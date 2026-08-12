import { auth, hasCredentialAccount, stepUp } from "@upstand/api/auth";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";

/** Registers Better Auth's protocol handler at the server boundary. */
export function registerAuthRoutes(app: Hono<AppEnv>): void {
  // Keep the documented API procedure reachable without stealing the rest of
  // Better Auth's /api/auth/* namespace. The wildcard handler below otherwise
  // turns this OpenAPI route into a Better Auth 404.
  app.get("/api/auth/isSession2faVerified", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ message: "Authentication required" }, 401);
    return c.json({
      verified: await stepUp.isStepUpAuthenticationSatisfied(session),
    });
  });
  app.get("/api/auth/security/status", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    return c.json({
      hasCredentialAccount: await hasCredentialAccount(session.user.id),
    });
  });
  app.post("/api/auth/security/set-password", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
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
      await auth.api.setPassword({
        body: { newPassword: body.data.newPassword },
        headers: c.req.raw.headers,
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Unable to set the password" }, 400);
    }
  });
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
}
