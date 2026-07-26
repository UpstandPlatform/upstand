import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { getBitbucketRepositories } from "./bitbucket-client";
import {
  getOrRefreshGitProviderToken,
  optionalGitProviderString,
  requiredGitProviderString,
} from "./git-provider-config";
import { resolveGitProviderAndConfig } from "./git-provider-resolution.helper";
import { getGiteaRepositories } from "./gitea-client";
import { getRepositories } from "./github-client";
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
    return this.uow.transaction(async (tx) => {
      const { provider, config } = await resolveGitProviderAndConfig(
        tx,
        input.gitProviderId,
      );

      if (provider.provider === "github") {
        return await getRepositories(
          String(config.githubAppId),
          requiredGitProviderString(config, "githubPrivateKey"),
          requiredGitProviderString(config, "githubInstallationId"),
        );
      }

      if (provider.provider === "gitlab") {
        const accessToken = await getOrRefreshGitProviderToken(
          tx,
          provider,
          config,
        );
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
        const accessToken = await getOrRefreshGitProviderToken(
          tx,
          provider,
          config,
        );
        return await getGiteaRepositories(
          requiredGitProviderString(config, "giteaUrl"),
          accessToken,
        );
      }

      throw new Error(
        `Provider ${provider.provider} is not supported for repository listing`,
      );
    });
  }
}
