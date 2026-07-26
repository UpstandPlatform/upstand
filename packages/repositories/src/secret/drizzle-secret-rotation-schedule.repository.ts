import { secretRotationSchedule } from "@upstand/db";
import type {
  CreateSecretRotationScheduleDTO,
  ISecretRotationScheduleRepository,
  SecretRotationSchedule,
  SecretScopeType,
} from "@upstand/domain";
import { and, eq, or, sql } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleSecretRotationScheduleRepository
  implements ISecretRotationScheduleRepository
{
  constructor(private readonly executor: Executor) {}

  async findById(id: string): Promise<SecretRotationSchedule | null> {
    const [row] = await this.executor
      .select()
      .from(secretRotationSchedule)
      .where(eq(secretRotationSchedule.id, id))
      .limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByScope(
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<SecretRotationSchedule[]> {
    const rows = await this.executor
      .select()
      .from(secretRotationSchedule)
      .where(
        and(
          eq(secretRotationSchedule.scopeType, scopeType),
          eq(secretRotationSchedule.scopeId, scopeId),
        ),
      );
    return rows.map((row) => this.toDomain(row));
  }

  async findDue(now: Date): Promise<SecretRotationSchedule[]> {
    const rows = await this.executor
      .select()
      .from(secretRotationSchedule)
      .where(
        and(
          eq(secretRotationSchedule.enabled, true),
          or(
            sql`${secretRotationSchedule.lastRotatedAt} IS NULL`,
            sql`${secretRotationSchedule.lastRotatedAt} <= ${new Date(now.getTime() - 60 * 60 * 1000)}`,
          ),
          or(
            sql`${secretRotationSchedule.rotationClaimedUntil} IS NULL`,
            sql`${secretRotationSchedule.rotationClaimedUntil} <= ${now}`,
          ),
        ),
      );
    return rows
      .filter(
        (row) =>
          !row.lastRotatedAt ||
          row.lastRotatedAt.getTime() + row.intervalHours * 3_600_000 <=
            now.getTime(),
      )
      .map((row) => this.toDomain(row));
  }

  async claimDue(
    id: string,
    now: Date,
    claimUntil: Date,
  ): Promise<SecretRotationSchedule | null> {
    const [row] = await this.executor
      .update(secretRotationSchedule)
      .set({ rotationClaimedUntil: claimUntil })
      .where(
        and(
          eq(secretRotationSchedule.id, id),
          eq(secretRotationSchedule.enabled, true),
          or(
            sql`${secretRotationSchedule.lastRotatedAt} IS NULL`,
            sql`${secretRotationSchedule.lastRotatedAt} + make_interval(hours => ${secretRotationSchedule.intervalHours}) <= ${now}`,
          ),
          or(
            sql`${secretRotationSchedule.rotationClaimedUntil} IS NULL`,
            sql`${secretRotationSchedule.rotationClaimedUntil} <= ${now}`,
          ),
        ),
      )
      .returning();
    return row ? this.toDomain(row) : null;
  }

  async create(
    data: CreateSecretRotationScheduleDTO,
  ): Promise<SecretRotationSchedule> {
    const [row] = await this.executor
      .insert(secretRotationSchedule)
      .values({ ...data, keys: JSON.stringify(data.keys) })
      .returning();
    if (!row)
      throw new Error("secret rotation schedule insert returned no row");
    return this.toDomain(row);
  }

  async updateById(
    id: string,
    patch: Partial<
      Omit<
        CreateSecretRotationScheduleDTO,
        "id" | "organizationId" | "scopeType" | "scopeId"
      >
    >,
  ): Promise<SecretRotationSchedule | null> {
    const { keys, ...rest } = patch;
    const [row] = await this.executor
      .update(secretRotationSchedule)
      .set({
        ...rest,
        ...(keys === undefined ? {} : { keys: JSON.stringify(keys) }),
      })
      .where(eq(secretRotationSchedule.id, id))
      .returning();
    return row ? this.toDomain(row) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    return (
      (
        await this.executor
          .delete(secretRotationSchedule)
          .where(eq(secretRotationSchedule.id, id))
          .returning({ id: secretRotationSchedule.id })
      ).length > 0
    );
  }

  private toDomain(
    row: typeof secretRotationSchedule.$inferSelect,
  ): SecretRotationSchedule {
    let keys: string[] = [];
    try {
      const parsed = JSON.parse(row.keys);
      if (Array.isArray(parsed))
        keys = parsed.filter((key): key is string => typeof key === "string");
    } catch {
      /* corrupted schedules are treated as empty and won't rotate anything */
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      scopeType: row.scopeType as SecretScopeType,
      scopeId: row.scopeId,
      keys,
      intervalHours: row.intervalHours,
      valueLength: row.valueLength,
      enabled: row.enabled,
      lastRotatedAt: row.lastRotatedAt,
      rotationClaimedUntil: row.rotationClaimedUntil,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
