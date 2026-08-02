import type { GitProvider, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import {
  restoreGitProviderConfig,
  validateGitProviderConfig,
} from "./provider-config";

export const UpdateGitProviderInputSchema = z.object({
  id: z.string().min(1, "Git Provider ID is required"),
  organizationId: z.string().min(1, "Organization ID is required").optional(),
  name: z.string().min(1, "Provider name is required").optional(),
  config: z.string().min(1, "Configuration config is required").optional(),
});

export type UpdateGitProviderInput = z.infer<
  typeof UpdateGitProviderInputSchema
>;

export class UpdateGitProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateGitProviderInput): Promise<GitProvider | null> {
    return this.uow.transaction(async (tx) => {
      const provider = await tx.gitProviderRepository.findById(input.id);
      if (
        !provider ||
        !input.organizationId ||
        provider.organizationId !== input.organizationId
      ) {
        return null;
      }
      const config =
        input.config !== undefined
          ? restoreGitProviderConfig(provider.config, input.config)
          : provider.config;
      validateGitProviderConfig(provider.provider, config);
      return tx.gitProviderRepository.updateById(input.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.config !== undefined
          ? {
              config,
            }
          : {}),
      });
    });
  }
}
