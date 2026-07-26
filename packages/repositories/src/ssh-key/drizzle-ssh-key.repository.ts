import { sshKey } from "@upstand/db";
import type {
  CreateSshKeyDTO,
  ISshKeyRepository,
  SshKey,
  UpdateSshKeyDTO,
} from "@upstand/domain";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleSshKeyRepository
  extends BaseRepository<typeof sshKey, SshKey, CreateSshKeyDTO>
  implements ISshKeyRepository
{
  constructor(executor: Executor) {
    super(executor, sshKey);
  }

  async findByOrganizationId(organizationId: string): Promise<SshKey[]> {
    return this.findMany({
      where: eq(sshKey.organizationId, organizationId),
    });
  }

  async updateById(id: string, patch: UpdateSshKeyDTO): Promise<SshKey | null> {
    return super.updateById(id, patch);
  }
}
