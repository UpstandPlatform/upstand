import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type {
  IUnitOfWork,
  ResourceAutoscalingProjection,
} from "@upstand/domain";
import { readDeploymentScopeHeaders } from "@upstand/platform/crypto/deployment-scope";
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
let proxyProcess: ReturnType<typeof spawn> | null = null;
const PROXY_PORT = 23775;
// Port range for remote Docker SSH proxies on Windows (Unix sockets unsupported).
let nextRemoteProxyPort = 23776;
const MAX_REMOTE_DOCKER_PROXIES = 256;
const releasedRemoteProxyPorts: number[] = [];
type RemoteProxyEntry =
  | { socketPath: string; close: () => void }
  | { host: string; port: number; close: () => void };
const remoteDockerProxies = new Map<string, RemoteProxyEntry>();
const proxyKeySecret = randomBytes(32);

export function getDockerInstance(
  customHeaders: Record<string, string> = {},
): Docker {
  const brokerHeaders = deploymentScopeHeaders(customHeaders);
  const isWindows = process.platform === "win32";
  const isBun = typeof process.versions.bun !== "undefined";

  if (isWindows && isBun && !process.env.DOCKER_HOST) {
    ensureDockerProxy();
    return new Docker({
      host: "127.0.0.1",
      port: PROXY_PORT,
      ...(Object.keys(brokerHeaders).length ? { headers: brokerHeaders } : {}),
    });
  }

  return createDockerClientFromEnvironment(
    process.env.DOCKER_HOST,
    brokerHeaders,
  );
}

function deploymentScopeHeaders(
  customHeaders: Record<string, string>,
): Record<string, string> {
  return { ...customHeaders, ...readDeploymentScopeHeaders() };
}

/**
 * Keep Docker transport configuration explicit so production can move from a
 * host socket to a constrained broker without changing every adapter.
 */
export function createDockerClientFromEnvironment(
  configuredHost = process.env.DOCKER_HOST,
  customHeaders: Record<string, string> = {},
): Docker {
  const brokerHeaders = deploymentScopeHeaders(customHeaders);
  const value = configuredHost?.trim();
  if (!value) {
    return new Docker(
      Object.keys(brokerHeaders).length ? { headers: brokerHeaders } : {},
    );
  }

  if (value.startsWith("unix://")) {
    const socketPath = value.slice("unix://".length);
    if (!socketPath.startsWith("/")) {
      throw new Error("DOCKER_HOST Unix socket path must be absolute");
    }
    return new Docker({
      socketPath,
      ...(Object.keys(brokerHeaders).length ? { headers: brokerHeaders } : {}),
    });
  }

  if (
    value.startsWith("tcp://") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    const url = new URL(value);
    const port = Number(url.port || 2375);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("DOCKER_HOST TCP port is invalid");
    }
    const brokerToken = readDockerBrokerToken();
    const brokerCaller = process.env.UPSTAND_DOCKER_BROKER_CALLER?.trim();
    const protocol = url.protocol === "https:" ? "https" : "http";
    const tlsOptions =
      protocol === "https"
        ? {
            ca: readDockerBrokerTLSFile("UPSTAND_DOCKER_BROKER_CA_FILE", "CA"),
            cert: readDockerBrokerTLSFile(
              "UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE",
              "client certificate",
            ),
            key: readDockerBrokerTLSFile(
              "UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE",
              "client key",
            ),
          }
        : {};
    return new Docker({
      host: url.hostname,
      port,
      protocol,
      ...tlsOptions,
      ...(brokerToken || Object.keys(brokerHeaders).length
        ? {
            headers: {
              ...(brokerToken
                ? { "X-Upstand-Docker-Broker-Token": brokerToken }
                : {}),
              ...brokerHeaders,
              ...(brokerCaller
                ? { "X-Upstand-Docker-Caller": brokerCaller }
                : {}),
            },
          }
        : {}),
    });
  }

  throw new Error("DOCKER_HOST must use unix://, tcp://, http://, or https://");
}

