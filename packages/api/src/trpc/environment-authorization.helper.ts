import type { ServiceKey, TokenLike } from "@circulo-ai/di";
import { TRPCError } from "@trpc/server";
import type {
  Capability,
  EnvironmentSummaryProjection,
  Project,
} from "@upstand/domain";
import {
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
} from "@upstand/usecases/tokens";
import { checkPermission } from "../permissions";

interface LookupUseCase<T> {
  execute(input: { id: string }): Promise<T | null>;
}

interface AuthorizationContext {
  scope: { resolve: <T>(token: TokenLike<T>, key?: ServiceKey) => T };
  session: { user: { id: string } };
}

interface AuthorizedEnvironmentContext {
  environment: EnvironmentSummaryProjection;
  project: Project;
}

export async function resolveEnvironmentAndCheckPermission(
  ctx: AuthorizationContext,
  environmentId: string,
  requiredPermission: Capability,
): Promise<AuthorizedEnvironmentContext> {
  const envUseCase = ctx.scope.resolve(GetEnvironmentUseCaseToken);
  const environment = await envUseCase.executeSummary({ id: environmentId });
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

  return { environment, project };
}
