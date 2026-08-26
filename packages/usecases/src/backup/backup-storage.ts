import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { S3Destination } from "@upstand/domain";
import { env, getInheritedEnv } from "@upstand/env/server";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  assertConfiguredHttpUrl,
  assertConfiguredHttpUrlSyntax,
} from "@upstand/platform/network/outbound";

const DEFAULT_BACKUP_COMMAND_TIMEOUT_MS = 30 * 60_000;
const MAX_BACKUP_COMMAND_TIMEOUT_MS = 24 * 60 * 60_000;
const BACKUP_FORCE_KILL_GRACE_MS = 1_000;
export const MAX_BACKUP_ERROR_OUTPUT_BYTES = 512 * 1024;

export function appendBoundedBackupError(
  current: string,
  chunk: string,
  maxBytes = MAX_BACKUP_ERROR_OUTPUT_BYTES,
): string {
  if (current.length >= maxBytes) return current;
  return current + chunk.slice(0, maxBytes - current.length);
}

function terminateProcess(child: ReturnType<typeof spawn>): void {
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }

  const forceKillTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the check and the signal.
    }
  }, BACKUP_FORCE_KILL_GRACE_MS);
  forceKillTimer.unref?.();
  child.once("close", () => clearTimeout(forceKillTimer));
}

/**
 * External backup commands must have a deadline. A hung Docker daemon or
 * object-store connection otherwise occupies a worker forever and prevents a
 * graceful shutdown. Operators may increase the deadline for large backups,
 * but it is always bounded to avoid an accidental infinite wait.
 */
export function getBackupCommandTimeoutMs(): number {
  const configured = Number(env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000) {
    return DEFAULT_BACKUP_COMMAND_TIMEOUT_MS;
  }
  return Math.min(Math.floor(configured), MAX_BACKUP_COMMAND_TIMEOUT_MS);
}

export interface BackupStorageDestination {
  bucket: string;
  rcloneFlags: string[];
  rcloneEnvironment: Record<string, string>;
}

export type BackupRuntimeDestination = S3Destination & {
  caCertificatePem?: string | null;
};

export function withBackupCaCertificate(
  destination: S3Destination,
  certificatePem?: string | null,
): BackupRuntimeDestination {
  return certificatePem?.trim()
    ? { ...destination, caCertificatePem: certificatePem }
    : destination;
}

export function normalizeBackupPrefix(prefix: string): string {
  let normalized = prefix.trim();
  while (normalized.startsWith("/")) normalized = normalized.slice(1);
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized ? `${normalized}/` : "";
}

const SAFE_S3_ADDITIONAL_FLAG_PATTERN =
  /^--(no-check-certificate|ca-cert|s3-insecure-skip-verify|s3-(server-side-encryption|sse-kms-key-id|sse-customer-algorithm|sse-customer-key|sse-customer-key-md5))(=.*)?$/i;

const S3_CONFIG_FLAG_PATTERN =
  /^--s3-(server-side-encryption|sse-kms-key-id|sse-customer-algorithm|sse-customer-key|sse-customer-key-md5)(?:=(.*))?$/i;
const S3_ENCRYPTION_FLAG_PATTERN =
  /^--s3-(server-side-encryption|sse-kms-key-id|sse-customer-(?:algorithm|key|key-md5))(?:=|$)/i;

function toRcloneConfigEnvironment(
  accessKeyId: string,
  secretAccessKey: string,
  provider: string,
  region: string,
  endpoint: string,
  additionalFlags: string[],
): { flags: string[]; environment: Record<string, string> } {
  const environment: Record<string, string> = {
    RCLONE_CONFIG_UPSTAND_TYPE: "s3",
    RCLONE_CONFIG_UPSTAND_PROVIDER: provider,
    RCLONE_CONFIG_UPSTAND_ACCESS_KEY_ID: accessKeyId,
    RCLONE_CONFIG_UPSTAND_SECRET_ACCESS_KEY: secretAccessKey,
    RCLONE_CONFIG_UPSTAND_REGION: region,
    RCLONE_CONFIG_UPSTAND_ENDPOINT: endpoint,
    RCLONE_CONFIG_UPSTAND_NO_CHECK_BUCKET: "true",
    RCLONE_CONFIG_UPSTAND_FORCE_PATH_STYLE: "true",
  };
  const flags: string[] = [];

  for (const flag of additionalFlags) {
    const match = flag.match(S3_CONFIG_FLAG_PATTERN);
    if (match) {
      const option = match[1]?.replaceAll("-", "_").toUpperCase();
      if (option) {
        environment[`RCLONE_CONFIG_UPSTAND_${option}`] = match[2] ?? "true";
      }
      continue;
    }
    flags.push(flag);
  }

  // Never silently create plaintext backup objects. Operators may select
  // SSE-KMS or SSE-C through the reviewed flags, but the safe default for
  // compatible S3 providers is provider-managed AES-256 encryption.
  if (!additionalFlags.some((flag) => S3_ENCRYPTION_FLAG_PATTERN.test(flag))) {
    environment.RCLONE_CONFIG_UPSTAND_SERVER_SIDE_ENCRYPTION = "AES256";
  }

  return { flags, environment };
}

export function filterSafeS3AdditionalFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags.filter(
    (flag): flag is string =>
      typeof flag === "string" &&
      SAFE_S3_ADDITIONAL_FLAG_PATTERN.test(flag.trim()),
  );
}

function decryptDestinationField(value: string): string {
  const payload = JSON.parse(value);
  return decryptSecret(payload);
}