export function readDockerBrokerTLSFile(
  environmentVariable: string,
  label: string,
): Buffer {
  const file = process.env[environmentVariable]?.trim();
  if (!file) {
    throw new Error(
      `${environmentVariable} is required for HTTPS Docker broker transport`,
    );
  }
  const value = fs.readFileSync(file);
  if (value.length === 0) {
    throw new Error(`Docker broker TLS ${label} file is empty`);
  }
  return value;
}

export function readDockerBrokerToken(): string | undefined {
  const tokenFile = process.env.UPSTAND_DOCKER_BROKER_TOKEN_FILE?.trim();
  const token = tokenFile
    ? fs.readFileSync(tokenFile, "utf8").trim()
    : process.env.UPSTAND_DOCKER_BROKER_TOKEN?.trim();
  if (!token) return undefined;
  if (token.length < 32) {
    throw new Error(
      "UPSTAND_DOCKER_BROKER_TOKEN must contain at least 32 characters",
    );
  }
  return token;
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
export function createRemoteDocker(
  connection: RemoteDockerConnection,
  customHeaders: Record<string, string> = {},
): Docker {
  if (!connection.hostKeyFingerprint) {
    throw new Error("Remote Docker SSH host key is not trusted");
  }
  assertSafeRemoteConnection(connection);
  const entry = ensureRemoteDockerProxy(connection);
  return "socketPath" in entry
    ? new Docker({
        socketPath: entry.socketPath,
        ...(Object.keys(customHeaders).length
          ? { headers: customHeaders }
          : {}),
      })
    : new Docker({
        host: entry.host,
        port: entry.port,
        ...(Object.keys(customHeaders).length
          ? { headers: customHeaders }
          : {}),
      });
}

function ensureRemoteDockerProxy(
  connection: RemoteDockerConnection,
): RemoteProxyEntry {
  const trustedFingerprint = connection.hostKeyFingerprint;
  if (!trustedFingerprint) {
    throw new Error("Remote Docker SSH host key is not trusted");
  }
  const credentialKey = connection.privateKey || connection.password || "";
  const key = createHmac("sha256", proxyKeySecret)
    .update(
      `${connection.host}:${connection.port}:${connection.username}:${credentialKey}`,
    )
    .digest("hex");
  const existing = remoteDockerProxies.get(key);
  if (existing) return existing;
  if (remoteDockerProxies.size >= MAX_REMOTE_DOCKER_PROXIES) {
    throw new Error("Remote Docker proxy capacity has been reached");
  }

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
    const localPort = releasedRemoteProxyPorts.pop() ?? nextRemoteProxyPort++;
    let closed = false;
    proxy.once("error", () => {
      remoteDockerProxies.delete(key);
    });
    proxy.listen(localPort, "127.0.0.1");
    const entry: RemoteProxyEntry = {
      host: "127.0.0.1",
      port: localPort,
      close: () => {
        if (closed) return;
        closed = true;
        remoteDockerProxies.delete(key);
        proxy.close();
        releasedRemoteProxyPorts.push(localPort);
      },
    };
    remoteDockerProxies.set(key, entry);
    return entry;
  }

  const socketPath = path.join(os.tmpdir(), `upstand-docker-${key}.sock`);
  fs.rmSync(socketPath, { force: true });
  let closed = false;
  proxy.once("error", () => {
    remoteDockerProxies.delete(key);
    fs.rmSync(socketPath, { force: true });
  });
  proxy.listen(socketPath);
  const entry: RemoteProxyEntry = {
    socketPath,
    close: () => {
      if (closed) return;
      closed = true;
      remoteDockerProxies.delete(key);
      proxy.close();
      fs.rmSync(socketPath, { force: true });
    },
  };
  remoteDockerProxies.set(key, entry);
  return entry;
}

export function closeRemoteDockerProxies(): void {
  for (const entry of remoteDockerProxies.values()) entry.close();
  remoteDockerProxies.clear();
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
    cleanup: entry.close,
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

  const dockerService = new DockerService(
    remoteDocker,
    remoteCli.environment,
    undefined,
    (resourceId) =>
      createRemoteDocker(connection, {
        "X-Upstand-Resource-ID": resourceId,
      }),
  );
  return {
    dockerService,
    cleanup: remoteCli.cleanup,
  };
}

