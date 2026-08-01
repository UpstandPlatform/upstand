import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { IUnitOfWork, Resource } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { hostVerifierForFingerprint } from "@upstand/platform/ssh/host-key";
import {
  isSafeSshHost,
  isSafeSshUsername,
} from "@upstand/platform/ssh/validate";
import type {
  DockerInfrastructureResolverPort,
  DockerServicePort,
} from "@upstand/usecases/ports/docker";
import Docker from "dockerode";
import { Client } from "ssh2";
import { CaddyService } from "../caddy/caddy.service";
import { DockerService } from "./docker.service";

let proxyStarted = false;
const PROXY_PORT = 23775;
// Port range for remote Docker SSH proxies on Windows (Unix sockets unsupported).
let nextRemoteProxyPort = 23776;
type RemoteProxyEntry = { socketPath: string } | { host: string; port: number };
const remoteDockerProxies = new Map<string, RemoteProxyEntry>();

export function getDockerInstance(): Docker {
  const isWindows = process.platform === "win32";
  const isBun = typeof process.versions.bun !== "undefined";

  if (isWindows && isBun) {
    ensureDockerProxy();
    return new Docker({ host: "127.0.0.1", port: PROXY_PORT });
  }

  return new Docker();
}

export interface RemoteDockerConnection {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  hostKeyFingerprint?: string;
}

function assertSafeRemoteConnection(
  connection: RemoteDockerConnection,
): string {
  const host = connection.host.replace(/^ssh:\/\//, "");
  if (
    !isSafeSshHost(host) ||
    !isSafeSshUsername(connection.username) ||
    !Number.isInteger(connection.port) ||
    connection.port < 1 ||
    connection.port > 65_535
  ) {
    throw new Error("Remote Docker SSH connection contains unsafe values");
  }
  return host;
}

/**
 * Creates a Docker API client for an independently managed deployment server.
 * Remote servers are not Swarm workers of the control-plane node; Docker's
 * SSH transport keeps the daemon socket private while retaining the Docker API.
 */
export function createRemoteDocker(connection: RemoteDockerConnection): Docker {
  if (!connection.hostKeyFingerprint) {
    throw new Error("Remote Docker SSH host key is not trusted");
  }
  assertSafeRemoteConnection(connection);
  const entry = ensureRemoteDockerProxy(connection);
  return "socketPath" in entry
    ? new Docker({ socketPath: entry.socketPath })
    : new Docker({ host: entry.host, port: entry.port });
}

function ensureRemoteDockerProxy(
  connection: RemoteDockerConnection,
): RemoteProxyEntry {
  const trustedFingerprint = connection.hostKeyFingerprint;
  if (!trustedFingerprint) {
    throw new Error("Remote Docker SSH host key is not trusted");
  }
  const credentialKey = connection.privateKey || connection.password || "";
  const key = createHash("sha256")
    .update(
      `${connection.host}:${connection.port}:${connection.username}:${credentialKey}`,
    )
    .digest("hex");
  const existing = remoteDockerProxies.get(key);
  if (existing) return existing;

  // Build the per-connection SSH-tunnel proxy server. Each incoming TCP/socket
  // connection opens a fresh SSH session and pipes data through
  // `docker system dial-stdio` so dockerode can speak the Docker HTTP API.
  const proxy = net.createServer((socket) => {
    const bufferedChunks: Buffer[] = [];
    let streamReady = false;
    let targetStream: NodeJS.ReadWriteStream | null = null;

    let socketEnded = false;

    socket.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === "string"
          ? Buffer.from(chunk)
          : Buffer.from(chunk);
      if (streamReady && targetStream) {
        targetStream.write(buf);
      } else {
        bufferedChunks.push(buf);
      }
    });

    socket.on("end", () => {
      socketEnded = true;
      if (targetStream) targetStream.end();
    });

    const client = new Client();
    const fail = () => {
      client.end();
      socket.destroy();
    };
    client
      .once("ready", () => {
        client.exec("docker system dial-stdio", (error, stream) => {
          if (error) return fail();
          targetStream = stream;
          stream.stderr?.resume?.();
          for (const chunk of bufferedChunks) {
            stream.write(chunk);
          }
          bufferedChunks.length = 0;
          streamReady = true;
          if (socketEnded) {
            targetStream.end();
          }

          stream.on("data", (chunk: Buffer) => {
            socket.write(chunk);
          });
          stream.once("end", () => {
            socket.end();
          });
          stream.once("close", () => {
            socket.end();
            client.end();
          });
          stream.once("error", fail);
        });
      })
      .once("error", fail)
      .connect({
        host: connection.host.replace(/^ssh:\/\//, ""),
        port: connection.port,
        username: connection.username,
        privateKey: connection.privateKey,
        password: connection.password,
        hostHash: "sha256",
        hostVerifier: hostVerifierForFingerprint(trustedFingerprint),
      });
    socket.setTimeout(60000);
    socket.once("timeout", fail);
    socket.once("error", fail);
  });

  // Windows does not support Unix-domain sockets on arbitrary file paths.
  // Use a local TCP port instead so dockerode can reach the SSH tunnel proxy.
  if (process.platform === "win32") {
    const localPort = nextRemoteProxyPort++;
    proxy.once("error", () => {
      remoteDockerProxies.delete(key);
    });
    proxy.listen(localPort, "127.0.0.1");
    const entry: RemoteProxyEntry = { host: "127.0.0.1", port: localPort };
    remoteDockerProxies.set(key, entry);
    return entry;
  }

  const socketPath = path.join(os.tmpdir(), `upstand-docker-${key}.sock`);
  fs.rmSync(socketPath, { force: true });
  proxy.once("error", () => {
    remoteDockerProxies.delete(key);
    fs.rmSync(socketPath, { force: true });
  });
  proxy.listen(socketPath);
  const entry: RemoteProxyEntry = { socketPath };
  remoteDockerProxies.set(key, entry);
  return entry;
}

