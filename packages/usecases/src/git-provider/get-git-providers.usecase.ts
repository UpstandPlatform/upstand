import type { GitProvider, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { redactGitProvider } from "./provider-config";

export const GetGitProvidersInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type GetGitProvidersInput = z.infer<typeof GetGitProvidersInputSchema>;

export class GetGitProvidersUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetGitProvidersInput): Promise<GitProvider[]> {
    return this.uow.transaction(async (tx) => {
      const providers = await tx.gitProviderRepository.findByOrganizationId(
        input.organizationId,
      );
      return providers.map(redactGitProvider);
    });
  }
}
