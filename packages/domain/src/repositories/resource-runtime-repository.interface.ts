import type { ResourceRuntime } from "../entities/resource-runtime";

export interface IResourceRuntimeRepository {
  findByResourceId(resourceId: string): Promise<ResourceRuntime | null>;
  upsert(
    resourceId: string,
    values: Omit<ResourceRuntime, "resourceId">,
  ): Promise<ResourceRuntime>;
}
