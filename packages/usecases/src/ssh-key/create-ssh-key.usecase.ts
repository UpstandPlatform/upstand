import { randomUUID } from "node:crypto";
import {
  type IUnitOfWork,
  type SshKey,
  ValidationError,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  algorithmOf,
  assertKeyPairMatches,
  fingerprintOf,
  KeyPairMismatchError,
  normalizePrivateKey,
} from "@upstand/platform/ssh/validate";
import { z } from "zod";

// Import path: user brings their own existing key pair.
export const CreateSshKeyInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Key name is required"),
  description: z.string().optional(),
  privateKey: z.string().min(1, "Private key is required"),
  publicKey: z.string().min(1, "Public key is required"),
});

export type CreateSshKeyInput = z.infer<typeof CreateSshKeyInputSchema>;

export type CreateSshKeyCommand = CreateSshKeyInput & { createdBy: string };

export class CreateSshKeyUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: CreateSshKeyCommand,
  ): Promise<
    Omit<SshKey, "privateKeyCiphertext" | "privateKeyIv" | "privateKeyAuthTag">
  > {
    try {
      assertKeyPairMatches(input.privateKey, input.publicKey);
    } catch (err) {
      if (err instanceof KeyPairMismatchError) {
        throw new ValidationError(err.message);
      }
      throw new ValidationError("Invalid SSH key pair — could not be parsed");
    }

    const normalizedPrivateKey = normalizePrivateKey(input.privateKey);
    const encrypted = encryptSecret(normalizedPrivateKey);

    return this.uow.transaction(async (tx) => {
      const row = await tx.sshKeyRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        description: input.description || null,
        algorithm: algorithmOf(input.publicKey),
        publicKey: input.publicKey.trim(),
        fingerprint: fingerprintOf(input.publicKey),
        privateKeyCiphertext: encrypted.ciphertext,
        privateKeyIv: encrypted.iv,
        privateKeyAuthTag: encrypted.authTag,
        privateKeyVersion: encrypted.keyVersion,
        createdBy: input.createdBy,
      });

      const {
        privateKeyCiphertext,
        privateKeyIv,
        privateKeyAuthTag,
        ...safeRow
      } = row;
      return safeRow;
    });
  }
}
