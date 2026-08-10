import type {
  DockerServicePort,
  RuntimeDeploymentRequest,
  RuntimeDeploymentResult,
  RuntimeHealth,
  WorkloadRuntimePort,
} from "@upstand/usecases";

export class DockerRuntimeAdapter implements WorkloadRuntimePort {
  readonly runtime = "docker" as const;

  constructor(private readonly docker: DockerServicePort) {}

  async deploy(
    request: RuntimeDeploymentRequest,
  ): Promise<RuntimeDeploymentResult> {
    if (request.plan.runtime !== this.runtime) {
      throw new Error("Docker adapter received a non-Docker deployment plan");
    }
    if (request.resource.type !== "application") {
      throw new Error(
        `Docker artifact deployment does not support resource type '${request.resource.type}'`,
      );
    }
    const resource = {
      ...request.resource,
      provider: "docker-registry",
      dockerImage: request.plan.artifact.reference,
    };
    await this.docker.deployAppImage(
      resource,
      { ...request.environment },
      request.onLog,
    );
    const health = await this.docker.waitForServiceConvergence(resource);
    if (!health.healthy) {
      throw new Error(health.message ?? "Docker workload did not converge");
    }
    return {
      runtimeId: this.docker.sanitizeName(resource.appName || resource.name),
      endpoint: null,
      artifact: request.plan.artifact,
    };
  }

  async health(
    resource: RuntimeDeploymentRequest["resource"],
  ): Promise<RuntimeHealth> {
    const result = await this.docker.waitForServiceConvergence(resource);
    return {
      healthy: result.healthy,
      state: result.state ?? (result.healthy ? "ready" : "unhealthy"),
      message: result.message ?? null,
    };
  }

  logs(
    resource: RuntimeDeploymentRequest["resource"],
    tail: number,
  ): Promise<string> {
    return this.docker.getLogs(resource, undefined, tail);
  }

  async rollback(request: RuntimeDeploymentRequest): Promise<void> {
    await this.docker.rollbackService(request.resource);
  }

  async remove(resource: RuntimeDeploymentRequest["resource"]): Promise<void> {
    await this.docker.removeResource(resource, false);
  }
}
