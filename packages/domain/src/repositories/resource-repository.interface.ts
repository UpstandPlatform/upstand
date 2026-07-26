import type { CreateResourceDTO, Resource } from "../entities/resource";

export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>;
  findByAppName(appName: string): Promise<Resource | null>;
  findByWebhookTokenHash(hash: string): Promise<Resource | null>;
  findByEnvironmentId(environmentId: string): Promise<Resource[]>;
  findByDockerRegistryId(registryId: string): Promise<Resource[]>;
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
  updateByIdIfUpdatedAt?(
    id: string,
    expectedUpdatedAt: Date,
    patch: Partial<CreateResourceDTO>,
  ): Promise<Resource | null>;
  deleteById(id: string): Promise<boolean>;
  count(): Promise<number>;
}
