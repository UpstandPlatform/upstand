import { hostVerifierForFingerprint } from "@upstand/platform/ssh/host-key";
import type { ServerProvisioningPort } from "@upstand/usecases";
import type { CaddySettings } from "@upstand/usecases/ports/caddy";
import { Client } from "ssh2";
import { generateCaddyfileContent } from "../caddy/caddy.service";

const CADDY_CONTAINER_NAME = "upstand-caddy";
const CADDY_IMAGE =
  "caddy:2.8-alpine@sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17";
const CADDY_NETWORK = "upstand-network";
export const MAX_SSH_STDOUT_BYTES = 2 * 1024 * 1024;
export const MAX_SSH_STDERR_BYTES = 512 * 1024;

const OVERLAYFS_PERMISSION_ERROR =
  /failed to mount[^\n]*overlay[^\n]*(?:permission denied|operation not permitted)/i;

export function appendBoundedSshOutput(
  current: string,
  chunk: Buffer | string,
  maxBytes: number,
  streamName: "stdout" | "stderr",
): string {
  const text = chunk.toString();
  if (
    Buffer.byteLength(current, "utf8") + Buffer.byteLength(text, "utf8") >
    maxBytes
  ) {
    throw new Error(
      `SSH ${streamName} output exceeded the ${maxBytes}-byte safety limit`,
    );
  }
  return current + text;
}

export function createServerProvisioningPort(): ServerProvisioningPort {
  return {
    connect: async ({ server, privateKey, password, hostKeyFingerprint }) => {
      const client = new Client();
      await new Promise<void>((resolve, reject) => {
        client
          .once("ready", resolve)
          .once("error", reject)
          .connect({
            host: server.ipAddress,
            port: server.port,
            username: server.username,
            privateKey,
            password,
            hostHash: "sha256",
            hostVerifier: hostVerifierForFingerprint(hostKeyFingerprint),
            readyTimeout: 20_000,
          });
      });

      // Run docker info via SSH to avoid the Unix socket proxy (not supported on Windows).
      const dockerCommand =
        server.username === "root" ? "docker" : "sudo -n docker";
      const dockerInfoViaSsh = async (): Promise<{
        Swarm?: { LocalNodeState?: string };
      }> => {
        const result = await execute(client, "docker info --format json");
        if (result.code !== 0) {
          throw new Error(
            `docker info failed (code ${result.code}): ${result.stderr.trim()}`,
          );
        }
        try {
          return JSON.parse(result.stdout.trim());
        } catch {
          throw new Error(
            `Failed to parse docker info output: ${result.stdout.slice(0, 200)}`,
          );
        }
      };

      return {
        execute: (command) => execute(client, command),
        upload: (localPath, remotePath) =>
          new Promise<void>((resolve, reject) => {
            client.sftp((error, sftp) => {
              if (error) return reject(error);
              sftp.fastPut(localPath, remotePath, (putError) =>
                putError ? reject(putError) : resolve(),
              );
            });
          }),
        dockerInfo: dockerInfoViaSsh,
        initializeCaddy: (settings) =>
          initializeCaddyViaSsh(client, settings, dockerCommand),
        close: async () => {
          client.end();
        },
      };
    },
  };
}

/**
 * Sets up the Caddy reverse-proxy container on the remote server using plain
 * SSH commands.  This avoids the dockerode Unix-socket proxy which is not
 * available on Windows, while producing an identical result to
 * CaddyService.initializeCaddy().
 */
