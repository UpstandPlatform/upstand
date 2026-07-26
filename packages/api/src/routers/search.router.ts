import { GlobalSearchInputSchema } from "@upstand/usecases";
import { GlobalSearchUseCaseToken } from "@upstand/usecases/tokens";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

export const searchRouter = router({
  global: twoFactorVerifiedProcedure
    .input(GlobalSearchInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:view",
      );
      return ctx.scope.resolve(GlobalSearchUseCaseToken).execute(input);
    }),
});
