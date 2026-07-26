import { auth, stepUp } from "@upstand/api/auth";
import type { Hono } from "hono";
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
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
}
