import { randomUUID } from "node:crypto";
import {
  type DockerRegistry,
  type IUnitOfWork,
  ValidationError,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { z } from "zod";

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
    if (env.IS_CLOUD) {
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
