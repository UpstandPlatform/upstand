import {
  type DockerRegistry,
  type IUnitOfWork,
  ValidationError,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { z } from "zod";
import { requiresRemoteServerPlacement } from "../platform/platform.types";

export const UpdateDockerRegistryInputSchema = z.object({
  id: z.string().min(1, "Registry ID is required"),
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Registry name is required").optional(),
  username: z.string().nullable().optional(),
  /** Omit to keep the current credential; null explicitly clears it. */
  password: z.string().nullable().optional(),
  imagePrefix: z.string().nullable().optional(),
  registryUrl: z.string().nullable().optional(),
  serverId: z.string().nullable().optional(),
});

export type UpdateDockerRegistryInput = z.infer<
  typeof UpdateDockerRegistryInputSchema
>;

export class UpdateDockerRegistryUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateDockerRegistryInput): Promise<DockerRegistry> {
    validateRegistryUrl(input.registryUrl);
    if (requiresRemoteServerPlacement()) {
      if (
        input.serverId === null ||
        (input.serverId && ["local", "manager"].includes(input.serverId))
      ) {
        throw new ValidationError(
          "Please select a target server for docker registry.",
        );
      }
    }
    const existing = await this.uow.dockerRegistryRepository.findById(input.id);
    if (!existing || existing.organizationId !== input.organizationId) {
      throw new Error("Docker registry not found");
    }
    if (input.serverId && !["local", "manager"].includes(input.serverId)) {
      const server = await this.uow.serverRepository.findById(input.serverId);
      if (!server || server.organizationId !== input.organizationId) {
        throw new ValidationError(
          "Selected Docker registry server is not available to this organization",
        );
      }
    }

    let passwordPatch: string | null | undefined;
    if (input.password === null) {
      passwordPatch = null;
    } else if (input.password !== undefined) {
      try {
        passwordPatch = JSON.stringify(encryptSecret(input.password));
      } catch {
        throw new ValidationError(
          "Docker registry credentials could not be encrypted",
        );
      }
    }

    const updated = await this.uow.dockerRegistryRepository.updateById(
      input.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(passwordPatch !== undefined ? { password: passwordPatch } : {}),
        ...(input.imagePrefix !== undefined
          ? { imagePrefix: input.imagePrefix }
          : {}),
        ...(input.registryUrl !== undefined
          ? { registryUrl: input.registryUrl }
          : {}),
        ...(input.serverId !== undefined ? { serverId: input.serverId } : {}),
      },
    );

    if (!updated) {
      throw new Error("Docker registry not found");
    }
    return updated;
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
