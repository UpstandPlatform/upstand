import type {
  CloudGatewayPort,
  RuntimeDeploymentRequest,
  WorkloadRuntimePort,
} from "@upstand/usecases";
import { CLOUD_GATEWAY_CONTRACT_VERSION } from "@upstand/usecases";

function cloudProjectId(request: RuntimeDeploymentRequest): string {
  if (request.plan.target.kind !== "cloud") {
    throw new Error("Cloud runtime requires a cloud deployment target");
  }
  return request.plan.target.cloudProjectId;
}

export class CloudRuntimeAdapter implements WorkloadRuntimePort {
  readonly runtime = "cloud" as const;

  constructor(private readonly gateway: CloudGatewayPort) {
    if (gateway.contractVersion !== CLOUD_GATEWAY_CONTRACT_VERSION) {
      throw new Error(
        `Cloud gateway contract mismatch: expected '${CLOUD_GATEWAY_CONTRACT_VERSION}', received '${String(gateway.contractVersion)}'`,
      );
    }
  }

  deploy(request: RuntimeDeploymentRequest) {
    this.assertCloudPlan(request);
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
    this.assertCloudPlan(request);
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

  private assertCloudPlan(request: RuntimeDeploymentRequest): void {
    if (request.plan.runtime !== this.runtime) {
      throw new Error("Cloud adapter received a non-cloud deployment plan");
    }
  }
}
