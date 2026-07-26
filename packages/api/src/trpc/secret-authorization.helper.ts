import { TRPCError } from "@trpc/server";
import {
  GetProjectUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { AuthenticatedContext } from "../context";
import { checkPermission, type PermissionAction } from "../permissions";

export async function resolveSecretScopeAndCheckPermission(
  ctx: AuthenticatedContext,
  scopeType: "environment" | "resource",
  scopeId: string,
  permission: PermissionAction,
): Promise<string> {
  const uow = ctx.scope.resolve(UnitOfWorkToken);
  const environment =
    scopeType === "environment"
      ? await uow.environmentRepository.findById(scopeId)
      : null;
  const resource =
    scopeType === "resource"
      ? await uow.resourceRepository.findById(scopeId)
      : null;
  const resolvedEnvironment =
    environment ??
    (resource
      ? await uow.environmentRepository.findById(resource.environmentId)
      : null);
  if (!resolvedEnvironment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Secret scope not found",
    });
  }
  const project = await ctx.scope
    .resolve(GetProjectUseCaseToken)
    .execute({ id: resolvedEnvironment.projectId });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  await checkPermission(
    ctx.session.user.id,
    project.organizationId,
    permission,
  );
  return project.organizationId;
}
