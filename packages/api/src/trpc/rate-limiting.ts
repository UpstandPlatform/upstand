import { isApiKeyPrincipal, setApiKeyRateLimitHeaders } from "../api-key-auth";
import { resolveClientIp } from "../client-ip";
import { rateLimitPolicy } from "../rate-limiting/policy";
import {
  enforceRequestRateLimit,
  getRateLimiterHealth,
} from "../rate-limiting/service";
import { t } from "./core";

/** Shared rate-limit middleware for every public and protected procedure. */
export const rateLimitMiddleware = t.middleware(async ({ ctx, path, next }) => {
  if (isApiKeyPrincipal(ctx.actor)) {
    setApiKeyRateLimitHeaders(ctx.actor, (name, value) =>
      ctx.honoContext.header(name, value),
    );
    return next();
  }

  const peerAddress = ctx.honoContext.env.server?.requestIP(
    ctx.honoContext.req.raw,
  )?.address;
  const ip = resolveClientIp({
    peerAddress,
    forwardedFor: ctx.honoContext.req.header("x-forwarded-for"),
    realIp: ctx.honoContext.req.header("x-real-ip"),
  });
  const identifier = ctx.session ? `user:${ctx.session.user.id}` : `ip:${ip}`;

  await enforceRequestRateLimit({
    path,
    identifier,
    hasSession: Boolean(ctx.session),
    setHeader: (name, value) => ctx.honoContext.header(name, value),
  });

  return next();
});

export type { Context as ApiContext } from "../context";
export { enforceRequestRateLimit, getRateLimiterHealth, rateLimitPolicy };
