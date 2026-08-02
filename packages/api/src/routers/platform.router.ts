import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "@upstand/usecases";
import { publicProcedure, router } from "../index";

export const platformRouter = router({
  getCapabilities: publicProcedure.query(() => {
    const mode = getConfiguredControlPlaneMode();
    return getPlatformCapabilities(mode);
  }),
});
