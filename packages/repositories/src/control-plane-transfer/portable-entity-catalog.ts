import {
  auditLog,
  backupRun,
  backupSchedule,
  certificate,
  deployment,
  dockerRegistry,
  environment,
  environmentSecret,
  gitProvider,
  member,
  monitoringSettings,
  organization,
  project,
  resource,
  resourceConfiguration,
  resourceSecret,
  s3Destination,
  schedule,
  server,
  sshKey,
  user,
  webServerSettings,
} from "@upstand/db";
import type { PortableControlPlaneTable } from "@upstand/domain";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";

export type PortableSecretStorage =
  | { kind: "json"; column: string; required: boolean; fallback: string }
  | {
      kind: "parts";
      ciphertext: string;
      iv: string;
      authTag: string;
      keyVersion: string;
      required: boolean;
      fallback: string;
    };

export interface PortableEntityDefinition {
  name: string;
  portableTable: PortableControlPlaneTable;
  table: AnyPgTable;
  idColumn: AnyPgColumn;
  idField: string;
  omit: readonly string[];
  secrets: Readonly<Record<string, PortableSecretStorage>>;
}

const jsonSecret = (
  column: string,
  options: { required?: boolean; fallback?: string } = {},
): PortableSecretStorage => ({
  kind: "json",
  column,
  required: options.required ?? false,
  fallback: options.fallback ?? "",
});

const partsSecret = (
  prefix: string,
  options: { required?: boolean; fallback?: string } = {},
): PortableSecretStorage => ({
  kind: "parts",
  ciphertext: `${prefix}Ciphertext`,
  iv: `${prefix}Iv`,
  authTag: `${prefix}AuthTag`,
  keyVersion: `${prefix}Version`,
  required: options.required ?? false,
  fallback: options.fallback ?? "",
});

function definition(
  input: Omit<PortableEntityDefinition, "omit" | "secrets"> & {
    omit?: readonly string[];
    secrets?: Readonly<Record<string, PortableSecretStorage>>;
  },
): PortableEntityDefinition {
  const secretColumns = Object.values(input.secrets ?? {}).flatMap((storage) =>
    storage.kind === "json"
      ? [storage.column]
      : [storage.ciphertext, storage.iv, storage.authTag, storage.keyVersion],
  );
  return {
    ...input,
    omit: [...new Set([...(input.omit ?? []), ...secretColumns])],
    secrets: input.secrets ?? {},
  };
}

/**
 * Physical tables in portable dependency order. Runtime caches, sessions,
 * API keys, transient queues, and auth verification challenges are excluded
 * deliberately: they must be recreated or invalidated during cutover.
 */
