import fs from "node:fs";
import path from "node:path";
import {
  MigrationPreconditionError,
  migrateDatabase,
  pool,
  validateMigrationPreconditions,
} from "@upstand/db";
import { env } from "@upstand/env/server";
import { log } from "evlog";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function errorCause(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return undefined;
  }
  const cause: unknown = error.cause;
  return cause === undefined ? undefined : String(cause);
}

export async function runDatabaseMigrations(options?: {
  attempts?: number;
  delayMs?: number;
  migrationsFolder?: string;
}): Promise<void> {
  const attempts = options?.attempts ?? 30;
  const delayMs = options?.delayMs ?? 2_000;

  let migrationsFolder = options?.migrationsFolder ?? env.DB_MIGRATIONS_PATH;

  if (!migrationsFolder) {
    const rootPath = path.resolve(process.cwd(), "packages/db/src/migrations");
    const appPath = path.resolve(
      process.cwd(),
      "../../packages/db/src/migrations",
    );
    if (fs.existsSync(rootPath)) {
      migrationsFolder = rootPath;
    } else if (fs.existsSync(appPath)) {
      migrationsFolder = appPath;
    } else {
      migrationsFolder = rootPath;
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await validateMigrationPreconditions(pool);
      await migrateDatabase(migrationsFolder);
      log.info({
        message: "Database migrations completed",
        migrationsFolder,
        attempt,
      });
      return;
    } catch (error) {
      if (error instanceof MigrationPreconditionError) throw error;
      lastError = error;
      log.warn({
        message: "Database migration attempt failed",
        attempt,
        attempts,
        err:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                cause: errorCause(error),
              }
            : error,
      });
      if (attempt < attempts) await wait(delayMs);
    }
  }

  throw new Error(`Database migrations failed after ${attempts} attempts`, {
    cause: lastError,
  });
}
