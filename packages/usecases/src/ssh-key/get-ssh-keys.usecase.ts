import type { IUnitOfWork, SshKeyView } from "@upstand/domain";
import { z } from "zod";

export const GetSshKeysInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type GetSshKeysInput = z.infer<typeof GetSshKeysInputSchema>;

export class GetSshKeysUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetSshKeysInput): Promise<SshKeyView[]> {
    return this.uow.transaction(async (tx) => {
      const keys = await tx.sshKeyRepository.findByOrganizationId(
        input.organizationId,
      );
      return keys.map(
        ({
          privateKeyCiphertext: _,
          privateKeyIv: __,
          privateKeyAuthTag: ___,
          privateKeyVersion: ____,
          ...safeKey
        }) => safeKey,
      );
    });
  }
}
