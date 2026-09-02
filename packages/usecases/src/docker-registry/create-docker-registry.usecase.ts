import { randomUUID } from "node:crypto";
import {
  type DockerRegistry,
  type IUnitOfWork,
  ValidationError,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { z } from "zod";
import { requiresRemoteServerPlacement } from "../platform/platform.types";

export const CreateDockerRegistryInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Registry name is required"),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  imagePrefix: z.string().optional().nullable(),
  registryUrl: z.string().optional().nullable(),
  serverId: z.string().optional().nullable(),
});

export type CreateDockerRegistryInput = z.infer<
  typeof CreateDockerRegistryInputSchema
>;

export class CreateDockerRegistryUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateDockerRegistryInput): Promise<DockerRegistry> {
    validateRegistryUrl(input.registryUrl);
    if (requiresRemoteServerPlacement()) {
      if (!input.serverId || ["local", "manager"].includes(input.serverId)) {
        throw new ValidationError(
          "Please select a target server for docker registry.",
        );
      }
    }
    let password: string | null = null;
    if (input.password) {
      try {
        password = JSON.stringify(encryptSecret(input.password));
      } catch {
        throw new ValidationError(
          "Docker registry credentials could not be encrypted",
        );
      }
    }
    return this.uow.transaction(async (tx) => {
      if (input.serverId && !["local", "manager"].includes(input.serverId)) {
        const server = await tx.serverRepository.findById(input.serverId);
        if (!server || server.organizationId !== input.organizationId) {
          throw new ValidationError(
            "Selected Docker registry server is not available to this organization",
          );
        }
      }
      return tx.dockerRegistryRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        username: input.username || null,
        password,
        imagePrefix: input.imagePrefix || null,
        registryUrl: input.registryUrl || null,
        serverId: input.serverId || null,
      });
    });
  }
}

function validateRegistryUrl(value: string | null | undefined): void {
  if (!value?.trim()) return;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new ValidationError(
      "Docker registry URL must be an HTTP or HTTPS URL without embedded credentials",
    );
  }
}
