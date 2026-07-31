import { ProxyKindSchema } from "@upstand/domain";
import {
  DetectProxyUseCaseToken,
  ScanProxySitesUseCaseToken,
  TakeoverProxyUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/index";

export const proxyRouter = router({
  detect: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        serverId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const usecase = ctx.scope.resolve(DetectProxyUseCaseToken);
      return usecase.execute({ serverId: input.serverId });
    }),

  scanImportable: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        serverId: z.string().optional(),
        proxyKind: ProxyKindSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const usecase = ctx.scope.resolve(ScanProxySitesUseCaseToken);
      return usecase.execute({
        serverId: input.serverId,
        proxyKind: input.proxyKind,
      });
    }),

  takeover: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        serverId: z.string(),
        acmeEmail: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const usecase = ctx.scope.resolve(TakeoverProxyUseCaseToken);
      return usecase.execute({
        serverId: input.serverId,
        acmeEmail: input.acmeEmail,
      });
    }),

  rollback: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        journalId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const usecase = ctx.scope.resolve(TakeoverProxyUseCaseToken);
      return usecase.rollback({ journalId: input.journalId });
    }),
});
