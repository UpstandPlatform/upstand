import { randomUUID } from "node:crypto";
import { auditLog } from "@upstand/db";
import type {
  AuditLogRecord,
  CreateAuditLog,
  IAuditLogRepository,
  ListAuditLogsInput,
} from "@upstand/domain";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly executor: Executor) {}

  async create(input: CreateAuditLog): Promise<void> {
    await this.executor.insert(auditLog).values({
      id: randomUUID(),
      ...input,
    });
  }

  async list(input: ListAuditLogsInput) {
    const conditions = [eq(auditLog.organizationId, input.organizationId)];
    if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
    if (input.action) conditions.push(eq(auditLog.action, input.action));
    if (input.resourceType)
      conditions.push(eq(auditLog.resourceType, input.resourceType));
    if (input.from) conditions.push(gte(auditLog.createdAt, input.from));
    if (input.to) conditions.push(lte(auditLog.createdAt, input.to));
    if (input.search) {
      const pattern = `%${input.search}%`;
      const searchCondition = or(
        ilike(auditLog.actorName, pattern),
        ilike(auditLog.actorEmail, pattern),
        ilike(auditLog.resourceName, pattern),
        ilike(auditLog.route, pattern),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    const where = and(...conditions);
    const [items, count] = await Promise.all([
      this.executor
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      this.executor
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where),
    ]);
    return {
      items: items as AuditLogRecord[],
      total: count[0]?.count ?? 0,
    };
  }
}
