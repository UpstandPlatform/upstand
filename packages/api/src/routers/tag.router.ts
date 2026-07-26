import {
  AssignResourceTagInputSchema,
  CreateTagInputSchema,
  DeleteTagInputSchema,
  ListTagsInputSchema,
  ResourceTagsInputSchema,
  UpdateTagInputSchema,
} from "@upstand/usecases";
import {
  AssignResourceTagUseCaseToken,
  CreateTagUseCaseToken,
  DeleteTagUseCaseToken,
  ListResourceTagsUseCaseToken,
  ListTagsUseCaseToken,
  RemoveResourceTagUseCaseToken,
  UpdateTagUseCaseToken,
} from "@upstand/usecases/tokens";
import type { AuthenticatedContext } from "../context";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { authorizeContextCapability } from "../permissions";
import { resolveResourceTarget } from "./shared/resource-authorization";

async function resourceOrganization(
  ctx: AuthenticatedContext,
  resourceId: string,
) {
  return (await resolveResourceTarget(ctx, resourceId)).organizationId;
}

export const tagRouter = router({
  list: twoFactorVerifiedProcedure
    .input(ListTagsInputSchema)
    .query(async ({ ctx, input }) => {
      await authorizeContextCapability(ctx, input.organizationId, "tag:view");
      return ctx.scope.resolve(ListTagsUseCaseToken).execute(input);
    }),
  create: twoFactorVerifiedProcedure
    .input(CreateTagInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeContextCapability(ctx, input.organizationId, "tag:create");
      try {
        return await ctx.scope.resolve(CreateTagUseCaseToken).execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
  update: twoFactorVerifiedProcedure
    .input(UpdateTagInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeContextCapability(ctx, input.organizationId, "tag:update");
      try {
        return await ctx.scope.resolve(UpdateTagUseCaseToken).execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
  remove: twoFactorVerifiedProcedure
    .input(DeleteTagInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeContextCapability(ctx, input.organizationId, "tag:delete");
      try {
        return await ctx.scope.resolve(DeleteTagUseCaseToken).execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
  forResource: twoFactorVerifiedProcedure
    .input(ResourceTagsInputSchema)
    .query(async ({ ctx, input }) => {
      const organizationId = await resourceOrganization(ctx, input.resourceId);
      await authorizeContextCapability(ctx, organizationId, "tag:view");
      return ctx.scope.resolve(ListResourceTagsUseCaseToken).execute(input);
    }),
  assign: twoFactorVerifiedProcedure
    .input(AssignResourceTagInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resourceOrganization(ctx, input.resourceId);
      await authorizeContextCapability(ctx, organizationId, "tag:update");
      try {
        return await ctx.scope
          .resolve(AssignResourceTagUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
  removeFromResource: twoFactorVerifiedProcedure
    .input(AssignResourceTagInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resourceOrganization(ctx, input.resourceId);
      await authorizeContextCapability(ctx, organizationId, "tag:update");
      try {
        return await ctx.scope
          .resolve(RemoveResourceTagUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
