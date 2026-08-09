import type {
  CloudGatewayPort,
  RuntimeDeploymentRequest,
  WorkloadRuntimePort,
} from "@upstand/usecases";

function cloudProjectId(request: RuntimeDeploymentRequest): string {
  if (request.plan.target.kind !== "cloud") {
    throw new Error("Cloud runtime requires a cloud deployment target");
  }
  return request.plan.target.cloudProjectId;
}

export class CloudRuntimeAdapter implements WorkloadRuntimePort {
  readonly runtime = "cloud" as const;

  constructor(private readonly gateway: CloudGatewayPort) {}

  deploy(request: RuntimeDeploymentRequest) {
    return this.gateway.deploy({
      idempotencyKey: `deployment:${request.deploymentId}`,
      cloudProjectId: cloudProjectId(request),
      plan: request.plan,
    });
  }

  health(resource: RuntimeDeploymentRequest["resource"]) {
    return this.gateway.health(
      this.cloudProjectFromResource(resource),
      resource.id,
    );
  }

  logs(resource: RuntimeDeploymentRequest["resource"], tail: number) {
    return this.gateway.logs(
      this.cloudProjectFromResource(resource),
      resource.id,
      tail,
    );
  }

  async rollback(request: RuntimeDeploymentRequest): Promise<void> {
    await this.gateway.rollback({
      idempotencyKey: `rollback:${request.deploymentId}`,
      cloudProjectId: cloudProjectId(request),
      plan: request.plan,
    });
  }

  async remove(resource: RuntimeDeploymentRequest["resource"]): Promise<void> {
    await this.gateway.remove({
      idempotencyKey: `remove:${resource.id}`,
      cloudProjectId: this.cloudProjectFromResource(resource),
      resourceId: resource.id,
    });
  }

  private cloudProjectFromResource(
    resource: RuntimeDeploymentRequest["resource"],
  ): string {
    const credentials: unknown = resource.credentials
      ? JSON.parse(resource.credentials)
      : {};
    const value =
      credentials &&
      typeof credentials === "object" &&
      "cloudProjectId" in credentials
        ? credentials.cloudProjectId
        : null;
    if (typeof value !== "string" || !value) {
      throw new Error("Cloud-owned resource has no canonical cloud project ID");
    }
    return value;
  }
}
