import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CollectLocalContainerMetricsUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Hono } from "hono";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

export const localMonitoringSnapshotPath = "/api/monitoring/local-containers";

export function verifyLocalMonitoringSignature(
  token: string,
  timestamp: string,
  signature: string,
  now = Date.now(),
): boolean {
  if (
    !token ||
    !/^\d{13}$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  if (Math.abs(now - Number(timestamp)) > 60_000) return false;
  const expected = createHmac("sha256", token)
    .update(`GET|${localMonitoringSnapshotPath}|${timestamp}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function registerMonitoringSnapshotRoute(app: Hono<AppEnv>): void {
  app.use(
    localMonitoringSnapshotPath,
    createHttpRateLimitMiddleware({
      path: "monitoring-local-containers",
      profile: "webhooks",
      onRejected: (c, message) => c.json({ error: message }, 429),
    }),
  );
  app.get(localMonitoringSnapshotPath, async (c) => {
    c.header("Cache-Control", "no-store");
    const scope = c.get("scope");
    const settings = await scope
      .resolve(UnitOfWorkToken)
      .monitoringSettingsRepository.findByServerId("local");
    if (
      !settings ||
      !verifyLocalMonitoringSignature(
        settings.token,
        c.req.header("X-Upstand-Metrics-Timestamp") ?? "",
        c.req.header("X-Upstand-Metrics-Signature") ?? "",
      )
    ) {
      return c.json({ error: "Unauthorized monitoring source" }, 401);
    }
    // Only the local agent's key authorizes this fixed read; remote-agent keys,
    // browser sessions and organization credentials never grant host inventory.
    try {
      return c.json(
        await scope.resolve(CollectLocalContainerMetricsUseCaseToken).execute(),
      );
    } catch {
      c.get("log").warn("Local container metrics collection failed");
      return c.json(
        { error: "Container metrics temporarily unavailable" },
        503,
      );
    }
  });
}
