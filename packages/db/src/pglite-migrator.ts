import type { MigrationConfig, MigrationMeta } from "drizzle-orm/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { PgSession } from "drizzle-orm/pg-core/session";
import type { PgliteDatabase } from "drizzle-orm/pglite";

function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "single" | "double" | "dollar" | null = null;
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (quote === "single") {
      if (character === "\\") index += 2;
      else if (character === "'" && next === "'") index += 2;
      else {
        if (character === "'") quote = null;
        index += 1;
      }
      continue;
    }
    if (quote === "double") {
      if (character === '"' && next === '"') index += 2;
      else {
        if (character === '"') quote = null;
        index += 1;
      }
      continue;
    }
    if (quote === "dollar") {
      if (source.startsWith("$$", index)) {
        quote = null;
        index += 2;
      } else index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (character === "'") quote = "single";
    else if (character === '"') quote = "double";
    else if (character === "$" && next === "$") {
      quote = "dollar";
      index += 2;
      continue;
    } else if (character === ";") {
      const statement = source.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }

  const trailing = source.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

/** Split legacy multi-command migrations before Drizzle sends them to PGlite. */
export async function migratePglite<TSchema extends Record<string, unknown>>(
  database: PgliteDatabase<TSchema>,
  config: MigrationConfig,
): Promise<void> {
  const migrations = readMigrationFiles(config).map(
    (migration): MigrationMeta => ({
      ...migration,
      sql: migration.sql.flatMap(splitSqlStatements),
    }),
  );
  const internal = database as unknown as {
    dialect: {
      migrate(
        files: MigrationMeta[],
        session: PgSession,
        migrationConfig: MigrationConfig,
      ): Promise<void>;
    };
    _: { session: PgSession };
  };
  await internal.dialect.migrate(migrations, internal._.session, config);
}
