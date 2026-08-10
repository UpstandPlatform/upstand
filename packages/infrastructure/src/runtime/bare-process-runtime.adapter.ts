import type {
  BareArtifactMaterializerPort,
  ProcessSupervisorPort,
  RuntimeDeploymentRequest,
  RuntimeDeploymentResult,
  WorkloadRuntimePort,
} from "@upstand/usecases";

export class BareProcessRuntimeAdapter implements WorkloadRuntimePort {
  readonly runtime = "bare-process" as const;

  constructor(
    private readonly supervisor: ProcessSupervisorPort,
    private readonly materializer: BareArtifactMaterializerPort,
  ) {}

  async deploy(
    request: RuntimeDeploymentRequest,
  ): Promise<RuntimeDeploymentResult> {
    if (request.plan.runtime !== this.runtime) {
      throw new Error("Bare-process adapter received a different runtime plan");
    }
    const materialized = await this.materializer.materialize({
      deploymentId: request.deploymentId,
      artifact: request.plan.artifact,
      resource: request.resource,
      environment: request.environment,
    });
    const name = this.name(request.resource.id);
    await this.supervisor.install({
      name,
      ...materialized,
      restartPolicy: "on-failure",
    });
    const health = await this.supervisor.status(name);
    if (!health.healthy) {
      throw new Error(health.message ?? "Bare process failed its health check");
    }
    return {
      runtimeId: name,
      endpoint: null,
      artifact: request.plan.artifact,
    };
  }

  health(resource: RuntimeDeploymentRequest["resource"]) {
    return this.supervisor.status(this.name(resource.id));
  }

  logs(resource: RuntimeDeploymentRequest["resource"], tail: number) {
    return this.supervisor.logs(this.name(resource.id), tail);
  }

  async rollback(request: RuntimeDeploymentRequest): Promise<void> {
    if (request.plan.runtime !== this.runtime) {
      throw new Error("Bare-process adapter received a different runtime plan");
    }
    const materialized = await this.materializer.materialize({
      deploymentId: request.deploymentId,
      artifact: request.plan.artifact,
      resource: request.resource,
      environment: request.environment,
    });
    const name = this.name(request.resource.id);
    await this.supervisor.install({
      name,
      ...materialized,
      restartPolicy: "on-failure",
    });
    const health = await this.supervisor.status(name);
    if (!health.healthy) {
      throw new Error(
        health.message ?? "Bare process rollback failed its health check",
      );
    }
  }

  remove(resource: RuntimeDeploymentRequest["resource"]): Promise<void> {
    return this.supervisor.remove(this.name(resource.id));
  }

  private name(resourceId: string): string {
    const safe = resourceId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `upstand-${safe}`.slice(0, 63);
  }
}
