import { proxyTakeoverJournal } from "@upstand/db";
import type {
  CreateProxyTakeoverJournalInput,
  ImportedSite,
  IProxyTakeoverJournalRepository,
  ProxyTakeoverJournal,
  ProxyTakeoverStatus,
  UpdateProxyTakeoverJournalInput,
} from "@upstand/domain";
import { desc, eq } from "drizzle-orm";
import type { Executor } from "../shared/types";

function mapRowToEntity(
  row: typeof proxyTakeoverJournal.$inferSelect,
): ProxyTakeoverJournal {
  return {
    id: row.id,
    serverId: row.serverId,
    previousProxy: row.previousProxy as ProxyTakeoverJournal["previousProxy"],
    occupiedPorts: row.occupiedPorts ?? [],
    stopTargets: (row.stopTargets ?? []) as ProxyTakeoverJournal["stopTargets"],
    importedSites: (row.importedSites ?? []) as ImportedSite[],
    status: row.status as ProxyTakeoverStatus,
    error: row.error ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleProxyTakeoverJournalRepository
  implements IProxyTakeoverJournalRepository
{
  constructor(private readonly db: Executor) {}

  async findById(id: string): Promise<ProxyTakeoverJournal | null> {
    const rows = await this.db
      .select()
      .from(proxyTakeoverJournal)
      .where(eq(proxyTakeoverJournal.id, id))
      .limit(1);
    return rows[0] ? mapRowToEntity(rows[0]) : null;
  }

  async findLatestByServerId(
    serverId: string,
  ): Promise<ProxyTakeoverJournal | null> {
    const rows = await this.db
      .select()
      .from(proxyTakeoverJournal)
      .where(eq(proxyTakeoverJournal.serverId, serverId))
      .orderBy(desc(proxyTakeoverJournal.createdAt))
      .limit(1);
    return rows[0] ? mapRowToEntity(rows[0]) : null;
  }

  async findManyByServerId(serverId: string): Promise<ProxyTakeoverJournal[]> {
    const rows = await this.db
      .select()
      .from(proxyTakeoverJournal)
      .where(eq(proxyTakeoverJournal.serverId, serverId))
      .orderBy(desc(proxyTakeoverJournal.createdAt));
    return rows.map(mapRowToEntity);
  }

  async create(
    input: CreateProxyTakeoverJournalInput,
  ): Promise<ProxyTakeoverJournal> {
    const id = `ptj_${crypto.randomUUID()}`;
    const now = new Date();
    const [inserted] = await this.db
      .insert(proxyTakeoverJournal)
      .values({
        id,
        serverId: input.serverId,
        previousProxy: input.previousProxy,
        occupiedPorts: input.occupiedPorts,
        stopTargets: input.stopTargets,
        importedSites: input.importedSites as Record<string, unknown>[],
        status: input.status ?? "planned",
        error: input.error ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert proxy takeover journal record");
    }
    return mapRowToEntity(inserted);
  }

  async update(
    id: string,
    input: UpdateProxyTakeoverJournalInput,
  ): Promise<ProxyTakeoverJournal | null> {
    const updateData: Partial<typeof proxyTakeoverJournal.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.status !== undefined) updateData.status = input.status;
    if (input.error !== undefined) updateData.error = input.error;
    if (input.importedSites !== undefined) {
      updateData.importedSites = input.importedSites as Record<
        string,
        unknown
      >[];
    }

    const [updated] = await this.db
      .update(proxyTakeoverJournal)
      .set(updateData)
      .where(eq(proxyTakeoverJournal.id, id))
      .returning();

    return updated ? mapRowToEntity(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(proxyTakeoverJournal)
      .where(eq(proxyTakeoverJournal.id, id))
      .returning({ id: proxyTakeoverJournal.id });
    return result.length > 0;
  }
}
