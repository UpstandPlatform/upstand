import { resourceRuntime } from "@upstand/db";
import type {
  IResourceRuntimeRepository,
  ResourceRuntime,
} from "@upstand/domain";
import { eq } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleResourceRuntimeRepository
  implements IResourceRuntimeRepository
{
  constructor(private readonly executor: Executor) {}

  async findByResourceId(resourceId: string): Promise<ResourceRuntime | null> {
    const [row] = await this.executor
      .select()
      .from(resourceRuntime)
      .where(eq(resourceRuntime.resourceId, resourceId))
      .limit(1);
    if (!row) return null;
    return toResourceRuntime(row);
  }

  async upsert(
    resourceId: string,
    values: Omit<ResourceRuntime, "resourceId">,
  ): Promise<ResourceRuntime> {
    const [row] = await this.executor
      .insert(resourceRuntime)
      .values({
        resourceId,
        version: values.version,
        containers: JSON.stringify(values.containers),
        observedAt: values.observedAt,
        source: values.source,
      })
      .onConflictDoUpdate({
        target: resourceRuntime.resourceId,
        set: {
          version: values.version,
          containers: JSON.stringify(values.containers),
          observedAt: values.observedAt,
          source: values.source,
        },
      })
      .returning();
    if (!row) throw new Error("resource runtime upsert returned no row");
    return toResourceRuntime(row);
  }
}

function toResourceRuntime(
  row: typeof resourceRuntime.$inferSelect,
): ResourceRuntime {
  let containers: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(row.containers);
    if (Array.isArray(parsed)) containers = parsed;
  } catch {
    // Corrupt cache rows are treated as empty; Docker remains authoritative.
  }
  return {
    resourceId: row.resourceId,
    version: row.version,
    containers,
    observedAt: row.observedAt,
    source: row.source,
  };
}
