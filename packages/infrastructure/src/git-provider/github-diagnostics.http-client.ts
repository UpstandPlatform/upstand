import { readResponseJsonLimited } from "@upstand/platform/network/response-body";
import type {
  GitHubDiagnosticsPort,
  GitHubRepositoryInspection,
} from "@upstand/usecases";

const GITHUB_API = "https://api.github.com";

async function githubRequest<T>(
  path: string,
  authorization: string,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: authorization,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Upstand",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub diagnostic request failed (${response.status})`);
  }
  return { data: await readResponseJsonLimited<T>(response), response };
}

function rateLimit(response: Response) {
  const remainingValue = response.headers.get("x-ratelimit-remaining");
  const resetValue = response.headers.get("x-ratelimit-reset");
  const resetSeconds = resetValue ? Number(resetValue) : Number.NaN;
  return {
    remaining: remainingValue === null ? null : Number(remainingValue),
    resetAt: Number.isFinite(resetSeconds)
      ? new Date(resetSeconds * 1_000).toISOString()
      : null,
  };
}

function safeWebhookHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

export class GitHubDiagnosticsHttpClient implements GitHubDiagnosticsPort {
  async inspect(input: {
    token: string;
    appJwt?: string;
    owner: string;
    repository: string;
    ref: string;
  }): Promise<GitHubRepositoryInspection> {
    const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
    const repositoryResult = await githubRequest<{
      full_name: string;
      default_branch: string;
      clone_url?: string;
      ssh_url?: string;
      permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
    }>(repoPath, `Bearer ${input.token}`);
    const resolvedRef = input.ref || repositoryResult.data.default_branch;
    let ref: GitHubRepositoryInspection["ref"] = null;
    try {
      const result = await githubRequest<{ sha: string }>(
        `${repoPath}/commits/${encodeURIComponent(resolvedRef)}`,
        `Bearer ${input.token}`,
      );
      ref = { name: resolvedRef, sha: result.data.sha };
    } catch {
      ref = null;
    }

    let webhook: GitHubRepositoryInspection["webhook"] = null;
    try {
      if (input.appJwt) {
        const hook = await githubRequest<{ url?: string; active?: boolean }>(
          "/app/hook/config",
          `Bearer ${input.appJwt}`,
        );
        webhook = {
          configured: Boolean(hook.data.url),
          active: hook.data.active !== false,
          host: safeWebhookHost(hook.data.url),
        };
      } else {
        const hooks = await githubRequest<
          Array<{ active?: boolean; config?: { url?: string } }>
        >(`${repoPath}/hooks?per_page=100`, `Bearer ${input.token}`);
        const activeHook = hooks.data.find((item) => item.active !== false);
        webhook = activeHook
          ? {
              configured: Boolean(activeHook.config?.url),
              active: true,
              host: safeWebhookHost(activeHook.config?.url),
            }
          : { configured: false, active: false };
      }
    } catch {
      webhook = null;
    }

    return {
      repository: {
        fullName: repositoryResult.data.full_name,
        defaultBranch: repositoryResult.data.default_branch,
        cloneProtocol: repositoryResult.data.clone_url
          ? "https"
          : repositoryResult.data.ssh_url
            ? "ssh"
            : "unknown",
        permissions: {
          pull: repositoryResult.data.permissions?.pull === true,
          push: repositoryResult.data.permissions?.push === true,
          admin: repositoryResult.data.permissions?.admin === true,
        },
      },
      ref,
      webhook,
      rateLimit: rateLimit(repositoryResult.response),
    };
  }
}