export function ensureCaCertificateFile(certificatePem: string): string {
  const hash = createHash("sha256")
    .update(certificatePem.trim())
    .digest("hex")
    .slice(0, 16);
  const certPath = path.join(os.tmpdir(), `upstand-ca-${hash}.pem`);
  if (!existsSync(certPath)) {
    writeFileSync(certPath, `${certificatePem.trim()}\n`, { mode: 0o600 });
  }
  return certPath;
}

export function buildRcloneS3Configuration(input: {
  accessKeyId: string;
  secretAccessKey: string;
  provider: string;
  region: string;
  endpoint: string;
  caCertificatePem?: string | null;
  additionalFlags?: string[];
}): { flags: string[]; environment: Record<string, string> } {
  const caFlags: string[] = [];
  if (input.caCertificatePem?.trim()) {
    const certPath = ensureCaCertificateFile(input.caCertificatePem);
    caFlags.push(`--ca-cert=${certPath}`);
  }

  const configuration = toRcloneConfigEnvironment(
    input.accessKeyId,
    input.secretAccessKey,
    input.provider,
    input.region,
    input.endpoint,
    filterSafeS3AdditionalFlags(input.additionalFlags),
  );
  return {
    flags: [...caFlags, ...configuration.flags],
    environment: configuration.environment,
  };
}

export function toBackupStorageDestination(
  destination: BackupRuntimeDestination,
  caCertificatePem?: string | null,
): BackupStorageDestination {
  assertConfiguredHttpUrlSyntax(
    destination.endpoint,
    (env.UPSTAND_OUTBOUND_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
  const accessKeyId = decryptDestinationField(destination.accessKeyId);
  const secretAccessKey = decryptDestinationField(destination.secretAccessKey);
  let additionalFlags: unknown = [];
  try {
    additionalFlags = JSON.parse(destination.additionalFlags || "[]");
  } catch {
    additionalFlags = [];
  }

  const rcloneConfig = buildRcloneS3Configuration({
    accessKeyId,
    secretAccessKey,
    provider: destination.provider,
    region: destination.region,
    endpoint: destination.endpoint,
    caCertificatePem,
    additionalFlags: Array.isArray(additionalFlags) ? additionalFlags : [],
  });

  return {
    bucket: destination.bucket,
    rcloneFlags: rcloneConfig.flags,
    rcloneEnvironment: rcloneConfig.environment,
  };
}

/** Validate the endpoint immediately before rclone opens a network connection. */
export async function assertBackupStorageEndpoint(
  endpoint: string,
): Promise<void> {
  await assertConfiguredHttpUrl(
    endpoint,
    (env.UPSTAND_OUTBOUND_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
}

export function rcloneRemote(
  destination: BackupStorageDestination,
  key: string,
): string {
  return `upstand:${destination.bucket}/${key}`;
}

export function runProcess(
  command: string,
  args: string[],
  input?: NodeJS.ReadableStream,
  environment?: Record<string, string | undefined>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "pipe"],
      env: environment ? getInheritedEnv(environment) : undefined,
    });
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      terminateProcess(child);
      reject(
        new Error(
          `${command} timed out after ${getBackupCommandTimeoutMs()}ms`,
        ),
      );
      settled = true;
    }, getBackupCommandTimeoutMs());
    timeout.unref?.();
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBoundedBackupError(stderr, chunk.toString());
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `${command} exited with ${code}: ${stderr.slice(0, 1_000)}`,
            ),
          );
      });
    });
    if (input) input.pipe(child.stdin);
    else child.stdin.end();
  });
}

export function pipeProcesses(
  producerCommand: string,
  producerArgs: string[],
  consumerCommand: string,
  consumerArgs: string[],
  environments?: {
    producer?: Record<string, string | undefined>;
    consumer?: Record<string, string | undefined>;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const producer = spawn(producerCommand, producerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: environments?.producer
        ? getInheritedEnv(environments.producer)
        : undefined,
    });
    const consumer = spawn(consumerCommand, consumerArgs, {
      stdio: ["pipe", "ignore", "pipe"],
      env: environments?.consumer
        ? getInheritedEnv(environments.consumer)
        : undefined,
    });
    let producerError = "";
    let consumerError = "";
    let settled = false;
    producer.stderr.on("data", (chunk: Buffer) => {
      producerError = appendBoundedBackupError(producerError, chunk.toString());
    });
    consumer.stderr.on("data", (chunk: Buffer) => {
      consumerError = appendBoundedBackupError(consumerError, chunk.toString());
    });
    const timeout = setTimeout(() => {
      terminateProcess(producer);
      terminateProcess(consumer);
      settled = true;
      reject(
        new Error(
          `Backup pipeline timed out after ${getBackupCommandTimeoutMs()}ms`,
        ),
      );
    }, getBackupCommandTimeoutMs());
    timeout.unref?.();
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      terminateProcess(producer);
      terminateProcess(consumer);
      reject(error);
    };
    producer.once("error", fail);
    consumer.once("error", fail);
    producer.stdout.pipe(consumer.stdin);

    let producerCode: number | null = null;
    let consumerCode: number | null = null;
    const complete = () => {
      if (settled) return;
      if (producerCode === null || consumerCode === null) return;
      settled = true;
      clearTimeout(timeout);
      if (producerCode === 0 && consumerCode === 0) return resolve();
      reject(
        new Error(
          `Backup pipeline failed (producer ${producerCode}, consumer ${consumerCode}): ${(producerError || consumerError).slice(0, 1_000)}`,
        ),
      );
    };
    producer.once("close", (code) => {
      producerCode = code;
      complete();
    });
    consumer.once("close", (code) => {
      consumerCode = code;
      complete();
    });
  });
}
