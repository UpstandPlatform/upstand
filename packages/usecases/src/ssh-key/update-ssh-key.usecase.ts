import {
  type IUnitOfWork,
  type SshKeyView,
  ValidationError,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  algorithmOf,
  assertKeyPairMatches,
  fingerprintOf,
  KeyPairMismatchError,
} from "@upstand/platform/ssh/validate";
import { z } from "zod";

export const UpdateSshKeyInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    privateKey: z.string().min(1).optional(),
    publicKey: z.string().min(1).optional(),
  })
  .refine(
    (input) =>
      (input.privateKey === undefined) === (input.publicKey === undefined),
    "Private and public keys must be rotated together",
  );

export type UpdateSshKeyInput = z.infer<typeof UpdateSshKeyInputSchema>;

function safeView(
  row: Awaited<ReturnType<IUnitOfWork["sshKeyRepository"]["findById"]>>,
): SshKeyView {
  if (!row) throw new ValidationError("SSH key not found");
  const {
    privateKeyCiphertext: _,
    privateKeyIv: __,
    privateKeyAuthTag: ___,
    privateKeyVersion: ____,
    ...view
  } = row;
  return view;
}

export class UpdateSshKeyUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateSshKeyInput): Promise<SshKeyView> {
    const parsed = UpdateSshKeyInputSchema.parse(input);
    return this.uow.transaction(async (tx) => {
      const existing = await tx.sshKeyRepository.findById(parsed.id);
      if (!existing || existing.organizationId !== parsed.organizationId) {
        throw new ValidationError("SSH key not found");
      }

      const patch: Parameters<
        IUnitOfWork["sshKeyRepository"]["updateById"]
      >[1] = {};
      if (parsed.name !== undefined) patch.name = parsed.name;
      if (parsed.description !== undefined)
        patch.description = parsed.description;

      if (parsed.privateKey !== undefined && parsed.publicKey !== undefined) {
        try {
          assertKeyPairMatches(parsed.privateKey, parsed.publicKey);
        } catch (error) {
          if (error instanceof KeyPairMismatchError) {
            throw new ValidationError(error.message);
          }
          throw new ValidationError(
            "Invalid SSH key pair — could not be parsed",
          );
        }
        const encrypted = encryptSecret(parsed.privateKey);
        patch.algorithm = algorithmOf(parsed.publicKey);
        patch.publicKey = parsed.publicKey.trim();
        patch.fingerprint = fingerprintOf(parsed.publicKey);
        patch.privateKeyCiphertext = encrypted.ciphertext;
        patch.privateKeyIv = encrypted.iv;
        patch.privateKeyAuthTag = encrypted.authTag;
        patch.privateKeyVersion = encrypted.keyVersion;
      }

      if (Object.keys(patch).length === 0) {
        return safeView(existing);
      }
      return safeView(await tx.sshKeyRepository.updateById(parsed.id, patch));
    });
  }
}
