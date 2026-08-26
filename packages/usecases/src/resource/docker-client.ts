import type {
  IUnitOfWork,
  ResourceAutoscalingProjection,
} from "@upstand/domain";
import type { CaddyServicePort } from "../ports/caddy";
import type {
  DockerCommandPort,
  DockerContainerControlPort,
  DockerDatabaseDeploymentPort,
  DockerDeploymentPort,
  DockerInfrastructureResolverPort,
  DockerResourceControlPort,
  DockerResourceReadPort,
  DockerServerStatsPort,
  DockerServicePort,
  RemoteDockerConnectionPort,
} from "../ports/docker";

let resolver: DockerInfrastructureResolverPort = {
  async resolveCaddyServiceForServer() {
    throw new Error("Remote Caddy infrastructure has not been configured");
  },
  async resolveDockerServiceForServer(_serverId, _uow, defaultDockerService) {
    return { dockerService: defaultDockerService, cleanup: () => {} };
  },
  async resolveDockerCliEnvironmentForServer() {
    return { environment: {}, cleanup: () => {} };
  },
  async resolveServicesForResource(
    _resource,
    _uow,
    defaultDockerService,
    defaultCaddyService,
  ) {
    return {
      dockerService: defaultDockerService,
      caddyService: defaultCaddyService,
      cleanup: () => {},
    };
  },
  createRemoteServices() {
    throw new Error("Remote Docker infrastructure has not been configured");
  },
};

export function configureDockerInfrastructure(
  nextResolver: DockerInfrastructureResolverPort,
): void {
  resolver = nextResolver;
}

export type DockerDeploymentService = DockerDeploymentPort;
export type DockerResourceControlService = DockerResourceControlPort;
export type DockerResourceReadService = DockerResourceReadPort;
export type DockerContainerControlService = DockerContainerControlPort;
export type DockerCommandService = DockerCommandPort;
export type DockerDatabaseDeploymentService = DockerDatabaseDeploymentPort;
export type DockerServerStatsService = DockerServerStatsPort;

export function resolveCaddyServiceForServer(
  serverId: string,
  uow: IUnitOfWork,
) {
  return resolver.resolveCaddyServiceForServer(serverId, uow);
}

export function resolveDockerServiceForServer<T extends object>(
  serverId: string | null | undefined,
  uow: IUnitOfWork,
  defaultDockerService: T,
) {
  return resolver
    .resolveDockerServiceForServer(
      serverId,
      uow,
      defaultDockerService as DockerServicePort,
    )
    .then(({ dockerService, cleanup }) => ({
      dockerService: restrictCapability(dockerService, defaultDockerService),
      cleanup,
    })) as Promise<{ dockerService: T; cleanup: () => void }>;
}

function restrictCapability<T extends object>(
  service: DockerServicePort,
  capabilityTemplate: T,
): T {
  return Object.fromEntries(
    Object.keys(capabilityTemplate).map((method) => {
      const implementation = service[method as keyof DockerServicePort];
      if (typeof implementation !== "function") {
        throw new Error(`Docker capability method is unavailable: ${method}`);
      }
      return [method, implementation.bind(service)];
    }),
  ) as T;
}

export function resolveDockerCliEnvironmentForServer(
  serverId: string | null | undefined,
  uow: IUnitOfWork,
) {
  return resolver.resolveDockerCliEnvironmentForServer(serverId, uow);
}

export function resolveServicesForResource<T extends object>(
  resource: ResourceAutoscalingProjection,
  uow: IUnitOfWork,
  defaultDockerService: T,
  defaultCaddyService: CaddyServicePort,
) {
  return resolver
    .resolveServicesForResource(
      resource,
      uow,
      defaultDockerService as DockerServicePort,
      defaultCaddyService,
    )
    .then(({ dockerService, caddyService, cleanup }) => ({
      dockerService: restrictCapability(dockerService, defaultDockerService),
      caddyService,
      cleanup,
    })) as Promise<{
    dockerService: T;
    caddyService: CaddyServicePort;
    cleanup: () => void;
  }>;
}

export function createRemoteServices(connection: RemoteDockerConnectionPort) {
  return resolver.createRemoteServices(connection);
}
