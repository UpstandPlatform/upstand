import { requestJson } from "./http";

interface GiteaRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
}

export async function refreshGiteaToken(
  giteaUrl: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const data = await requestJson<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>(
    `${giteaUrl}/login/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
    (response) => `Failed to refresh Gitea token: ${response.statusText}`,
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function getGiteaRepositories(
  giteaUrl: string,
  accessToken: string,
): Promise<{ id: number; name: string; fullName: string; owner: string }[]> {
  let allRepos: GiteaRepository[] = [];
  let page = 1;
  const limit = 50;

  while (true) {
    const repos = await requestJson<GiteaRepository[]>(
      `${giteaUrl}/api/v1/user/repos?page=${page}&limit=${limit}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `token ${accessToken}`,
        },
      },
      (response) =>
        `Failed to fetch Gitea repositories: ${response.statusText}`,
    );
    if (repos.length === 0) {
      break;
    }

    allRepos = allRepos.concat(repos);
    if (repos.length < limit) {
      break;
    }
    page++;
  }

  return allRepos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
  }));
}

export async function getGiteaBranches(
  giteaUrl: string,
  accessToken: string,
  owner: string,
  repo: string,
): Promise<string[]> {
  const branches = await requestJson<{ name: string }[]>(
    `${giteaUrl}/api/v1/repos/${owner}/${repo}/branches`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `token ${accessToken}`,
      },
    },
    (response) => `Failed to fetch Gitea branches: ${response.statusText}`,
  );
  return branches.map((b) => b.name);
}
