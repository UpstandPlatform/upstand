import { safeExternalUrl } from "./safe-external-url";

const GITHUB_APP_HOST = "github.com";

const GITHUB_APP_DEFAULT_PERMISSIONS = {
  actions: "read",
  administration: "read",
  checks: "read",
  contents: "read",
  deployments: "write",
  environments: "write",
  issues: "read",
  metadata: "read",
  packages: "read",
  pages: "read",
  pull_requests: "read",
  repository_hooks: "write",
  statuses: "read",
  vulnerability_alerts: "read",
  workflows: "write",
} as const;

const GITHUB_APP_DEFAULT_EVENTS = [
  "create",
  "delete",
  "deployment",
  "deployment_status",
  "fork",
  "gollum",
  "issue_comment",
  "issues",
  "label",
  "milestone",
  "member",
  "project",
  "project_card",
  "project_column",
  "public",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "release",
  "repository",
  "status",
  "watch",
  "workflow_dispatch",
  "workflow_run",
] as const;

export type GithubAppManifest = {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
    active: true;
  };
  redirect_url: string;
  setup_url: string;
  public: false;
  default_permissions: typeof GITHUB_APP_DEFAULT_PERMISSIONS;
  default_events: typeof GITHUB_APP_DEFAULT_EVENTS;
};

export function buildGithubAppManifest(input: {
  organizationId: string;
  serverUrl: string;
  state: string;
}): GithubAppManifest {
  const { organizationId, serverUrl, state } = input;
  const callback = `${serverUrl}/api/providers/github/setup`;

  return {
    name: `Upstand Deploy (${organizationId.substring(0, 6)})`,
    url: serverUrl,
    hook_attributes: {
      url: `${serverUrl}/api/webhooks/github/manifest/${encodeURIComponent(state)}`,
      active: true,
    },
    redirect_url: callback,
    setup_url: getGithubAppSetupUrl(serverUrl, state),
    public: false,
    default_permissions: GITHUB_APP_DEFAULT_PERMISSIONS,
    default_events: GITHUB_APP_DEFAULT_EVENTS,
  };
}

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
