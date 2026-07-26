import { z } from "zod";

export const SshKeySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  algorithm: z.enum(["ed25519", "rsa"]),
  publicKey: z.string(),
  fingerprint: z.string(),
  privateKeyCiphertext: z.string(),
  privateKeyIv: z.string(),
  privateKeyAuthTag: z.string(),
  privateKeyVersion: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.date(),
});

export type SshKey = z.infer<typeof SshKeySchema>;

export type SshKeyView = Omit<
  SshKey,
  | "privateKeyCiphertext"
  | "privateKeyIv"
  | "privateKeyAuthTag"
  | "privateKeyVersion"
>;

export interface CreateSshKeyDTO {
  id?: string;
  organizationId: string;
  name: string;
  description?: string | null;
  algorithm: "ed25519" | "rsa";
  publicKey: string;
  fingerprint: string;
  privateKeyCiphertext: string;
  privateKeyIv: string;
  privateKeyAuthTag: string;
  privateKeyVersion?: number;
  createdBy: string;
}

export interface UpdateSshKeyDTO {
  name?: string;
  description?: string | null;
  publicKey?: string;
  fingerprint?: string;
  algorithm?: "ed25519" | "rsa";
  privateKeyCiphertext?: string;
  privateKeyIv?: string;
  privateKeyAuthTag?: string;
  privateKeyVersion?: number;
}
