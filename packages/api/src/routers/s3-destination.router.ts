import { TRPCError } from "@trpc/server";
import {
  CreateS3DestinationInputSchema,
  DeleteS3DestinationInputSchema,
  GetS3DestinationsInputSchema,
  TestS3DestinationConnectionInputSchema,
  UpdateS3DestinationInputSchema,
} from "@upstand/usecases";
import {
  CreateS3DestinationUseCaseToken,
  DeleteS3DestinationUseCaseToken,
  GetS3DestinationsUseCaseToken,
  TestS3DestinationConnectionUseCaseToken,
  UnitOfWorkToken,
  UpdateS3DestinationUseCaseToken,
} from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

export const s3DestinationRouter = router({
  create: twoFactorVerifiedProcedure
    .input(CreateS3DestinationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "s3_destination:create",
      );

      const useCase = ctx.scope.resolve(CreateS3DestinationUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetS3DestinationsInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "s3_destination:view",
      );

      const useCase = ctx.scope.resolve(GetS3DestinationsUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateS3DestinationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const destination = await uow.s3DestinationRepository.findById(input.id);
      if (!destination) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "S3 Destination not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        destination.organizationId,
        "s3_destination:create",
      );

      const useCase = ctx.scope.resolve(UpdateS3DestinationUseCaseToken);
      try {
        return await useCase.execute({
          ...input,
          organizationId: destination.organizationId,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteS3DestinationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const destination = await uow.s3DestinationRepository.findById(input.id);
      if (!destination) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "S3 Destination not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        destination.organizationId,
        "s3_destination:delete",
      );

      const deleteUseCase = ctx.scope.resolve(DeleteS3DestinationUseCaseToken);
      try {
        return await deleteUseCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  testConnection: twoFactorVerifiedProcedure
    .input(TestS3DestinationConnectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "s3_destination:view",
      );
      const useCase = ctx.scope.resolve(
        TestS3DestinationConnectionUseCaseToken,
      );
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
