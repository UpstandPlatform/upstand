import { stepUp } from "@upstand/api/auth";
import { isStepUpVerificationValid } from "@upstand/auth/step-up-auth";

export { isStepUpVerificationValid };
export const isStepUpAuthenticationSatisfied =
  stepUp.isStepUpAuthenticationSatisfied;
