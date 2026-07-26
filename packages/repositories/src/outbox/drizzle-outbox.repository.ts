import { randomUUID } from "node:crypto";
import { outbox } from "@upstand/db";
import type {
  CreateOutboxMessageDTO,
  IOutboxRepository,
  OutboxMessage,
  OutboxOperationalSummary,
} from "@upstand/domain";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Executor } from "../shared/types";

const DEFAULT_MAX_ATTEMPTS = 10;
const MAX_BATCH_SIZE = 500;

function statusFilter(
  status: OutboxMessage["status"],
  organizationId?: string,
) {
  return organizationId
    ? and(eq(outbox.status, status), eq(outbox.organizationId, organizationId))
    : eq(outbox.status, status);
}

function normalizeRow(row: unknown): OutboxMessage {
  return row as OutboxMessage;
}

export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(private readonly executor: Executor) {}

  async create(data: CreateOutboxMessageDTO): Promise<OutboxMessage> {
    const [message] = await this.executor
      .insert(outbox)
      .values({
        ...data,
        id: data.id ?? randomUUID(),
        maxAttempts: data.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      })
      .onConflictDoNothing({ target: outbox.idempotencyKey })
      .returning();

    if (message) return normalizeRow(message);

    const existing = await this.executor
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, data.idempotencyKey))
      .limit(1);
    if (!existing[0]) {
      throw new Error("create: insert returned no outbox message");
    }
    return normalizeRow(existing[0]);
  }

  async createMany(data: CreateOutboxMessageDTO[]): Promise<OutboxMessage[]> {
    if (data.length === 0) return [];

    const inserted = await this.executor
      .insert(outbox)
      .values(
        data.map((item) => ({
          ...item,
          id: item.id ?? randomUUID(),
          maxAttempts: item.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        })),
      )
      .onConflictDoNothing({ target: outbox.idempotencyKey })
      .returning();

    if (inserted.length === data.length) {
      return inserted.map(normalizeRow);
    }

    const keys = data.map((item) => item.idempotencyKey);
    const existing = await this.executor
      .select()
      .from(outbox)
      .where(inArray(outbox.idempotencyKey, keys));
    const byKey = new Map(existing.map((row) => [row.idempotencyKey, row]));
    return keys.flatMap((key) => {
      const row = byKey.get(key);
      return row ? [normalizeRow(row)] : [];
    });
  }

  async findById(id: string): Promise<OutboxMessage | null> {
    const [message] = await this.executor
      .select()
      .from(outbox)
      .where(eq(outbox.id, id))
      .limit(1);
    return message ? normalizeRow(message) : null;
  }

  async findByStatus(
    status: OutboxMessage["status"],
    limit = 100,
    organizationId?: string,
  ): Promise<OutboxMessage[]> {
    const rows = await this.executor
      .select()
      .from(outbox)
      .where(statusFilter(status, organizationId))
      .orderBy(outbox.createdAt)
      .limit(Math.max(1, Math.min(limit, MAX_BATCH_SIZE)));
    return rows.map(normalizeRow);
  }

  async claimBatch(
    now: Date,
    leaseMs: number,
    limit = 100,
  ): Promise<OutboxMessage[]> {
    const safeLimit = Math.max(1, Math.min(limit, MAX_BATCH_SIZE));
    const staleBefore = new Date(now.getTime() - Math.max(1_000, leaseMs));
    const result = await this.executor.execute(sql`
      WITH candidates AS (
        SELECT id, status
        FROM ${outbox}
        WHERE (
          (status = 'pending' AND available_at <= ${now})
          OR (status = 'publishing' AND claimed_at < ${staleBefore})
        )
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${safeLimit}
      )
      UPDATE ${outbox} AS messages
      SET
        status = 'publishing',
        claimed_at = ${now},
        attempts = messages.attempts + CASE
          WHEN EXISTS (
            SELECT 1 FROM candidates
            WHERE candidates.id = messages.id AND candidates.status = 'pending'
          ) THEN 1 ELSE 0 END,
        updated_at = ${now}
      WHERE messages.id IN (SELECT id FROM candidates)
      RETURNING messages.*
    `);

    return ((result as { rows?: unknown[] }).rows ?? []).map(normalizeRow);
  }

  async markPublished(
    id: string,
    publishedAt: Date,
    claimedAt?: Date | null,
  ): Promise<boolean> {
    const conditions = [eq(outbox.id, id), eq(outbox.status, "publishing")];
    if (claimedAt) conditions.push(eq(outbox.claimedAt, claimedAt));
    const result = await this.executor
      .update(outbox)
      .set({
        status: "published",
        claimedAt: null,
        publishedAt,
        updatedAt: publishedAt,
      })
      .where(and(...conditions))
      .returning({ id: outbox.id });
    return result.length > 0;
  }

  async markFailed(
    id: string,
    failedAt: Date,
    error: string,
    retryDelayMs: number,
    claimedAt?: Date | null,
  ): Promise<OutboxMessage | null> {
    const conditions = [eq(outbox.id, id), eq(outbox.status, "publishing")];
    if (claimedAt) conditions.push(eq(outbox.claimedAt, claimedAt));
    const [message] = await this.executor
      .update(outbox)
      .set({
        status: sql`CASE WHEN ${outbox.attempts} >= ${outbox.maxAttempts} THEN 'dead_letter' ELSE 'pending' END`,
        availableAt: sql`${failedAt} + (${Math.max(0, retryDelayMs)} * interval '1 millisecond')`,
        claimedAt: null,
        deadLetteredAt: sql`CASE WHEN ${outbox.attempts} >= ${outbox.maxAttempts} THEN ${failedAt} ELSE NULL END`,
        lastError: error.slice(0, 4_000),
        updatedAt: failedAt,
      })
      .where(and(...conditions))
      .returning();
    return message ? normalizeRow(message) : null;
  }

  async retryDeadLetter(
    id: string,
    availableAt: Date,
    organizationId?: string,
  ): Promise<OutboxMessage | null> {
    const [message] = await this.executor
      .update(outbox)
      .set({
        status: "pending",
        attempts: 0,
        availableAt,
        claimedAt: null,
        deadLetteredAt: null,
        lastError: null,
        updatedAt: availableAt,
      })
      .where(
        and(eq(outbox.id, id), statusFilter("dead_letter", organizationId)),
      )
      .returning();
    return message ? normalizeRow(message) : null;
  }

  async prunePublished(before: Date, limit = 1_000): Promise<number> {
    const candidates = await this.executor
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(eq(outbox.status, "published"), lt(outbox.publishedAt, before)),
      )
      .orderBy(outbox.publishedAt)
      .limit(Math.max(1, Math.min(limit, MAX_BATCH_SIZE)));
    if (candidates.length === 0) return 0;

    const deleted = await this.executor
      .delete(outbox)
      .where(
        inArray(
          outbox.id,
          candidates.map((candidate) => candidate.id),
        ),
      )
      .returning({ id: outbox.id });
    return deleted.length;
  }

  async getOperationalSummary(
    organizationId?: string,
  ): Promise<OutboxOperationalSummary> {
    const rows = await this.executor
      .select({ status: outbox.status, count: sql<number>`count(*)` })
      .from(outbox)
      .where(
        organizationId ? eq(outbox.organizationId, organizationId) : undefined,
      )
      .groupBy(outbox.status);
    const summary: OutboxOperationalSummary = {
      pending: 0,
      publishing: 0,
      published: 0,
      deadLetter: 0,
    };
    for (const row of rows) {
      const count = Number(row.count);
      if (row.status === "dead_letter") summary.deadLetter = count;
      else if (row.status === "pending") summary.pending = count;
      else if (row.status === "publishing") summary.publishing = count;
      else if (row.status === "published") summary.published = count;
    }
    return summary;
  }
}
