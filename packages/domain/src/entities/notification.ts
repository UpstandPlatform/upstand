import { z } from "zod";

export const NotificationProviderTypeSchema = z.enum([
  "slack",
  "telegram",
  "discord",
  "lark",
  "teams",
  "email",
  "resend",
  "gotify",
  "ntfy",
  "mattermost",
  "pushover",
  "custom",
]);

export type NotificationProviderType = z.infer<
  typeof NotificationProviderTypeSchema
>;

export const NotificationEventTypeSchema = z.enum([
  "deployment_succeeded",
  "deployment_failed",
  "database_backup_completed",
  "volume_backup_completed",
  "web_server_backup_completed",
  "platform_restart",
  "upstand_update_available",
  "upstand_update_completed",
  "docker_cleanup_completed",
  "docker_cleanup_failed",
  "cluster_initialized",
  "cluster_node_updated",
  "cluster_node_removed",
  "cluster_token_rotated",
  "server_threshold_alert",
]);

export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Only HTTP(S) URLs are supported",
  );

const EmailAddressSchema = z.email();

export const NotificationConfigurationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("slack"),
    webhookUrl: HttpUrlSchema,
    channel: z.string().trim().max(80).optional(),
  }),
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().trim().min(1).max(512),
    chatId: z.string().trim().min(1).max(128),
    messageThreadId: z.string().trim().max(128).optional(),
  }),
  z.object({
    type: z.literal("discord"),
    webhookUrl: HttpUrlSchema,
  }),
  z.object({
    type: z.literal("lark"),
    webhookUrl: HttpUrlSchema,
  }),
  z.object({
    type: z.literal("teams"),
    webhookUrl: HttpUrlSchema,
  }),
  z.object({
    type: z.literal("email"),
    smtpHost: z.string().trim().min(1).max(255),
    smtpPort: z.number().int().min(1).max(65535),
    username: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(1024),
    fromAddress: EmailAddressSchema,
    toAddresses: z.array(EmailAddressSchema).min(1).max(50),
    secure: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("resend"),
    apiKey: z.string().trim().min(1).max(1024),
    fromAddress: EmailAddressSchema,
    toAddresses: z.array(EmailAddressSchema).min(1).max(50),
  }),
  z.object({
    type: z.literal("gotify"),
    serverUrl: HttpUrlSchema,
    appToken: z.string().trim().min(1).max(1024),
    priority: z.number().int().min(0).max(10).default(5),
  }),
  z.object({
    type: z.literal("ntfy"),
    serverUrl: HttpUrlSchema,
    topic: z.string().trim().min(1).max(255),
    accessToken: z.string().trim().min(1).max(1024).optional(),
    priority: z.number().int().min(1).max(5).default(3),
  }),
  z.object({
    type: z.literal("mattermost"),
    webhookUrl: HttpUrlSchema,
    channel: z.string().trim().max(80).optional(),
    username: z.string().trim().max(80).optional(),
  }),
  z
    .object({
      type: z.literal("pushover"),
      userKey: z.string().trim().min(1).max(1024),
      apiToken: z.string().trim().min(1).max(1024),
      priority: z.number().int().min(-2).max(2).default(0),
      retry: z.number().int().min(30).max(3600).optional(),
      expire: z.number().int().min(1).max(10800).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.priority === 2 && (!value.retry || !value.expire)) {
        ctx.addIssue({
          code: "custom",
          path: ["retry"],
          message: "Emergency priority requires retry and expire values",
        });
      }
    }),
  z.object({
    type: z.literal("custom"),
    endpoint: HttpUrlSchema,
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);

export type NotificationConfiguration = z.infer<
  typeof NotificationConfigurationSchema
>;

export const CreateNotificationChannelInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  events: z.array(NotificationEventTypeSchema).min(1).max(16),
  configuration: NotificationConfigurationSchema,
});

export type CreateNotificationChannelInput = z.infer<
  typeof CreateNotificationChannelInputSchema
>;

export const UpdateNotificationChannelInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  events: z.array(NotificationEventTypeSchema).min(1).max(16).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateNotificationChannelInput = z.infer<
  typeof UpdateNotificationChannelInputSchema
>;

export const NotificationChannelSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  provider: NotificationProviderTypeSchema,
  events: z.array(NotificationEventTypeSchema),
  encryptedConfiguration: z.string(),
  configurationSummary: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export type NotificationChannelView = Omit<
  NotificationChannel,
  "encryptedConfiguration"
>;

export const NotificationDeliveryStatusSchema = z.enum([
  "queued",
  "processing",
  "delivered",
  "failed",
  "dead_letter",
]);

export const NotificationDeliverySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  organizationId: z.string(),
  event: NotificationEventTypeSchema,
  idempotencyKey: z.string().nullable(),
  title: z.string(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  status: NotificationDeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  deliveredAt: z.date().nullable(),
  processingStartedAt: z.date().nullable(),
  lastAttemptAt: z.date().nullable(),
  nextAttemptAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;

export interface CreateNotificationDeliveryDTO {
  id: string;
  channelId: string;
  organizationId: string;
  event: NotificationEventType;
  idempotencyKey?: string | null;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  status?: z.infer<typeof NotificationDeliveryStatusSchema>;
  attempts?: number;
  error?: string | null;
  deliveredAt?: Date | null;
  processingStartedAt?: Date | null;
  lastAttemptAt?: Date | null;
  nextAttemptAt?: Date | null;
}

const SensitiveConfigurationKeys = new Set([
  "accessToken",
  "apiKey",
  "apiToken",
  "appToken",
  "botToken",
  "password",
  "userKey",
]);

export function summarizeNotificationConfiguration(
  configuration: NotificationConfiguration,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(configuration).filter(
      ([key, value]) =>
        key !== "type" &&
        !SensitiveConfigurationKeys.has(key) &&
        value !== undefined,
    ),
  );
}

export function toNotificationChannelView(
  channel: NotificationChannel,
): NotificationChannelView {
  const { encryptedConfiguration: _encryptedConfiguration, ...view } = channel;
  return view;
}

export const ListNotificationDeliveriesInputSchema = z.object({
  organizationId: z.string().min(1),
  channelId: z.string().optional(),
  status: NotificationDeliveryStatusSchema.optional(),
  timespan: z.enum(["24h", "7d", "30d"]).default("30d").optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1).optional(),
  pageSize: z.number().int().min(1).max(100).default(50).optional(),
});

export type ListNotificationDeliveriesInput = z.infer<
  typeof ListNotificationDeliveriesInputSchema
>;

export interface ListNotificationDeliveriesResult {
  items: NotificationDelivery[];
  total: number;
}
