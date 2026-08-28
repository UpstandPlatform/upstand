import { ServiceCollection } from "@circulo-ai/di";
import { registerApplicationFeatures } from "@upstand/api/di/application";
import { registerBackups } from "@upstand/api/di/backups";
import {
  configureDockerInfrastructure,
  configureMonitoringAgent,
  createDockerInfrastructureResolver,
  createMonitoringAgentPort,
} from "@upstand/api/di/dependencies";
import { registerPersistence } from "@upstand/api/di/persistence";
import { registerRuntime } from "@upstand/api/di/runtime";
import { validateCompositionGraph } from "@upstand/api/di/validation";
import { registerWebServer } from "@upstand/api/di/web-server";

const services = new ServiceCollection();

configureDockerInfrastructure(createDockerInfrastructureResolver());
configureMonitoringAgent(createMonitoringAgentPort());

export type ServiceProvider = ReturnType<typeof services.build>;
let provider: ServiceProvider | undefined;

export function getServiceProvider(): ServiceProvider {
  if (!provider) throw new Error("Service provider has not been built");
  return provider;
}

registerPersistence(services);
registerApplicationFeatures(services);
registerBackups(services, getServiceProvider);
registerWebServer(services);
registerRuntime(services);

provider = services.build();
validateCompositionGraph(provider);
