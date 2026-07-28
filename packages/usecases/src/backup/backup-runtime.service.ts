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
import { env } from "@upstand/env/server";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { resolveDockerCliEnvironmentForServer } from "../resource/docker-client";
import { parseResourceCredentials as parseCredentialDocument } from "../resource/resource-credentials";
import { parseResourceEnvironmentVariables } from "../resource/resource-environment";
import {
  type BackupRuntimeDestination,
  normalizeBackupPrefix,
  pipeProcesses,
  rcloneRemote,
  runProcess,
  toBackupStorageDestination,
} from "./backup-storage";

const execFileAsync = promisify(execFile);

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

export class BackupRuntimeService {
  constructor(
    private readonly dockerEnvironment: Record<string, string | undefined> = {},
  ) {}

  withDockerEnvironment(
    environment: Record<string, string | undefined>,
  ): BackupRuntimeService {
    return new BackupRuntimeService(environment);
  }

  async listVolumes(resource: Resource): Promise<string[]> {
    try {
      const containerId = await this.resolveContainerId(resource, null);
      const { stdout } = await execFileAsync(
        "docker",
        ["inspect", containerId, "--format", "{{json .Mounts}}"],
        { env: { ...process.env, ...this.dockerEnvironment } },
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
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
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
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
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
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
    await runProcess("rclone", [
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
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
    if (schedule.kind !== "database") {
      await runProcess("rclone", [
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
      env: { ...process.env, ...this.dockerEnvironment },
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
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "postgres:18-alpine",
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
        { producer: dockerOptions.env, consumer: dockerOptions.env },
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
    const image = engine === "mysql" ? "mysql:8.4" : "mariadb:11";
    const dockerOptions = {
      env: { ...process.env, ...this.dockerEnvironment },
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
        { consumer: dockerOptions.env },
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
      env: { ...process.env, ...this.dockerEnvironment },
    };
    await execFileAsync(
      "docker",
      ["run", "-d", "--rm", "--name", containerName, "mongo:7.0"],
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
        { consumer: dockerOptions.env },
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
      env: { ...process.env, ...this.dockerEnvironment },
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
          "alpine:3.20",
          "sh",
          "-ec",
          `find ${target} -mindepth 1 -delete && tar -xzf - -C ${target} && test -n "$(find ${target} -mindepth 1 -print -quit)"`,
        ],
        { consumer: dockerOptions.env },
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
      env: { ...process.env, ...this.dockerEnvironment },
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
    const dockerArgs = [
      "exec",
      "-i",
      "-e",
      `UPSTAND_BACKUP_USER=${credentials.databaseUser}`,
      "-e",
      `UPSTAND_BACKUP_PASSWORD=${credentials.databasePassword}`,
      "-e",
      `UPSTAND_BACKUP_DATABASE=${databaseName}`,
      containerId,
      "sh",
      "-c",
      command,
    ];
    await pipeProcesses(
      "docker",
      dockerArgs,
      "rclone",
      ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      { producer: this.dockerEnvironment },
    );
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
        env: { ...process.env, ...this.dockerEnvironment },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const backupName = await this.resolveLatestWalBackup(
      activeContainerId,
      result.stdout,
    );
    const manifest: PostgresPitrManifest = {
      version: 1,
      kind: "postgres-pitr",
      createdAt: new Date().toISOString(),
      backupName,
    };
    await runProcess(
      "rclone",
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
      env: { ...process.env, ...this.dockerEnvironment },
    };
    let currentConfig = "";
    try {
      const current = await execFileAsync(
        "docker",
        [
          "exec",
          "-e",
          `UPSTAND_BACKUP_USER=${credentials.databaseUser}`,
          "-e",
          `UPSTAND_BACKUP_PASSWORD=${credentials.databasePassword}`,
          "-e",
          `UPSTAND_BACKUP_DATABASE=${schedule.databaseName ?? "postgres"}`,
          containerId,
          "sh",
          "-ec",
          "PGPASSWORD=\"$UPSTAND_BACKUP_PASSWORD\" psql -At -U \"$UPSTAND_BACKUP_USER\" -d \"$UPSTAND_BACKUP_DATABASE\" -c 'SHOW archive_mode' -c 'SHOW wal_level' -c 'SHOW archive_command'",
        ],
        dockerOptions,
      );
      currentConfig = current.stdout;
    } catch {
      // The configuration check is retried by the guarded configuration path.
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
    await execFileAsync(
      "docker",
      [
        "exec",
        "-e",
        `UPSTAND_BACKUP_USER=${credentials.databaseUser}`,
        "-e",
        `UPSTAND_BACKUP_PASSWORD=${credentials.databasePassword}`,
        "-e",
        `UPSTAND_BACKUP_DATABASE=${schedule.databaseName ?? "postgres"}`,
        containerId,
        "sh",
        "-ec",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion is intentional.
        'command -v wal-g >/dev/null 2>&1 || { echo "PostgreSQL PITR requires an image with wal-g installed" >&2; exit 42; }; test -n "${WALG_S3_PREFIX:-}" || { echo "PostgreSQL PITR requires WALG_S3_PREFIX in the database service environment" >&2; exit 42; }; PGPASSWORD="$UPSTAND_BACKUP_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$UPSTAND_BACKUP_USER" -d "$UPSTAND_BACKUP_DATABASE" -c "ALTER SYSTEM SET wal_level = \'replica\';" -c "ALTER SYSTEM SET archive_mode = \'on\';" -c "ALTER SYSTEM SET archive_command = \'wal-g wal-push %p\';"',
      ],
      dockerOptions,
    );
    const serviceName = serviceNameFor(resource, schedule.serviceName);
    await execFileAsync(
      "docker",
      ["service", "update", "--force", serviceName],
      dockerOptions,
    );
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const active = await this.resolveContainerId(resource, schedule);
        await execFileAsync(
          "docker",
          [
            "exec",
            "-e",
            `UPSTAND_BACKUP_USER=${credentials.databaseUser}`,
            "-e",
            `UPSTAND_BACKUP_DATABASE=${schedule.databaseName ?? "postgres"}`,
            active,
            "sh",
            "-ec",
            'pg_isready -U "$UPSTAND_BACKUP_USER" -d "$UPSTAND_BACKUP_DATABASE"',
          ],
          dockerOptions,
        );
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
    if (explicit) return explicit;
    const result = await execFileAsync(
      "docker",
      ["exec", containerId, "sh", "-ec", "wal-g backup-list --json"],
      {
        env: { ...process.env, ...this.dockerEnvironment },
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
    return name;
  }

  private async verifyPostgresPitr(
    storage: ReturnType<typeof toBackupStorageDestination>,
    fileKey: string,
    schedule: BackupSchedule,
    resource: Resource,
  ): Promise<void> {
    const { stdout } = await execFileAsync(
      "rclone",
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      { maxBuffer: 1024 * 1024 },
    );
    let manifest: PostgresPitrManifest;
    try {
      manifest = JSON.parse(stdout) as PostgresPitrManifest;
    } catch {
      throw new ValidationError("PostgreSQL PITR manifest is invalid");
    }
    if (
      manifest.version !== 1 ||
      manifest.kind !== "postgres-pitr" ||
      !manifest.backupName
    )
      throw new ValidationError("PostgreSQL PITR manifest is invalid");
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
        `rm -rf /tmp/upstand-pitr-verify && mkdir -p /tmp/upstand-pitr-verify && wal-g backup-fetch /tmp/upstand-pitr-verify ${manifest.backupName} && test -s /tmp/upstand-pitr-verify/PG_VERSION && rm -rf /tmp/upstand-pitr-verify`,
      ],
      {
        env: { ...process.env, ...this.dockerEnvironment },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  }

  async createWebServerBackup(
    schedule: BackupSchedule,
    destination: BackupRuntimeDestination,
  ): Promise<string> {
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
    const base = `web-server/${normalizeBackupPrefix(schedule.prefix)}${backupTimestamp()}-${randomSuffix()}/`;
    const postgresKey = `${base}control-plane.dump`;
    const volumeKeys = WEB_SERVER_BACKUP_VOLUMES.map(
      (volume) => `${base}${volume}.tar.gz`,
    );
    const postgresContainer = await this.resolvePostgresContainer();

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
    );

    for (const [index, volume] of WEB_SERVER_BACKUP_VOLUMES.entries()) {
      await pipeProcesses(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${volume}:/source:ro`,
          "alpine:3.20",
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
      );
    }

    const manifestKey = `${base}manifest.json`;
    const manifest: WebServerBackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: [postgresKey, ...volumeKeys],
    };
    await runProcess(
      "rclone",
      ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, manifestKey)],
      Readable.from([JSON.stringify(manifest)]),
    );
    return manifestKey;
  }

  async restoreWebServerBackup(
    destination: BackupRuntimeDestination,
    manifestKey: string,
  ): Promise<void> {
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
    const manifest = await this.readWebServerManifest(storage, manifestKey);
    const postgresContainer = await this.resolvePostgresContainer();
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
      await execFileAsync("docker", [
        "exec",
        postgresContainer,
        "sh",
        "-ec",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion is intentional.
        'psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-upstand}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"',
      ]);
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
      );

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
            "alpine:3.20",
            "sh",
            "-ec",
            "find /target -mindepth 1 -delete && tar -xzf - -C /target",
          ],
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
    const storage = toBackupStorageDestination(
      destination,
      destination.caCertificatePem,
    );
    let manifest: WebServerBackupManifest;
    try {
      manifest = await this.readWebServerManifest(storage, manifestKey);
    } catch {
      await runProcess("rclone", [
        "deletefile",
        ...storage.rcloneFlags,
        rcloneRemote(storage, manifestKey),
      ]);
      return;
    }
    for (const key of [...manifest.files, manifestKey]) {
      await runProcess("rclone", [
        "deletefile",
        ...storage.rcloneFlags,
        rcloneRemote(storage, key),
      ]);
    }
  }

  private async resolvePostgresContainer(): Promise<string> {
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
    throw new ValidationError("Upstand PostgreSQL container is not running");
  }

  private async readWebServerManifest(
    storage: ReturnType<typeof toBackupStorageDestination>,
    manifestKey: string,
  ): Promise<WebServerBackupManifest> {
    const { stdout } = await execFileAsync(
      "rclone",
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
          "alpine:3.20",
          "tar",
          "-C",
          "/source",
          "-czf",
          "-",
          ".",
        ],
        "rclone",
        ["rcat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
        { producer: this.dockerEnvironment },
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
    const containerId = await this.resolveContainerId(resource, schedule);
    await pipeProcesses(
      "rclone",
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      "docker",
      [
        "exec",
        "-i",
        "-e",
        `UPSTAND_BACKUP_USER=${credentials.databaseUser}`,
        "-e",
        `UPSTAND_BACKUP_PASSWORD=${credentials.databasePassword}`,
        "-e",
        `UPSTAND_BACKUP_DATABASE=${databaseName}`,
        containerId,
        "sh",
        "-c",
        this.databaseRestoreCommand(engine),
      ],
      { consumer: this.dockerEnvironment },
    );
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
    const { stdout } = await execFileAsync(
      "rclone",
      ["cat", ...storage.rcloneFlags, rcloneRemote(storage, fileKey)],
      { maxBuffer: 1024 * 1024 },
    );
    let manifest: PostgresPitrManifest;
    try {
      manifest = JSON.parse(stdout) as PostgresPitrManifest;
    } catch {
      throw new ValidationError("PostgreSQL PITR manifest is invalid");
    }
    if (
      manifest.version !== 1 ||
      manifest.kind !== "postgres-pitr" ||
      !manifest.backupName
    )
      throw new ValidationError("PostgreSQL PITR manifest is invalid");

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
    const postgresDataPath =
      envValues.PGDATA || "/var/lib/postgresql/18/docker";
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
          `command -v wal-g >/dev/null 2>&1 || { echo 'The database image must contain wal-g' >&2; exit 42; }; mkdir -p ${postgresDataPath}; rm -rf ${postgresDataPath}/* ${postgresDataPath}/.[!.]*; wal-g backup-fetch ${postgresDataPath} ${manifest.backupName}; printf '%s\\n' ${recoveryLines.map((line) => JSON.stringify(line)).join(" ")} >> ${postgresDataPath}/postgresql.auto.conf; touch ${postgresDataPath}/recovery.signal; if command -v chown >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then chown -R postgres:postgres ${postgresDataPath}; fi`,
        ],
        {
          env: { ...process.env, ...this.dockerEnvironment },
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
          "alpine:3.20",
          "sh",
          "-c",
          "find /target -mindepth 1 -delete && tar -xzf - -C /target",
        ],
        { consumer: this.dockerEnvironment },
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
    if (engine === "libsql") {
      return "find /var/lib/sqld -mindepth 1 -delete && tar -xzf - -C /var/lib/sqld";
    }
    if (engine === "redis") {
      return "mkdir -p /data && tar -xzf - -C /data";
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
      { env: { ...process.env, ...this.dockerEnvironment } },
    );
    const containerId = stdout.trim().split("\n")[0];
    if (!containerId) {
      throw new Error(
        `No running container found for service '${serviceName}'`,
      );
    }
    return containerId;
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
      { env: { ...process.env, ...this.dockerEnvironment } },
    );
    const replicas = Number.parseInt(stdout.trim(), 10);
    if (!Number.isInteger(replicas)) {
      throw new Error(
        `Unable to determine replicas for service '${serviceName}'`,
      );
    }
    await execFileAsync("docker", ["service", "scale", `${serviceName}=0`], {
      env: { ...process.env, ...this.dockerEnvironment },
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
      { env: { ...process.env, ...this.dockerEnvironment } },
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
