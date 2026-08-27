import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import type { IUnitOfWork } from "@upstand/domain";
import {
  type BackupDatabaseEngine,
  type BackupSchedule,
  type Resource,
  ValidationError,
} from "@upstand/domain";
import { env, getInheritedEnv } from "@upstand/env/server";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { resolveDockerCliEnvironmentForServer } from "../resource/docker-client";
import { parseResourceCredentials as parseCredentialDocument } from "../resource/resource-credentials";
import { parseResourceEnvironmentVariables } from "../resource/resource-environment";
import {
  assertBackupStorageEndpoint,
  type BackupRuntimeDestination,
  type BackupStorageDestination,
  getBackupCommandTimeoutMs,
  normalizeBackupPrefix,
  pipeProcesses,
  rcloneRemote,
  runProcess,
  toBackupStorageDestination,
} from "./backup-storage";

const execFilePromise = promisify(execFile);

function execFileAsync(
  file: string,
  args: string[],
  options: Parameters<typeof execFile>[2] = {},
) {
  return execFilePromise(file, args, {
    ...options,
    encoding: "utf8",
    timeout: getBackupCommandTimeoutMs(),
    killSignal: "SIGKILL",
  });
}

function execRcloneAsync(
  storage: BackupStorageDestination,
  args: string[],
  options: Parameters<typeof execFile>[2] = {},
) {
  const optionEnvironment =
    typeof options === "object" && options && "env" in options
      ? options.env
      : undefined;
  return execFileAsync("rclone", args, {
    ...options,
    env: {
      ...getInheritedEnv(),
      ...(optionEnvironment ?? {}),
      ...storage.rcloneEnvironment,
    },
  });
}

function runRclone(
  storage: BackupStorageDestination,
  args: string[],
  input?: NodeJS.ReadableStream,
): Promise<void> {
  return runProcess("rclone", args, input, storage.rcloneEnvironment);
}

interface BackupCredentials {
  databaseUser: string;
  databasePassword: string;
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function randomSuffix(): string {
  return randomUUID().slice(0, 8);
}

const CONTROL_PLANE_POSTGRES_CONTAINERS = [
  "upstand-postgres",
  "upstand_postgres",
] as const;
const CONTROL_PLANE_POSTGRES_CLIENT_IMAGE =
  "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const BACKUP_HELPER_ALPINE_IMAGE =
  "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";
const BACKUP_HELPER_MYSQL_IMAGE =
  "mysql:8.4@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb";
const BACKUP_HELPER_MARIADB_IMAGE =
  "mariadb:11@sha256:efb4959ef2c835cd735dbc388eb9ad6aab0c78dd64febcd51bc17481111890c4";
const BACKUP_HELPER_MONGO_IMAGE =
  "mongo:7.0@sha256:9bdaeb6dac6e7e762e84e2f84103d1f9bb078fa1ba6bde8bb9d2274f655ad173";
const WEB_SERVER_BACKUP_VOLUMES = [
  "upstand-caddy-runtime",
  "upstand-caddy-data",
  "upstand-caddy-config",
] as const;

type WebServerBackupManifest = {
  version: 1;
  createdAt: string;
  files: string[];
};

type PostgresPitrManifest = {
  version: 1;
  kind: "postgres-pitr";
  createdAt: string;
  backupName: string;
};

const POSTGRES_PITR_BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const POSTGRES_PITR_DATA_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const SAFE_ARCHIVE_TARGET = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

/**
 * Restore an archive into a staging directory and only replace the target
 * after extraction succeeds. The previous contents remain available for
 * rollback if the final move fails. This protects live volumes from a
 * truncated or corrupt object-store stream leaving them empty.
 */
export function buildSafeArchiveRestoreCommand(target: string): string {
  const normalizedTarget = target.trim();
  if (
    !SAFE_ARCHIVE_TARGET.test(normalizedTarget) ||
    normalizedTarget
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    throw new ValidationError("Archive restore target is invalid");
  }
  const quotedTarget = shellQuote(normalizedTarget);
  return [
    "set -eu",
    `target=${quotedTarget}`,
    'archive="$(mktemp "$target/.upstand-restore-archive.XXXXXX")"',
    'warnings="$(mktemp "$target/.upstand-restore-warnings.XXXXXX")"',
    'trap \'rm -f -- "$archive" "$warnings"\' EXIT',
    'stage="$(mktemp -d "$target/.upstand-restore-stage.XXXXXX")"',
    'previous="$(mktemp -d "$target/.upstand-restore-previous.XXXXXX")"',
    "moved_existing=0",
    'move_entries() { for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; mv -- "$entry" "$2/"; done; }',
    'clear_target() { for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; if [ "$entry" = "$archive" ] || [ "$entry" = "$warnings" ] || [ "$entry" = "$stage" ] || [ "$entry" = "$previous" ]; then continue; fi; rm -rf -- "$entry"; done; }',
    'restore_previous() { clear_target; move_entries "$previous" "$target"; }',
    'trap \'status=$?; if [ "$status" -ne 0 ] && [ "$moved_existing" -eq 1 ]; then restore_previous || true; fi; rm -rf -- "$archive" "$warnings" "$stage" "$previous"; exit "$status"\' EXIT',
    'cat > "$archive"',
    'tar -tzf "$archive" >/dev/null 2>"$warnings"',
    '[ ! -s "$warnings" ] || exit 41',
    'tar -tzf "$archive" | awk \'$0 ~ /^\\// || $0 == ".." || $0 ~ /(^|\\/)\\.\\.(\\/|$)/ { exit 41 }\'',
    "if tar -tvzf \"$archive\" | grep -Eq '^[lhbcps]'; then exit 42; fi",
    'tar -xzf "$archive" -C "$stage" -o --no-same-permissions',
    '[ -n "$(find "$stage" -mindepth 1 -print -quit)" ] || exit 42',
    "moved_existing=1",
    'for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; if [ "$entry" = "$archive" ] || [ "$entry" = "$warnings" ] || [ "$entry" = "$stage" ] || [ "$entry" = "$previous" ]; then continue; fi; mv -- "$entry" "$previous/"; done',
    'move_entries "$stage" "$target"',
    'rm -rf -- "$stage" "$previous"',
    "trap - EXIT",
  ].join("; ");
}

export function validateFileDatabaseRestore(
  engine: "libsql" | "redis",
  stopService: boolean,
): void {
  if (!stopService) {
    throw new ValidationError(
      `${engine} database restores require stopService to be enabled on the schedule`,
    );
  }
}

export function validatePostgresPitrBackupName(rawName: unknown): string {
  if (typeof rawName !== "string" || !POSTGRES_PITR_BACKUP_NAME.test(rawName)) {
    throw new ValidationError("PostgreSQL PITR backup name is invalid");
  }
  return rawName;
}

export function validatePostgresPitrDataPath(rawPath: string): string {
  const dataPath = rawPath.trim();
  if (
    !POSTGRES_PITR_DATA_PATH.test(dataPath) ||
    dataPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new ValidationError("PostgreSQL PITR data path is invalid");
  }
  return dataPath;
}

export function validatePostgresPitrManifest(
  parsed: unknown,
): PostgresPitrManifest {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1 ||
    (parsed as { kind?: unknown }).kind !== "postgres-pitr" ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
    Number.isNaN(Date.parse((parsed as { createdAt: string }).createdAt))
  ) {
    throw new ValidationError("PostgreSQL PITR manifest is invalid");
  }
  const backupName = validatePostgresPitrBackupName(
    (parsed as { backupName?: unknown }).backupName,
  );
  return { ...parsed, backupName } as PostgresPitrManifest;
}

