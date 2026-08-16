import { env } from "@upstand/env/server";
import { resolveCorrelationId } from "@upstand/platform";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { ServiceProvider } from "../di";
import type { AppEnv } from "./types";

type IdentifyUser = (
  logger: AppEnv["Variables"]["log"],
  headers: Headers,
  path?: string,
) => Promise<boolean>;

export type HttpMiddlewareDependencies = {
  getServiceProvider(): ServiceProvider;
  identifyUser: IdentifyUser;
};

export const MAX_HTTP_REQUEST_BYTES = 16 * 1024 * 1024;
const PUBLIC_SYSTEM_PATHS = new Set([
  "/health/live",
  "/health/ready",
  "/api/setup/status",
]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function registerHttpMiddleware(
  app: Hono<AppEnv>,
  dependencies: HttpMiddlewareDependencies,
): void {
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );

  app.use("*", async (c, next) => {
    const correlationId = resolveCorrelationId(c.req.header("x-request-id"));
    c.set("correlationId", correlationId);
    c.get("log").set({ requestId: correlationId, correlationId });
    await next();
    c.header("X-Request-ID", correlationId);
  });

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );

  // Keep JSON, auth, terminal, and streaming transports from buffering an
  // unbounded request before their route-specific validation runs. Smaller
  // endpoints (webhooks and AI/MCP) install stricter limits in their routers.
  const defaultBodyLimit = bodyLimit({
    maxSize: MAX_HTTP_REQUEST_BYTES,
    onError: (c) => c.json({ error: "Request body is too large" }, 413),
  });
  app.use("*", (c, next) =>
    c.req.path === "/api/control-plane-transfer/import"
      ? next()
      : defaultBodyLimit(c, next),
  );

  app.use("*", async (c, next) => {
    const scope = dependencies.getServiceProvider().createScope();
    c.set("scope", scope);
    try {
      await next();
    } finally {
      await scope.dispose();
    }
  });

  app.use("*", async (c, next) => {
    if (!PUBLIC_SYSTEM_PATHS.has(c.req.path)) {
      await dependencies.identifyUser(
        c.get("log"),
        c.req.raw.headers,
        c.req.path,
      );
    }
    await next();
  });

  const trustedOrigins = new Set(
    [
      env.CORS_ORIGIN,
      env.BETTER_AUTH_URL,
      ...(env.NODE_ENV === "production"
        ? []
        : ["http://localhost:3001", "http://127.0.0.1:3001"]),
    ]
      .filter((origin): origin is string => Boolean(origin))
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return origin;
        }
      }),
  );

  const isTrustedOrigin = (origin: string): boolean => {
    try {
      const parsed = new URL(origin);
      if (trustedOrigins.has(parsed.origin)) return true;
      return (
        env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
      );
    } catch {
      return false;
    }
  };

  // SameSite cookies are still sent between sibling subdomains. Rejecting an
  // untrusted Origin on state-changing requests closes that CSRF path while
  // keeping header-authenticated MCP and non-browser clients available.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin")?.trim();
    if (
      origin &&
      STATE_CHANGING_METHODS.has(c.req.method.toUpperCase()) &&
      !c.req.path.startsWith("/api/mcp") &&
      !isTrustedOrigin(origin)
    ) {
      return c.json({ error: "Request origin is not allowed" }, 403);
    }
    await next();
  });

  // HSTS — instruct browsers and compliant clients to always use HTTPS.
  // Only applied when the server is behind TLS (i.e. not on plain HTTP localhost).
  app.use("*", async (c, next) => {
    await next();
    const proto =
      c.req.header("x-forwarded-proto") || new URL(c.req.url).protocol;
    if (proto === "https:" || proto === "https") {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  });

  // MCP authentication is header-based API-key authentication. Keep its
  // intentionally broad origin policy credentialless so arbitrary web pages
  // cannot combine it with browser cookies, including on CORS preflight.
  app.use("/api/mcp*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Credentials", "false");
  });

  app.use(
    "/*",
    cors({
      origin: (origin, c) => {
        if (!origin) return undefined;
        // MCP clients may be hosted on arbitrary origins, but discovery
        // metadata is served under the normal trusted-origin policy.
        if (c.req.path.startsWith("/api/mcp")) {
          c.header("Access-Control-Allow-Credentials", "false");
          return origin;
        }
        if (isTrustedOrigin(origin)) return new URL(origin).origin;

        return env.CORS_ORIGIN || "http://localhost:3001";
      },
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "Mcp-Session-Id",
        "mcp-session-id",
        "Last-Event-ID",
        "X-Request-ID",
      ],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Mcp-Session-Id",
        "Location",
        "X-Request-ID",
      ],
      credentials: true,
    }),
  );
}
