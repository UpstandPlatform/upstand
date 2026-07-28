import { TRPCError } from "@trpc/server";
import { enforceApiKeyRoute, isApiKeyPrincipal } from "../api-key-auth";
import { stepUp } from "../auth";
import type { AuthenticatedContext, Context } from "../context";
import {
  type AuditOutcome,
  recordAuditEvent,
  resolveAuditOrganizationId,
} from "./audit";
import { t } from "./core";
import { rateLimitMiddleware } from "./rate-limiting";

/** All public procedures are rate limited. */
export const publicProcedure = t.procedure.use(rateLimitMiddleware);

async function safeRecordAudit(
  ctx: Context,
  path: string,
  input: unknown,
  outcome: AuditOutcome,
): Promise<void> {
  try {
    const organizationId = await resolveAuditOrganizationId(ctx, path, input);
    if (organizationId) {
      await recordAuditEvent(ctx, path, organizationId, input, outcome);
    }
  } catch (error) {
    ctx.log.error(error instanceof Error ? error : String(error), {
      message: "Failed to resolve audit event scope",
      route: path,
    });
  }
}

/**
 * Protected procedures require an authenticated actor, enforce API-key route
 * permissions, and persist an audit event after successful mutations.
 */
export const protectedProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session || !ctx.actor) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
        cause: "No session",
      });
    }
    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        actor: ctx.actor,
      },
    });
  })
  .use(async ({ ctx, path, getRawInput, next }) => {
    if (path === "auditLog.list") return next();

    let input: unknown;
    try {
      input = await getRawInput();
      if (isApiKeyPrincipal(ctx.actor)) {
        await enforceApiKeyRoute(path, ctx.actor, input);
      }

      const result = await next();
      await safeRecordAudit(ctx, path, input, {
        success: result.ok,
        ...(!result.ok && result.error.code
          ? { errorCode: result.error.code }
          : {}),
      });
      return result;
    } catch (error) {
      await safeRecordAudit(ctx, path, input, {
        success: false,
        ...(error instanceof TRPCError ? { errorCode: error.code } : {}),
      });
      throw error;
    }
  });

/** Procedures that require an additional step-up authentication check. */
export const twoFactorVerifiedProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    if (isApiKeyPrincipal(ctx.actor)) return next();
    if (!(await stepUp.isStepUpAuthenticationSatisfied(ctx.session))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "2FA verification required",
        cause: "2FA_PENDING",
      });
    }
    return next();
  },
);

export type ApiProcedureContext = Context;
export type ProtectedProcedureContext = AuthenticatedContext;
