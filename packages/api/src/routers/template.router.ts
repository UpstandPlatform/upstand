import {
  CreateTemplateInputSchema,
  DeleteTemplateInputSchema,
  DeployTemplateInputSchema,
  ListTemplatesInputSchema,
  listNativeTemplates,
  UpdateTemplateInputSchema,
} from "@upstand/usecases";
import {
  CreateTemplateUseCaseToken,
  DeleteTemplateUseCaseToken,
  DeployTemplateUseCaseToken,
  ListTemplatesUseCaseToken,
  UpdateTemplateUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

export const templateRouter = router({
  catalog: twoFactorVerifiedProcedure
    .input(
      z.object({
        search: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(48).default(12),
      }),
    )
    .query(async ({ input }) => {
      const all = listNativeTemplates(input.search);
      const offset = (input.page - 1) * input.pageSize;
      const items = all
        .slice(offset, offset + input.pageSize)
        .map((template) => ({
          ...template,
          source: "builtin" as const,
        }));
      return {
        items,
        total: all.length,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(all.length / input.pageSize)),
      };
    }),

  list: twoFactorVerifiedProcedure
    .input(ListTemplatesInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "template:view",
      );
      return ctx.scope.resolve(ListTemplatesUseCaseToken).execute(input);
    }),

  create: twoFactorVerifiedProcedure
    .input(CreateTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "template:create",
      );
      try {
        return await ctx.scope
          .resolve(CreateTemplateUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "template:update",
      );
      try {
        return await ctx.scope
          .resolve(UpdateTemplateUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  remove: twoFactorVerifiedProcedure
    .input(DeleteTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "template:delete",
      );
      try {
        return await ctx.scope
          .resolve(DeleteTemplateUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  deploy: twoFactorVerifiedProcedure
    .input(DeployTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "template:deploy",
      );
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "resource:create",
      );
      try {
        return await ctx.scope
          .resolve(DeployTemplateUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
