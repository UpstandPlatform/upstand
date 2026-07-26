import { auth } from "@upstand/api/auth";
import type { Hono } from "hono";
import type { AppEnv } from "../types";

/** Registers Better Auth's protocol handler at the server boundary. */
export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
}
