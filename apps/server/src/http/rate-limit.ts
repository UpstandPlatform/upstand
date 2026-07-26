import { resolveClientIp } from "@upstand/api/client-ip";
import {
  enforceRequestRateLimit,
  type RateLimitProfile,
} from "@upstand/api/rate-limiting";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";

export type HttpRateLimitOptions = {
  path: string;
  profile: RateLimitProfile;
  onRejected(c: Context<AppEnv>, message: string): Response;
  resolveIdentity?(
    c: Context<AppEnv>,
    fallbackIp: string,
  ):
    | { identifier: string; hasSession: boolean }
    | Promise<{ identifier: string; hasSession: boolean }>;
};

/** Adapts the shared rate-limit service to Hono protocol middleware. */
export function createHttpRateLimitMiddleware(
  options: HttpRateLimitOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const peerAddress = c.env.server?.requestIP(c.req.raw)?.address;
    const ip = resolveClientIp({
      peerAddress,
      forwardedFor: c.req.header("x-forwarded-for"),
      realIp: c.req.header("x-real-ip"),
    });

    const identity = options.resolveIdentity
      ? await options.resolveIdentity(c, ip)
      : { identifier: `ip:${ip}`, hasSession: false };

    try {
      await enforceRequestRateLimit({
        path: options.path,
        identifier: identity.identifier,
        hasSession: identity.hasSession,
        profile: options.profile,
        setHeader: (name, value) => c.header(name, value),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Rate limit")) {
        return options.onRejected(c, error.message);
      }
      throw error;
    }

    await next();
  };
}
