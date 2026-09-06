import { describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { redis } from "@upstand/redis";
import { CollectLocalContainerMetricsUseCase } from "@upstand/usecases";
import {
  CollectLocalContainerMetricsUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import {
  localMonitoringSnapshotPath,
  registerMonitoringSnapshotRoute,
  verifyLocalMonitoringSignature,
} from "./monitoring-snapshot";

describe("local monitoring snapshot authentication", () => {
  const now = 1_800_000_000_000;
  const timestamp = String(now);
  const sign = (token: string, path = localMonitoringSnapshotPath) =>
    createHmac("sha256", token)
      .update(`GET|${path}|${timestamp}`)
      .digest("hex");
  test("accepts only the local agent key for the fixed endpoint", () => {
    expect(
      verifyLocalMonitoringSignature(
        "local-key",
        timestamp,
        sign("local-key"),
        now,
      ),
    ).toBe(true);
    expect(
      verifyLocalMonitoringSignature(
        "local-key",
        timestamp,
        sign("remote-key"),
        now,
      ),
    ).toBe(false);
    expect(
      verifyLocalMonitoringSignature(
        "local-key",
        timestamp,
        sign("local-key", "/api/monitoring/alerts"),
        now,
      ),
    ).toBe(false);
  });
  test("rejects expired, future, malformed and missing signatures", () => {
    for (const current of [now + 60_001, now - 60_001]) {
      expect(
        verifyLocalMonitoringSignature(
          "local-key",
          timestamp,
          sign("local-key"),
          current,
        ),
      ).toBe(false);
    }
    for (const signature of ["", "a", "g".repeat(64), "雪".repeat(64)]) {
      expect(
        verifyLocalMonitoringSignature("local-key", timestamp, signature, now),
      ).toBe(false);
    }
    expect(verifyLocalMonitoringSignature("", timestamp, sign(""), now)).toBe(
      false,
    );
    expect(
      verifyLocalMonitoringSignature(
        "local-key",
        "NaN",
        sign("local-key"),
        now,
      ),
    ).toBe(false);
  });
});

test("registered snapshot route denies foreign keys and reports collection failures without exposing inventory", async () => {
  const limiter = spyOn(redis, "eval").mockResolvedValue(1);
  let reads = 0;
  let failed = false;
  const useCase = new CollectLocalContainerMetricsUseCase({
    async listContainers() {
      reads++;
      if (failed) throw new Error("private daemon detail");
      return [];
    },
    async getContainerStats() {
      throw new Error("no containers");
    },
  });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("scope", {
      resolve(token: unknown) {
        if (token === UnitOfWorkToken)
          return {
            monitoringSettingsRepository: {
              async findByServerId(id: string) {
                expect(id).toBe("local");
                return { token: "local-key" };
              },
            },
          };
        if (token === CollectLocalContainerMetricsUseCaseToken) return useCase;
        throw new Error("unexpected dependency");
      },
    } as unknown as AppEnv["Variables"]["scope"]);
    c.set("log", { warn() {} } as unknown as AppEnv["Variables"]["log"]);
    await next();
  });
  registerMonitoringSnapshotRoute(app);
  const request = (token: string) => {
    const timestamp = String(Date.now());
    return app.request(
      localMonitoringSnapshotPath,
      {
        headers: {
          "X-Upstand-Metrics-Timestamp": timestamp,
          "X-Upstand-Metrics-Signature": createHmac("sha256", token)
            .update(`GET|${localMonitoringSnapshotPath}|${timestamp}`)
            .digest("hex"),
        },
      },
      {},
    );
  };
  try {
    expect(
      (await app.request(localMonitoringSnapshotPath, {}, {})).status,
    ).toBe(401);
    expect((await request("remote-key")).status).toBe(401);
    expect(reads).toBe(0);
    failed = true;
    const failure = await request("local-key");
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("private daemon detail");
    failed = false;
    const success = await request("local-key");
    expect(success.status).toBe(200);
    expect(success.headers.get("Cache-Control")).toBe("no-store");
    expect(await success.json()).toMatchObject({ containers: [] });
    expect(reads).toBe(2);
  } finally {
    limiter.mockRestore();
  }
});
