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
import { requireInstanceOwnerContext } from "../instance-access";
import { checkPermission } from "../permissions";

async function resolveResourceContext(
  ctx: AuthenticatedContext,
  resourceId: string,
): Promise<{ organizationId: string; allowLocalInCloud: boolean }> {
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
  const allowLocalInCloud =
    !resource.serverId ||
    resource.serverId === "local" ||
    resource.serverId === "manager";
  return { organizationId: project.organizationId, allowLocalInCloud };
}

async function requireLocalResourceOwner(
  ctx: AuthenticatedContext,
  allowLocalInCloud: boolean,
): Promise<void> {
  if (allowLocalInCloud) await requireInstanceOwnerContext(ctx);
}

export const containerFileManagerRouter = router({
  listMounts: twoFactorVerifiedProcedure
    .input(ListContainerMountsInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        return await ctx.scope
          .resolve(ContainerFileManagerUseCaseToken)
          .listMounts({ ...input, organizationId }, { allowLocalInCloud });
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  listFiles: twoFactorVerifiedProcedure
    .input(ListContainerFilesInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.listFiles(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  readFile: twoFactorVerifiedProcedure
    .input(ReadContainerFileInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.readFile(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  writeFile: twoFactorVerifiedProcedure
    .input(WriteContainerFileInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.writeFile(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  createItem: twoFactorVerifiedProcedure
    .input(CreateContainerItemInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.createItem(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  renameItem: twoFactorVerifiedProcedure
    .input(RenameContainerItemInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.renameItem(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  deleteItem: twoFactorVerifiedProcedure
    .input(DeleteContainerItemInputSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.deleteItem(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
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
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:update",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.changePermissions(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),

  searchFiles: twoFactorVerifiedProcedure
    .input(SearchContainerFilesInputSchema.omit({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, allowLocalInCloud } =
          await resolveResourceContext(ctx, input.resourceId);
        await checkPermission(
          ctx.session.user.id,
          organizationId,
          "resource:view",
        );
        await requireLocalResourceOwner(ctx, allowLocalInCloud);
        const useCase = ctx.scope.resolve(ContainerFileManagerUseCaseToken);
        return await useCase.searchFiles(
          {
            ...input,
            organizationId,
          },
          { allowLocalInCloud },
        );
      } catch (error) {
        handleUseCaseError(error);
      }
    }),
});