async function initializeCaddyViaSsh(
  client: Client,
  settings: CaddySettings,
  dockerCommand: string,
): Promise<void> {
  // Generate the initial Caddyfile and base64-encode it for the bootstrap env var.
  const caddyfileContent = generateCaddyfileContent(settings);
  const bootstrapConfig = Buffer.from(caddyfileContent).toString("base64");
  const caddyHttpPort = settings.httpPort ?? 80;
  const caddyHttpsPort = settings.httpsPort ?? 443;
  const publishedHttpPort = 80;
  const publishedHttpsPort = 443;

  // 1. Create required named volumes (idempotent).
  const volumes = [
    "upstand-caddy-runtime",
    "upstand-caddy-data",
    "upstand-caddy-config",
    "upstand-caddy-logs",
  ];
  for (const vol of volumes) {
    const r = await execute(
      client,
      `${dockerCommand} volume inspect ${vol} >/dev/null 2>&1 || ${dockerCommand} volume create ${vol}`,
    );
    if (r.code !== 0) {
      throw new Error(
        `Failed to create Docker volume '${vol}': ${r.stderr.trim()}`,
      );
    }
  }

  // 2. Pull the Caddy image (no-op if already present).
  const pull = await execute(
    client,
    `${dockerCommand} pull ${shellQuote(CADDY_IMAGE)}`,
  );
  if (pull.code !== 0) {
    const diagnostic = await execute(
      client,
      `${dockerCommand} info --format 'driver={{.Driver}} root={{.DockerRootDir}} security={{json .SecurityOptions}}' 2>&1`,
      30_000,
    );
    throw new Error(
      formatCaddyPullError(
        CADDY_IMAGE,
        pull.stderr.trim() || pull.stdout.trim(),
        diagnostic.stdout.trim() || diagnostic.stderr.trim(),
      ),
    );
  }

  // 3. Check whether the container already exists.
  const inspect = await execute(
    client,
    `${dockerCommand} inspect ${CADDY_CONTAINER_NAME} >/dev/null 2>&1`,
  );

  if (inspect.code === 0) {
    const bindings = await execute(
      client,
      `${dockerCommand} inspect --format '{{json .HostConfig.PortBindings}}' ${CADDY_CONTAINER_NAME}`,
    );
    let expectedBindings = true;
    try {
      const parsed = JSON.parse(bindings.stdout.trim()) as Record<
        string,
        Array<{ HostPort?: string }>
      >;
      const expected = [
        [`${caddyHttpPort}/tcp`, String(publishedHttpPort)],
        [`${caddyHttpsPort}/tcp`, String(publishedHttpsPort)],
        ...(settings.enableHttp3 === false
          ? []
          : [[`${caddyHttpsPort}/udp`, String(publishedHttpsPort)]]),
      ] as const;
      expectedBindings = expected.every(([target, hostPort]) =>
        parsed[target]?.some((binding) => binding.HostPort === hostPort),
      );
    } catch {
      expectedBindings = false;
    }
    if (!expectedBindings) {
      await execute(client, `${dockerCommand} rm -f ${CADDY_CONTAINER_NAME}`);
    } else {
      // Container already exists – make sure it is running and on the overlay network.
      await execute(
        client,
        `${dockerCommand} start ${CADDY_CONTAINER_NAME} 2>/dev/null || true`,
      );
      await execute(
        client,
        `${dockerCommand} network connect ${CADDY_NETWORK} ${CADDY_CONTAINER_NAME} 2>/dev/null || true`,
      );
      return;
    }
  }

  // 4. Create the container (mirrors CaddyService.initializeCaddy exactly).
  //    The container is first created disconnected from the network, then the
  //    overlay network is attached before starting – matching what the Docker
  //    API path does (create → network connect → start).
  const runCmd = [
    `${dockerCommand} create`,
    `--name ${shellQuote(CADDY_CONTAINER_NAME)}`,
    "--label com.upstand.component=caddy",
    "--label com.upstand.platform=true",
    "--restart always",
    `-p ${shellQuote(`${publishedHttpPort}:${caddyHttpPort}`)}`,
    `-p ${shellQuote(`${publishedHttpsPort}:${caddyHttpsPort}`)}`,
    ...(settings.enableHttp3 === false
      ? []
      : [`-p ${shellQuote(`${publishedHttpsPort}:${caddyHttpsPort}/udp`)}`]),
    "-v upstand-caddy-runtime:/etc/caddy",
    "-v upstand-caddy-data:/data",
    "-v upstand-caddy-config:/config",
    "-v upstand-caddy-logs:/var/log/caddy",
    `-e ${shellQuote(`UPSTAND_CADDYFILE_B64=${bootstrapConfig}`)}`,
    "--entrypoint /bin/sh",
    shellQuote(CADDY_IMAGE),
    "-ec",
    shellQuote(
      `if [ ! -s /etc/caddy/Caddyfile ]; then printf '%s' "$UPSTAND_CADDYFILE_B64" | base64 -d > /etc/caddy/Caddyfile; fi; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`,
    ),
  ].join(" ");

  const create = await execute(client, runCmd);
  if (create.code !== 0) {
    throw new Error(
      `Failed to create Caddy container: ${create.stderr.trim()}`,
    );
  }

  // 5. Attach to the overlay network.
  const connect = await execute(
    client,
    `${dockerCommand} network connect ${CADDY_NETWORK} ${CADDY_CONTAINER_NAME}`,
  );
  if (connect.code !== 0) {
    throw new Error(
      `Failed to connect Caddy to ${CADDY_NETWORK}: ${connect.stderr.trim()}`,
    );
  }

  // 6. Start the container.
  const start = await execute(
    client,
    `${dockerCommand} start ${CADDY_CONTAINER_NAME}`,
  );
  if (start.code !== 0) {
    throw new Error(`Failed to start Caddy container: ${start.stderr.trim()}`);
  }
}

