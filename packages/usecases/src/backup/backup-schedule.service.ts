import {
  type BackupDatabaseEngine,
  type BackupSchedule,
  type CreateBackupScheduleInput,
  CreateBackupScheduleInputSchema,
  type IUnitOfWork,
  parseResourceAdvancedConfig,
  type Resource,
  ValidationError,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { Cron } from "croner";
import { parseResourceCredentials as parseCredentials } from "../resource/resource-credentials";

const DATABASE_ENGINES: Record<string, BackupDatabaseEngine> = {
  postgres: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  mongodb: "mongodb",
  libsql: "libsql",
  redis: "redis",
};

function parseResourceCredentials(resource: Resource): Record<string, string> {
  return parseCredentials(resource.credentials) as Record<string, string>;
}

function defaultsForDatabase(resource: Resource): { databaseName?: string } {
  const credentials = parseResourceCredentials(resource);
  return {
    databaseName: credentials.dbName,
  };
}

export function validateBackupSchedule(input: CreateBackupScheduleInput): void {
  validateBackupTiming(input.cronExpression, input.timezone);
}

export function validateBackupTiming(
  cronExpression: string,
  timezone: string,
): void {
  try {
    const cron = new Cron(cronExpression, {
      paused: true,
      timezone,
      mode: "5-part",
    });
    const next = cron.nextRun();
    cron.stop();
    if (!next) throw new Error("The schedule has no future run");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid schedule";
    throw new ValidationError(`Invalid backup schedule: ${message}`);
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ValidationError("Backup timezone must be a valid IANA timezone");
  }
}

export function normalizeBackupScheduleInput(
  rawInput: CreateBackupScheduleInput,
  resource: Resource,
  options: { allowExistingSourceCredentials?: boolean } = {},
): CreateBackupScheduleInput {
  const resourceEngine = resource.dbType
    ? DATABASE_ENGINES[resource.dbType.toLowerCase()]
    : undefined;
  const databaseEngine = rawInput.databaseEngine ?? resourceEngine;

  if (rawInput.kind === "database" && !databaseEngine) {
    throw new ValidationError(
      "Choose a supported database engine (PostgreSQL, MySQL, MariaDB, MongoDB, libSQL, or Redis)",
    );
  }

  if (rawInput.kind === "database" && databaseEngine) {
    if (
      (rawInput.pointInTimeRecovery ||
        (rawInput.replicaCount ?? 0) > 0 ||
        rawInput.failoverEnabled) &&
      (resource.type !== "database" ||
        resource.dbType?.toLowerCase() !== "postgres" ||
        databaseEngine !== "postgres")
    ) {
      throw new ValidationError(
        "Point-in-time recovery, managed replicas, and failover require a first-class PostgreSQL database resource",
      );
    }
    if ((rawInput.replicaCount ?? 0) > 0 || rawInput.failoverEnabled) {
      const replication = parseResourceAdvancedConfig(
        resource.advancedConfig,
      ).databaseReplication;
      if (
        !replication.enabled ||
        replication.replicaCount !== rawInput.replicaCount ||
        replication.automaticFailover !== Boolean(rawInput.failoverEnabled)
      ) {
        throw new ValidationError(
          "Managed replica and failover settings must match Advanced > Health & Deploy on the PostgreSQL resource",
        );
      }
    }
    const defaults = defaultsForDatabase(resource);
    const normalized = CreateBackupScheduleInputSchema.parse({
      ...rawInput,
      databaseEngine,
      databaseName: rawInput.databaseName ?? defaults.databaseName,
    });

    if (
      resource.type !== "database" &&
      !normalized.sourceCredentials &&
      !options.allowExistingSourceCredentials
    ) {
      throw new ValidationError(
        "Database backups for applications and Compose resources require source database credentials",
      );
    }
    return normalized;
  }

  return CreateBackupScheduleInputSchema.parse(rawInput);
}

export function encryptedSourceCredentials(
  input: CreateBackupScheduleInput,
): string | null {
  return input.sourceCredentials
    ? JSON.stringify(encryptSecret(JSON.stringify(input.sourceCredentials)))
    : null;
}

export async function resolveBackupOrganizationId(
  uow: IUnitOfWork,
  resource: Resource,
): Promise<string> {
  const environment = await uow.environmentRepository.findById(
    resource.environmentId,
  );
  if (!environment) throw new ValidationError("Resource environment not found");

  const project = await uow.projectRepository.findById(environment.projectId);
  if (!project) throw new ValidationError("Resource project not found");
  return project.organizationId;
}

export function toScheduleUpdate(
  input: CreateBackupScheduleInput,
  encryptedConfiguration: string | null | undefined,
) {
  return {
    resourceId: input.resourceId,
    destinationId: input.destinationId,
    name: input.name,
    kind: input.kind,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    prefix: input.prefix.replace(/^\/+|\/+$/g, ""),
    retentionCount: input.retentionCount ?? null,
    enabled: input.enabled,
    databaseName: input.databaseName ?? null,
    databaseEngine: input.databaseEngine ?? null,
    serviceName: input.serviceName ?? null,
    volumeName: input.volumeName ?? null,
    stopService: input.stopService,
    pointInTimeRecovery: input.pointInTimeRecovery ?? false,
    restoreVerification: input.restoreVerification ?? true,
    replicaCount: input.replicaCount ?? 0,
    failoverEnabled: input.failoverEnabled ?? false,
    migrationCommand: input.migrationCommand ?? null,
    encryptedConfiguration,
  };
}

export function scheduleWithInput(
  schedule: BackupSchedule,
): CreateBackupScheduleInput {
  if (!schedule.resourceId) {
    throw new ValidationError(
      "Use the web-server backup schedule workflow for global backups",
    );
  }
  return {
    resourceId: schedule.resourceId,
    destinationId: schedule.destinationId,
    name: schedule.name,
    kind: schedule.kind,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    prefix: schedule.prefix,
    retentionCount: schedule.retentionCount,
    enabled: schedule.enabled,
    databaseName: schedule.databaseName ?? undefined,
    databaseEngine: schedule.databaseEngine ?? undefined,
    serviceName: schedule.serviceName ?? undefined,
    volumeName: schedule.volumeName ?? undefined,
    stopService: schedule.stopService,
    pointInTimeRecovery: schedule.pointInTimeRecovery,
    restoreVerification: schedule.restoreVerification,
    replicaCount: schedule.replicaCount,
    failoverEnabled: schedule.failoverEnabled,
    migrationCommand: schedule.migrationCommand ?? undefined,
  };
}
