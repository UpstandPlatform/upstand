import { hostVerifierForFingerprint } from "@upstand/platform/ssh/host-key";
import type { ServerProvisioningPort } from "@upstand/usecases";
import type { CaddySettings } from "@upstand/usecases/ports/caddy";
import { Client } from "ssh2";
import { generateCaddyfileContent } from "../caddy/caddy.service";

const CADDY_CONTAINER_NAME = "upstand-caddy";
const CADDY_IMAGE = "caddy:2.8-alpine";
const CADDY_NETWORK = "upstand-network";

export function createServerProvisioningPort(): ServerProvisioningPort {
  return {
    connect: async ({ server, privateKey, hostKeyFingerprint }) => {
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
            hostHash: "sha256",
            hostVerifier: hostVerifierForFingerprint(hostKeyFingerprint),
            readyTimeout: 20_000,
          });
      });

      // Run docker info via SSH to avoid the Unix socket proxy (not supported on Windows).
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
        initializeCaddy: (settings) => initializeCaddyViaSsh(client, settings),
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
): Promise<void> {
  // Generate the initial Caddyfile and base64-encode it for the bootstrap env var.
  const caddyfileContent = generateCaddyfileContent(settings);
  const bootstrapConfig = Buffer.from(caddyfileContent).toString("base64");

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
      `docker volume inspect ${vol} >/dev/null 2>&1 || docker volume create ${vol}`,
    );
    if (r.code !== 0) {
      throw new Error(
        `Failed to create Docker volume '${vol}': ${r.stderr.trim()}`,
      );
    }
  }

  // 2. Pull the Caddy image (no-op if already present).
  const pull = await execute(client, `docker pull ${CADDY_IMAGE}`);
  if (pull.code !== 0) {
    throw new Error(`Failed to pull ${CADDY_IMAGE}: ${pull.stderr.trim()}`);
  }

  // 3. Check whether the container already exists.
  const inspect = await execute(
    client,
    `docker inspect ${CADDY_CONTAINER_NAME} >/dev/null 2>&1`,
  );

  if (inspect.code === 0) {
    // Container already exists – make sure it is running and on the overlay network.
    await execute(
      client,
      `docker start ${CADDY_CONTAINER_NAME} 2>/dev/null || true`,
    );
    await execute(
      client,
      `docker network connect ${CADDY_NETWORK} ${CADDY_CONTAINER_NAME} 2>/dev/null || true`,
    );
    return;
  }

  // 4. Create the container (mirrors CaddyService.initializeCaddy exactly).
  //    The container is first created disconnected from the network, then the
  //    overlay network is attached before starting – matching what the Docker
  //    API path does (create → network connect → start).
  const runCmd = [
    "docker create",
    `--name ${CADDY_CONTAINER_NAME}`,
    "--restart always",
    "-p 80:80",
    "-p 443:443",
    "-p 443:443/udp",
    "-v upstand-caddy-runtime:/etc/caddy",
    "-v upstand-caddy-data:/data",
    "-v upstand-caddy-config:/config",
    "-v upstand-caddy-logs:/var/log/caddy",
    `-e UPSTAND_CADDYFILE_B64=${bootstrapConfig}`,
    "--entrypoint /bin/sh",
    CADDY_IMAGE,
    "-ec",
    `'if [ ! -s /etc/caddy/Caddyfile ]; then printf "%s" "$UPSTAND_CADDYFILE_B64" | base64 -d > /etc/caddy/Caddyfile; fi; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile'`,
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
    `docker network connect ${CADDY_NETWORK} ${CADDY_CONTAINER_NAME}`,
  );
  if (connect.code !== 0) {
    throw new Error(
      `Failed to connect Caddy to ${CADDY_NETWORK}: ${connect.stderr.trim()}`,
    );
  }

  // 6. Start the container.
  const start = await execute(client, `docker start ${CADDY_CONTAINER_NAME}`);
  if (start.code !== 0) {
    throw new Error(`Failed to start Caddy container: ${start.stderr.trim()}`);
  }
}

async function execute(
  client: Client,
  command: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      let finished = false;
      const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        resolve({ code, stdout, stderr });
        stream.destroy();
      };
      stream.on("exit", (code: number | null) => {
        exitCode = code;
        setTimeout(() => finish(code), 20);
      });
      stream.on("close", () => finish(exitCode));
      stream.on("error", reject);
      stream.on("data", (data: Buffer | string) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data: Buffer | string) => {
        stderr += data.toString();
      });
    });
  });
}
