import { describe, expect, test } from "bun:test";
import { DrizzleAuditLogRepository } from "./drizzle-audit-log.repository";

describe("DrizzleAuditLogRepository retention", () => {
  test("deletes at most one bounded batch of records", async () => {
    let selectedLimit = 0;
    let deleteCalls = 0;

    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async (limit: number) => {
                selectedLimit = limit;
                return [{ id: "old-audit-record" }];
              },
            }),
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: async () => {
            deleteCalls += 1;
            return [{ id: "old-audit-record" }];
          },
        }),
      }),
    } as never;

    const deleted = await new DrizzleAuditLogRepository(
      executor,
    ).deleteOlderThan(new Date(), 10_000);

    expect(selectedLimit).toBe(1_000);
    expect(deleteCalls).toBe(1);
    expect(deleted).toBe(1);
  });

  test("does not issue a delete when no records are past the cutoff", async () => {
    let deleteCalls = 0;
    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: async () => {
            deleteCalls += 1;
            return [];
          },
        }),
      }),
    } as never;

    const deleted = await new DrizzleAuditLogRepository(
      executor,
    ).deleteOlderThan(new Date());

    expect(deleteCalls).toBe(0);
    expect(deleted).toBe(0);
  });
});
