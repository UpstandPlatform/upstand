import {
  type IUnitOfWork,
  type Server,
  ServerTypeSchema,
  ValidationError,
} from "@upstand/domain";
import {
  isSafeSshHost,
  isSafeSshUsername,
} from "@upstand/platform/ssh/validate";
import { z } from "zod";
import {
  assertBuildServerSupportsResource,
  assertDeploymentServerSupportsResource,
} from "./server-role";

export const UpdateServerInputSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  serverType: ServerTypeSchema.optional(),
  sshKeyId: z.string().min(1).nullable().optional(),
  sshHostKeyFingerprint: z
    .string()
    .trim()
    .regex(/^SHA256:[A-Za-z0-9+/=]+$/)
    .nullable()
    .optional(),
  ipAddress: z
    .string()
    .min(1)
    .max(253)
    .refine(isSafeSshHost, "Host contains unsupported characters")
    .optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  username: z
    .string()
    .min(1)
    .max(64)
    .refine(isSafeSshUsername, "Username contains unsupported characters")
    .optional(),
  enableDockerCleanup: z.boolean().optional(),
});

export type UpdateServerInput = z.infer<typeof UpdateServerInputSchema>;

export class UpdateServerUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateServerInput): Promise<Server> {
    const current = await this.uow.serverRepository.findById(input.id);
    if (!current || current.organizationId !== input.organizationId) {
      throw new Error("Server not found");
    }

    if (input.serverType && input.serverType !== current.serverType) {
      const candidate = { ...current, serverType: input.serverType };
      const resources = await this.uow.resourceRepository.findMany();
      for (const resource of resources) {
        if (resource.serverId === current.id) {
          try {
            assertDeploymentServerSupportsResource(candidate, resource.type);
          } catch (error) {
            throw new ValidationError(
              `Cannot change this server to '${input.serverType}' while it hosts ${resource.type} resource '${resource.name}': ${error instanceof Error ? error.message : "unsupported assignment"}`,
            );
          }
        }
        if (resource.buildServerId === current.id) {
          try {
            assertBuildServerSupportsResource(candidate, resource.type);
          } catch (error) {
            throw new ValidationError(
              `Cannot change this server to '${input.serverType}' while it builds resource '${resource.name}': ${error instanceof Error ? error.message : "unsupported assignment"}`,
            );
          }
        }
      }
    }

    const { organizationId: _organizationId, id: _id, ...patch } = input;
    const provisioningChanged = [
      "sshKeyId",
      "sshHostKeyFingerprint",
      "ipAddress",
      "port",
      "username",
      "serverType",
    ].some((field) => field in input);
    const updated = await this.uow.serverRepository.updateById(
      input.id,
      provisioningChanged
        ? { ...patch, status: "idle", setupError: null }
        : patch,
    );
    if (!updated) throw new Error("Server not found");
    return updated;
  }
}
