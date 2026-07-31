import { getRateLimiterHealth } from "@upstand/api";
import { env } from "@upstand/env/server";
import { pingRedis, redis } from "@upstand/redis";
import {
  getPlatformCapabilities,
  resolveControlPlaneMode,
} from "@upstand/usecases";
import {
  GetSetupStatusUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../types";

export type SystemRouteDependencies = {
  isShuttingDown(): boolean;
  isCaddyReady(): boolean;
};

/** Registers the minimal first-run status endpoint before tenant routes. */
export function registerSetupStatusRoute(app: Hono<AppEnv>): void {
  app.get("/api/setup/status", async (c) => {
    const status = await c
      .get("scope")
      .resolve(GetSetupStatusUseCaseToken)
      .execute();
    const platformMode = resolveControlPlaneMode({
      platform: env.UPSTAND_PLATFORM,
      isCloud: env.IS_CLOUD,
    });
    return c.json({
      ...status,
      isCloud: platformMode === "cloud",
      platformMode,
      capabilities: getPlatformCapabilities(platformMode),
    });
  });
}

/** Registers generated API compatibility routes and process health endpoints. */
export function registerSystemRoutes(
  app: Hono<AppEnv>,
  dependencies: SystemRouteDependencies,
): void {
  app.get("/health/live", (c) => c.json({ status: "alive" }));

  app.get("/health/ready", async (c) => {
    const platformMode = resolveControlPlaneMode({
      platform: env.UPSTAND_PLATFORM,
      isCloud: env.IS_CLOUD,
    });
    const redisReady =
      platformMode === "desktop" ? true : await pingRedis(redis);
    const rateLimiterHealth = getRateLimiterHealth();
    let databaseReady = false;
    try {
      const uow = c.get("scope").resolve(UnitOfWorkToken);
      await uow.resourceRepository.count();
      databaseReady = true;
    } catch (error) {
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "Database readiness check failed",
      });
    }

    const ready =
      !dependencies.isShuttingDown() &&
      (platformMode === "desktop" || dependencies.isCaddyReady()) &&
      (platformMode === "desktop" || redisReady) &&
      databaseReady;
    return c.json(
      {
        status: ready ? "ready" : "not_ready",
        checks: {
          database: databaseReady,
          caddy: dependencies.isCaddyReady(),
          redis: redisReady,
          rateLimiter: rateLimiterHealth,
        },
      },
      ready ? 200 : 503,
    );
  });

  // OAuth 2.0 Authorization Server Metadata (RFC 8414) & OpenID Connect Discovery.
  // MCP 2025-03-26 clients probe these endpoints for authentication discovery.
  // RFC 8414 strictly requires issuer, authorization_endpoint, and token_endpoint.
  const handleAuthMetadata = (c: Context<AppEnv>) => {
    const base = new URL(c.req.url).origin;
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/api/auth/authorize`,
      token_endpoint: `${base}/api/auth/token`,
      registration_endpoint: `${base}/api/auth/register`,
      scopes_supported: ["mcp:read", "mcp:full"],
      response_types_supported: ["code", "token"],
      grant_types_supported: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
      ],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none",
      ],
      revocation_endpoint: `${base}/api/auth/revoke`,
      introspection_endpoint: `${base}/api/auth/introspect`,
      code_challenge_methods_supported: ["S256"],
      service_documentation: `${base}/docs`,
    });
  };

  app.get("/.well-known/oauth-authorization-server", handleAuthMetadata);
  app.get("/.well-known/openid-configuration", handleAuthMetadata);

  app.get("/", (c) => c.text("OK"));
}
