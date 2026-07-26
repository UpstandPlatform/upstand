import { randomUUID } from "node:crypto";
import type { IUnitOfWork } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { generateSshKeyPair } from "@upstand/platform/ssh/keygen";
import { z } from "zod";

// Generated path: we create the key pair for the user.
export const GenerateSshKeyInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Key name is required"),
  description: z.string().optional(),
  algorithm: z.enum(["ed25519", "rsa"]).default("ed25519"),
});

export type GenerateSshKeyInput = z.infer<typeof GenerateSshKeyInputSchema>;

export interface GenerateSshKeyResult {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  algorithm: "ed25519" | "rsa";
  createdAt: Date;
  /** Returned once, at generation time only. Never persisted in
   *  plaintext and never returned by any other endpoint again. */
  privateKey: string;
}

export type GenerateSshKeyCommand = GenerateSshKeyInput & { createdBy: string };

export class GenerateSshKeyUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GenerateSshKeyCommand): Promise<GenerateSshKeyResult> {
    const { privateKey, publicKey, fingerprint } = generateSshKeyPair(
      input.algorithm,
      input.name,
    );
    const encrypted = encryptSecret(privateKey);

    const row = await this.uow.transaction(async (tx) => {
      return tx.sshKeyRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        description: input.description || null,
        algorithm: input.algorithm,
        publicKey,
        fingerprint,
        privateKeyCiphertext: encrypted.ciphertext,
        privateKeyIv: encrypted.iv,
        privateKeyAuthTag: encrypted.authTag,
        privateKeyVersion: encrypted.keyVersion,
        createdBy: input.createdBy,
      });
    });

    return {
      id: row.id,
      name: row.name,
      publicKey,
      fingerprint,
      algorithm: input.algorithm,
      createdAt: row.createdAt,
      privateKey,
    };
  }
}
