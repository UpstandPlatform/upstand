export const OUTBOX_COMMAND_TYPES = {
  deploy: "deployment.deploy",
  backupRun: "backup.run",
  notificationDelivery: "notification.deliver",
  migrate: "resource.migrate",
} as const;

export const WORKLOAD_MIGRATION_QUEUE = "upstand-workload-migrations";

export type DeployOutboxPayload = {
  resourceId: string;
  deploymentId: string;
  serverId: string;
  previewDeploymentId?: string;
  sourceRevision?: string;
  maxAttempts?: number;
  retryBaseSeconds?: number;
  retryMaxSeconds?: number;
};

export type BackupRunOutboxPayload = {
  runId: string;
};

export type NotificationDeliveryOutboxPayload = {
  deliveryId: string;
};

export type MigrateOutboxPayload = {
  migrationId: string;
  deploymentId: string;
  resourceId: string;
  sourceServerId: string;
  targetServerId: string;
};

export type OutboxCommandPayload =
  | DeployOutboxPayload
  | BackupRunOutboxPayload
  | NotificationDeliveryOutboxPayload
  | MigrateOutboxPayload;
