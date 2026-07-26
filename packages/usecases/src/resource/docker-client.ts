import type { IUnitOfWork, Resource } from "@upstand/domain";
import type Docker from "dockerode";
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

let dockerClientFactory: (() => Docker) | null = null;

export function configureDockerInfrastructure(
  nextResolver: DockerInfrastructureResolverPort,
  clientFactory: () => Docker,
): void {
  resolver = nextResolver;
  dockerClientFactory = clientFactory;
}

export type DockerDeploymentService = DockerDeploymentPort;
export type DockerResourceControlService = DockerResourceControlPort;
export type DockerResourceReadService = DockerResourceReadPort;
export type DockerContainerControlService = DockerContainerControlPort;
export type DockerCommandService = DockerCommandPort;
export type DockerDatabaseDeploymentService = DockerDatabaseDeploymentPort;
export type DockerServerStatsService = DockerServerStatsPort;

export function getDockerInstance(): Docker {
  if (!dockerClientFactory) {
    throw new Error("Docker infrastructure has not been configured");
  }
  return dockerClientFactory();
}

export function resolveDockerServiceForServer<T>(
  serverId: string | null | undefined,
  uow: IUnitOfWork,
  defaultDockerService: T,
) {
  return resolver.resolveDockerServiceForServer(
    serverId,
    uow,
    defaultDockerService as DockerServicePort,
  ) as Promise<{ dockerService: T; cleanup: () => void }>;
}

export function resolveDockerCliEnvironmentForServer(
  serverId: string | null | undefined,
  uow: IUnitOfWork,
) {
  return resolver.resolveDockerCliEnvironmentForServer(serverId, uow);
}

export function resolveServicesForResource<T>(
  resource: Resource,
  uow: IUnitOfWork,
  defaultDockerService: T,
  defaultCaddyService: CaddyServicePort,
) {
  return resolver.resolveServicesForResource(
    resource,
    uow,
    defaultDockerService as DockerServicePort,
    defaultCaddyService,
  ) as Promise<{
    dockerService: T;
    caddyService: CaddyServicePort;
    cleanup: () => void;
  }>;
}

export function createRemoteServices(connection: RemoteDockerConnectionPort) {
  return resolver.createRemoteServices(connection);
}
