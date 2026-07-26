import { notificationDelivery } from "@upstand/db";
import type {
  CreateNotificationDeliveryDTO,
  INotificationDeliveryRepository,
  ListNotificationDeliveriesInput,
  ListNotificationDeliveriesResult,
  NotificationDelivery,
} from "@upstand/domain";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleNotificationDeliveryRepository
  implements INotificationDeliveryRepository
{
  constructor(private readonly executor: Executor) {}

  async findById(id: string): Promise<NotificationDelivery | null> {
    const [delivery] = await this.executor
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.id, id))
      .limit(1);
    return (delivery as NotificationDelivery | undefined) ?? null;
  }

  async findRecentByOrganizationId(
    organizationId: string,
    limit = 25,
  ): Promise<NotificationDelivery[]> {
    return (await this.executor
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.organizationId, organizationId))
      .orderBy(desc(notificationDelivery.createdAt))
      .limit(limit)) as NotificationDelivery[];
  }

  async findByStatus(
    status: string,
    limit = 500,
  ): Promise<NotificationDelivery[]> {
    return (await this.executor
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.status, status))
      .orderBy(desc(notificationDelivery.createdAt))
      .limit(Math.max(1, Math.min(limit, 1_000)))) as NotificationDelivery[];
  }

  async list(
    input: ListNotificationDeliveriesInput,
  ): Promise<ListNotificationDeliveriesResult> {
    const timespan = input.timespan || "30d";
    const millisInTimespan =
      timespan === "24h"
        ? 24 * 60 * 60 * 1000
        : timespan === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - millisInTimespan);

    const conditions = [
      eq(notificationDelivery.organizationId, input.organizationId),
      gte(notificationDelivery.createdAt, cutoffDate),
    ];

    if (input.channelId) {
      conditions.push(eq(notificationDelivery.channelId, input.channelId));
    }
    if (input.status) {
      conditions.push(eq(notificationDelivery.status, input.status));
    }
    if (input.search) {
      const pattern = `%${input.search}%`;
      const searchCondition = or(
        like(notificationDelivery.title, pattern),
        like(notificationDelivery.message, pattern),
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const whereClause = and(...conditions);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const [items, countResult] = await Promise.all([
      this.executor
        .select()
        .from(notificationDelivery)
        .where(whereClause)
        .orderBy(desc(notificationDelivery.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.executor
        .select({ total: sql<number>`count(*)` })
        .from(notificationDelivery)
        .where(whereClause),
    ]);

    const total = countResult[0]?.total ?? 0;

    return {
      items: items as NotificationDelivery[],
      total: Number(total || 0),
    };
  }

  async create(
    data: CreateNotificationDeliveryDTO,
  ): Promise<NotificationDelivery> {
    const [delivery] = await this.executor
      .insert(notificationDelivery)
      .values(data)
      .returning();
    if (!delivery)
      throw new Error("create: insert returned no notification delivery");
    return delivery as NotificationDelivery;
  }

  async createMany(
    data: CreateNotificationDeliveryDTO[],
  ): Promise<NotificationDelivery[]> {
    if (data.length === 0) return [];
    return (await this.executor
      .insert(notificationDelivery)
      .values(data)
      .onConflictDoNothing({ target: notificationDelivery.idempotencyKey })
      .returning()) as NotificationDelivery[];
  }

  async claimForDelivery(
    id: string,
    now: Date,
    leaseMs: number,
  ): Promise<NotificationDelivery | null> {
    const staleBefore = new Date(now.getTime() - leaseMs);
    const [delivery] = await this.executor
      .update(notificationDelivery)
      .set({
        status: "processing",
        attempts: sql`${notificationDelivery.attempts} + 1`,
        processingStartedAt: now,
        lastAttemptAt: now,
        nextAttemptAt: null,
        error: null,
      })
      .where(
        and(
          eq(notificationDelivery.id, id),
          or(
            eq(notificationDelivery.status, "queued"),
            eq(notificationDelivery.status, "failed"),
            and(
              eq(notificationDelivery.status, "processing"),
              or(
                isNull(notificationDelivery.processingStartedAt),
                lt(notificationDelivery.processingStartedAt, staleBefore),
              ),
            ),
          ),
        ),
      )
      .returning();
    return (delivery as NotificationDelivery | undefined) ?? null;
  }

  async updateById(
    id: string,
    patch: Partial<CreateNotificationDeliveryDTO>,
  ): Promise<NotificationDelivery | null> {
    const [delivery] = await this.executor
      .update(notificationDelivery)
      .set(patch)
      .where(eq(notificationDelivery.id, id))
      .returning();
    return (delivery as NotificationDelivery | undefined) ?? null;
  }

  async updateClaimed(
    id: string,
    processingStartedAt: Date,
    patch: Partial<CreateNotificationDeliveryDTO>,
  ): Promise<NotificationDelivery | null> {
    const [delivery] = await this.executor
      .update(notificationDelivery)
      .set(patch)
      .where(
        and(
          eq(notificationDelivery.id, id),
          eq(notificationDelivery.status, "processing"),
          eq(notificationDelivery.processingStartedAt, processingStartedAt),
        ),
      )
      .returning();
    return (delivery as NotificationDelivery | undefined) ?? null;
  }

  async requeueIfRetryable(
    id: string,
    expectedUpdatedAt: Date,
  ): Promise<NotificationDelivery | null> {
    const [delivery] = await this.executor
      .update(notificationDelivery)
      .set({
        status: "queued",
        attempts: 0,
        error: null,
        deliveredAt: null,
        processingStartedAt: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(notificationDelivery.id, id),
          eq(notificationDelivery.updatedAt, expectedUpdatedAt),
          inArray(notificationDelivery.status, ["failed", "dead_letter"]),
        ),
      )
      .returning();
    return (delivery as NotificationDelivery | undefined) ?? null;
  }
}
