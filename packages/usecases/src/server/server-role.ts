import { type Server, type ServerType, ValidationError } from "@upstand/domain";

type ResourceType = string;

/**
 * The host capabilities that setup must establish for a server role.
 *
 * Deploy and database resources use Swarm services. Only deploy hosts expose
 * the shared Caddy edge; build hosts run Docker only and are never eligible to
 * receive a deployment target assignment.
 */
export type ServerProvisioningPlan = {
  requiresSwarm: boolean;
  requiresCaddy: boolean;
  requiresMonitoring: boolean;
};

export function getServerProvisioningPlan(
  serverType: ServerType,
): ServerProvisioningPlan {
  switch (serverType) {
    case "deploy":
      return {
        requiresSwarm: true,
        requiresCaddy: true,
        requiresMonitoring: true,
      };
    case "database":
      return {
        requiresSwarm: true,
        requiresCaddy: false,
        requiresMonitoring: true,
      };
    case "build":
      return {
        requiresSwarm: false,
        requiresCaddy: false,
        requiresMonitoring: true,
      };
  }
}

export function assertDeploymentServerSupportsResource(
  server: Server,
  resourceType: ResourceType,
): void {
  if (server.serverType === "build") {
    throw new ValidationError(
      `Server '${server.name}' is a build server and cannot host deployments`,
    );
  }
  if (server.serverType === "database" && resourceType !== "database") {
    throw new ValidationError(
      `Server '${server.name}' is a database server and can only host database resources`,
    );
  }
}

export function assertBuildServerSupportsResource(
  server: Server,
  resourceType: ResourceType,
): void {
  assertResourceCanUseBuildServer(resourceType);
  if (server.serverType === "database") {
    throw new ValidationError(
      `Server '${server.name}' is a database server and cannot build applications`,
    );
  }
}

export function assertResourceCanUseBuildServer(
  resourceType: ResourceType,
): void {
  if (resourceType !== "application") {
    throw new ValidationError(
      "Only application resources can use a dedicated build server",
    );
  }
}