export function validateWebServerBackupManifest(
  parsed: unknown,
  manifestKey: string,
): WebServerBackupManifest {
  const manifestSuffix = "manifest.json";
  const manifestIndex = manifestKey.lastIndexOf(manifestSuffix);
  const base = manifestKey.slice(0, manifestIndex);
  const expectedFiles = new Set([
    `${base}control-plane.dump`,
    ...WEB_SERVER_BACKUP_VOLUMES.map((volume) => `${base}${volume}.tar.gz`),
  ]);
  const files =
    parsed && typeof parsed === "object"
      ? (parsed as { files?: unknown }).files
      : undefined;
  if (
    manifestIndex < 1 ||
    !manifestKey.endsWith(manifestSuffix) ||
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
    Number.isNaN(Date.parse((parsed as { createdAt: string }).createdAt)) ||
    !Array.isArray(files) ||
    files.length !== expectedFiles.size ||
    new Set(files).size !== files.length ||
    !files.every(
      (file) =>
        typeof file === "string" &&
        file.startsWith(base) &&
        !file.split("/").includes("..") &&
        expectedFiles.has(file),
    )
  ) {
    throw new ValidationError("Web-server backup manifest is invalid");
  }
  return parsed as WebServerBackupManifest;
}

export function validateControlPlanePostgresUrl(rawUrl: string): string {
  const databaseUrl = rawUrl.trim();
  if (!databaseUrl || /[\r\n]/.test(databaseUrl)) {
    throw new ValidationError(
      "External control-plane PostgreSQL connection is not configured",
    );
  }
  try {
    const parsed = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !parsed.hostname
    ) {
      throw new Error("invalid PostgreSQL URL");
    }
  } catch {
    throw new ValidationError(
      "External control-plane PostgreSQL connection is invalid",
    );
  }
  return databaseUrl;
}

export function buildExternalPostgresDockerArgs(
  envFile: string,
  network: string,
  command: string,
  interactive = false,
): string[] {
  return [
    "run",
    "--rm",
    ...(interactive ? ["-i"] : []),
    "--network",
    network,
    "--env-file",
    envFile,
    CONTROL_PLANE_POSTGRES_CLIENT_IMAGE,
    "sh",
    "-ec",
    command,
  ];
}

function databaseFileExtension(
  engine: BackupDatabaseEngine,
  pointInTimeRecovery = false,
): string {
  if (pointInTimeRecovery && engine === "postgres") return "pitr.json";
  return engine === "mongodb" || engine === "libsql" || engine === "redis"
    ? "archive.gz"
    : "sql.gz";
}

function parseEncryptedConfiguration(
  schedule: BackupSchedule,
): BackupCredentials | null {
  if (!schedule.encryptedConfiguration) return null;
  const payload = JSON.parse(schedule.encryptedConfiguration);
  return JSON.parse(decryptSecret(payload)) as BackupCredentials;
}

function parseResourceCredentials(resource: Resource): Record<string, string> {
  return parseCredentialDocument(resource.credentials) as Record<
    string,
    string
  >;
}

function resolveCredentials(
  schedule: BackupSchedule,
  resource: Resource,
): BackupCredentials {
  const configured = parseEncryptedConfiguration(schedule);
  if (configured) return configured;
  const credentials = parseResourceCredentials(resource);
  const engine = schedule.databaseEngine;
  if (engine === "postgres") {
    return {
      databaseUser: credentials.dbUser || "upstand",
      databasePassword: credentials.dbPassword || "",
    };
  }
  if (engine === "mongodb") {
    return {
      databaseUser: credentials.dbUser || "upstand",
      databasePassword: credentials.dbPassword || "",
    };
  }
  return {
    databaseUser: credentials.dbUser || "root",
    databasePassword:
      credentials.dbRootPassword || credentials.dbPassword || "",
  };
}

