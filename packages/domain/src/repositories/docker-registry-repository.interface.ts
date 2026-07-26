import type {
  CreateDockerRegistryDTO,
  DockerRegistry,
} from "../entities/docker-registry.entity";

export interface IDockerRegistryRepository {
  findById(id: string): Promise<DockerRegistry | null>;
  findByOrganizationId(organizationId: string): Promise<DockerRegistry[]>;
  create(data: CreateDockerRegistryDTO): Promise<DockerRegistry>;
  updateById(
    id: string,
    data: Partial<CreateDockerRegistryDTO>,
  ): Promise<DockerRegistry | null>;
  deleteById(id: string): Promise<boolean>;
}
