import { stepUp } from "../auth";
import { protectedProcedure, router } from "../index";

export const authRouter = router({
  isSession2faVerified: protectedProcedure.query(async ({ ctx }) => {
    return {
      verified: await stepUp.isStepUpAuthenticationSatisfied(ctx.session),
    };
  }),
});
