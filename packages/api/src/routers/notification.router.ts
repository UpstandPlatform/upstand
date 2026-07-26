import { TRPCError } from "@trpc/server";
import {
  CreateNotificationChannelInputSchema,
  ListNotificationDeliveriesInputSchema,
  UpdateNotificationChannelInputSchema,
} from "@upstand/domain";
import {
  CreateNotificationChannelUseCaseToken,
  DeleteNotificationChannelUseCaseToken,
  GetNotificationChannelsUseCaseToken,
  RetryNotificationDeliveryUseCaseToken,
  TestNotificationChannelUseCaseToken,
  UnitOfWorkToken,
  UpdateNotificationChannelUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

const OrganizationInputSchema = z.object({ organizationId: z.string().min(1) });
const ChannelIdInputSchema = z.object({ id: z.string().min(1) });

export const notificationRouter = router({
  list: twoFactorVerifiedProcedure
    .input(OrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "notification:view",
      );
      return ctx.scope
        .resolve(GetNotificationChannelsUseCaseToken)
        .execute(input.organizationId);
    }),

  create: twoFactorVerifiedProcedure
    .input(CreateNotificationChannelInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "notification:create",
      );
      try {
        return await ctx.scope
          .resolve(CreateNotificationChannelUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateNotificationChannelInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const channel = await uow.notificationChannelRepository.findById(
        input.id,
      );
      if (!channel) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification channel not found",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        channel.organizationId,
        "notification:update",
      );
      try {
        return await ctx.scope
          .resolve(UpdateNotificationChannelUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  remove: twoFactorVerifiedProcedure
    .input(ChannelIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const channel = await uow.notificationChannelRepository.findById(
        input.id,
      );
      if (!channel) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification channel not found",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        channel.organizationId,
        "notification:delete",
      );
      try {
        await ctx.scope
          .resolve(DeleteNotificationChannelUseCaseToken)
          .execute(input.id);
        return { success: true };
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  test: twoFactorVerifiedProcedure
    .input(ChannelIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const channel = await uow.notificationChannelRepository.findById(
        input.id,
      );
      if (!channel) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification channel not found",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        channel.organizationId,
        "notification:update",
      );
      try {
        await ctx.scope
          .resolve(TestNotificationChannelUseCaseToken)
          .execute(input.id);
        return { success: true };
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  deliveries: twoFactorVerifiedProcedure
    .input(ListNotificationDeliveriesInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "notification:view",
      );
      return ctx.scope
        .resolve(UnitOfWorkToken)
        .notificationDeliveryRepository.list(input);
    }),

  retryDelivery: twoFactorVerifiedProcedure
    .input(ChannelIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const delivery = await ctx.scope
        .resolve(UnitOfWorkToken)
        .notificationDeliveryRepository.findById(input.id);
      if (!delivery) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification delivery not found",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        delivery.organizationId,
        "notification:update",
      );
      try {
        return await ctx.scope
          .resolve(RetryNotificationDeliveryUseCaseToken)
          .execute(input.id);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
