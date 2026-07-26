import { TRPCError } from "@trpc/server";
import { UnitOfWorkToken } from "@upstand/usecases/tokens";
import { z } from "zod";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

const organizationInput = z.object({
  organizationId: z.string().min(1),
});

export const outboxRouter = router({
  summary: twoFactorVerifiedProcedure
    .input(organizationInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      return ctx.scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.getOperationalSummary(input.organizationId);
    }),

  deadLetters: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      const messages = await ctx.scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.findByStatus(
          "dead_letter",
          input.limit,
          input.organizationId,
        );
      return messages.map((message) => ({
        id: message.id,
        type: message.type,
        status: message.status,
        attempts: message.attempts,
        maxAttempts: message.maxAttempts,
        lastError: message.lastError,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        deadLetteredAt: message.deadLetteredAt,
      }));
    }),

  retryDeadLetter: twoFactorVerifiedProcedure
    .input(organizationInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      const message = await ctx.scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.retryDeadLetter(
          input.id,
          new Date(),
          input.organizationId,
        );
      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dead-letter outbox message not found",
        });
      }
      return message;
    }),
});
