import { randomBytes } from "node:crypto";
import { initializeMonitoring as initializeLocalMonitoring } from "@upstand/infrastructure/monitoring/local-monitoring-agent.service";
import { UnitOfWorkToken } from "@upstand/usecases/tokens";
import { getServiceProvider } from "./di";

export {
  isImmutableImageReference,
  waitForMonitoringHealth,
} from "@upstand/infrastructure/monitoring/local-monitoring-agent.service";

export async function initializeMonitoring(): Promise<void> {
  return initializeLocalMonitoring(async () => {
    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      let settings =
        await uow.monitoringSettingsRepository.findByServerId("local");
      if (!settings) {
        settings = await uow.monitoringSettingsRepository.upsert({
          serverId: "local",
          token: randomBytes(24).toString("hex"),
          cpuThreshold: 90,
          memoryThreshold: 90,
        });
      }
      return {
        token: settings.token,
        cpuThreshold: settings.cpuThreshold,
        memoryThreshold: settings.memoryThreshold,
      };
    } finally {
      await scope.dispose();
    }
  });
}
