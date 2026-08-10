import { describe, expect, test } from "bun:test";
import type { NotificationConfiguration } from "@upstand/domain";
import { NotificationTransportRegistry } from "./notification-transport";

type JsonObject = Record<string, unknown>;
const resolvePublicHost = async () => [{ address: "8.8.8.8" }];

function createRegistry(
  allowlistedHosts: readonly string[] = [],
): NotificationTransportRegistry {
  return new NotificationTransportRegistry(allowlistedHosts, resolvePublicHost);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(body: unknown): JsonObject {
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  const parsed: unknown = JSON.parse(body);
  if (!isJsonObject(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}

function createFetchMock(
  responseBody: string,
  status: number,
  statusText: string,
  capture: (body: JsonObject) => void,
): typeof fetch {
  return Object.assign(
    async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capture(parseJsonObject(init?.body));
      return new Response(responseBody, { status, statusText });
    },
    { preconnect: (_url: string | URL | Request): void => undefined },
  );
}

describe("NotificationTransportRegistry", () => {
  const originalFetch = globalThis.fetch;

  test("formats Slack message with header, sections, and actions", async () => {
    let capturedBody: JsonObject | null = null;
    globalThis.fetch = createFetchMock("ok", 200, "OK", (body) => {
      capturedBody = body;
    });

    try {
      const registry = createRegistry();
      const config: NotificationConfiguration = {
        type: "slack",
        webhookUrl: "https://hooks.slack.com/services/XXX/YYY/ZZZ",
        channel: "#deploys",
      };

      await registry.send(config, {
        title: "Deployment Succeeded",
        message: "Deployment for web API completed.",
        metadata: {
          event: "deployment_succeeded",
          resourceName: "web-api",
          projectName: "Production",
          environmentName: "Main",
          commitSha: "a1b2c3d4e5f",
          deploymentId: "dep-12345",
          dashboardUrl: "https://app.upstand.dev",
        },
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody).toMatchObject({
        text: expect.stringContaining("🚀 Deployment Succeeded"),
        channel: "#deploys",
      });
      expect(capturedBody).toMatchObject({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining("🚀 Deployment Succeeded"),
            }),
          }),
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining("📦 Resource: web-api"),
            }),
          }),
          expect.objectContaining({ type: "actions" }),
        ]),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("formats Telegram HTML message with inline markup", async () => {
    let capturedBody: JsonObject | null = null;
    globalThis.fetch = createFetchMock('{"ok":true}', 200, "OK", (body) => {
      capturedBody = body;
    });

    try {
      const registry = createRegistry();
      const config: NotificationConfiguration = {
        type: "telegram",
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        chatId: "-100123456789",
      };

      await registry.send(config, {
        title: "Server Threshold Alert",
        message: "High CPU usage detected.",
        metadata: {
          event: "server_threshold_alert",
          serverName: "node-master-01",
          alertType: "cpu",
          value: 92,
          threshold: 85,
        },
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody).toMatchObject({
        chat_id: "-100123456789",
        parse_mode: "HTML",
        text: expect.stringContaining("🚨 Server Threshold Alert"),
      });
      expect(capturedBody).toMatchObject({
        disable_web_page_preview: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("formats Discord Embed with custom color bar", async () => {
    let capturedBody: JsonObject | null = null;
    globalThis.fetch = createFetchMock("{}", 204, "No Content", (body) => {
      capturedBody = body;
    });

    try {
      const registry = createRegistry();
      const config: NotificationConfiguration = {
        type: "discord",
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      };

      await registry.send(config, {
        title: "Database Backup Completed",
        message: "PostgreSQL database backup run finished.",
        metadata: {
          event: "database_backup_completed",
          resourceName: "postgres-main",
          fileKey: "backups/2026-07-24/db.tar.gz",
        },
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody).toMatchObject({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining("💾 Database Backup Completed"),
            color: 0x22c55e,
            fields: expect.any(Array),
          }),
        ]),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("formats Custom Webhook with rich payload", async () => {
    let capturedBody: JsonObject | null = null;
    globalThis.fetch = createFetchMock("{}", 200, "OK", (body) => {
      capturedBody = body;
    });

    try {
      const registry = createRegistry(["example.com"]);
      const config: NotificationConfiguration = {
        type: "custom",
        endpoint: "https://example.com/webhooks/upstand",
        headers: { "X-Custom-Auth": "secret-token" },
      };

      await registry.send(config, {
        title: "Docker Cleanup Completed",
        message: "Cleaned up 12 dangling images.",
        metadata: {
          event: "docker_cleanup_completed",
          scope: "local",
        },
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody).toMatchObject({
        event: "docker_cleanup_completed",
        emoji: "🧹",
        formattedText: expect.stringContaining(
          "Cleaned up 12 dangling images.",
        ),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not follow notification webhook redirects", async () => {
    let redirect: RequestInit["redirect"] | undefined;
    globalThis.fetch = Object.assign(
      async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        redirect = init?.redirect;
        return new Response("ok", { status: 200 });
      },
      { preconnect: (_url: string | URL | Request): void => undefined },
    );

    try {
      const registry = createRegistry();
      await registry.send(
        {
          type: "slack",
          webhookUrl: "https://hooks.slack.com/services/XXX/YYY/ZZZ",
        },
        { title: "Deployment", message: "Completed" },
      );

      expect(redirect).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
