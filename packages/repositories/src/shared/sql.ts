import { getTableColumns, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export function conflictUpdateAllExcept<TTable extends PgTable>(
  table: TTable,
  except: ReadonlyArray<keyof TTable["$inferInsert"]> = [],
): Record<string, SQL> {
  const columns = getTableColumns(table);
  const excluded = new Set(except as ReadonlyArray<string>);
  const set: Record<string, SQL> = {};

  for (const [property, column] of Object.entries(columns)) {
    if (excluded.has(property)) {
      continue;
    }
    set[property] = sql.raw(`excluded."${column.name}"`);
  }

  return set;
}
