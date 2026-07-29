import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { IUnitOfWork, Server } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { log } from "evlog";
import { z } from "zod";
import type {
  ServerProvisioningPort,
  ServerProvisioningSession,
} from "../ports/server-provisioning";
import { getServerProvisioningPlan } from "./server-role";

export const SetupServerInputSchema = z.object({
  id: z.string().min(1, "Server ID is required"),
});

export type SetupServerInput = z.infer<typeof SetupServerInputSchema>;

export class SetupServerUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly provisioning: ServerProvisioningPort,
  ) {}

  async execute(
    input: SetupServerInput,
  ): Promise<{ success: boolean; message: string }> {
    const server = await this.uow.serverRepository.findById(input.id);
    if (!server) {
      throw new Error("Server not found");
    }

    if (!server.sshKeyId) {
      throw new Error("Server does not have an SSH Key configured");
    }
    if (!server.sshHostKeyFingerprint) {
      throw new Error("Trust the server SSH host key before provisioning it");
    }

    const sshKey = await this.uow.sshKeyRepository.findById(server.sshKeyId);
    if (!sshKey) {
      throw new Error("Configured SSH Key not found");
    }

    // Update status to setting_up
    await this.uow.serverRepository.updateById(server.id, {
      status: "setting_up",
      setupError: null,
    });

    // Decrypt the private key
    const privateKey = decryptSecret({
      ciphertext: sshKey.privateKeyCiphertext,
      iv: sshKey.privateKeyIv,
      authTag: sshKey.privateKeyAuthTag,
      keyVersion: sshKey.privateKeyVersion,
    });

    return this.runSetup(server, privateKey, server.sshHostKeyFingerprint);
  }

  private async runSetup(
    server: Server,
    privateKey: string,
    hostKeyFingerprint: string,
  ): Promise<{ success: boolean; message: string }> {
    let session: ServerProvisioningSession | null = null;
    const plan = getServerProvisioningPlan(server.serverType);

    const executeCommand = async (cmd: string): Promise<string> => {
      if (!session) throw new Error("Provisioning session is not connected");
      const result = await session.execute(cmd);
      if (result.code !== 0) {
        throw new Error(
          `Command failed with code ${result.code}. Stderr: ${result.stderr.trim()}`,
        );
      }
      return result.stdout;
    };

    try {
      session = await this.provisioning.connect({
        server,
        privateKey,
        hostKeyFingerprint,
      });
      const connectedSession = session;

      let sudo: string;
      try {
        sudo = (
          await executeCommand(
            "if [ \"$(id -u)\" -eq 0 ]; then printf ''; elif sudo -n true 2>/dev/null; then printf 'sudo '; else exit 1; fi",
          )
        ).trim();
      } catch {
        throw new Error(
          "The SSH user is not root and does not have passwordless sudo access.",
        );
      }
      const privileged = (command: string) =>
        executeCommand(`${sudo ? `${sudo} ` : ""}${command}`);

      // 1. Install Docker if not present
      log.info({
        message: `[Server Setup] Checking Docker installation on ${server.ipAddress}`,
      });
      try {
        await executeCommand("docker --version");
      } catch {
        log.info({
          message: `[Server Setup] Docker not found on ${server.ipAddress}. Installing Docker...`,
        });
        await executeCommand(buildDockerInstallCommand(sudo));
      }

      await privileged("systemctl enable --now docker");
      if (sudo) {
        await privileged('usermod -aG docker "$USER"');
      }

      // systemctl can return before dockerd has finished creating its socket.
      // Give the daemon a short, bounded window to become ready before
      // attempting Swarm operations. This also makes retries after a failed
      // setup deterministic instead of depending on daemon startup timing.
      const remoteInfo = await waitForDocker(() =>
        connectedSession.dockerInfo(),
      );
      if (plan.requiresSwarm) {
        // Each deployment/database host owns an independent Swarm. It must
        // never join the control-plane cluster because its resource network,
        // scheduling, and failure domain are isolated from that control plane.
        log.info({
          message: `[Server Setup] Checking Swarm status on ${server.ipAddress}`,
          serverType: server.serverType,
        });
        const remoteSwarmStatus =
          remoteInfo.Swarm?.LocalNodeState ?? "inactive";
        if (remoteSwarmStatus === "inactive") {
          log.info({
            message: `[Server Setup] Initializing an independent Docker Swarm on ${server.ipAddress}...`,
            serverType: server.serverType,
          });
          await privileged(
            `docker swarm init --advertise-addr ${shellQuote(server.ipAddress)}`,
          );
        } else if (remoteSwarmStatus !== "active") {
          throw new Error(
            `Docker Swarm is in '${remoteSwarmStatus}' state. Resolve the Docker or advertised-address issue on the server, then retry setup.`,
          );
        }

        await privileged("docker swarm update --task-history-limit 1");

        await privileged(
          "docker network inspect upstand-network >/dev/null 2>&1 || docker network create --driver overlay --attachable upstand-network",
        );

        const initializedInfo = await waitForDocker(() =>
          connectedSession.dockerInfo(),
        );
        if (initializedInfo.Swarm?.LocalNodeState !== "active") {
          throw new Error(
            `Remote Docker Swarm is not active after initialization (state: ${initializedInfo.Swarm?.LocalNodeState ?? "unknown"}).`,
          );
        }
      } else {
        log.info({
          message: `[Server Setup] ${server.name} is a build server; Docker was verified without creating a Swarm or public edge.`,
        });
      }

      if (plan.requiresCaddy) {
        // Only deployment servers expose Caddy. Database servers deliberately
        // have no edge proxy, so database credentials and ports stay private.
        const webServerSettings =
          await this.uow.webServerSettingsRepository.findGlobal();
        await connectedSession.initializeCaddy(webServerSettings ?? {});
      }

      if (plan.requiresMonitoring) {
        await this.setupMonitoringAgent(connectedSession, server, privileged);
      }

      log.info({
        message: `[Server Setup] Server ${server.name} set up successfully.`,
      });
      await this.uow.serverRepository.updateById(server.id, {
        status: "ready",
        setupError: null,
      });
      return {
        success: true,
        message: "Remote server connected and configured successfully.",
      };
    } catch (err: unknown) {
      const message = toSetupErrorMessage(err);
      log.error({
        message: `[Server Setup] Error setting up server ${server.name}: ${message}`,
        err: err instanceof Error ? err.stack : String(err),
      });
      await this.uow.serverRepository.updateById(server.id, {
        status: "failed",
        setupError: message,
      });
      throw new Error(message);
    } finally {
      await session?.close();
    }
  }

  private async setupMonitoringAgent(
    session: ServerProvisioningSession,
    server: Server,
    privileged: (cmd: string) => Promise<string>,
  ): Promise<void> {
    log.info({
      message: `[Monitoring Setup] Provisioning Monitoring Agent on ${server.ipAddress}...`,
    });

    let settings = await this.uow.monitoringSettingsRepository.findByServerId(
      server.id,
    );
    if (!settings) {
      const generatedToken = randomBytes(24).toString("hex");
      settings = await this.uow.monitoringSettingsRepository.upsert({
        serverId: server.id,
        token: generatedToken,
        cpuThreshold: 90,
        memoryThreshold: 90,
      });
    }

    const token = settings.token;

    const configuredMonitoringImage = env.UPSTAND_MONITORING_IMAGE?.trim();
    const monitoringImage =
      configuredMonitoringImage || "upstand-monitoring-agent";
    let remoteTarPath: string | undefined;
    let remoteSrcPath: string | undefined;

    if (configuredMonitoringImage) {
      if (
        env.NODE_ENV === "production" &&
        !/@sha256:[a-f0-9]{64}$/i.test(configuredMonitoringImage)
      ) {
        throw new Error(
          "UPSTAND_MONITORING_IMAGE must use an immutable sha256 digest in production",
        );
      }
      log.info({
        message: `[Monitoring Setup] Pulling immutable monitoring image ${configuredMonitoringImage} on ${server.ipAddress}...`,
      });
      await privileged(`docker pull ${shellQuote(configuredMonitoringImage)}`);
    } else {
      if (env.NODE_ENV === "production") {
        throw new Error(
          "UPSTAND_MONITORING_IMAGE is required in production for remote monitoring setup",
        );
      }

      let monitoringPath = path.join(process.cwd(), "apps", "monitoring");
      if (!fs.existsSync(monitoringPath)) {
        const alternativePath = path.join(
          process.cwd(),
          "..",
          "..",
          "apps",
          "monitoring",
        );
        if (fs.existsSync(alternativePath)) monitoringPath = alternativePath;
      }
      if (!fs.existsSync(monitoringPath)) {
        throw new Error(
          `Monitoring agent source path not found: ${monitoringPath}`,
        );
      }

      const tarFileName = `monitoring-${server.id}-${Date.now()}.tar.gz`;
      const localTarPath = path.join(process.cwd(), ".builds", tarFileName);
      fs.mkdirSync(path.dirname(localTarPath), { recursive: true });
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      log.info({
        message: `[Monitoring Setup] Creating tarball at ${localTarPath}`,
      });
      await execAsync(`tar -czf "${localTarPath}" -C "${monitoringPath}" .`);

      remoteTarPath = `/tmp/${tarFileName}`;
      remoteSrcPath = `/tmp/monitoring-src-${server.id}`;
      log.info({
        message: `[Monitoring Setup] Uploading tarball to ${server.ipAddress}:${remoteTarPath}`,
      });
      if (!remoteTarPath) throw new Error("Remote archive path is missing");
      await session.upload(localTarPath, remoteTarPath);
      fs.unlinkSync(localTarPath);

      log.info({
        message:
          "[Monitoring Setup] Extracting and building Docker image on remote server...",
      });
      await privileged(
        `mkdir -p ${remoteSrcPath} && tar -xzf ${remoteTarPath} -C ${remoteSrcPath}`,
      );
      await privileged(
        `docker build -t ${shellQuote(monitoringImage)} ${shellQuote(remoteSrcPath)}`,
      );
    }

    const containerName = "upstand-monitoring-agent";
    const globalSettings =
      await this.uow.webServerSettingsRepository.findGlobal();
    const controlPlaneIp = globalSettings?.serverIp || "localhost";

    const metricsConfig = {
      server: {
        serverId: server.id,
        refreshRate: 25,
        port: 3001,
        serverType: "Remote",
        token: token,
        urlCallback: `http://${controlPlaneIp}:${env.PORT}/api/monitoring/alerts`,
        retentionDays: 7,
        cronJob: "0 0 * * *",
        thresholds: {
          cpu: settings.cpuThreshold,
          memory: settings.memoryThreshold,
        },
      },
      containers: {
        refreshRate: 25,
        services: {
          include: [],
          exclude: [],
        },
      },
    };

    log.info({
      message: `[Monitoring Setup] Starting upstand-monitoring-agent container on ${server.ipAddress}...`,
    });
    const monitoringCommand = buildMonitoringAgentContainerCommand({
      containerName,
      monitoringImage,
      metricsConfig,
    });
    await privileged(`sh -ec ${shellQuote(monitoringCommand)}`);

    if (remoteTarPath && remoteSrcPath) {
      await privileged(`rm -rf ${remoteTarPath} ${remoteSrcPath}`);
    }
    log.info({
      message: `[Monitoring Setup] Monitoring Agent configured successfully on ${server.ipAddress}! ✅`,
    });
  }
}

