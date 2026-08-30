import { expect, test } from "bun:test";
import {
  buildRedisOptions,
  closeRedis,
  getRedisWithTimeout,
  pingRedis,
} from "./index";
import { withRedisLock, withRedisTimeout } from "./utils";

test("pingRedis fails fast when Redis does not answer", async () => {
  const result = await pingRedis(
    { ping: () => new Promise<string>(() => undefined) } as never,
    10,
  );

  expect(result).toBe(false);
});

test("getRedisWithTimeout fails fast when Redis GET does not answer", async () => {
  await expect(
    getRedisWithTimeout(
      { get: () => new Promise<string>(() => undefined) },
      "migration-key",
      10,
    ),
  ).rejects.toThrow("Redis GET timed out");
});

test("rediss connections verify server certificates by default", () => {
  expect(
    buildRedisOptions("rediss://redis.example.com:6380").tls,
  ).toMatchObject({ rejectUnauthorized: true });
  expect(
    buildRedisOptions("rediss://redis.example.com:6380", {
      redisOptions: { tls: { ca: "operator-provided-ca" } },
    }).tls,
  ).toMatchObject({ ca: "operator-provided-ca" });
  expect(buildRedisOptions("redis://localhost:6379").tls).toBeUndefined();
});

test("request Redis clients fail individual commands instead of queueing forever", () => {
  expect(buildRedisOptions("redis://localhost:6379").maxRetriesPerRequest).toBe(
    1,
  );
  expect(
    buildRedisOptions("redis://localhost:6379", {
      maxRetriesPerRequest: null,
    }).maxRetriesPerRequest,
  ).toBeNull();
});

test("pingRedis does not enqueue commands while the client is reconnecting", async () => {
  let pingCalls = 0;
  const result = await pingRedis({
    status: "reconnecting",
    ping: async () => {
      pingCalls += 1;
      return "PONG";
    },
  } as never);

  expect(result).toBe(false);
  expect(pingCalls).toBe(0);
});

test("pingRedis reconnects a ready client after a failed ping", async () => {
  let disconnectArgument: boolean | undefined;
  const result = await pingRedis(
    {
      status: "ready",
      ping: () => new Promise<string>(() => undefined),
      disconnect: (reconnect: boolean) => {
        disconnectArgument = reconnect;
      },
    } as never,
    10,
  );

  expect(result).toBe(false);
  expect(disconnectArgument).toBe(true);
});

test("closeRedis forces a disconnected client closed after the deadline", async () => {
  let disconnected = false;
  await closeRedis(
    {
      quit: () => new Promise<never>(() => undefined),
      disconnect: () => {
        disconnected = true;
      },
    } as never,
    10,
  );

  expect(disconnected).toBe(true);
});

test("withRedisLock renews and releases ownership atomically", async () => {
  const evalCalls: unknown[][] = [];
  const client = {
    set: async () => "OK",
    eval: async (...args: unknown[]) => {
      evalCalls.push(args);
      return 1;
    },
  } as never;

  const result = await withRedisLock({
    redis: client,
    key: "scheduler:test",
    ttlMs: 1_000,
    work: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return "completed";
    },
  });

  expect(result).toBe("completed");
  expect(evalCalls.length).toBeGreaterThanOrEqual(2);
  expect(evalCalls.every((call) => call[1] === 1)).toBe(true);
  expect(evalCalls.every((call) => call[2] === "scheduler:test")).toBe(true);
});

test("withRedisLock rejects unsafe TTL values", async () => {
  await expect(
    withRedisLock({
      redis: {} as never,
      key: "scheduler:test",
      ttlMs: 999,
      work: async () => undefined,
    }),
  ).rejects.toThrow("at least one second");
});

test("withRedisLock bounds a Redis command that never completes", async () => {
  await expect(
    withRedisLock({
      redis: {
        set: () => new Promise<"OK">(() => undefined),
      } as never,
      key: "scheduler:test",
      ttlMs: 1_000,
      operationTimeoutMs: 10,
      work: async () => undefined,
    }),
  ).rejects.toThrow("timed out");
});

test("withRedisLock does not hide renewal loss", async () => {
  await expect(
    withRedisLock({
      redis: {
        set: async () => "OK",
        eval: async () => 0,
      } as never,
      key: "scheduler:test",
      ttlMs: 1_000,
      operationTimeoutMs: 10,
      work: async () => {
        await Bun.sleep(1_100);
      },
    }),
  ).rejects.toThrow("Redis lock is no longer owned");
});

test("withRedisTimeout bounds a Redis operation that never completes", async () => {
  await expect(
    withRedisTimeout(new Promise<never>(() => undefined), 5),
  ).rejects.toThrow("Redis operation timed out after 5ms");
});
