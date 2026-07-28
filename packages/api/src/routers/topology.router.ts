import { GetTopologyGraphInputSchema } from "@upstand/usecases";
import { GetTopologyGraphUseCaseToken } from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
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

      try {
        return await ctx.scope
          .resolve(GetTopologyGraphUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
