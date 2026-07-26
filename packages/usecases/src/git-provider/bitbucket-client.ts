import { requestJson } from "./http";

interface BitbucketRepository {
  slug: string;
  name: string;
  workspace: { slug: string };
}

interface BitbucketBranch {
  name: string;
}

interface BitbucketPage<T> {
  values: T[];
  next?: string;
}

export function getBitbucketHeaders(
  username: string,
  appPassword: string,
): Record<string, string> {
  const credentials = `${username}:${appPassword}`;
  const base64 = Buffer.from(credentials).toString("base64");
  return {
    Authorization: `Basic ${base64}`,
  };
}

export async function getBitbucketRepositories(
  username: string,
  appPassword: string,
  workspaceName?: string,
): Promise<{ id: string; name: string; fullName: string; owner: string }[]> {
  const owner = workspaceName || username;
  let url = `https://api.bitbucket.org/2.0/repositories/${owner}?pagelen=100`;
  let repositories: BitbucketRepository[] = [];

  const headers = getBitbucketHeaders(username, appPassword);

  while (url) {
    const data = await requestJson<BitbucketPage<BitbucketRepository>>(
      url,
      {
        method: "GET",
        headers,
      },
      (response) =>
        `Failed to fetch Bitbucket repositories: ${response.statusText}`,
    );
    repositories = repositories.concat(data.values);
    url = data.next || "";
  }

  return repositories.map((repo) => ({
    id: repo.slug, // Bitbucket API references by repo slug
    name: repo.name,
    fullName: `${repo.workspace.slug}/${repo.slug}`,
    owner: repo.workspace.slug,
  }));
}

export async function getBitbucketBranches(
  username: string,
  appPassword: string,
  owner: string,
  repoSlug: string,
): Promise<string[]> {
  let url = `https://api.bitbucket.org/2.0/repositories/${owner}/${repoSlug}/refs/branches?pagelen=100`;
  let branches: string[] = [];

  const headers = getBitbucketHeaders(username, appPassword);

  while (url) {
    const data = await requestJson<BitbucketPage<BitbucketBranch>>(
      url,
      {
        method: "GET",
        headers,
      },
      (response) =>
        `Failed to fetch Bitbucket branches: ${response.statusText}`,
    );
    branches = branches.concat(data.values.map((b) => b.name));
    url = data.next || "";
  }

  return branches;
}
