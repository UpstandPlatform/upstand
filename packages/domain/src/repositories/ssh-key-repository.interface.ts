import type {
  CreateSshKeyDTO,
  SshKey,
  UpdateSshKeyDTO,
} from "../entities/ssh-key";

export interface ISshKeyRepository {
  findById(id: string): Promise<SshKey | null>;
  findByOrganizationId(organizationId: string): Promise<SshKey[]>;
  create(data: CreateSshKeyDTO): Promise<SshKey>;
  updateById(id: string, patch: UpdateSshKeyDTO): Promise<SshKey | null>;
  deleteById(id: string): Promise<boolean>;
}
