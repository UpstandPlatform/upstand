import * as fs from "node:fs";
import type { IUnitOfWork } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { hostVerifierForFingerprint } from "@upstand/platform/ssh/host-key";
import type { MonitoringAgentPort } from "@upstand/usecases/ports/monitoring";
import { Client, type ClientChannel } from "ssh2";
import { requestHttpOverSshChannel } from "./ssh-channel-http.client";

type LocalMonitoringAgentTarget = {
  baseUrl: string;
  token: string;
};

type RemoteMonitoringAgentTarget = {
  baseUrl: string;
  token: string;
  server: {
    host: string;
    port: number;
    username: string;
    privateKey: string;
    hostKeyFingerprint: string;
  };
};

type MonitoringAgentTarget =
  | LocalMonitoringAgentTarget
  | RemoteMonitoringAgentTarget;

type MonitoringRequestOptions = {
  method: "GET" | "POST";
  path: string;
  token: string;
  body?: Record<string, unknown>;
};

async function resolveMonitoringAgentTarget(
  uow: IUnitOfWork,
  serverId: string,
): Promise<MonitoringAgentTarget> {
  const settings =
    await uow.monitoringSettingsRepository.findByServerId(serverId);
  if (!settings)
    throw new Error(`Monitoring is not configured for server ${serverId}`);

  if (serverId === "local") {
    return {
      baseUrl: fs.existsSync("/.dockerenv")
        ? "http://upstand-monitoring-agent:3001"
        : "http://127.0.0.1:3005",
      token: settings.token,
    };
  }

  const server = await uow.serverRepository.findById(serverId);
  if (!server) throw new Error(`Server ${serverId} not found`);
  if (!server.sshKeyId || !server.sshHostKeyFingerprint) {
    throw new Error("Remote monitoring requires a trusted SSH host key");
  }
  const sshKey = await uow.sshKeyRepository.findById(server.sshKeyId);
  if (!sshKey) throw new Error("Configured SSH Key not found");
  const privateKey = decryptSecret({
    ciphertext: sshKey.privateKeyCiphertext,
    iv: sshKey.privateKeyIv,
    authTag: sshKey.privateKeyAuthTag,
    keyVersion: sshKey.privateKeyVersion,
  });
  return {
    baseUrl: "ssh://127.0.0.1:3001",
    token: settings.token,
    server: {
      host: server.ipAddress,
      port: server.port,
      username: server.username,
      privateKey,
      hostKeyFingerprint: server.sshHostKeyFingerprint,
    },
  };
}

export async function requestMonitoringAgent<T>(
  uow: IUnitOfWork,
  serverId: string,
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    query?: URLSearchParams;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const target = await resolveMonitoringAgentTarget(uow, serverId);
  const query = options.query?.toString();
  const path = `${endpoint}${query ? `?${query}` : ""}`;
  if ("server" in target) {
    return requestThroughSsh<T>(
      {
        method: options.method ?? "GET",
        path,
        token: target.token,
        body: options.body,
      },
      target.server,
    );
  }
  const url = `${target.baseUrl}${path}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${target.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Monitoring agent request failed (${response.status})${message ? `: ${message}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

async function requestThroughSsh<T>(
  options: MonitoringRequestOptions,
  server: {
    host: string;
    port: number;
    username: string;
    privateKey: string;
    hostKeyFingerprint: string;
  },
): Promise<T> {
  const client = new Client();
  try {
    await new Promise<void>((resolve, reject) => {
      client
        .once("ready", resolve)
        .once("error", reject)
        .connect({
          host: server.host,
          port: server.port,
          username: server.username,
          privateKey: server.privateKey,
          hostHash: "sha256",
          hostVerifier: hostVerifierForFingerprint(server.hostKeyFingerprint),
          readyTimeout: 10_000,
        });
    });
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, "127.0.0.1", 3001, (error, stream) => {
        if (error) reject(error);
        else resolve(stream);
      });
    });
    return await requestHttpOverSshChannel<T>(channel, options);
  } finally {
    client.end();
  }
}

export function createMonitoringAgentPort(): MonitoringAgentPort {
  return { request: requestMonitoringAgent };
}