export function createRemoteDockerCliEnvironment(
  connection: RemoteDockerConnection,
): {
  environment: Record<string, string | undefined>;
  cleanup: () => void;
} {
  if (!connection.hostKeyFingerprint) {
    throw new Error("Remote Docker SSH host key is not trusted");
  }

  // Docker CLI's SSH transport invokes an external `ssh` process. In the
  // production worker that process can inherit DOCKER_HOST but not the
  // temporary HOME/configuration directory, leaving the configured alias
  // unresolved. Reuse the same host-key-verified tunnel as Dockerode instead
  // of depending on external SSH config discovery.
  const entry = ensureRemoteDockerProxy(connection);
  const dockerHost =
    "socketPath" in entry
      ? `unix://${entry.socketPath}`
      : `tcp://${entry.host}:${entry.port}`;

  return {
    environment: {
      DOCKER_HOST: dockerHost,
    },
    cleanup: () => {},
  };
}

export async function resolveDockerCliEnvironmentForServer(
  serverId: string | null | undefined,
  uow: IUnitOfWork,
): Promise<{
  environment: Record<string, string | undefined>;
  cleanup: () => void;
}> {
  if (!serverId || serverId === "local" || serverId === "manager") {
    return { environment: {}, cleanup: () => {} };
  }

  const server = await uow.serverRepository.findById(serverId);
  if (!server) {
    throw new Error("Target deployment server was not found");
  }

  let privateKey: string | undefined;
  let password: string | undefined;

  const isPasswordAuth =
    server.authType === "password" ||
    (!server.sshKeyId && Boolean(server.passwordCiphertext));

  if (isPasswordAuth) {
    if (
      !server.passwordCiphertext ||
      !server.passwordIv ||
      !server.passwordAuthTag ||
      server.passwordVersion == null
    ) {
      throw new Error("Target deployment server password credentials missing");
    }
    password = decryptSecret({
      ciphertext: server.passwordCiphertext,
      iv: server.passwordIv,
      authTag: server.passwordAuthTag,
      keyVersion: server.passwordVersion,
    });
  } else {
    if (!server.sshKeyId) {
      throw new Error("Target deployment server has no SSH key configured");
    }
    const sshKey = await uow.sshKeyRepository.findById(server.sshKeyId);
    if (!sshKey) throw new Error("Target deployment server SSH key not found");
    privateKey = decryptSecret({
      ciphertext: sshKey.privateKeyCiphertext,
      iv: sshKey.privateKeyIv,
      authTag: sshKey.privateKeyAuthTag,
      keyVersion: sshKey.privateKeyVersion,
    });
  }

  return createRemoteDockerCliEnvironment({
    host: server.ipAddress,
    port: server.port,
    username: server.username,
    privateKey,
    password,
    hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
  });
}

