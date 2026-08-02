import { createHmac, timingSafeEqual } from "node:crypto";
import { redis, withRedisTimeout } from "@upstand/redis";
import {
  PublishNotificationUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

export const monitoringAlertSchema = z.object({
  json: z.object({
    serverId: z.string().trim().min(1).max(128),
    serverType: z.string().trim().max(64).optional(),
    type: z.enum(["CPU", "Memory"]),
    value: z.number().finite().min(0).max(100),
    threshold: z.number().finite().min(0).max(100),
    message: z.string().max(1_024).optional(),
    timestamp: z.string().datetime({ offset: true }),
    nonce: z.string().min(1).max(128),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
});

export function registerMonitoringRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/monitoring/alerts",
    createHttpRateLimitMiddleware({
      path: "monitoring-alerts",
      profile: "webhooks",
      onRejected: (c, message) => c.json({ error: message }, 429),
    }),
  );
  app.use(
    "/api/monitoring/alerts",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: "Monitoring alert is too large" }, 413),
    }),
  );

  // Webhook for receiving threshold alerts from Go Monitoring Agent.
  app.post("/api/monitoring/alerts", async (c) => {
    const requestLog = c.get("log");
    const parsed = monitoringAlertSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "Invalid monitoring alert signature payload" },
        400,
      );
    }

    const { json: alert } = parsed.data;
    const {
      serverId,
      serverType,
      type,
      value,
      threshold,
      message,
      timestamp,
      nonce,
      signature,
    } = alert;

    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);

    const settings =
      await uow.monitoringSettingsRepository.findByServerId(serverId);

    if (!settings) {
      return c.json(
        { error: "Unauthorized: Invalid monitoring alert source" },
        401,
      );
    }

    const alertTime = Date.parse(timestamp);
    if (
      !Number.isFinite(alertTime) ||
      Math.abs(Date.now() - alertTime) > 5 * 60_000
    ) {
      return c.json({ error: "Monitoring alert signature expired" }, 401);
    }
    const canonical = [
      serverId,
      serverType ?? "",
      type,
      String(value ?? ""),
      String(threshold ?? ""),
      message ?? "",
      timestamp,
      nonce,
    ].join("|");
    const expectedSignature = createHmac("sha256", settings.token)
      .update(canonical)
      .digest("hex");
    const receivedSignature = Buffer.from(signature, "utf8");
    const expectedSignatureBytes = Buffer.from(expectedSignature, "utf8");
    if (
      receivedSignature.length !== expectedSignatureBytes.length ||
      !timingSafeEqual(receivedSignature, expectedSignatureBytes)
    ) {
      return c.json(
        { error: "Unauthorized: Invalid monitoring alert signature" },
        401,
      );
    }
    const nonceKey = `monitoring-alert:${serverId}:${nonce}`;
    let acceptedNonce: string | null;
    try {
      acceptedNonce = await withRedisTimeout(
        redis.set(nonceKey, "1", "EX", 300, "NX"),
      );
    } catch (error) {
      requestLog.error(error instanceof Error ? error : String(error), {
        message: "Unable to claim monitoring alert nonce",
        serverId,
      });
      return c.json(
        { error: "Monitoring alert intake is temporarily unavailable" },
        503,
      );
    }
    if (acceptedNonce !== "OK") {
      return c.json(
        { error: "Monitoring alert has already been received" },
        401,
      );
    }

    const serverRecord =
      settings.serverId === "local"
        ? null
        : await uow.serverRepository.findById(settings.serverId);
    if (settings.serverId !== "local" && !serverRecord) {
      return c.json({ error: "Associated server not found" }, 404);
    }

    const serverName = serverRecord?.name ?? "Local control plane";

    requestLog.warn(`Server alert received: ${type} usage exceeded threshold`, {
      serverId: settings.serverId,
      type,
      value,
      threshold,
    });

    // Cooldown protection: suppress duplicate notification dispatches for 15 minutes per (serverId, type)
    const cooldownKey = `monitoring-alert-cooldown:${serverId}:${type}`;
    let acquireCooldown: string | null;
    try {
      acquireCooldown = await withRedisTimeout(
        redis.set(cooldownKey, "1", "EX", 900, "NX"),
      );
    } catch (error) {
      await withRedisTimeout(redis.del(nonceKey)).catch(() => undefined);
      requestLog.error(error instanceof Error ? error : String(error), {
        message: "Unable to claim monitoring alert cooldown",
        serverId,
        type,
      });
      return c.json(
        { error: "Monitoring alert intake is temporarily unavailable" },
        503,
      );
    }
    if (acquireCooldown !== "OK") {
      requestLog.info(
        "Server threshold alert notification suppressed due to 15-minute cooldown",
        {
          serverId: settings.serverId,
          type,
        },
      );
      return c.json({ status: "acknowledged", throttled: true });
    }

    const publisher = scope.resolve(PublishNotificationUseCaseToken);

    try {
      await publisher.execute({
        event: "server_threshold_alert",
        ...(serverRecord?.organizationId
          ? { organizationId: serverRecord.organizationId }
          : {}),
        idempotencyKey: `alert:${settings.serverId}:${type}:${new Date().toISOString().slice(0, 13)}`,
        title: `🚨 Server Alert: ${serverName} (${type.toUpperCase()})`,
        message:
          message ||
          `Server '${serverName}' resource usage for ${type} has reached ${value}%, exceeding the configured alert threshold of ${threshold}%.`,
        metadata: {
          event: "server_threshold_alert",
          serverId: settings.serverId,
          serverName,
          alertType: type,
          value,
          threshold,
        },
      });
    } catch (error) {
      await Promise.all([
        redis.del(nonceKey).catch(() => undefined),
        redis.del(cooldownKey).catch(() => undefined),
      ]);
      requestLog.error(error instanceof Error ? error : String(error), {
        message: "Failed to publish server threshold alert notification",
        serverId,
        type,
      });
      return c.json(
        { error: "Monitoring alert delivery is temporarily unavailable" },
        503,
      );
    }

    return c.json({ status: "acknowledged" });
  });
}
