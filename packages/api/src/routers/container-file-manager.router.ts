import { TRPCError } from "@trpc/server";
import {
  ChangeContainerItemPermissionsInputSchema,
  CreateContainerItemInputSchema,
  DeleteContainerItemInputSchema,
  ListContainerFilesInputSchema,
  ListContainerMountsInputSchema,
  ReadContainerFileInputSchema,
  RenameContainerItemInputSchema,
  SearchContainerFilesInputSchema,
  WriteContainerFileInputSchema,
} from "@upstand/usecases";
import {
  ContainerFileManagerUseCaseToken,
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  GetResourceUseCaseToken,
} from "@upstand/usecases/tokens";
import type { AuthenticatedContext } from "../context";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

async function resolveResourceOrgId(
  ctx: AuthenticatedContext,
  resourceId: string,
): Promise<string> {
  const getResource = ctx.scope.resolve(GetResourceUseCaseToken);
  const resource = await getResource.execute({ id: resourceId });
  if (!resource) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
  }
  const getEnv = ctx.scope.resolve(GetEnvironmentUseCaseToken);
  const env = await getEnv.execute({ id: resource.environmentId });
  const getProj = ctx.scope.resolve(GetProjectUseCaseToken);
  const project = env ? await getProj.execute({ id: env.projectId }) : null;
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project.organizationId;
}

export const containerFileManagerRouter = router({
  listMounts: twoFactorVerifiedProcedure
    .input(ListContainerMountsInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        return await ctx.scope
          .resolve(ContainerFileManagerUseCaseToken)
          .listMounts({ ...input, organizationId });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  listFiles: twoFactorVerifiedProcedure
    .input(ListContainerFilesInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.listFiles({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  readFile: twoFactorVerifiedProcedure
    .input(ReadContainerFileInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.readFile({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  writeFile: twoFactorVerifiedProcedure
    .input(WriteContainerFileInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.writeFile({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  createItem: twoFactorVerifiedProcedure
    .input(CreateContainerItemInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.createItem({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  renameItem: twoFactorVerifiedProcedure
    .input(RenameContainerItemInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.renameItem({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  deleteItem: twoFactorVerifiedProcedure
    .input(DeleteContainerItemInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.deleteItem({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  changePermissions: twoFactorVerifiedProcedure
    .input(
      ChangeContainerItemPermissionsInputSchema.omit({
        organizationId: true,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.changePermissions({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  searchFiles: twoFactorVerifiedProcedure
    .input(SearchContainerFilesInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const organizationId = await resolveResourceOrgId(
          ctx,
          input.resourceId,
        );
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.searchFiles({
          ...input,
          organizationId,
        });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),
});
