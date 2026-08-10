import { describe, expect, test } from "bun:test";
import type { GitProvider } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import type { GitHubDiagnosticsPort } from "./github-diagnostics.port";
import { RunGitHubDiagnosticsUseCase } from "./run-github-diagnostics.usecase";

const provider: GitProvider = {
  id: "provider-1",
  organizationId: "organization-1",
  name: "GitHub",
  provider: "github",
  config: JSON.stringify({
    personalAccessToken: "must-never-be-returned",
    githubWebhookSecret: "must-never-be-returned-either",
  }),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const diagnostics: GitHubDiagnosticsPort = {
  inspect: async () => ({
    repository: {
      fullName: "upstand/app",
      defaultBranch: "main",
      cloneProtocol: "https",
      permissions: { pull: true, push: false, admin: false },
    },
    ref: { name: "main", sha: "a".repeat(40) },
    webhook: { configured: true, active: true, host: "upstand.example" },
    rateLimit: { remaining: 4_999, resetAt: null },
  }),
};

function useCase(replayReady = true) {
  return new RunGitHubDiagnosticsUseCase(
    mockUnitOfWork({
      gitProviderRepository: { findById: async () => provider },
    }),
    diagnostics,
    async () => replayReady,
  );
}

describe("RunGitHubDiagnosticsUseCase", () => {
  test("returns actionable redacted checks for a healthy provider", async () => {
    const result = await useCase().execute({
      organizationId: "organization-1",
      gitProviderId: provider.id,
      repository: "upstand/app",
    });

    expect(result.ready).toBe(true);
    expect(result.checks.map((item) => item.code)).toContain(
      "GH_WEBHOOK_REPLAY_PROTECTION_READY",
    );
    expect(JSON.stringify(result)).not.toContain("must-never-be-returned");
  });

  test("fails closed when webhook replay protection is unavailable", async () => {
    const result = await useCase(false).execute({
      organizationId: "organization-1",
      gitProviderId: provider.id,
      repository: "upstand/app",
      ref: "main",
    });

    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "GH_WEBHOOK_REPLAY_STORE_UNAVAILABLE",
        status: "fail",
      }),
    );
  });
});
