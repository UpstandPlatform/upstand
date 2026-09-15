import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { getBitbucketRepositories } from "./bitbucket-client";
import {
  optionalGitProviderString,
  refreshGitProviderToken,
  requiredGitProviderString,
} from "./git-provider-config";
import { resolveGitProviderAndConfig } from "./git-provider-resolution.helper";
import { getGiteaRepositories } from "./gitea-client";
import { getRepositories, getRepositoriesWithToken } from "./github-client";
import { getGitlabRepositories } from "./gitlab-client";

export const ListGitRepositoriesInputSchema = z.object({
  gitProviderId: z.string().min(1, "Git Provider ID is required"),
});

export type ListGitRepositoriesInput = z.infer<
  typeof ListGitRepositoriesInputSchema
>;

export class ListGitRepositoriesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: ListGitRepositoriesInput) {
    // Read and decrypt provider configuration in a short transaction. The
    // provider HTTP request must run after the connection is released.
    const { provider, config } = await this.uow.transaction((tx) =>
      resolveGitProviderAndConfig(tx, input.gitProviderId),
    );

    if (provider.provider === "gitlab" || provider.provider === "gitea") {
      const refreshed = await refreshGitProviderToken(provider, config);
      if (refreshed.changed) {
        await this.uow.transaction((tx) =>
          tx.gitProviderRepository.updateById(provider.id, {
            config: JSON.stringify(refreshed.config),
          }),
        );
      }
      config.accessToken = refreshed.accessToken;
    }

    if (provider.provider === "github") {
      const pat =
        optionalGitProviderString(config, "personalAccessToken") ||
        optionalGitProviderString(config, "accessToken");
      if (pat) {
        return await getRepositoriesWithToken(pat);
      }
      return await getRepositories(
        String(config.githubAppId),
        requiredGitProviderString(config, "githubPrivateKey"),
        requiredGitProviderString(config, "githubInstallationId"),
      );
    }

    if (provider.provider === "gitlab") {
      const accessToken = requiredGitProviderString(config, "accessToken");
      return await getGitlabRepositories(
        requiredGitProviderString(config, "gitlabUrl"),
        accessToken,
        optionalGitProviderString(config, "groupName"),
      );
    }

    if (provider.provider === "bitbucket") {
      return await getBitbucketRepositories(
        requiredGitProviderString(config, "bitbucketUsername"),
        requiredGitProviderString(config, "appPassword"),
        optionalGitProviderString(config, "bitbucketWorkspaceName"),
      );
    }

    if (provider.provider === "gitea") {
      const accessToken = requiredGitProviderString(config, "accessToken");
      return await getGiteaRepositories(
        requiredGitProviderString(config, "giteaUrl"),
        accessToken,
      );
    }

    throw new Error(
      `Provider ${provider.provider} is not supported for repository listing`,
    );
  }
}
