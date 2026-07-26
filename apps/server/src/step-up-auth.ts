import { stepUp } from "@upstand/api/auth";
import {
  isStepUpVerificationValid,
  type StepUpSession,
  stepUpKey,
} from "@upstand/auth/step-up-auth";

export type { StepUpSession };
export { isStepUpVerificationValid, stepUpKey };
export const isStepUpAuthenticationSatisfied =
  stepUp.isStepUpAuthenticationSatisfied;