export async function resolveDockerServiceForServer(
  serverId: string | null | undefined,
  uow: IUnitOfWork,
  defaultDockerService: DockerServicePort,
): Promise<{ dockerService: DockerServicePort; cleanup: () => void }> {
  if (!serverId || serverId === "local" || serverId === "manager") {
    return { dockerService: defaultDockerService, cleanup: () => {} };
  }

  const server = await uow.serverRepository.findById(serverId);
  if (!server) {
    throw new Error("Target deployment server was not found");
  }

  let privateKey: string | undefined;
  let password: string | undefined;

  const isPasswordAuth =
    server.authType === "password" ||
    (!server.sshKeyId && Boolean(server.passwordCiphertext));

  if (isPasswordAuth) {
    if (
      !server.passwordCiphertext ||
      !server.passwordIv ||
      !server.passwordAuthTag ||
      server.passwordVersion == null
    ) {
      throw new Error("Target deployment server password credentials missing");
    }
    password = decryptSecret({
      ciphertext: server.passwordCiphertext,
      iv: server.passwordIv,
      authTag: server.passwordAuthTag,
      keyVersion: server.passwordVersion,
    });
  } else {
    if (!server.sshKeyId) {
      throw new Error("Target deployment server has no SSH key configured");
    }

    const sshKey = await uow.sshKeyRepository.findById(server.sshKeyId);
    if (!sshKey) {
      throw new Error("Target deployment server SSH key not found");
    }

    privateKey = decryptSecret({
      ciphertext: sshKey.privateKeyCiphertext,
      iv: sshKey.privateKeyIv,
      authTag: sshKey.privateKeyAuthTag,
      keyVersion: sshKey.privateKeyVersion,
    });
  }

  const connection = {
    host: server.ipAddress,
    port: server.port,
    username: server.username,
    privateKey,
    password,
    hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
  };

  const remoteDocker = createRemoteDocker(connection);
  const remoteCli = createRemoteDockerCliEnvironment(connection);

  const dockerService = new DockerService(remoteDocker, remoteCli.environment);
  return {
    dockerService,
    cleanup: remoteCli.cleanup,
  };
}

export async function resolveServicesForResource(
  resource: Resource,
  uow: IUnitOfWork,
  defaultDockerService: DockerServicePort,
  defaultCaddyService: CaddyService,
): Promise<{
  dockerService: DockerServicePort;
  caddyService: CaddyService;
  cleanup: () => void;
}> {
  const serverId = resource.serverId;
  if (!serverId || serverId === "local" || serverId === "manager") {
    return {
      dockerService: defaultDockerService,
      caddyService: defaultCaddyService,
      cleanup: () => {},
    };
  }

  const server = await uow.serverRepository.findById(serverId);
  if (!server) {
    throw new Error("Resource target server was not found");
  }

  let privateKey: string | undefined;
  let password: string | undefined;

  const isPasswordAuth =
    server.authType === "password" ||
    (!server.sshKeyId && Boolean(server.passwordCiphertext));

  if (isPasswordAuth) {
    if (
      !server.passwordCiphertext ||
      !server.passwordIv ||
      !server.passwordAuthTag ||
      server.passwordVersion == null
    ) {
      throw new Error("Target deployment server password credentials missing");
    }
    password = decryptSecret({
      ciphertext: server.passwordCiphertext,
      iv: server.passwordIv,
      authTag: server.passwordAuthTag,
      keyVersion: server.passwordVersion,
    });
  } else {
    if (!server.sshKeyId) {
      throw new Error("Target deployment server has no SSH key configured");
    }

    const sshKey = await uow.sshKeyRepository.findById(server.sshKeyId);
    if (!sshKey) {
      throw new Error("Target deployment server SSH key not found");
    }

    privateKey = decryptSecret({
      ciphertext: sshKey.privateKeyCiphertext,
      iv: sshKey.privateKeyIv,
      authTag: sshKey.privateKeyAuthTag,
      keyVersion: sshKey.privateKeyVersion,
    });
  }

  const connection = {
    host: server.ipAddress,
    port: server.port,
    username: server.username,
    privateKey,
    password,
    hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
  };

  const remoteDocker = createRemoteDocker(connection);
  const remoteCli = createRemoteDockerCliEnvironment(connection);

  const dockerService = new DockerService(remoteDocker, remoteCli.environment);
  const caddyService = new CaddyService(remoteDocker);
  return {
    dockerService,
    caddyService,
    cleanup: remoteCli.cleanup,
  };
}

