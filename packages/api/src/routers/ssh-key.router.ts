import { TRPCError } from "@trpc/server";
import {
  CreateSshKeyInputSchema,
  DeleteSshKeyInputSchema,
  GenerateSshKeyInputSchema,
  GetSshKeysInputSchema,
  UpdateSshKeyInputSchema,
} from "@upstand/usecases";
import {
  CreateSshKeyUseCaseToken,
  DeleteSshKeyUseCaseToken,
  GenerateSshKeyUseCaseToken,
  GetSshKeysUseCaseToken,
  UnitOfWorkToken,
  UpdateSshKeyUseCaseToken,
} from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

export const sshKeyRouter = router({
  generate: twoFactorVerifiedProcedure
    .input(GenerateSshKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ssh_key:create",
      );
      const useCase = ctx.scope.resolve(GenerateSshKeyUseCaseToken);
      try {
        return await useCase.execute({
          ...input,
          createdBy: ctx.session.user.id,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  create: twoFactorVerifiedProcedure
    .input(CreateSshKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ssh_key:create",
      );
      const useCase = ctx.scope.resolve(CreateSshKeyUseCaseToken);
      try {
        return await useCase.execute({
          ...input,
          createdBy: ctx.session.user.id,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetSshKeysInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ssh_key:view",
      );
      const useCase = ctx.scope.resolve(GetSshKeysUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteSshKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const sshKey = await uow.sshKeyRepository.findById(input.id);
      if (!sshKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SSH Key not found",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        sshKey.organizationId,
        "ssh_key:delete",
      );
      const deleteUseCase = ctx.scope.resolve(DeleteSshKeyUseCaseToken);
      try {
        return await deleteUseCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateSshKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ssh_key:update",
      );
      const useCase = ctx.scope.resolve(UpdateSshKeyUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
