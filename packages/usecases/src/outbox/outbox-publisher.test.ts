import { expect, test } from "bun:test";
import type { OutboxMessage } from "@upstand/domain";
import { type OutboxJobPublisher, OutboxPublisher } from "./outbox-publisher";

function message(overrides: Partial<OutboxMessage> = {}): OutboxMessage {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "outbox-1",
    type: "backup.run",
    payload: { runId: "run-1" },
    aggregateType: "backup_run",
    aggregateId: "run-1",
    organizationId: "org-1",
    idempotencyKey: "backup-run:run-1",
    status: "publishing",
    attempts: 1,
    maxAttempts: 3,
    availableAt: now,
    claimedAt: now,
    publishedAt: null,
    deadLetteredAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function repository(messages: OutboxMessage[]) {
  const state = { messages };
  return {
    state,
    claimBatch: async () => state.messages,
    markPublished: async (id: string) => {
      const item = state.messages.find((candidate) => candidate.id === id);
      if (!item) return false;
      item.status = "published";
      return true;
    },
    markFailed: async (
      id: string,
      _at: Date,
      error: string,
      _retryDelayMs: number,
    ) => {
      const item = state.messages.find((candidate) => candidate.id === id);
      if (!item) return null;
      item.lastError = error;
      item.status =
        item.attempts >= item.maxAttempts ? "dead_letter" : "pending";
      return item;
    },
  };
}

test("publishes with the outbox id and acknowledges only after publish", async () => {
  const published: string[] = [];
  const jobPublisher: OutboxJobPublisher = {
    publish: async (item) => {
      published.push(item.id);
    },
  };
  const outbox = repository([message()]);
  const publisher = new OutboxPublisher(
    { outboxRepository: outbox } as never,
    jobPublisher,
  );

  await expect(publisher.publishBatch()).resolves.toMatchObject({
    claimed: 1,
    published: 1,
  });
  expect(published).toEqual(["outbox-1"]);
  expect(outbox.state.messages[0]?.status).toBe("published");
});

test("keeps failed publication pending and dead-letters after max attempts", async () => {
  const jobPublisher: OutboxJobPublisher = {
    publish: async () => {
      throw new Error("Redis unavailable");
    },
  };
  const outbox = repository([
    message({ id: "retry", attempts: 1, maxAttempts: 3 }),
    message({ id: "dead", attempts: 3, maxAttempts: 3 }),
  ]);
  const publisher = new OutboxPublisher(
    { outboxRepository: outbox } as never,
    jobPublisher,
  );

  await expect(publisher.publishBatch()).resolves.toMatchObject({
    claimed: 2,
    retried: 1,
    deadLettered: 1,
  });
  expect(outbox.state.messages.map((item) => item.status)).toEqual([
    "pending",
    "dead_letter",
  ]);
  expect(outbox.state.messages[0]?.lastError).toBe("Redis unavailable");
});

test("re-publishing an unacknowledged message uses the same stable id", async () => {
  const published: string[] = [];
  const jobPublisher: OutboxJobPublisher = {
    publish: async (item) => {
      published.push(item.id);
    },
  };
  const outbox = repository([message({ status: "publishing" })]);
  const publisher = new OutboxPublisher(
    { outboxRepository: outbox } as never,
    jobPublisher,
  );

  await publisher.publishBatch();
  const retrying = outbox.state.messages[0];
  if (!retrying) throw new Error("Expected an outbox message");
  retrying.status = "publishing";
  await publisher.publishBatch();

  expect(published).toEqual(["outbox-1", "outbox-1"]);
});
