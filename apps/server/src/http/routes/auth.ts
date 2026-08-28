import { auth, hasCredentialAccount, stepUp } from "@upstand/api/auth";
import {
  normalizeDirectIpAuthRequest,
  normalizeDirectIpAuthResponse,
} from "@upstand/auth";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

/** Registers Better Auth's protocol handler at the server boundary. */
export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/auth/*",
    createHttpRateLimitMiddleware({
      path: "api.auth",
      profile: "default",
      onRejected: (c, message) => c.json({ error: message }, 429),
    }),
  );
  app.use(
    "/api/auth/*",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) =>
        c.json({ error: "Authentication request is too large" }, 413),
    }),
  );

  // Keep the documented API procedure reachable without stealing the rest of
  // Better Auth's /api/auth/* namespace. The wildcard handler below otherwise
  // turns this OpenAPI route into a Better Auth 404.
  app.get("/api/auth/isSession2faVerified", async (c) => {
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!session) return c.json({ message: "Authentication required" }, 401);
    return c.json({
      verified: await stepUp.isStepUpAuthenticationSatisfied(session),
    });
  });
  app.get("/api/auth/security/status", async (c) => {
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    return c.json({
      hasCredentialAccount: await hasCredentialAccount(session.user.id),
    });
  });
  app.post("/api/auth/security/set-password", async (c) => {
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const body = z
      .object({ newPassword: z.string().min(8).max(128) })
      .safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return c.json(
        { error: "Password must be between 8 and 128 characters" },
        400,
      );
    }
    if (await hasCredentialAccount(session.user.id)) {
      return c.json(
        { error: "A password already exists. Use Change Password instead." },
        409,
      );
    }
    try {
      const request = normalizeDirectIpAuthRequest(c.req.raw);
      await auth.api.setPassword({
        body: { newPassword: body.data.newPassword },
        headers: request.headers,
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Unable to set the password" }, 400);
    }
  });
  app.on(["POST", "GET"], "/api/auth/*", async (c) => {
    const request = normalizeDirectIpAuthRequest(c.req.raw);
    return normalizeDirectIpAuthResponse(request, await auth.handler(request));
  });
}