export function buildMonitoringAgentContainerCommand(input: {
  containerName: string;
  monitoringImage: string;
  metricsConfig: object;
}): string {
  const containerName = shellQuote(input.containerName);
  const monitoringImage = shellQuote(input.monitoringImage);

  return [
    "set -eu",
    "exec 9>/var/lock/upstand-monitoring-agent.lock",
    "flock -x 9",
    // Restrict inspection to containers. The development image intentionally
    // shares this name, and untyped `docker inspect` may resolve that image
    // before the first monitoring container has been created.
    `if docker container inspect ${containerName} >/dev/null 2>&1; then`,
    `  label="$(docker container inspect -f '{{index .Config.Labels "com.upstand.component"}}' ${containerName})"`,
    `  image="$(docker container inspect -f '{{.Config.Image}}' ${containerName})"`,
    `  test "$label" = monitoring-agent || test "$image" = ${monitoringImage} || { echo 'refusing to replace unrelated container ${input.containerName}' >&2; exit 1; }`,
    `  docker container rm -f ${containerName} >/dev/null`,
    "fi",
    "docker run -d " +
      `--name ${containerName} ` +
      "--label com.upstand.component=monitoring-agent " +
      "--restart always " +
      "--cap-drop ALL " +
      "--security-opt no-new-privileges:true " +
      "--read-only " +
      "--tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m " +
      "--memory 256m " +
      "--pids-limit 128 " +
      "--log-opt max-size=10m --log-opt max-file=3 " +
      "-p 127.0.0.1:3001:3001 " +
      "-e DB_PATH=/data/monitoring.db " +
      `-e METRICS_CONFIG=${shellQuote(JSON.stringify(input.metricsConfig))} ` +
      "-v /var/run/docker.sock:/var/run/docker.sock:ro " +
      "-v /proc:/host/proc:ro " +
      "-v /sys:/host/sys:ro " +
      "-v /etc/os-release:/etc/os-release:ro " +
      "-v upstand-monitoring-data:/data " +
      monitoringImage,
  ].join("\n");
}

