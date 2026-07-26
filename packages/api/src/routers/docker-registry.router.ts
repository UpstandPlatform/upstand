import { TRPCError } from "@trpc/server";
import type { DockerRegistry } from "@upstand/domain";
import {
  CreateDockerRegistryInputSchema,
  DeleteDockerRegistryInputSchema,
  GetDockerRegistriesInputSchema,
  TestDockerRegistryConnectionInputSchema,
  UpdateDockerRegistryInputSchema,
} from "@upstand/usecases";
import {
  CreateDockerRegistryUseCaseToken,
  DeleteDockerRegistryUseCaseToken,
  GetDockerRegistriesUseCaseToken,
  TestDockerRegistryConnectionUseCaseToken,
  UnitOfWorkToken,
  UpdateDockerRegistryUseCaseToken,
} from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

function publicRegistry(registry: DockerRegistry) {
  const { password: _password, ...safe } = registry;
  return { ...safe, password: null };
}

export const dockerRegistryRouter = router({
  create: twoFactorVerifiedProcedure
    .input(CreateDockerRegistryInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "docker_registry:create",
      );

      const useCase = ctx.scope.resolve(CreateDockerRegistryUseCaseToken);
      try {
        return publicRegistry(await useCase.execute(input));
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetDockerRegistriesInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "docker_registry:view",
      );

      const useCase = ctx.scope.resolve(GetDockerRegistriesUseCaseToken);
      try {
        return (await useCase.execute(input)).map(publicRegistry);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteDockerRegistryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const registry = await uow.dockerRegistryRepository.findById(input.id);
      if (!registry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Docker registry not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        registry.organizationId,
        "docker_registry:delete",
      );

      const useCase = ctx.scope.resolve(DeleteDockerRegistryUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateDockerRegistryInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "docker_registry:update",
      );

      const useCase = ctx.scope.resolve(UpdateDockerRegistryUseCaseToken);
      try {
        return publicRegistry(await useCase.execute(input));
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  testConnection: twoFactorVerifiedProcedure
    .input(TestDockerRegistryConnectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "docker_registry:view",
      );
      const useCase = ctx.scope.resolve(
        TestDockerRegistryConnectionUseCaseToken,
      );
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
