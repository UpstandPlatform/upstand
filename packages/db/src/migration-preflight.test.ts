import { expect, test } from "bun:test";
import {
  MigrationPreconditionError,
  validateMigrationPreconditions,
} from "./migration-preflight";

test("migration preflight accepts fresh tables and clean data", async () => {
  await validateMigrationPreconditions({
    query: async (query: string) => {
      if (query.includes("to_regclass")) return { rows: [{ relation: null }] };
      return { rows: [] };
    },
  } as never);
});

test("migration preflight reports duplicate data before a unique index fails", async () => {
  await expect(
    validateMigrationPreconditions({
      query: async (query: string) => {
        if (query.includes("to_regclass")) {
          return { rows: [{ relation: "member" }] };
        }
        return { rows: [{ duplicate: 1 }] };
      },
    } as never),
  ).rejects.toBeInstanceOf(MigrationPreconditionError);
});

test("migration preflight reports orphaned backup tenant rows before foreign keys are added", async () => {
  await expect(
    validateMigrationPreconditions({
      query: async (query: string) => {
        if (query.includes("to_regclass")) {
          return { rows: [{ relation: "present" }] };
        }
        if (query.includes("GROUP BY")) return { rows: [] };
        return { rows: [{ orphan: 1 }] };
      },
    } as never),
  ).rejects.toThrow("orphaned rows");
});
