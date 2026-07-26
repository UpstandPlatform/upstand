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
    if (
      !config.githubAppId ||
      !config.githubPrivateKey ||
      !config.githubInstallationId
    ) {
      throw new Error(
        "GitHub App is not fully configured (missing installation)",
      );
    }
  }

  return { provider, config };
}
