import { TRPCError } from "@trpc/server";
import { env } from "@upstand/env/server";
import { GetTopologyGraphInputSchema } from "@upstand/usecases";
import { GetTopologyGraphUseCaseToken } from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { isInstanceOwnerContext } from "../instance-access";
import { checkPermission } from "../permissions";

export const topologyRouter = router({
  getGraph: twoFactorVerifiedProcedure
    .input(GetTopologyGraphInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      const instanceOwner = await isInstanceOwnerContext(ctx);
      if (env.IS_CLOUD && input.serverId === "local" && !instanceOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Local server topology is restricted to the cloud instance owner",
        });
      }

      try {
        return await ctx.scope
          .resolve(GetTopologyGraphUseCaseToken)
          .execute(input, {
            includeLocal: !env.IS_CLOUD || instanceOwner,
          });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
