import type {
  CreateGitProviderDTO,
  GitProvider,
} from "../entities/git-provider";

export interface IGitProviderRepository {
  findById(id: string): Promise<GitProvider | null>;
  findByOrganizationId(organizationId: string): Promise<GitProvider[]>;
  create(data: CreateGitProviderDTO): Promise<GitProvider>;
  deleteById(id: string): Promise<boolean>;
  updateById(
    id: string,
    patch: Partial<CreateGitProviderDTO>,
  ): Promise<GitProvider | null>;
}