export async function resolveCaddyServiceForServer(
  serverId: string,
  uow: IUnitOfWork,
): Promise<{ caddyService: CaddyService; cleanup: () => void }> {
  const server = await uow.serverRepository.findById(serverId);
  if (!server) throw new Error("Target deployment server was not found");

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

  const remoteDocker = createRemoteDocker({
    host: server.ipAddress,
    port: server.port,
    username: server.username,
    privateKey,
    password,
    hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
  });
  const remoteCli = createRemoteDockerCliEnvironment({
    host: server.ipAddress,
    port: server.port,
    username: server.username,
    privateKey,
    password,
    hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
  });

  return {
    caddyService: new CaddyService(remoteDocker),
    cleanup: remoteCli.cleanup,
  };
}

export async function resolveServicesForResource(
  resource: ResourceAutoscalingProjection,
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

  const dockerService = new DockerService(
    remoteDocker,
    remoteCli.environment,
    undefined,
    (resourceId) =>
      createRemoteDocker(connection, {
        "X-Upstand-Resource-ID": resourceId,
      }),
  );
  const caddyService = new CaddyService(remoteDocker);
  return {
    dockerService,
    caddyService,
    cleanup: remoteCli.cleanup,
  };
}

export function createDockerInfrastructureResolver(): DockerInfrastructureResolverPort {
  return {
    resolveCaddyServiceForServer,
    resolveDockerServiceForServer,
    resolveDockerCliEnvironmentForServer,
    resolveServicesForResource,
    createRemoteServices(connection) {
      const remoteDocker = createRemoteDocker(connection);
      const cli = createRemoteDockerCliEnvironment(connection);
      return {
        docker: remoteDocker,
        dockerService: new DockerService(
          remoteDocker,
          cli.environment,
          undefined,
          (resourceId) =>
            createRemoteDocker(connection, {
              "X-Upstand-Resource-ID": resourceId,
            }),
        ),
        caddyService: new CaddyService(remoteDocker),
        cli,
        info: () => remoteDocker.info(),
      };
    },
  };
}

function ensureDockerProxy() {
  if (proxyStarted) return;
  const configuredNodeRuntime = process.env.UPSTAND_NODE_RUNTIME_PATH?.trim();
  const nodeRuntime = configuredNodeRuntime || "node";
  const nodeEnvironment = configuredNodeRuntime
    ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    : process.env;
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
    spawnSync(nodeRuntime, ["-e", checkCode], {
      timeout: 2_000,
      env: nodeEnvironment,
    }).status === 0
  ) {
    proxyStarted = true;
    return;
  }

  const code = `
    const net = require("net");
    const PIPE_PATH = "//./pipe/docker_engine";
    const PORT = ${PROXY_PORT};
    const parentPid = process.ppid;
    const connections = new Set();
    let closing = false;

    function closeProxy() {
      if (closing) return;
      closing = true;
      clearInterval(parentWatchdog);
      for (const connection of connections) connection.destroy();
      const forceExit = setTimeout(() => process.exit(0), 1_000);
      forceExit.unref();
      server.close(() => process.exit(0));
    }

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
    server.on("connection", (connection) => {
      connections.add(connection);
      connection.once("close", () => connections.delete(connection));
    });
    server.on("error", () => closeProxy());
    server.listen(PORT, "127.0.0.1");
    const parentWatchdog = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        closeProxy();
      }
    }, 250);
    parentWatchdog.unref();
    process.once("SIGTERM", closeProxy);
    process.once("SIGINT", closeProxy);
  `;
  // Bun's TCP implementation can connect to the named pipe but cannot
  // reliably proxy Docker's long-lived HTTP stream on Windows. Use Electron's
  // bundled Node runtime for this tiny bridge while keeping the caller Bun.
  const child = spawn(nodeRuntime, ["-e", code], {
    detached: true,
    env: nodeEnvironment,
    stdio: "ignore",
  });
  proxyProcess = child;
  process.once("exit", () => proxyProcess?.kill());
  child.unref();
  if (
    spawnSync(nodeRuntime, ["-e", checkCode], {
      timeout: 2_000,
      env: nodeEnvironment,
    }).status !== 0
  ) {
    child.kill();
    proxyProcess = null;
    throw new Error("Unable to start the local Docker named-pipe proxy");
  }
  proxyStarted = true;
}