export const PORTABLE_ENTITY_CATALOG: readonly PortableEntityDefinition[] = [
  definition({
    name: "user",
    portableTable: "users",
    table: user,
    idColumn: user.id,
    idField: "id",
  }),
  definition({
    name: "organization",
    portableTable: "organizations",
    table: organization,
    idColumn: organization.id,
    idField: "id",
  }),
  definition({
    name: "member",
    portableTable: "memberships",
    table: member,
    idColumn: member.id,
    idField: "id",
  }),
  definition({
    name: "ssh_key",
    portableTable: "credentials",
    table: sshKey,
    idColumn: sshKey.id,
    idField: "id",
    secrets: {
      keyMaterial: partsSecret("privateKey", { required: true }),
    },
  }),
  definition({
    name: "docker_registry",
    portableTable: "credentials",
    table: dockerRegistry,
    idColumn: dockerRegistry.id,
    idField: "id",
    omit: ["serverId"],
    secrets: { registryPassword: jsonSecret("password") },
  }),
  definition({
    name: "git_provider",
    portableTable: "credentials",
    table: gitProvider,
    idColumn: gitProvider.id,
    idField: "id",
    secrets: {
      providerConfiguration: jsonSecret("config", {
        required: true,
        fallback: "{}",
      }),
    },
  }),
  definition({
    name: "certificate",
    portableTable: "credentials",
    table: certificate,
    idColumn: certificate.id,
    idField: "id",
    secrets: {
      certificateChain: jsonSecret("certificatePem", { required: true }),
      certificateKey: jsonSecret("privateKeyPem", { required: true }),
    },
  }),
  definition({
    name: "s3_destination",
    portableTable: "credentials",
    table: s3Destination,
    idColumn: s3Destination.id,
    idField: "id",
    secrets: {
      storageAccessValue: jsonSecret("secretAccessKey", { required: true }),
    },
  }),
  definition({
    name: "project",
    portableTable: "projects",
    table: project,
    idColumn: project.id,
    idField: "id",
  }),
  definition({
    name: "environment",
    portableTable: "environments",
    table: environment,
    idColumn: environment.id,
    idField: "id",
  }),
  definition({
    name: "environment_state",
    portableTable: "environments",
    table: environmentSecret,
    idColumn: environmentSecret.environmentId,
    idField: "environmentId",
    secrets: {
      variables: jsonSecret("envVars", { required: true, fallback: "{}" }),
    },
  }),
  definition({
    name: "server",
    portableTable: "servers",
    table: server,
    idColumn: server.id,
    idField: "id",
    omit: ["setupLogs", "setupError"],
    secrets: { loginPassword: partsSecret("password") },
  }),
  definition({
    name: "resource",
    portableTable: "resources",
    table: resource,
    idColumn: resource.id,
    idField: "id",
    omit: ["webhookTokenHash", "webhookTokenPrefix"],
  }),
  definition({
    name: "resource_configuration",
    portableTable: "resources",
    table: resourceConfiguration,
    idColumn: resourceConfiguration.resourceId,
    idField: "resourceId",
  }),
  definition({
    name: "resource_state",
    portableTable: "resources",
    table: resourceSecret,
    idColumn: resourceSecret.resourceId,
    idField: "resourceId",
    secrets: {
      providerCredentials: jsonSecret("credentials"),
      buildInputs: jsonSecret("buildSecrets"),
      buildVariables: jsonSecret("buildEnvVars"),
      runtimeVariables: jsonSecret("envVars", {
        required: true,
        fallback: "{}",
      }),
    },
  }),
  definition({
    name: "schedule",
    portableTable: "schedules",
    table: schedule,
    idColumn: schedule.id,
    idField: "id",
    omit: ["secretEnvVar"],
  }),
  definition({
    name: "backup_schedule",
    portableTable: "backups",
    table: backupSchedule,
    idColumn: backupSchedule.id,
    idField: "id",
    omit: ["encryptedConfiguration"],
  }),
  definition({
    name: "backup_run",
    portableTable: "backups",
    table: backupRun,
    idColumn: backupRun.id,
    idField: "id",
  }),
  definition({
    name: "deployment",
    portableTable: "deployments",
    table: deployment,
    idColumn: deployment.id,
    idField: "id",
    omit: ["logs", "executionToken", "lastError"],
  }),
  definition({
    name: "monitoring_settings",
    portableTable: "settings",
    table: monitoringSettings,
    idColumn: monitoringSettings.serverId,
    idField: "serverId",
    secrets: {
      monitoringCredential: jsonSecret("token", { required: true }),
    },
  }),
  definition({
    name: "web_server_settings",
    portableTable: "settings",
    table: webServerSettings,
    idColumn: webServerSettings.id,
    idField: "id",
    secrets: { dnsCredential: jsonSecret("cloudflareApiToken") },
  }),
  definition({
    name: "audit_log",
    portableTable: "audit_history",
    table: auditLog,
    idColumn: auditLog.id,
    idField: "id",
    omit: ["ipAddress", "userAgent"],
  }),
];

export const PORTABLE_ENTITY_BY_NAME = new Map(
  PORTABLE_ENTITY_CATALOG.map((entry) => [entry.name, entry]),
);
