export const OUTBOX_COMMAND_TYPES = {
  deploy: "deployment.deploy",
  backupRun: "backup.run",
  notificationDelivery: "notification.deliver",
} as const;

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

export type OutboxCommandPayload =
  | DeployOutboxPayload
  | BackupRunOutboxPayload
  | NotificationDeliveryOutboxPayload;