export function formatCaddyPullError(
  image: string,
  detail: string,
  dockerDiagnostic = "",
): string {
  const base = `Failed to pull ${image}: ${detail || "unknown Docker error"}`;
  if (!OVERLAYFS_PERMISSION_ERROR.test(detail)) return base;

  return [
    base,
    "Remote Docker cannot mount its overlay filesystem.",
    dockerDiagnostic.includes("driver=overlayfs")
      ? "The Docker daemon is using the overlayfs snapshotter, but the host denied the required mount. This commonly happens with an unprivileged LXC/Incus container, restricted VPS kernel, or a security policy that blocks nested overlay mounts."
      : "This usually means the server is running rootless Docker, an unprivileged LXC/Incus container, or Docker data is on an unsupported filesystem.",
    "Run Docker on a VM or bare-metal host, or enable nested Docker/overlayfs with nesting and keyctl where applicable. For rootless Docker, configure fuse-overlayfs; for rootful Docker, use ext4 or XFS with ftype=1. Then verify `docker run --rm hello-world` and retry setup.",
    dockerDiagnostic ? `Docker storage diagnostic: ${dockerDiagnostic}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function execute(
  client: Client,
  command: string,
  timeoutMs = 600_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      let finished = false;
      const terminate = () => {
        try {
          (stream as unknown as { signal?: (signal: string) => void }).signal?.(
            "KILL",
          );
        } catch {
          // Closing the SSH channel below remains the fallback when the
          // server does not support channel signals.
        }
        stream.destroy();
      };
      const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr });
        terminate();
      };
      timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          terminate();
          reject(
            new Error(
              `SSH command execution timed out after ${timeoutMs / 1000}s`,
            ),
          );
        }
      }, timeoutMs);
      stream.on("exit", (code: number | null) => {
        exitCode = code;
        setTimeout(() => finish(code), 20);
      });
      stream.on("close", () => finish(exitCode));
      stream.on("error", (err: unknown) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      stream.on("data", (data: Buffer | string) => {
        try {
          stdout = appendBoundedSshOutput(
            stdout,
            data,
            MAX_SSH_STDOUT_BYTES,
            "stdout",
          );
        } catch (error) {
          if (timer) clearTimeout(timer);
          if (!finished) {
            finished = true;
            terminate();
            reject(error);
          }
        }
      });
      stream.stderr.on("data", (data: Buffer | string) => {
        try {
          stderr = appendBoundedSshOutput(
            stderr,
            data,
            MAX_SSH_STDERR_BYTES,
            "stderr",
          );
        } catch (error) {
          if (timer) clearTimeout(timer);
          if (!finished) {
            finished = true;
            terminate();
            reject(error);
          }
        }
      });
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
