import { TRPCError } from "@trpc/server";
import { ScimConflictError, ScimNotFoundError } from "@upstand/usecases";
import { ScimUseCaseToken } from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

const baseInput = z.object({ organizationId: z.string().min(1) });

async function assertManager(userId: string, organizationId: string) {
  return checkPermission(userId, organizationId, "scim:manage");
}

export const scimRouter = router({
  list: twoFactorVerifiedProcedure
    .input(baseInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "scim:view",
      );
      return ctx.scope
        .resolve(ScimUseCaseToken)
        .listProviders(input.organizationId);
    }),

  create: twoFactorVerifiedProcedure
    .input(baseInput.extend({ providerId: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await assertManager(ctx.session.user.id, input.organizationId);
      try {
        return await ctx.scope
          .resolve(ScimUseCaseToken)
          .createProvider(input.organizationId, input.providerId);
      } catch (error) {
        if (error instanceof ScimConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A SCIM provider with this ID already exists",
          });
        }
        handleUseCaseError(error, ctx.log);
      }
    }),

  rotate: twoFactorVerifiedProcedure
    .input(baseInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertManager(ctx.session.user.id, input.organizationId);
      try {
        return await ctx.scope
          .resolve(ScimUseCaseToken)
          .rotateProvider(input.organizationId, input.id);
      } catch (error) {
        if (error instanceof ScimNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        handleUseCaseError(error, ctx.log);
      }
    }),

  remove: twoFactorVerifiedProcedure
    .input(baseInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertManager(ctx.session.user.id, input.organizationId);
      try {
        await ctx.scope
          .resolve(ScimUseCaseToken)
          .deleteProvider(input.organizationId, input.id);
      } catch (error) {
        if (error instanceof ScimNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        handleUseCaseError(error, ctx.log);
      }
      return { success: true };
    }),
});
