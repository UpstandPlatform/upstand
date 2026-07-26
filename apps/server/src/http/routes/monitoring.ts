import { createHmac, timingSafeEqual } from "node:crypto";
import { redis } from "@upstand/redis";
import {
  PublishNotificationUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Hono } from "hono";
import type { AppEnv } from "../types";

export function registerMonitoringRoutes(app: Hono<AppEnv>): void {
  // Webhook for receiving threshold alerts from Go Monitoring Agent.
  app.post("/api/monitoring/alerts", async (c) => {
    const requestLog = c.get("log");
    const body = (await c.req.json().catch(() => null)) as {
      json?: {
        serverId?: string;
        serverType?: string;
        type?: "CPU" | "Memory";
        value?: number;
        threshold?: number;
        message?: string;
        timestamp?: string;
        nonce?: string;
        signature?: string;
      };
    } | null;

    const alert = body?.json;
    if (
      !alert?.serverId ||
      !alert.nonce ||
      !alert.signature ||
      !alert.timestamp ||
      !alert.type
    ) {
      return c.json(
        { error: "Invalid monitoring alert signature payload" },
        400,
      );
    }

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
    const acceptedNonce = await redis.set(
      `monitoring-alert:${serverId}:${nonce}`,
      "1",
      "EX",
      300,
      "NX",
    );
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
    const acquireCooldown = await redis.set(cooldownKey, "1", "EX", 900, "NX");
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

    await publisher
      .execute({
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
      })
      .catch((err) => {
        requestLog.error(err instanceof Error ? err : String(err), {
          message: "Failed to publish server threshold alert notification",
        });
      });

    return c.json({ status: "acknowledged" });
  });
}
