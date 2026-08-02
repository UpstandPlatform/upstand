import { describe, expect, test } from "bun:test";
import type { TableWithId } from "./base.repository";
import { BaseRepository } from "./base.repository";

type TestRow = { id: string };

class TestRepository extends BaseRepository<TableWithId, TestRow, TestRow> {
  constructor(executor: never) {
    super(executor, {} as TableWithId);
  }
}

function createExecutor(rows: TestRow[], onLimit: (limit: number) => void) {
  const query = {
    limit(limit: number) {
      onLimit(limit);
      return query;
    },
    offset() {
      return query;
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake Drizzle query must be awaitable.
    then(
      onFulfilled: (value: TestRow[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };

  return {
    select: () => ({
      from: () => ({
        $dynamic: () => query,
      }),
    }),
  } as never;
}

describe("BaseRepository read limits", () => {
  test("fails closed instead of materializing an unbounded default read", async () => {
    let selectedLimit = 0;
    const rows = Array.from({ length: 10_001 }, (_, index) => ({
      id: `row-${index}`,
    }));

    await expect(
      new TestRepository(
        createExecutor(rows, (limit) => (selectedLimit = limit)),
      ).findMany(),
    ).rejects.toThrow("maximum supported row count");
    expect(selectedLimit).toBe(10_001);
  });

  test("preserves bounded callers without adding an unnecessary sentinel row", async () => {
    let selectedLimit = 0;
    const rows = [{ id: "row-1" }];

    await expect(
      new TestRepository(
        createExecutor(rows, (limit) => (selectedLimit = limit)),
      ).findMany({ limit: 50 }),
    ).resolves.toEqual(rows);
    expect(selectedLimit).toBe(50);
  });
});
