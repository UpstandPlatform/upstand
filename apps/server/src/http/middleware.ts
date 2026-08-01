import { env } from "@upstand/env/server";
import type { Hono } from "hono";
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
    const scope = dependencies.getServiceProvider().createScope();
    c.set("scope", scope);
    try {
      await next();
    } finally {
      await scope.dispose();
    }
  });

  app.use("*", async (c, next) => {
    await dependencies.identifyUser(
      c.get("log"),
      c.req.raw.headers,
      c.req.path,
    );
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

  const trustedOrigins = new Set(
    [
      env.CORS_ORIGIN,
      env.BETTER_AUTH_URL,
      ...(process.env.NODE_ENV === "production"
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

  app.use(
    "/*",
    cors({
      origin: (origin, c) => {
        if (!origin) return undefined;
        // Allow any origin for MCP endpoints and discovery metadata so web-based
        // MCP tools, playgrounds, and inspectors can connect seamlessly.
        if (
          c.req.path.startsWith("/api/mcp") ||
          c.req.path.startsWith("/.well-known")
        ) {
          c.header("Access-Control-Allow-Credentials", "false");
          return origin;
        }
        try {
          const originUrl = new URL(origin);
          if (trustedOrigins.has(originUrl.origin)) {
            return originUrl.origin;
          }
          if (
            process.env.NODE_ENV !== "production" &&
            (originUrl.hostname === "localhost" ||
              originUrl.hostname === "127.0.0.1" ||
              originUrl.hostname === "::1" ||
              originUrl.hostname === "[::1]")
          ) {
            return origin;
          }
        } catch {
          // Reject malformed origins
        }

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
      ],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Mcp-Session-Id",
        "Location",
      ],
      credentials: true,
    }),
  );
}
