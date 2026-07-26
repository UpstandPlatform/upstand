import { randomUUID } from "node:crypto";
import type { GitProvider, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { validateGitProviderConfig } from "./provider-config";

export const CreateGitProviderInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Provider name is required"),
  provider: z.string().min(1, "Provider type is required"), // 'github' | 'gitlab' | 'bitbucket' | 'gitea'
  config: z.string().min(1, "Configuration config is required"), // JSON string containing credentials
});

export type CreateGitProviderInput = z.infer<
  typeof CreateGitProviderInputSchema
>;

export class CreateGitProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateGitProviderInput): Promise<GitProvider> {
    validateGitProviderConfig(input.provider, input.config);
    return this.uow.transaction(async (tx) => {
      return await tx.gitProviderRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        provider: input.provider,
        config: input.config,
      });
    });
  }
}