const DOCKER_GPG_KEY_FINGERPRINT = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88";

/**
 * Build a non-interactive Docker Engine installation command for supported
 * Debian-family hosts. The installer is deliberately repository-based: the
 * key and repository metadata are verified before apt is allowed to install
 * packages, and the mutable convenience script is never executed.
 */
export function buildDockerInstallCommand(
  sudo: string,
  requestedVersion = env.UPSTAND_DOCKER_VERSION?.trim(),
): string {
  const privileged = (command: string) => `${sudo ? `${sudo} ` : ""}${command}`;
  const packages = requestedVersion
    ? `docker-ce=${shellQuote(requestedVersion)} docker-ce-cli=${shellQuote(requestedVersion)} containerd.io docker-buildx-plugin docker-compose-plugin`
    : "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin";
  const packageInstall = `${privileged("env DEBIAN_FRONTEND=noninteractive apt-get install -y")} ${packages}`;

  return [
    "set -eu",
    'test -r /etc/os-release || { echo "Unsupported host: /etc/os-release is missing" >&2; exit 1; }',
    ". /etc/os-release",
    `case "\${ID:-}" in ubuntu) docker_repo=ubuntu ;; debian) docker_repo=debian ;; *) echo "Unsupported host OS: \${ID:-unknown}. Install Docker manually and retry." >&2; exit 1 ;; esac`,
    `test -n "\${VERSION_CODENAME:-}" || { echo "Unsupported host: distribution codename is unavailable" >&2; exit 1; }`,
    privileged("apt-get update"),
    privileged(
      "env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg",
    ),
    'key_tmp=$(mktemp); keyring_tmp=$(mktemp); source_tmp=$(mktemp); trap \'rm -f "$key_tmp" "$keyring_tmp" "$source_tmp"\' EXIT',
    'curl --fail --silent --show-error --location --proto "=https" --tlsv1.2 https://download.docker.com/linux/$docker_repo/gpg -o "$key_tmp"',
    `key_fingerprint=$(gpg --batch --show-keys --with-colons "$key_tmp" | awk -F: '$1 == "fpr" { print toupper($10); exit }'); test "$key_fingerprint" = "${DOCKER_GPG_KEY_FINGERPRINT}" || { echo "Docker repository key fingerprint mismatch" >&2; exit 1; }`,
    `gpg --batch --dearmor -o "$keyring_tmp" "$key_tmp"`,
    privileged("install -m 0755 -d /etc/apt/keyrings"),
    privileged('install -m 0644 "$keyring_tmp" /etc/apt/keyrings/docker.gpg'),
    'printf "Types: deb\\nURIs: https://download.docker.com/linux/%s\\nSuites: %s\\nComponents: stable\\nArchitectures: %s\\nSigned-By: /etc/apt/keyrings/docker.gpg\\n" "$docker_repo" "$VERSION_CODENAME" "$(dpkg --print-architecture)" > "$source_tmp"',
    privileged(
      'install -m 0644 "$source_tmp" /etc/apt/sources.list.d/docker.sources',
    ),
    privileged("apt-get update"),
    packageInstall,
  ].join(" && ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const EXISTING_SWARM_SETUP_GUIDANCE =
  "Upstand does not force-leave an existing Swarm. An active existing Swarm can be reused; if initialization failed, resolve the Docker or advertised-address issue on the server, then retry setup.";

async function waitForDocker<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableDockerError(error) || attempt === 7) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableDockerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|Cannot connect to the Docker daemon|socket hang up|ENOENT/i.test(
    message,
  );
}

function toSetupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/already part of a swarm/i.test(message)) {
    return EXISTING_SWARM_SETUP_GUIDANCE;
  }
  if (/different Docker Swarm cluster/i.test(message)) {
    return EXISTING_SWARM_SETUP_GUIDANCE;
  }
  if (/ECONNREFUSED|Cannot connect to the Docker daemon/i.test(message)) {
    return `Docker refused the connection on the remote server. Verify that Docker is running and its local socket is available (for example, run 'sudo systemctl status docker' and 'sudo docker info' on the server), then retry setup. ${EXISTING_SWARM_SETUP_GUIDANCE}`;
  }
  if (
    /advertise|advertised address|address.*(available|assigned|bound)/i.test(
      message,
    )
  ) {
    return `Docker could not use the advertised address. Make sure the address is assigned to a network interface on the server and is reachable by its Docker network, then retry setup. ${EXISTING_SWARM_SETUP_GUIDANCE}`;
  }
  if (/authentication methods failed|client-authentication/i.test(message)) {
    return "SSH authentication failed. Verify the selected private key matches the public key in the remote user's ~/.ssh/authorized_keys, and confirm the username and port.";
  }
  if (/passwordless sudo/i.test(message)) return message;
  if (/timed out|timeout|connect/i.test(message)) {
    return `${message} Verify that the host is reachable and its SSH port is open from the Upstand server.`;
  }
  return message;
}
