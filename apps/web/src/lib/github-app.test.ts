import { describe, expect, test } from "bun:test";
import {
  getGithubAppInstallationUrl,
  getGithubAppManifestCreationUrl,
  getGithubAppSetupUrl,
} from "./github-app";

describe("GitHub App URLs", () => {
  test("keeps manifest state in the GitHub registration URL", () => {
    expect(getGithubAppManifestCreationUrl("acme", "state-token")).toBe(
      "https://github.com/organizations/acme/settings/apps/new?state=state-token",
    );
  });

  test("keeps manifest state in the post-install setup URL", () => {
    expect(getGithubAppSetupUrl("https://api.upstand.dev", "state-token")).toBe(
      "https://api.upstand.dev/api/providers/github/setup?state=state-token",
    );
  });

  test("builds the installation URL from the persisted app slug", () => {
    expect(
      getGithubAppInstallationUrl({ githubAppSlug: "upstand-deploy" }),
    ).toBe("https://github.com/apps/upstand-deploy/installations/new");
  });

  test("supports existing providers persisted with the GitHub app URL", () => {
    expect(
      getGithubAppInstallationUrl({
        githubAppName: "https://github.com/apps/upstand-deploy",
      }),
    ).toBe("https://github.com/apps/upstand-deploy/installations/new");
  });

  test("rejects non-GitHub app URLs", () => {
    expect(
      getGithubAppInstallationUrl({
        githubAppName: "https://evil.example/apps/upstand-deploy",
      }),
    ).toBeUndefined();
  });
});
