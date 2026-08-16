import type { CreateResourceDTO, Resource } from "../entities/resource";

export type ResourceRoutingProjection = Pick<
  Resource,
  | "id"
  | "name"
  | "type"
  | "appName"
  | "domains"
  | "composeType"
  | "serverId"
  | "previewPort"
  | "previewHttps"
> & {
  advancedConfig?: Resource["advancedConfig"];
};

export type ResourceSummaryProjection = Pick<
  Resource,
  "id" | "environmentId" | "name" | "type" | "serverId"
>;

/** Only the runtime identity/configuration needed by autoscaling. */
export type ResourceAutoscalingProjection = Pick<
  Resource,
  | "id"
  | "name"
  | "type"
  | "status"
  | "appName"
  | "composeType"
  | "serverId"
  | "domains"
  | "advancedConfig"
>;

export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>;
  findByAppName(appName: string): Promise<Resource | null>;
  findByWebhookTokenHash(hash: string): Promise<Resource | null>;
  findByEnvironmentId(environmentId: string): Promise<Resource[]>;
  /** Return only identifiers for organization-scoping reads. */
  findIdsByEnvironmentId?(environmentId: string): Promise<string[]>;
  findByProvider?(provider: string): Promise<Resource[]>;
  findByDockerRegistryId(registryId: string): Promise<Resource[]>;
  findByServerId(serverId: string): Promise<Resource[]>;
  /** Return resources routed through one deployment server, including local assignments. */
  findByDeploymentServerId?(
    serverId: string | null | undefined,
  ): Promise<Resource[]>;
  /** Return only routing metadata; never hydrate resource secrets for Caddy reconciliation. */
  findForCaddy?(): Promise<ResourceRoutingProjection[]>;
  /** Return routing metadata for one deployment server without hydrating secrets. */
  findForCaddyByDeploymentServerId?(
    serverId: string | null | undefined,
  ): Promise<ResourceRoutingProjection[]>;
  /** Return only resource identity/label metadata for bounded history and queue reads. */
  findSummariesByIds?(
    ids: readonly string[],
  ): Promise<ResourceSummaryProjection[]>;
  /** Return only non-secret runtime metadata for autoscaling reconciliation. */
  findForAutoscaling?(): Promise<ResourceAutoscalingProjection[]>;
  /** Resolve an organization's resource IDs with one tenant-scoped SQL projection. */
  findIdsByOrganizationId?(organizationId: string): Promise<string[]>;
  checkDuplicateServiceKey(
    appName: string,
    excludeResourceId?: string,
  ): Promise<Resource | null>;
  create(data: CreateResourceDTO): Promise<Resource>;
  findMany(): Promise<Resource[]>;
  createMany(values: CreateResourceDTO[]): Promise<Resource[]>;
  updateById(
    id: string,
    patch: Partial<CreateResourceDTO>,
  ): Promise<Resource | null>;
  updateByIdIfUpdatedAt(
    id: string,
    expectedUpdatedAt: Date,
    patch: Partial<CreateResourceDTO>,
  ): Promise<Resource | null>;
  deleteById(id: string): Promise<boolean>;
  count(): Promise<number>;
}
