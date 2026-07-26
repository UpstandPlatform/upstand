import { z } from "zod";

export const OUTBOX_STATUSES = [
  "pending",
  "publishing",
  "published",
  "dead_letter",
] as const;

export const OutboxStatusSchema = z.enum(OUTBOX_STATUSES);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const OutboxMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  aggregateType: z.string().nullable().optional(),
  aggregateId: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  idempotencyKey: z.string(),
  status: OutboxStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.date(),
  claimedAt: z.date().nullable().optional(),
  publishedAt: z.date().nullable().optional(),
  deadLetteredAt: z.date().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type OutboxMessage = z.infer<typeof OutboxMessageSchema>;

export interface CreateOutboxMessageDTO {
  id?: string;
  type: string;
  payload: Record<string, unknown>;
  aggregateType?: string | null;
  aggregateId?: string | null;
  organizationId?: string | null;
  idempotencyKey: string;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface OutboxOperationalSummary {
  pending: number;
  publishing: number;
  published: number;
  deadLetter: number;
}
