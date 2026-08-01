import type { IUnitOfWork } from "@upstand/domain";
import { parseGitProviderConfig } from "./git-provider-config";

export async function resolveGitProviderAndConfig(
  tx: Parameters<Parameters<IUnitOfWork["transaction"]>[0]>[0],
  gitProviderId: string,
) {
  const provider = await tx.gitProviderRepository.findById(gitProviderId);
  if (!provider) {
    throw new Error("Git Provider not found");
  }

  const config = parseGitProviderConfig(provider);

  if (provider.provider === "github") {
    const hasAppConfig =
      config.githubAppId &&
      config.githubPrivateKey &&
      config.githubInstallationId;
    const hasPatConfig = !!(config.personalAccessToken || config.accessToken);
    if (!hasAppConfig && !hasPatConfig) {
      throw new Error(
        "GitHub Provider requires either a configured GitHub App or a Personal Access Token (PAT)",
      );
    }
  }

  return { provider, config };
}
