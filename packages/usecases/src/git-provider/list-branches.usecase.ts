import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { getBitbucketBranches } from "./bitbucket-client";
import {
  getOrRefreshGitProviderToken,
  requiredGitProviderString,
} from "./git-provider-config";
import { resolveGitProviderAndConfig } from "./git-provider-resolution.helper";
import { getGiteaBranches } from "./gitea-client";
import { getBranches, getBranchesWithToken } from "./github-client";
import { getGitlabBranches } from "./gitlab-client";

export const ListGitBranchesInputSchema = z.object({
  gitProviderId: z.string().min(1, "Git Provider ID is required"),
  owner: z.string().min(1, "Repository owner is required"),
  repo: z.string().min(1, "Repository name is required"),
});

export type ListGitBranchesInput = z.infer<typeof ListGitBranchesInputSchema>;

export class ListGitBranchesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: ListGitBranchesInput) {
    return this.uow.transaction(async (tx) => {
      const { provider, config } = await resolveGitProviderAndConfig(
        tx,
        input.gitProviderId,
      );

      if (provider.provider === "github") {
        const pat =
          config.personalAccessToken || config.accessToken
            ? String(config.personalAccessToken || config.accessToken)
            : null;
        if (pat) {
          return await getBranchesWithToken(pat, input.owner, input.repo);
        }
        return await getBranches(
          String(config.githubAppId),
          requiredGitProviderString(config, "githubPrivateKey"),
          requiredGitProviderString(config, "githubInstallationId"),
          input.owner,
          input.repo,
        );
      }

      if (provider.provider === "gitlab") {
        const accessToken = await getOrRefreshGitProviderToken(
          tx,
          provider,
          config,
        );
        const projectPath = `${input.owner}/${input.repo}`;
        return await getGitlabBranches(
          requiredGitProviderString(config, "gitlabUrl"),
          accessToken,
          projectPath,
        );
      }

      if (provider.provider === "bitbucket") {
        return await getBitbucketBranches(
          requiredGitProviderString(config, "bitbucketUsername"),
          requiredGitProviderString(config, "appPassword"),
          input.owner,
          input.repo,
        );
      }

      if (provider.provider === "gitea") {
        const accessToken = await getOrRefreshGitProviderToken(
          tx,
          provider,
          config,
        );
        return await getGiteaBranches(
          requiredGitProviderString(config, "giteaUrl"),
          accessToken,
          input.owner,
          input.repo,
        );
      }

      throw new Error(
        `Provider ${provider.provider} is not supported for branch listing`,
      );
    });
  }
}
