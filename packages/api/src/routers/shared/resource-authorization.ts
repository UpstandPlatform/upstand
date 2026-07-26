import { TRPCError } from "@trpc/server";
import type { Project, Resource } from "@upstand/domain";
import {
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  GetResourceUseCaseToken,
} from "@upstand/usecases/tokens";
import type { AuthenticatedContext } from "../../context";
import {
  authorizeContextCapability,
  type PermissionAction,
} from "../../permissions";

export type ResourceAuthorizationOptions = {
  action: PermissionAction;
  expectedType?: string;
  resourceLabel?: string;
  missingProjectMessage?: string;
};

export function createResourceAuthorizer(
  options: Omit<ResourceAuthorizationOptions, "action">,
) {
  return (ctx: AuthenticatedContext, id: string, action: PermissionAction) =>
    authorizeResource(ctx, id, { ...options, action });
}

export async function resolveResourceTarget(
  ctx: AuthenticatedContext,
  id: string,
): Promise<{
  resource: Resource;
  organizationId: string;
  project: Project;
}> {
  const resource = await ctx.scope
    .resolve(GetResourceUseCaseToken)
    .execute({ id });
  if (!resource) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Resource not found",
    });
  }

  const environment = await ctx.scope
    .resolve(GetEnvironmentUseCaseToken)
    .execute({ id: resource.environmentId });
  const project = environment
    ? await ctx.scope
        .resolve(GetProjectUseCaseToken)
        .execute({ id: environment.projectId })
    : null;
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  return { resource, organizationId: project.organizationId, project };
}

/** Loads a resource and enforces its project-scoped permission in one place. */
export async function authorizeResource(
  ctx: AuthenticatedContext,
  id: string,
  options: ResourceAuthorizationOptions,
): Promise<Resource> {
  const label = options.resourceLabel ?? "Resource";
  const { resource, organizationId, project } = await resolveResourceTarget(
    ctx,
    id,
  );

  if (options.expectedType && resource.type !== options.expectedType) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${label} not found`,
    });
  }

  await authorizeContextCapability(ctx, organizationId, options.action);

  if (options.action !== "resource:view" && project.archivedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Project is archived. Unarchive it before modifying resources.",
    });
  }

  return resource;
}
