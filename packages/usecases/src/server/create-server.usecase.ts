import { randomUUID } from "node:crypto";
import {
  type IUnitOfWork,
  type Server,
  ServerTypeSchema,
} from "@upstand/domain";
import {
  isSafeSshHost,
  isSafeSshUsername,
} from "@upstand/platform/ssh/validate";
import { z } from "zod";

export const CreateServerInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Server name is required"),
  description: z.string().optional().nullable(),
  serverType: ServerTypeSchema,
  sshKeyId: z.string().optional().nullable(),
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
});

export type CreateServerInput = z.infer<typeof CreateServerInputSchema>;

export class CreateServerUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateServerInput): Promise<Server> {
    return this.uow.transaction(async (tx) => {
      return tx.serverRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        description: input.description || null,
        serverType: input.serverType,
        sshKeyId: input.sshKeyId || null,
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