export function createDockerInfrastructureResolver(): DockerInfrastructureResolverPort {
  return {
    resolveDockerServiceForServer,
    resolveDockerCliEnvironmentForServer,
    resolveServicesForResource,
    createRemoteServices(connection) {
      const remoteDocker = createRemoteDocker(connection);
      const cli = createRemoteDockerCliEnvironment(connection);
      return {
        docker: remoteDocker,
        dockerService: new DockerService(remoteDocker, cli.environment),
        caddyService: new CaddyService(remoteDocker),
        cli,
        info: () => remoteDocker.info(),
      };
    },
  };
}

function ensureDockerProxy() {
  if (proxyStarted) return;
  const checkCode = `
    const net = require("net");
    const PORT = ${PROXY_PORT};
    let attempts = 0;
    function check() {
      const socket = new net.Socket();
      socket.connect(PORT, "127.0.0.1", () => {
        socket.destroy();
        process.exit(0);
      });
      socket.on("error", () => {
        attempts++;
        if (attempts > 50) process.exit(1);
        setTimeout(check, 20);
      });
    }
    check();
  `;
  if (
    spawnSync(process.execPath, ["-e", checkCode], { timeout: 2_000 })
      .status === 0
  ) {
    proxyStarted = true;
    return;
  }

  const code = `
    const net = require("net");
    const PIPE_PATH = "//./pipe/docker_engine";
    const PORT = ${PROXY_PORT};
    const server = net.createServer((socket) => {
      const pipe = net.connect(PIPE_PATH);
      const buffered = [];
      let pipeReady = false;
      let socketEnded = false;

      socket.on("data", (chunk) => {
        if (pipeReady) {
          pipe.write(chunk);
        } else {
          buffered.push(chunk);
        }
      });
      socket.on("end", () => {
        socketEnded = true;
        if (pipeReady) pipe.end();
      });
      socket.on("error", () => pipe.destroy());

      pipe.on("connect", () => {
        pipeReady = true;
        for (const chunk of buffered) pipe.write(chunk);
        buffered.length = 0;
        if (socketEnded) pipe.end();
      });
      pipe.on("data", (chunk) => socket.write(chunk));
      pipe.on("end", () => socket.end());
      pipe.on("close", () => socket.end());
      pipe.on("error", () => socket.destroy());
    });
    server.on("error", () => process.exit(1));
    server.listen(PORT, "127.0.0.1");
  `;
  // Bun's TCP implementation can connect to the named pipe but cannot
  // reliably proxy Docker's long-lived HTTP stream on Windows. Use the
  // installed Node runtime for this tiny bridge while keeping the caller Bun.
  const child = spawn("node", ["-e", code], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (
    spawnSync(process.execPath, ["-e", checkCode], { timeout: 2_000 })
      .status !== 0
  ) {
    throw new Error("Unable to start the local Docker named-pipe proxy");
  }
  proxyStarted = true;
}
