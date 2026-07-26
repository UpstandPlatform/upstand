import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ProcessSourceWebhookUseCase } from "./process-source-webhook.usecase";

function resource(
  id: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    environmentId: `env-${id}`,
    name: id,
    type: "application",
    status: "idle",
    provider: "github",
    appName: id,
    credentials: JSON.stringify({
      autoDeploy: true,
      githubAccount: "provider-1",
      repository: "acme/example",
      branch: "main",
      triggerType: "On Push",
      watchPaths: ["apps/api/**"],
    }),
    buildConfig: "{}",
    advancedConfig: "{}",
    envVars: "{}",
    domains: "[]",
    serverId: null,
    buildServerId: null,
    webhookTokenHash: null,
    webhookTokenPrefix: null,
    organizationId,
    ...overrides,
  };
}

function harness() {
  const queued: string[] = [];
  const queuedInputs: Array<{ resourceId: string; sourceRevision?: string }> =
    [];
  const service = resource("api", "org-1");
  const uow = {
    gitProviderRepository: {
      findById: async () => ({
        id: "provider-1",
        organizationId: "org-1",
        provider: "github",
        config: JSON.stringify({ webhookSecret: "secret" }),
      }),
    },
    projectRepository: {
      findByOrganizationId: async () => [
        { id: "project-1", organizationId: "org-1" },
      ],
    },
    environmentRepository: {
      findByProjectId: async () => [{ id: "env-api", projectId: "project-1" }],
    },
    resourceRepository: {
      findByEnvironmentId: async () => [service],
    },
  } as never;
  const useCase = new ProcessSourceWebhookUseCase(uow, () => ({
    execute: async (input) => {
      queuedInputs.push(input);
      const { resourceId } = input;
      queued.push(resourceId);
    },
  }));
  return { useCase, queued, queuedInputs };
}

