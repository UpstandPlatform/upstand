import type { GitProvider, IUnitOfWork } from "@upstand/domain";
import { refreshGiteaToken } from "./gitea-client";
import { refreshGitlabToken } from "./gitlab-client";

type GitProviderConfig = Record<string, unknown>;

export function requiredGitProviderString(
  config: GitProviderConfig,
  key: string,
): string {
  const value: unknown = config[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Git provider configuration field '${key}' is required`);
  }
  return value;
}

export function optionalGitProviderString(
  config: GitProviderConfig,
  key: string,
): string | undefined {
  const value: unknown = config[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(config: GitProviderConfig, key: string): number | null {
  const value: unknown = config[key];
  return typeof value === "number" ? value : null;
}

export function parseGitProviderConfig(
  provider: GitProvider,
): GitProviderConfig {
  try {
    const parsed: unknown = JSON.parse(provider.config);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return Object.fromEntries(Object.entries(parsed));
    }
    return {};
  } catch (_err) {
    throw new Error(
      `Invalid or unparseable configuration for Git provider '${provider.name}'`,
    );
  }
}

export async function getOrRefreshGitProviderToken(
  tx: IUnitOfWork,
  provider: GitProvider,
  config: GitProviderConfig,
): Promise<string> {
  const currentTime = Math.floor(Date.now() / 1000);
  const safetyMargin = 60;

  let accessToken = requiredGitProviderString(config, "accessToken");

  if (provider.provider === "gitlab") {
    const expiresAt = optionalNumber(config, "expiresAt");
    if (expiresAt && currentTime + safetyMargin >= expiresAt) {
      const refreshed = await refreshGitlabToken(
        requiredGitProviderString(config, "gitlabUrl"),
        requiredGitProviderString(config, "refreshToken"),
        requiredGitProviderString(config, "applicationId"),
        requiredGitProviderString(config, "secret"),
      );
      config.accessToken = refreshed.accessToken;
      config.refreshToken = refreshed.refreshToken;
      config.expiresAt = refreshed.expiresAt;

      await tx.gitProviderRepository.updateById(provider.id, {
        config: JSON.stringify(config),
      });
      accessToken = refreshed.accessToken;
    }
  } else if (provider.provider === "gitea") {
    const expiresAt = optionalNumber(config, "expiresAt");
    if (expiresAt && currentTime + safetyMargin >= expiresAt) {
      const refreshed = await refreshGiteaToken(
        requiredGitProviderString(config, "giteaUrl"),
        requiredGitProviderString(config, "refreshToken"),
        requiredGitProviderString(config, "clientId"),
        requiredGitProviderString(config, "clientSecret"),
      );
      config.accessToken = refreshed.accessToken;
      config.refreshToken = refreshed.refreshToken;
      config.expiresAt = refreshed.expiresAt;

      await tx.gitProviderRepository.updateById(provider.id, {
        config: JSON.stringify(config),
      });
      accessToken = refreshed.accessToken;
    }
  }

  return accessToken;
}
