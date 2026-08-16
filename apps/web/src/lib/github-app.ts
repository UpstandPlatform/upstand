import { safeExternalUrl } from "./safe-external-url";

const GITHUB_APP_HOST = "github.com";

export function getGithubAppManifestCreationUrl(
  organizationName: string | undefined,
  state: string,
): string {
  const safeOrganization = organizationName?.trim();
  const baseUrl = safeOrganization
    ? `https://${GITHUB_APP_HOST}/organizations/${encodeURIComponent(safeOrganization)}/settings/apps/new`
    : `https://${GITHUB_APP_HOST}/settings/apps/new`;
  const url = new URL(baseUrl);
  url.searchParams.set("state", state);
  return url.toString();
}

export function getGithubAppSetupUrl(serverUrl: string, state: string): string {
  const url = new URL("/api/providers/github/setup", `${serverUrl}/`);
  url.searchParams.set("state", state);
  return url.toString();
}

function readString(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readGithubAppSlug(config: Record<string, unknown>) {
  const configuredSlug = readString(config, "githubAppSlug");
  if (configuredSlug && /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(configuredSlug)) {
    return configuredSlug;
  }

  const appUrl = readString(config, "githubAppName");
  if (!appUrl) return undefined;

  try {
    const url = new URL(appUrl);
    if (url.hostname !== GITHUB_APP_HOST) return undefined;
    const [appsSegment, slug] = url.pathname.split("/").filter(Boolean);
    return appsSegment === "apps" && slug ? slug : undefined;
  } catch {
    return undefined;
  }
}

export function getGithubAppInstallationUrl(
  config: Record<string, unknown>,
): string | undefined {
  const slug = readGithubAppSlug(config);
  if (!slug) return undefined;

  return safeExternalUrl(
    `https://${GITHUB_APP_HOST}/apps/${encodeURIComponent(slug)}/installations/new`,
  );
}
