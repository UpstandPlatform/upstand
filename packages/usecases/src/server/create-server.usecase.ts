import { randomUUID } from "node:crypto";
import {
  type IUnitOfWork,
  type Server,
  ServerAuthTypeSchema,
  ServerTypeSchema,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  isSafeSshHost,
  isSafeSshUsername,
} from "@upstand/platform/ssh/validate";
import { z } from "zod";

export const CreateServerInputSchema = z
  .object({
    organizationId: z.string().min(1, "Organization ID is required"),
    name: z.string().min(1, "Server name is required"),
    description: z.string().optional().nullable(),
    serverType: ServerTypeSchema,
    authType: ServerAuthTypeSchema.default("ssh_key"),
    sshKeyId: z.string().optional().nullable(),
    password: z.string().optional().nullable(),
    sshHostKeyFingerprint: z
      .string()
      .trim()
      .regex(/^SHA256:[A-Za-z0-9+/=]+$/)
      .optional()
      .nullable(),
    ipAddress: z
      .string()
      .min(1, "IP address is required")
      .refine(isSafeSshHost, "Host contains unsupported characters"),
    port: z.number().int().min(1).max(65_535).default(22),
    username: z
      .string()
      .min(1, "Username is required")
      .refine(isSafeSshUsername, "Username contains unsupported characters")
      .default("root"),
    enableDockerCleanup: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.authType === "ssh_key" && !data.sshKeyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SSH Key is required for SSH key authentication",
        path: ["sshKeyId"],
      });
    }
    if (data.authType === "password" && !data.password?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password is required for password authentication",
        path: ["password"],
      });
    }
  });

export type CreateServerInput = z.infer<typeof CreateServerInputSchema>;

export class CreateServerUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateServerInput): Promise<Server> {
    const authType = input.authType ?? "ssh_key";
    let sshKeyId: string | null = null;
    let passwordCiphertext: string | null = null;
    let passwordIv: string | null = null;
    let passwordAuthTag: string | null = null;
    let passwordVersion: number | null = null;

    if (authType === "password") {
      if (!input.password) {
        throw new Error("Password is required for password authentication");
      }
      const encrypted = encryptSecret(input.password);
      passwordCiphertext = encrypted.ciphertext;
      passwordIv = encrypted.iv;
      passwordAuthTag = encrypted.authTag;
      passwordVersion = encrypted.keyVersion;
    } else {
      if (!input.sshKeyId) {
        throw new Error("SSH key is required for SSH key authentication");
      }
      sshKeyId = input.sshKeyId;
    }

    return this.uow.transaction(async (tx) => {
      return tx.serverRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        description: input.description || null,
        serverType: input.serverType,
        authType,
        sshKeyId,
        passwordCiphertext,
        passwordIv,
        passwordAuthTag,
        passwordVersion,
        sshHostKeyFingerprint: input.sshHostKeyFingerprint || null,
        ipAddress: input.ipAddress,
        port: input.port,
        username: input.username,
        enableDockerCleanup: input.enableDockerCleanup,
        status: "idle",
        setupError: null,
      });
    });
  }
}
