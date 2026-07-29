import { randomUUID } from "node:crypto";
import { auditLog } from "@upstand/db";
import type {
  AuditLogRecord,
  CreateAuditLog,
  IAuditLogRepository,
  ListAuditLogsInput,
} from "@upstand/domain";
import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import type { Executor } from "../shared/types";

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const separator = cursor.indexOf("|");
  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (
    separator <= 0 ||
    Number.isNaN(createdAt.getTime()) ||
    id.length === 0 ||
    id.length > 200
  ) {
    throw new Error("Invalid audit log cursor");
  }
  return { createdAt, id };
}

function encodeCursor(record: { createdAt: Date; id: string }): string {
  return `${record.createdAt.toISOString()}|${record.id}`;
}

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
      conditions.push(sql`
        to_tsvector(
          'simple',
          ${auditLog.actorName} || ' ' ||
          ${auditLog.actorEmail} || ' ' ||
          coalesce(${auditLog.resourceName}, '') || ' ' ||
          ${auditLog.route}
        ) @@ websearch_to_tsquery('simple', ${input.search})
      `);
    }
    if (input.pagination === "cursor" && input.cursor) {
      const cursor = decodeCursor(input.cursor);
      const cursorCondition = or(
        lt(auditLog.createdAt, cursor.createdAt),
        and(
          eq(auditLog.createdAt, cursor.createdAt),
          lt(auditLog.id, cursor.id),
        ),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }
    const where = and(...conditions);
    if (input.pagination === "cursor") {
      const rows = await this.executor
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const last = items.at(-1);
      return {
        items: items as AuditLogRecord[],
        nextCursor: hasMore && last ? encodeCursor(last) : undefined,
      };
    }

    const [items, count] = await Promise.all([
      this.executor
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(input.limit)
        .offset(input.offset ?? 0),
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