function signed(body: string) {
  return `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
}

describe("source webhook processing", () => {
  test("queues a matching push when a watched path changed", async () => {
    const { useCase, queued, queuedInputs } = harness();
    const body = JSON.stringify({
      ref: "refs/heads/main",
      after: "0123456789abcdef0123456789abcdef01234567",
      repository: { full_name: "acme/example" },
      commits: [{ modified: ["apps/api/src/index.ts"] }],
    });
    const result = await useCase.execute({
      providerId: "provider-1",
      provider: "github",
      bodyText: body,
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": signed(body),
      },
    });
    expect(result.queued).toBe(1);
    expect(queued).toEqual(["api"]);
    expect(queuedInputs[0]?.sourceRevision).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  test("rejects invalid signatures before matching resources", async () => {
    const { useCase } = harness();
    const body = JSON.stringify({
      ref: "refs/heads/main",
      repository: { full_name: "acme/example" },
    });
    await expect(
      useCase.execute({
        providerId: "provider-1",
        provider: "github",
        bodyText: body,
        headers: {
          "x-github-event": "push",
          "x-hub-signature-256": "sha256=invalid",
        },
      }),
    ).rejects.toThrow("Invalid webhook signature");
  });

  test("uses typed tag and watch-path fields when they are present", async () => {
    const queued: string[] = [];
    const service = resource("api", "org-1", {
      triggerType: "tag",
      watchPaths: JSON.stringify(["packages/api/**"]),
      credentials: JSON.stringify({
        autoDeploy: true,
        githubAccount: "provider-1",
        repository: "acme/example",
        branch: "v1.2.3",
        triggerType: "push",
        watchPaths: ["apps/old/**"],
      }),
    });
    const uow = {
      gitProviderRepository: {
        findById: async () => ({
          id: "provider-1",
          organizationId: "org-1",
          provider: "github",
          config: JSON.stringify({ webhookSecret: "secret" }),
        }),
      },
      projectRepository: {
        findByOrganizationId: async () => [
          { id: "project-1", organizationId: "org-1" },
        ],
      },
      environmentRepository: {
        findByProjectId: async () => [
          { id: "env-api", projectId: "project-1" },
        ],
      },
      resourceRepository: {
        findByEnvironmentId: async () => [service],
      },
    } as never;
    const useCase = new ProcessSourceWebhookUseCase(uow, () => ({
      execute: async ({ resourceId }) => queued.push(resourceId),
    }));
    const body = JSON.stringify({
      ref: "refs/tags/v1.2.3",
      repository: { full_name: "acme/example" },
      commits: [{ modified: ["packages/api/src/index.ts"] }],
    });

    const result = await useCase.execute({
      providerId: "provider-1",
      provider: "github",
      bodyText: body,
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": signed(body),
      },
    });

    expect(result.queued).toBe(1);
    expect(queued).toEqual(["api"]);
  });

  test("queues a Git-backed Compose resource through the provider webhook", async () => {
    const queued: string[] = [];
    const service = resource("stack", "org-1", { type: "compose" });
    const uow = {
      gitProviderRepository: {
        findById: async () => ({
          id: "provider-1",
          organizationId: "org-1",
          provider: "github",
          config: JSON.stringify({ webhookSecret: "secret" }),
        }),
      },
      projectRepository: {
        findByOrganizationId: async () => [
          { id: "project-1", organizationId: "org-1" },
        ],
      },
      environmentRepository: {
        findByProjectId: async () => [
          { id: "env-stack", projectId: "project-1" },
        ],
      },
      resourceRepository: {
        findByEnvironmentId: async () => [service],
      },
    } as never;
    const useCase = new ProcessSourceWebhookUseCase(uow, () => ({
      execute: async ({ resourceId }) => queued.push(resourceId),
    }));
    const body = JSON.stringify({
      ref: "refs/heads/main",
      repository: { full_name: "acme/example" },
      commits: [{ modified: ["apps/api/src/index.ts"] }],
    });

    const result = await useCase.execute({
      providerId: "provider-1",
      provider: "github",
      bodyText: body,
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": signed(body),
      },
    });

    expect(result.queued).toBe(1);
    expect(queued).toEqual(["stack"]);
  });

  test("matches Docker Hub image events by repository and tag", async () => {
    const queued: string[] = [];
    const service = resource("image", "org-1", {
      provider: "docker-registry",
      dockerImage: "acme/api:stable",
      credentials: JSON.stringify({
        autoDeploy: true,
        dockerImage: "acme/api:stable",
      }),
    });
    const uow = {
      gitProviderRepository: {
        findById: async () => ({
          id: "provider-1",
          organizationId: "org-1",
          provider: "dockerhub",
          config: JSON.stringify({ webhookSecret: "secret" }),
        }),
      },
      projectRepository: {
        findByOrganizationId: async () => [
          { id: "project-1", organizationId: "org-1" },
        ],
      },
      environmentRepository: {
        findByProjectId: async () => [
          { id: "env-image", projectId: "project-1" },
        ],
      },
      resourceRepository: {
        findByEnvironmentId: async () => [service],
      },
    } as never;
    const useCase = new ProcessSourceWebhookUseCase(uow, () => ({
      execute: async ({ resourceId }) => queued.push(resourceId),
    }));
    const body = JSON.stringify({
      repository: { repo_name: "acme/api" },
      push_data: { tag: "stable" },
    });
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;

    const result = await useCase.execute({
      providerId: "provider-1",
      provider: "dockerhub",
      bodyText: body,
      headers: { "x-hub-signature": signature },
    });

    expect(result.queued).toBe(1);
    expect(queued).toEqual(["image"]);
  });

  describe("tag trigger and tag pattern matching", () => {
    function tagResource(overrides: Record<string, unknown> = {}) {
      return resource("api", "org-1", {
        triggerType: "tag",
        tagPattern: null,
        credentials: JSON.stringify({
          autoDeploy: true,
          githubAccount: "provider-1",
          repository: "acme/example",
          branch: "main",
        }),
        watchPaths: "[]",
        ...overrides,
      });
    }

    function tagHarness(resourceOverrides: Record<string, unknown> = {}) {
      const queued: string[] = [];
      const svc = tagResource(resourceOverrides);
      const uow = {
        gitProviderRepository: {
          findById: async () => ({
            id: "provider-1",
            organizationId: "org-1",
            provider: "github",
            config: JSON.stringify({ webhookSecret: "secret" }),
          }),
        },
        projectRepository: {
          findByOrganizationId: async () => [
            { id: "project-1", organizationId: "org-1" },
          ],
        },
        environmentRepository: {
          findByProjectId: async () => [
            { id: "env-api", projectId: "project-1" },
          ],
        },
        resourceRepository: {
          findByEnvironmentId: async () => [svc],
        },
      } as never;
      const useCase = new ProcessSourceWebhookUseCase(uow, () => ({
        execute: async ({ resourceId }: { resourceId: string }) =>
          queued.push(resourceId),
      }));
      return { useCase, queued };
    }

    function tagEvent(ref: string) {
      const body = JSON.stringify({
        ref,
        after: "abc123",
        head_commit: { id: "abc123", message: "release", modified: [] },
        repository: { full_name: "acme/example" },
        commits: [{ id: "abc123", modified: [] }],
      });
      return {
        providerId: "provider-1",
        provider: "github" as const,
        bodyText: body,
        headers: {
          "x-github-event": "push",
          "x-hub-signature-256": signed(body),
        },
      };
    }

    test("queues deployment when tag event arrives and no pattern is set", async () => {
      const { useCase, queued } = tagHarness();
      const result = await useCase.execute(tagEvent("refs/tags/v1.0.0"));
      expect(result.queued).toBe(1);
      expect(queued).toEqual(["api"]);
    });

    test("queues deployment when tag matches the pattern", async () => {
      const { useCase, queued } = tagHarness({ tagPattern: "v*" });
      const result = await useCase.execute(tagEvent("refs/tags/v1.2.3"));
      expect(result.queued).toBe(1);
      expect(queued).toEqual(["api"]);
    });

    test("does not queue when tag does not match the pattern", async () => {
      const { useCase, queued } = tagHarness({ tagPattern: "release-*" });
      const result = await useCase.execute(tagEvent("refs/tags/v1.0.0"));
      expect(result.queued).toBe(0);
      expect(queued).toEqual([]);
    });

    test("queues when pattern with wildcard matches a longer tag", async () => {
      const { useCase, queued } = tagHarness({ tagPattern: "v1.*" });
      const result = await useCase.execute(tagEvent("refs/tags/v1.99.0"));
      expect(result.queued).toBe(1);
      expect(queued).toEqual(["api"]);
    });

    test("does not queue a push event when trigger type is tag", async () => {
      const { useCase, queued } = tagHarness();
      const body = JSON.stringify({
        ref: "refs/heads/main",
        after: "abc123",
        head_commit: {
          id: "abc123",
          message: "feat",
          modified: ["src/index.ts"],
        },
        repository: { full_name: "acme/example" },
        commits: [{ id: "abc123", modified: ["src/index.ts"] }],
      });
      const result = await useCase.execute({
        providerId: "provider-1",
        provider: "github" as const,
        bodyText: body,
        headers: {
          "x-github-event": "push",
          "x-hub-signature-256": signed(body),
        },
      });
      expect(result.queued).toBe(0);
      expect(queued).toEqual([]);
    });
  });
});