function serviceNameFor(
  resource: Resource,
  serviceName?: string | null,
): string {
  const appName = (resource.appName || resource.name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-");
  return resource.type === "compose" && serviceName
    ? `${appName}_${serviceName}`
    : appName;
}

export function shellQuote(value: string): string {
  if (value.includes("\0")) {
    throw new ValidationError("Shell argument contains a NUL byte");
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function databaseCredentialFileContent(
  credentials: BackupCredentials,
  databaseName: string | null,
): string {
  return [
    `UPSTAND_BACKUP_USER=${shellQuote(credentials.databaseUser)}`,
    `UPSTAND_BACKUP_PASSWORD=${shellQuote(credentials.databasePassword)}`,
    `UPSTAND_BACKUP_DATABASE=${shellQuote(databaseName ?? "")}`,
    "",
  ].join("\n");
}

function databaseCommandWithCredentialFile(
  credentialFile: string,
  command: string,
): string {
  return `trap 'rm -f -- ${credentialFile}' EXIT HUP INT TERM; . ${credentialFile}; ${command}`;
}

export class BackupRuntimeService {
  private async resolveBackupStorageDestination(
    destination: BackupRuntimeDestination,
  ): Promise<ReturnType<typeof toBackupStorageDestination>> {
    await assertBackupStorageEndpoint(destination.endpoint);
    return toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
  }

  constructor(
    private readonly dockerEnvironment: Record<string, string | undefined> = {},
  ) {}

  withDockerEnvironment(
    environment: Record<string, string | undefined>,
  ): BackupRuntimeService {
    return new BackupRuntimeService(environment);
  }

  private async createDatabaseCredentialFile(
    containerId: string,
    credentials: BackupCredentials,
    databaseName: string | null,
  ): Promise<string> {
    const credentialFile = `/tmp/upstand-backup-${randomUUID()}.env`;
    try {
      await runProcess(
        "docker",
        [
          "exec",
          "-i",
          containerId,
          "sh",
          "-ec",
          `umask 077; cat > ${credentialFile}`,
        ],
        Readable.from([
          databaseCredentialFileContent(credentials, databaseName),
        ]),
        this.dockerEnvironment,
      );
    } catch (error) {
      await this.removeDatabaseCredentialFile(containerId, credentialFile);
      throw error;
    }
    return credentialFile;
  }

  private async removeDatabaseCredentialFile(
    containerId: string,
    credentialFile: string,
  ): Promise<void> {
    try {
      await execFileAsync(
        "docker",
        ["exec", containerId, "sh", "-ec", `rm -f -- ${credentialFile}`],
        { env: getInheritedEnv(this.dockerEnvironment) },
      );
    } catch {
      // The command trap already removes the file on normal completion. This
      // cleanup is best-effort for setup failures and interrupted processes.
    }
  }

  private databaseExecArgs(
    containerId: string,
    credentialFile: string,
    command: string,
    interactive = false,
  ): string[] {
    return [
      "exec",
      ...(interactive ? ["-i"] : []),
      containerId,
      "sh",
      "-ec",
      databaseCommandWithCredentialFile(credentialFile, command),
    ];
  }

  async listVolumes(resource: Resource): Promise<string[]> {
    try {
      const containerId = await this.resolveContainerId(resource, null);
      const { stdout } = await execFileAsync(
        "docker",
        ["inspect", containerId, "--format", "{{json .Mounts}}"],
        { env: getInheritedEnv(this.dockerEnvironment) },
      );
      const mounts = JSON.parse(stdout) as Array<{
        Type?: string;
        Name?: string;
      }>;
      return mounts
        .filter((mount) => mount.Type === "volume" && mount.Name)
        .map((mount) => mount.Name as string)
        .sort();
    } catch {
      return [];
    }
  }

  async createBackup(
    schedule: BackupSchedule,
    resource: Resource,
    destination: BackupRuntimeDestination,
  ): Promise<string> {
    const storage = await this.resolveBackupStorageDestination(destination);
    const resourcePath = `${resource.id}/${normalizeBackupPrefix(schedule.prefix)}`;
    const fileName =
      schedule.kind === "database"
        ? `${backupTimestamp()}.${databaseFileExtension(
            schedule.databaseEngine as BackupDatabaseEngine,
            schedule.pointInTimeRecovery,
          )}`
        : `${schedule.volumeName}-${backupTimestamp()}.tar.gz`;
    const fileKey = `${resourcePath}${fileName}`;

    if (schedule.kind === "database") {
      await this.createDatabaseBackup(schedule, resource, storage, fileKey);
    } else {
      await this.createVolumeBackup(schedule, resource, storage, fileKey);
    }
    return fileKey;
  }

  async restoreBackup(
    schedule: BackupSchedule,
    resource: Resource,
    destination: BackupRuntimeDestination,
    fileKey: string,
    targetTime?: string,
  ): Promise<void> {
    const storage = await this.resolveBackupStorageDestination(destination);
    if (schedule.kind === "database") {
      await this.restoreDatabaseBackup(
        schedule,
        resource,
        storage,
        fileKey,
        targetTime,
      );
      return;
    }
    await this.restoreVolumeBackup(schedule, resource, storage, fileKey);
  }

  async deleteBackup(
    destination: BackupRuntimeDestination,
    fileKey: string,
  ): Promise<void> {
    const storage = await this.resolveBackupStorageDestination(destination);
    await runRclone(storage, [
      "deletefile",
      ...storage.rcloneFlags,
      rcloneRemote(storage, fileKey),
    ]);
  }

  async verifyBackup(
    schedule: BackupSchedule,
    destination: BackupRuntimeDestination,
    fileKey: string,
    resource?: Resource,
  ): Promise<void> {
    const storage = await this.resolveBackupStorageDestination(destination);
    if (schedule.kind === "web-server") {
      await this.verifyWebServerBackup(storage, fileKey);
      return;
    }
    if (schedule.kind !== "database") {
      await runRclone(storage, [
        "size",
        ...storage.rcloneFlags,
        rcloneRemote(storage, fileKey),
      ]);
      return;
    }
    const engine = schedule.databaseEngine;
    if (!engine) throw new ValidationError("Backup engine is missing");
    if (engine === "postgres") {
      if (schedule.pointInTimeRecovery) {
        if (!resource)
          throw new ValidationError(
            "PITR verification requires the database resource",
          );
        await this.verifyPostgresPitr(storage, fileKey, schedule, resource);
        return;
      }
      await this.verifyPostgresRestore(storage, fileKey);
      return;
    }
    if (["mysql", "mariadb"].includes(engine)) {
      if (!resource)
        throw new ValidationError(
          "Database restore verification requires the database resource",
        );
      await this.verifyMysqlRestore(
        storage,
        fileKey,
        engine as "mysql" | "mariadb",
      );
      return;
    }
    if (!resource)
      throw new ValidationError(
        "Database restore verification requires the database resource",
      );
    if (engine === "mongodb") {
      await this.verifyMongoRestore(storage, fileKey);
      return;
    }
    await this.verifyArchiveRestore(storage, fileKey, engine);
  }

  private async verifyPostgresRestore(
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
  ): Promise<void> {
    const containerName = `upstand-restore-test-${randomSuffix()}`;
    const dockerOptions = {
      env: getInheritedEnv(this.dockerEnvironment),
    };
    await execFileAsync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "-e",
        `POSTGRES_PASSWORD=${randomUUID()}`,
        "--network",
        "none",
        CONTROL_PLANE_POSTGRES_CLIENT_IMAGE,
      ],
      dockerOptions,
    );
    try {
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          await execFileAsync(
            "docker",
            ["exec", containerName, "pg_isready", "-U", "postgres"],
            dockerOptions,
          );
          ready = true;
          break;
        } catch {
          await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        }
      }
      if (!ready)
        throw new ValidationError(
          "Temporary PostgreSQL restore container did not become ready",
        );
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        [
          "exec",
          "-i",
          containerName,
          "sh",
          "-ec",
          "gzip -dc | pg_restore -U postgres -d postgres --clean --if-exists --no-owner",
        ],
        { producer: storage.rcloneEnvironment, consumer: dockerOptions.env },
      );
    } finally {
      await execFileAsync(
        "docker",
        ["rm", "-f", containerName],
        dockerOptions,
      ).catch(() => undefined);
    }
  }

  private async verifyMysqlRestore(
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    engine: "mysql" | "mariadb",
  ): Promise<void> {
    const containerName = `upstand-restore-test-${randomSuffix()}`;
    const image =
      engine === "mysql"
        ? BACKUP_HELPER_MYSQL_IMAGE
        : BACKUP_HELPER_MARIADB_IMAGE;
    const dockerOptions = {
      env: getInheritedEnv(this.dockerEnvironment),
    };
    await execFileAsync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "-e",
        "MYSQL_ALLOW_EMPTY_PASSWORD=yes",
        image,
      ],
      dockerOptions,
    );
    try {
      await this.waitForTemporaryContainer(containerName, [
        "sh",
        "-ec",
        "mysqladmin ping -h 127.0.0.1 -uroot --silent",
      ]);
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        ["exec", "-i", containerName, "sh", "-ec", "gzip -dc | mysql -uroot"],
        { producer: storage.rcloneEnvironment, consumer: dockerOptions.env },
      );
    } finally {
      await execFileAsync(
        "docker",
        ["rm", "-f", containerName],
        dockerOptions,
      ).catch(() => undefined);
    }
  }

  private async verifyMongoRestore(
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
  ): Promise<void> {
    const containerName = `upstand-restore-test-${randomSuffix()}`;
    const dockerOptions = {
      env: getInheritedEnv(this.dockerEnvironment),
    };
    await execFileAsync(
      "docker",
      ["run", "-d", "--rm", "--name", containerName, BACKUP_HELPER_MONGO_IMAGE],
      dockerOptions,
    );
    try {
      await this.waitForTemporaryContainer(containerName, [
        "mongosh",
        "--quiet",
        "--eval",
        "db.adminCommand('ping')",
      ]);
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        [
          "exec",
          "-i",
          containerName,
          "sh",
          "-ec",
          "mongorestore --archive --gzip --drop",
        ],
        { producer: storage.rcloneEnvironment, consumer: dockerOptions.env },
      );
    } finally {
      await execFileAsync(
        "docker",
        ["rm", "-f", containerName],
        dockerOptions,
      ).catch(() => undefined);
    }
  }

  private async verifyArchiveRestore(
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    engine: BackupDatabaseEngine,
  ): Promise<void> {
    const volumeName = `upstand-restore-test-${randomSuffix()}`;
    const dockerOptions = {
      env: getInheritedEnv(this.dockerEnvironment),
    };
    await execFileAsync(
      "docker",
      ["volume", "create", volumeName],
      dockerOptions,
    );
    try {
      const target = engine === "libsql" ? "/var/lib/sqld" : "/data";
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "-v",
          `${volumeName}:${target}`,
          BACKUP_HELPER_ALPINE_IMAGE,
          "sh",
          "-ec",
          buildSafeArchiveRestoreCommand(target),
        ],
        { producer: storage.rcloneEnvironment, consumer: dockerOptions.env },
      );
    } finally {
      await execFileAsync(
        "docker",
        ["volume", "rm", "-f", volumeName],
        dockerOptions,
      ).catch(() => undefined);
    }
  }

  private async waitForTemporaryContainer(
    name: string,
    command: string[],
  ): Promise<void> {
    const dockerOptions = {
      env: getInheritedEnv(this.dockerEnvironment),
    };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await execFileAsync(
          "docker",
          ["exec", name, ...command],
          dockerOptions,
        );
        return;
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw new ValidationError(
      `Temporary restore container '${name}' did not become ready`,
    );
  }

  private async createDatabaseBackup(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
  ): Promise<void> {
    const engine = schedule.databaseEngine;
    const databaseName = schedule.databaseName;
    if (
      !engine ||
      (!databaseName && engine !== "libsql" && engine !== "redis")
    ) {
      throw new ValidationError("Database backup configuration is incomplete");
    }
    const credentials = resolveCredentials(schedule, resource);
    const containerId = await this.resolveContainerId(resource, schedule);
    if (schedule.pointInTimeRecovery && engine === "postgres") {
      await this.createPostgresPitrBackup(
        schedule,
        resource,
        storage,
        fileKey,
        containerId,
        credentials,
      );
      return;
    }
    const command = this.databaseDumpCommand(engine);
    const credentialFile = await this.createDatabaseCredentialFile(
      containerId,
      credentials,
      databaseName,
    );
    try {
      await pipeProcesses(
        "docker",
        this.databaseExecArgs(containerId, credentialFile, command, true),
        "rclone",
        ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        {
          producer: this.dockerEnvironment,
          consumer: storage.rcloneEnvironment,
        },
      );
    } finally {
      await this.removeDatabaseCredentialFile(containerId, credentialFile);
    }
  }

  private async createPostgresPitrBackup(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    containerId: string,
    credentials: BackupCredentials,
  ): Promise<void> {
    const activeContainerId = await this.configurePostgresPitr(
      resource,
      schedule,
      containerId,
      credentials,
    );
    const result = await execFileAsync(
      "docker",
      [
        "exec",
        activeContainerId,
        "sh",
        "-ec",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion is intentional.
        'command -v wal-g >/dev/null 2>&1 || { echo "wal-g is required for PostgreSQL point-in-time recovery" >&2; exit 42; }; wal-g backup-push "${PGDATA:-/var/lib/postgresql/data}"',
      ],
      {
        env: getInheritedEnv(this.dockerEnvironment),
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const backupName = validatePostgresPitrBackupName(
      await this.resolveLatestWalBackup(activeContainerId, result.stdout),
    );
    const manifest: PostgresPitrManifest = {
      version: 1,
      kind: "postgres-pitr",
      createdAt: new Date().toISOString(),
      backupName,
    };
    await runRclone(
      storage,
      ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      Readable.from([JSON.stringify(manifest)]),
    );
  }

  private async configurePostgresPitr(
    resource: Resource,
    schedule: BackupSchedule,
    containerId: string,
    credentials: BackupCredentials,
  ): Promise<string> {
    const dockerOptions = {
      env: getInheritedEnv(this.dockerEnvironment),
    };
    const databaseName = schedule.databaseName ?? "postgres";
    let currentConfig = "";
    const currentConfigCredentialFile = await this.createDatabaseCredentialFile(
      containerId,
      credentials,
      databaseName,
    );
    try {
      const current = await execFileAsync(
        "docker",
        this.databaseExecArgs(
          containerId,
          currentConfigCredentialFile,
          "PGPASSWORD=\"$UPSTAND_BACKUP_PASSWORD\" psql -At -U \"$UPSTAND_BACKUP_USER\" -d \"$UPSTAND_BACKUP_DATABASE\" -c 'SHOW archive_mode' -c 'SHOW wal_level' -c 'SHOW archive_command'",
        ),
        dockerOptions,
      );
      currentConfig = current.stdout;
    } catch {
      // The configuration check is retried by the guarded configuration path.
    } finally {
      await this.removeDatabaseCredentialFile(
        containerId,
        currentConfigCredentialFile,
      );
    }
    const currentLines = currentConfig
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      currentLines[0] === "on" &&
      ["replica", "logical"].includes(currentLines[1] ?? "") &&
      currentLines[2]?.includes("wal-g wal-push")
    )
      return containerId;
    const configureCredentialFile = await this.createDatabaseCredentialFile(
      containerId,
      credentials,
      databaseName,
    );
    try {
      await execFileAsync(
        "docker",
        this.databaseExecArgs(
          containerId,
          configureCredentialFile,
          // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion is intentional.
          'command -v wal-g >/dev/null 2>&1 || { echo "wal-g is required for PostgreSQL point-in-time recovery" >&2; exit 42; }; test -n "${WALG_S3_PREFIX:-}" || { echo "PostgreSQL PITR requires WALG_S3_PREFIX in the database service environment" >&2; exit 42; }; PGPASSWORD="$UPSTAND_BACKUP_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$UPSTAND_BACKUP_USER" -d "$UPSTAND_BACKUP_DATABASE" -c "ALTER SYSTEM SET wal_level = \'replica\';" -c "ALTER SYSTEM SET archive_mode = \'on\';" -c "ALTER SYSTEM SET archive_command = \'wal-g wal-push %p\';"',
        ),
        dockerOptions,
      );
    } finally {
      await this.removeDatabaseCredentialFile(
        containerId,
        configureCredentialFile,
      );
    }
    const serviceName = serviceNameFor(resource, schedule.serviceName);
    await execFileAsync(
      "docker",
      ["service", "update", "--force", serviceName],
      dockerOptions,
    );
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const active = await this.resolveContainerId(resource, schedule);
        const readinessCredentialFile = await this.createDatabaseCredentialFile(
          active,
          credentials,
          databaseName,
        );
        try {
          await execFileAsync(
            "docker",
            this.databaseExecArgs(
              active,
              readinessCredentialFile,
              'pg_isready -U "$UPSTAND_BACKUP_USER" -d "$UPSTAND_BACKUP_DATABASE"',
            ),
            dockerOptions,
          );
        } finally {
          await this.removeDatabaseCredentialFile(
            active,
            readinessCredentialFile,
          );
        }
        return active;
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw new ValidationError(
      "PostgreSQL service did not return after PITR configuration",
    );
  }

  private async resolveLatestWalBackup(
    containerId: string,
    output: string,
  ): Promise<string> {
    const explicit = output.match(
      /(?:backup\s*name|name)\s*[:=]\s*([A-Za-z0-9_.-]+)/i,
    )?.[1];
    if (explicit) return validatePostgresPitrBackupName(explicit);
    const result = await execFileAsync(
      "docker",
      ["exec", containerId, "sh", "-ec", "wal-g backup-list --json"],
      {
        env: getInheritedEnv(this.dockerEnvironment),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new ValidationError("WAL-G did not return a valid backup manifest");
    }
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { backups?: unknown }).backups)
        ? (parsed as { backups: unknown[] }).backups
        : [];
    const latest = rows.at(-1);
    const name =
      latest && typeof latest === "object"
        ? ((latest as Record<string, unknown>).backup_name ??
          (latest as Record<string, unknown>).name)
        : undefined;
    if (typeof name !== "string" || !name)
      throw new ValidationError("WAL-G did not report the created base backup");
    return validatePostgresPitrBackupName(name);
  }

  private async verifyPostgresPitr(
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    schedule: BackupSchedule,
    resource: Resource,
  ): Promise<void> {
    const { stdout } = await execRcloneAsync(
      storage,
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      { maxBuffer: 1024 * 1024 },
    );
    let manifest: PostgresPitrManifest;
    try {
      manifest = JSON.parse(stdout) as PostgresPitrManifest;
    } catch {
      throw new ValidationError("PostgreSQL PITR manifest is invalid");
    }
    manifest = validatePostgresPitrManifest(manifest);
    const containerId = await this.resolveContainerId(resource, schedule);
    const activeContainerId = await this.configurePostgresPitr(
      resource,
      schedule,
      containerId,
      resolveCredentials(schedule, resource),
    );
    await execFileAsync(
      "docker",
      [
        "exec",
        activeContainerId,
        "sh",
        "-ec",
        `rm -rf /tmp/upstand-pitr-verify && mkdir -p /tmp/upstand-pitr-verify && wal-g backup-fetch /tmp/upstand-pitr-verify ${shellQuote(manifest.backupName)} && test -s /tmp/upstand-pitr-verify/PG_VERSION && rm -rf /tmp/upstand-pitr-verify`,
      ],
      {
        env: getInheritedEnv(this.dockerEnvironment),
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  }

  async createWebServerBackup(
    schedule: BackupSchedule,
    destination: BackupRuntimeDestination,
  ): Promise<string> {
    const storage = await this.resolveBackupStorageDestination(destination);
    const base = `web-server/${normalizeBackupPrefix(schedule.prefix)}${backupTimestamp()}-${randomSuffix()}/`;
    const postgresKey = `${base}control-plane.dump`;
    const volumeKeys = WEB_SERVER_BACKUP_VOLUMES.map(
      (volume) => `${base}${volume}.tar.gz`,
    );
    const postgresContainer = await this.findPostgresContainer();
    const dockerEnvironment = getInheritedEnv(this.dockerEnvironment);

    if (postgresContainer) {
      await pipeProcesses(
        "docker",
        [
          "exec",
          postgresContainer,
          "sh",
          "-ec",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion is intentional.
          'pg_dump -Fc -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-upstand}"',
        ],
        "rclone",
        ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, postgresKey)],
        { producer: dockerEnvironment, consumer: storage.rcloneEnvironment },
      );
    } else {
      await this.withExternalControlPlaneDatabase((envFile) =>
        pipeProcesses(
          "docker",
          this.externalPostgresCommand(
            envFile,
            'pg_dump -Fc --dbname "$DATABASE_URL"',
          ),
          "rclone",
          ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, postgresKey)],
          { producer: dockerEnvironment, consumer: storage.rcloneEnvironment },
        ),
      );
    }

    for (const [index, volume] of WEB_SERVER_BACKUP_VOLUMES.entries()) {
      await pipeProcesses(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${volume}:/source:ro`,
          BACKUP_HELPER_ALPINE_IMAGE,
          "tar",
          "-C",
          "/source",
          "-czf",
          "-",
          ".",
        ],
        "rclone",
        [
          "rcat",
          ...storage.rcloneFlags,
          rcloneRemote(storage, volumeKeys[index] as string),
        ],
        { consumer: storage.rcloneEnvironment },
      );
    }

    const manifestKey = `${base}manifest.json`;
    const manifest: WebServerBackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: [postgresKey, ...volumeKeys],
    };
    await runRclone(
      storage,
      ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, manifestKey)],
      Readable.from([JSON.stringify(manifest)]),
    );
    return manifestKey;
  }

  async restoreWebServerBackup(
    destination: BackupRuntimeDestination,
    manifestKey: string,
  ): Promise<void> {
    const storage = await this.resolveBackupStorageDestination(destination);
    const manifest = await this.readWebServerManifest(storage, manifestKey);
    const postgresContainer = await this.findPostgresContainer();
    const dockerEnvironment = getInheritedEnv(this.dockerEnvironment);
    let caddyWasRunning = false;
    try {
      const inspect = await execFileAsync("docker", [
        "inspect",
        "--format",
        "{{.State.Running}}",
        "upstand-caddy",
      ]);
      caddyWasRunning = inspect.stdout.trim() === "true";
    } catch {
      caddyWasRunning = false;
    }

    if (caddyWasRunning) {
      await execFileAsync("docker", ["stop", "--time", "30", "upstand-caddy"]);
    }
    try {
      const databaseKey = manifest.files.find((file) =>
        file.endsWith("control-plane.dump"),
      );
      if (!databaseKey)
        throw new ValidationError(
          "Web-server backup has no control-plane database dump",
        );
      if (postgresContainer) {
        await execFileAsync(
          "docker",
          [
            "exec",
            postgresContainer,
            "sh",
            "-ec",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion is intentional.
            'psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-upstand}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"',
          ],
          { env: dockerEnvironment },
        );
        await pipeProcesses(
          "rclone",
          ["cat", ...storage.rcloneFlags, rcloneRemote(storage, databaseKey)],
          "docker",
          [
            "exec",
            "-i",
            postgresContainer,
            "sh",
            "-ec",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion is intentional.
            'pg_restore -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-upstand}" --clean --if-exists --no-owner',
          ],
          {
            producer: storage.rcloneEnvironment,
            consumer: dockerEnvironment,
          },
        );
      } else {
        await this.withExternalControlPlaneDatabase(async (envFile) => {
          await execFileAsync(
            "docker",
            this.externalPostgresCommand(
              envFile,
              'psql -v ON_ERROR_STOP=1 --dbname "$DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"',
            ),
            { env: dockerEnvironment },
          );
          await pipeProcesses(
            "rclone",
            ["cat", ...storage.rcloneFlags, rcloneRemote(storage, databaseKey)],
            "docker",
            this.externalPostgresCommand(
              envFile,
              'pg_restore --dbname "$DATABASE_URL" --clean --if-exists --no-owner',
              true,
            ),
            {
              producer: storage.rcloneEnvironment,
              consumer: dockerEnvironment,
            },
          );
        });
      }

      for (const volume of WEB_SERVER_BACKUP_VOLUMES) {
        const key = manifest.files.find((file) =>
          file.endsWith(`${volume}.tar.gz`),
        );
        if (!key)
          throw new ValidationError(`Web-server backup is missing ${volume}`);
        await pipeProcesses(
          "rclone",
          ["cat", ...storage.rcloneFlags, rcloneRemote(storage, key)],
          "docker",
          [
            "run",
            "--rm",
            "-i",
            "-v",
            `${volume}:/target`,
            BACKUP_HELPER_ALPINE_IMAGE,
            "sh",
            "-ec",
            buildSafeArchiveRestoreCommand("/target"),
          ],
          {
            producer: storage.rcloneEnvironment,
            consumer: dockerEnvironment,
          },
        );
      }
    } finally {
      if (caddyWasRunning) {
        await execFileAsync("docker", ["start", "upstand-caddy"]).catch(
          () => undefined,
        );
      }
    }
  }

  async deleteWebServerBackup(
    destination: BackupRuntimeDestination,
    manifestKey: string,
  ): Promise<void> {
    const storage = await this.resolveBackupStorageDestination(destination);
    let manifest: WebServerBackupManifest;
    try {
      manifest = await this.readWebServerManifest(storage, manifestKey);
    } catch {
      await runRclone(storage, [
        "deletefile",
        ...storage.rcloneFlags,
        rcloneRemote(storage, manifestKey),
      ]);
      return;
    }
    for (const key of [...manifest.files, manifestKey]) {
      await runRclone(storage, [
        "deletefile",
        ...storage.rcloneFlags,
        rcloneRemote(storage, key),
      ]);
    }
  }

  private async findPostgresContainer(): Promise<string | null> {
    const candidates = env.UPSTAND_POSTGRES_CONTAINER
      ? [env.UPSTAND_POSTGRES_CONTAINER, ...CONTROL_PLANE_POSTGRES_CONTAINERS]
      : [...CONTROL_PLANE_POSTGRES_CONTAINERS];
    for (const candidate of [...new Set(candidates)]) {
      const result = await execFileAsync("docker", [
        "ps",
        "--filter",
        `name=${candidate}`,
        "--format",
        "{{.ID}}",
      ]);
      const id = result.stdout.trim().split(/\r?\n/)[0];
      if (id) return id;
    }
    return null;
  }

  private externalPostgresCommand(
    envFile: string,
    command: string,
    interactive = false,
  ): string[] {
    return buildExternalPostgresDockerArgs(
      envFile,
      env.DOCKER_NETWORK,
      command,
      interactive,
    );
  }

  private async withExternalControlPlaneDatabase<T>(
    operation: (envFile: string) => Promise<T>,
  ): Promise<T> {
    const databaseUrl = validateControlPlanePostgresUrl(env.DATABASE_URL ?? "");

    const envDir = await mkdtemp(
      path.join(os.tmpdir(), "upstand-control-plane-db-"),
    );
    const envFile = path.join(envDir, "database.env");
    await writeFile(envFile, `DATABASE_URL=${databaseUrl}\n`, { mode: 0o600 });
    try {
      return await operation(envFile);
    } finally {
      await rm(envDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async readWebServerManifest(
    storage: ReturnType<typeof toBackupStorageDestination>,
    manifestKey: string,
  ): Promise<WebServerBackupManifest> {
    const { stdout } = await execRcloneAsync(
      storage,
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, manifestKey)],
      { maxBuffer: 1024 * 1024 },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new ValidationError("Web-server backup manifest is invalid");
    }
    return validateWebServerBackupManifest(parsed, manifestKey);
  }

  private async verifyWebServerBackup(
    storage: ReturnType<typeof toBackupStorageDestination>,
    manifestKey: string,
  ): Promise<void> {
    const manifest = await this.readWebServerManifest(storage, manifestKey);
    const databaseKey = manifest.files.find((file) =>
      file.endsWith("control-plane.dump"),
    );
    if (!databaseKey) {
      throw new ValidationError(
        "Web-server backup has no control-plane database dump",
      );
    }

    await pipeProcesses(
      "rclone",
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, databaseKey)],
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--network",
        "none",
        "--entrypoint",
        "sh",
        CONTROL_PLANE_POSTGRES_CLIENT_IMAGE,
        "-ec",
        "cat > /tmp/upstand-control-plane.dump && pg_restore -l /tmp/upstand-control-plane.dump >/dev/null",
      ],
      { producer: storage.rcloneEnvironment },
    );

    for (const file of manifest.files) {
      if (file === databaseKey) continue;
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, file)],
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "--network",
          "none",
          "--entrypoint",
          "sh",
          BACKUP_HELPER_ALPINE_IMAGE,
          "-ec",
          "tar -tzf - > /tmp/upstand-volume.list && test -s /tmp/upstand-volume.list && ! grep -Eq '(^/|(^|/)\\.\\.(/|$))' /tmp/upstand-volume.list",
        ],
        { producer: storage.rcloneEnvironment },
      );
    }
  }

  private async createVolumeBackup(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
  ): Promise<void> {
    if (!schedule.volumeName) {
      throw new ValidationError("Volume backup configuration is incomplete");
    }
    const serviceName = serviceNameFor(resource, schedule.serviceName);
    const replicas = schedule.stopService
      ? await this.stopService(serviceName)
      : null;
    try {
      await pipeProcesses(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${schedule.volumeName}:/source:ro`,
          BACKUP_HELPER_ALPINE_IMAGE,
          "tar",
          "-C",
          "/source",
          "-czf",
          "-",
          ".",
        ],
        "rclone",
        ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        {
          producer: this.dockerEnvironment,
          consumer: storage.rcloneEnvironment,
        },
      );
    } finally {
      if (replicas !== null) await this.restoreService(serviceName, replicas);
    }
  }

  private async restoreDatabaseBackup(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    targetTime?: string,
  ): Promise<void> {
    const engine = schedule.databaseEngine;
    const databaseName = schedule.databaseName;
    if (
      !engine ||
      (!databaseName && engine !== "libsql" && engine !== "redis")
    ) {
      throw new ValidationError("Database restore configuration is incomplete");
    }
    const credentials = resolveCredentials(schedule, resource);
    if (schedule.pointInTimeRecovery && engine === "postgres") {
      await this.restorePostgresPitr(
        schedule,
        resource,
        storage,
        fileKey,
        targetTime,
      );
      return;
    }
    if (engine === "libsql" || engine === "redis") {
      await this.restoreFileDatabaseBackup(
        schedule,
        resource,
        storage,
        fileKey,
        engine,
      );
      return;
    }
    const containerId = await this.resolveContainerId(resource, schedule);
    const credentialFile = await this.createDatabaseCredentialFile(
      containerId,
      credentials,
      databaseName,
    );
    try {
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        this.databaseExecArgs(
          containerId,
          credentialFile,
          this.databaseRestoreCommand(engine),
          true,
        ),
        {
          producer: storage.rcloneEnvironment,
          consumer: this.dockerEnvironment,
        },
      );
    } finally {
      await this.removeDatabaseCredentialFile(containerId, credentialFile);
    }
  }

  private async restoreFileDatabaseBackup(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    engine: "libsql" | "redis",
  ): Promise<void> {
    validateFileDatabaseRestore(engine, schedule.stopService);

    const serviceName = serviceNameFor(resource, schedule.serviceName);
    const containerId = await this.resolveContainerId(resource, schedule);
    const targetPath = engine === "libsql" ? "/var/lib/sqld" : "/data";
    const volumeName = await this.resolveNamedVolume(containerId, targetPath);
    const replicas = await this.stopService(serviceName);
    try {
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "-v",
          `${volumeName}:/target`,
          BACKUP_HELPER_ALPINE_IMAGE,
          "sh",
          "-ec",
          buildSafeArchiveRestoreCommand("/target"),
        ],
        {
          producer: storage.rcloneEnvironment,
          consumer: this.dockerEnvironment,
        },
      );
    } finally {
      await this.restoreService(serviceName, replicas);
    }
  }

  private async restorePostgresPitr(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    targetTime?: string,
  ): Promise<void> {
    if (!schedule.stopService)
      throw new ValidationError(
        "PITR restore requires stopService to be enabled on the schedule",
      );
    if (targetTime && !/^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z$/.test(targetTime))
      throw new ValidationError(
        "PITR restore target must be an ISO-8601 UTC timestamp",
      );
    const { stdout } = await execRcloneAsync(
      storage,
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      { maxBuffer: 1024 * 1024 },
    );
    let manifest: PostgresPitrManifest;
    try {
      manifest = JSON.parse(stdout) as PostgresPitrManifest;
    } catch {
      throw new ValidationError("PostgreSQL PITR manifest is invalid");
    }
    manifest = validatePostgresPitrManifest(manifest);

    const serviceName = serviceNameFor(resource, schedule.serviceName);
    const volumeName = `upstand-db-data-${resource.id}`;
    const image = resource.dockerImage || "postgres:18-alpine";
    const envValues = parseResourceEnvironmentVariables(resource.envVars);
    const pitrEnv = Object.entries(envValues).filter(([key]) =>
      /^(WALG_|AWS_|PGDATA$)/.test(key),
    );
    if (!pitrEnv.some(([key]) => key === "WALG_S3_PREFIX"))
      throw new ValidationError(
        "PITR restore requires WALG_S3_PREFIX in the database service environment",
      );
    const postgresDataPath = validatePostgresPitrDataPath(
      envValues.PGDATA || "/var/lib/postgresql/18/docker",
    );
    const replicas = await this.stopService(serviceName);
    const envDir = await mkdtemp(path.join(os.tmpdir(), "upstand-pitr-"));
    const envFile = path.join(envDir, "wal-g.env");
    await writeFile(
      envFile,
      `${pitrEnv.map(([key, value]) => `${key}=${value.replace(/\r?\n/g, "")}`).join("\n")}\n`,
      { mode: 0o600 },
    );
    await chmod(envFile, 0o600);
    try {
      const recoveryLines = [
        "restore_command = 'wal-g wal-fetch %f %p'",
        ...(targetTime ? [`recovery_target_time = '${targetTime}'`] : []),
      ];
      const quotedDataPath = shellQuote(postgresDataPath);
      const quotedConfigPath = shellQuote(
        `${postgresDataPath}/postgresql.auto.conf`,
      );
      const quotedRecoverySignalPath = shellQuote(
        `${postgresDataPath}/recovery.signal`,
      );
      const recoveryCommands = recoveryLines
        .map(
          (line) => `printf '%s\\n' ${shellQuote(line)} >> ${quotedConfigPath}`,
        )
        .join("; ");
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--env-file",
          envFile,
          "-v",
          `${volumeName}:${postgresDataPath}`,
          image,
          "sh",
          "-ec",
          `command -v wal-g >/dev/null 2>&1 || { echo 'The database image must contain wal-g' >&2; exit 42; }; mkdir -p ${quotedDataPath}; rm -rf ${quotedDataPath}/* ${quotedDataPath}/.[!.]*; wal-g backup-fetch ${quotedDataPath} ${shellQuote(manifest.backupName)}; ${recoveryCommands}; touch ${quotedRecoverySignalPath}; if command -v chown >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then chown -R postgres:postgres ${quotedDataPath}; fi`,
        ],
        {
          env: getInheritedEnv(this.dockerEnvironment),
          maxBuffer: 2 * 1024 * 1024,
        },
      );
    } finally {
      await rm(envDir, { recursive: true, force: true }).catch(() => undefined);
      await this.restoreService(serviceName, replicas);
    }
  }

  private async restoreVolumeBackup(
    schedule: BackupSchedule,
    resource: Resource,
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
  ): Promise<void> {
    if (!schedule.volumeName) {
      throw new ValidationError("Volume restore configuration is incomplete");
    }
    const serviceName = serviceNameFor(resource, schedule.serviceName);
    const replicas = schedule.stopService
      ? await this.stopService(serviceName)
      : null;
    try {
      await pipeProcesses(
        "rclone",
        ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "-v",
          `${schedule.volumeName}:/target`,
          BACKUP_HELPER_ALPINE_IMAGE,
          "sh",
          "-c",
          buildSafeArchiveRestoreCommand("/target"),
        ],
        {
          producer: storage.rcloneEnvironment,
          consumer: this.dockerEnvironment,
        },
      );
    } finally {
      if (replicas !== null) await this.restoreService(serviceName, replicas);
    }
  }

  private databaseDumpCommand(engine: BackupDatabaseEngine): string {
    if (engine === "postgres") {
      return 'PGPASSWORD="$UPSTAND_BACKUP_PASSWORD" pg_dump -Fc --no-owner --no-acl -U "$UPSTAND_BACKUP_USER" -d "$UPSTAND_BACKUP_DATABASE" | gzip';
    }
    if (engine === "mongodb") {
      return 'mongodump --archive --gzip -d "$UPSTAND_BACKUP_DATABASE" -u "$UPSTAND_BACKUP_USER" -p "$UPSTAND_BACKUP_PASSWORD" --authenticationDatabase admin';
    }
    if (engine === "libsql") {
      return "tar -C /var/lib/sqld -czf - .";
    }
    if (engine === "redis") {
      return "tar -C /data -czf - dump.rdb";
    }
    const command = engine === "mariadb" ? "mariadb-dump" : "mysqldump";
    return `MYSQL_PWD="$UPSTAND_BACKUP_PASSWORD" ${command} -u "$UPSTAND_BACKUP_USER" --single-transaction --quick --databases "$UPSTAND_BACKUP_DATABASE" | gzip`;
  }

  private databaseRestoreCommand(engine: BackupDatabaseEngine): string {
    if (engine === "postgres") {
      return 'PGPASSWORD="$UPSTAND_BACKUP_PASSWORD" gunzip | pg_restore -U "$UPSTAND_BACKUP_USER" -d "$UPSTAND_BACKUP_DATABASE" --clean --if-exists --no-owner';
    }
    if (engine === "mongodb") {
      return 'mongorestore --archive --gzip --drop -u "$UPSTAND_BACKUP_USER" -p "$UPSTAND_BACKUP_PASSWORD" --authenticationDatabase admin';
    }
    const command = engine === "mariadb" ? "mariadb" : "mysql";
    return `MYSQL_PWD="$UPSTAND_BACKUP_PASSWORD" gunzip | ${command} -u "$UPSTAND_BACKUP_USER"`;
  }

  private async resolveContainerId(
    resource: Resource,
    schedule: BackupSchedule | null,
  ): Promise<string> {
    const serviceName = serviceNameFor(resource, schedule?.serviceName);
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        `label=com.docker.swarm.service.name=${serviceName}`,
        "--format",
        "{{.ID}}",
      ],
      { env: getInheritedEnv(this.dockerEnvironment) },
    );
    const containerId = stdout.trim().split("\n")[0];
    if (!containerId) {
      throw new Error(
        `No running container found for service '${serviceName}'`,
      );
    }
    return containerId;
  }

  private async resolveNamedVolume(
    containerId: string,
    targetPath: string,
  ): Promise<string> {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "inspect",
        containerId,
        "--format",
        `{{range .Mounts}}{{if and (eq .Type "volume") (eq .Destination "${targetPath}")}}{{.Name}}{{end}}{{end}}`,
      ],
      { env: getInheritedEnv(this.dockerEnvironment) },
    );
    const volumeName = stdout.trim();
    if (!volumeName) {
      throw new ValidationError(
        `The ${targetPath} database path must be backed by a named Docker volume for safe restore`,
      );
    }
    return volumeName;
  }

  private async stopService(serviceName: string): Promise<number> {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "service",
        "inspect",
        serviceName,
        "--format",
        "{{.Spec.Mode.Replicated.Replicas}}",
      ],
      { env: getInheritedEnv(this.dockerEnvironment) },
    );
    const replicas = Number.parseInt(stdout.trim(), 10);
    if (!Number.isInteger(replicas)) {
      throw new Error(
        `Unable to determine replicas for service '${serviceName}'`,
      );
    }
    await execFileAsync("docker", ["service", "scale", `${serviceName}=0`], {
      env: getInheritedEnv(this.dockerEnvironment),
    });
    return replicas;
  }

  private async restoreService(
    serviceName: string,
    replicas: number,
  ): Promise<void> {
    await execFileAsync(
      "docker",
      ["service", "scale", `${serviceName}=${replicas}`],
      { env: getInheritedEnv(this.dockerEnvironment) },
    );
  }
}

export async function withBackupRuntime<T>(
  uow: IUnitOfWork,
  resource: Resource,
  runtime: BackupRuntimeService,
  operation: (runtime: BackupRuntimeService) => Promise<T>,
): Promise<T> {
  const remote = await resolveDockerCliEnvironmentForServer(
    resource.serverId,
    uow,
  );
  try {
    return await operation(runtime.withDockerEnvironment(remote.environment));
  } finally {
    remote.cleanup();
  }
}
