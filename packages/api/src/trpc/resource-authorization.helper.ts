import type { ServiceKey, TokenLike } from "@circulo-ai/di";
import { TRPCError } from "@trpc/server";
import type {
  Capability,
  Environment,
  Project,
  Resource,
} from "@upstand/domain";
import {
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  GetResourceUseCaseToken,
} from "@upstand/usecases/tokens";
import { checkPermission } from "../permissions";

interface LookupUseCase<T> {
  execute(input: { id: string }): Promise<T | null>;
}

interface AuthorizationContext {
  scope: { resolve: <T>(token: TokenLike<T>, key?: ServiceKey) => T };
  session: { user: { id: string } };
}

interface AuthorizedResourceContext {
  resource: Resource;
  environment: Environment;
  project: Project;
}

export async function resolveResourceAndCheckPermission(
  ctx: AuthorizationContext,
  resourceId: string,
  requiredPermission: Capability,
): Promise<AuthorizedResourceContext> {
  const useCase = ctx.scope.resolve<LookupUseCase<Resource>>(
    GetResourceUseCaseToken,
  );
  const resource = await useCase.execute({ id: resourceId });
  if (!resource) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Resource not found",
    });
  }

  const envUseCase = ctx.scope.resolve<LookupUseCase<Environment>>(
    GetEnvironmentUseCaseToken,
  );
  const environment = await envUseCase.execute({
    id: resource.environmentId,
  });
  if (!environment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Environment not found",
    });
  }

  const projectUseCase = ctx.scope.resolve<LookupUseCase<Project>>(
    GetProjectUseCaseToken,
  );
  const project = await projectUseCase.execute({
    id: environment.projectId,
  });
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  await checkPermission(
    ctx.session.user.id,
    project.organizationId,
    requiredPermission,
  );

  if (requiredPermission !== "resource:view" && project.archivedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Project is archived. Unarchive it before modifying resources.",
    });
  }

  return { resource, environment, project };
}
