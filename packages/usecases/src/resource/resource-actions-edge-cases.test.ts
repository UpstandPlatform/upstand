import { describe, expect, test } from "bun:test";
import { ValidationError } from "@upstand/domain";
import { CreateResourceUseCase } from "./create-resource.usecase";
import { DeleteResourceUseCase } from "./delete-resource.usecase";
import { RebuildDatabaseUseCase } from "./rebuild-database.usecase";
import { RotateResourceWebhookTokenUseCase } from "./rotate-resource-webhook-token.usecase";
import { UpdateResourceUseCase } from "./update-resource.usecase";
import { generateWebhookToken, hashWebhookToken } from "./webhook-token";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

interface TestRecord {
  id: string;
  projectId?: string;
  organizationId?: string;
  name?: string;
  appName?: string;
  type?: string;
  environmentId?: string;
  resourceCount?: number;
  [key: string]: unknown;
}

function createMockStoreUow() {
  const store = {
    environments: [] as TestRecord[],
    projects: [] as TestRecord[],
    resources: [] as TestRecord[],
    servers: [] as TestRecord[],
    deployments: [] as TestRecord[],
  };

  const environmentRepository = {
    store: store.environments,
    async findById(id: string) {
      return store.environments.find((e) => e.id === id) || null;
    },
    async incrementResourceCount(id: string, delta: number) {
      const e = store.environments.find((item) => item.id === id);
      if (e) e.resourceCount = Math.max(0, (e.resourceCount || 0) + delta);
    },
  };

  const projectRepository = {
    store: store.projects,
    async findById(id: string) {
      return store.projects.find((p) => p.id === id) || null;
    },
  };

  const serverRepository = {
    store: store.servers,
    async findById(id: string) {
      return store.servers.find((s) => s.id === id) || null;
    },
  };

  const certificateRepository = {
    async findAll() {
      return [];
    },
  };

  const resourceRepository = {
    store: store.resources,
    async create(data: TestRecord) {
      const created = { ...data, createdAt: new Date(), updatedAt: new Date() };
      store.resources.push(created);
      return { ...created };
    },
    async findById(id: string) {
      const r = store.resources.find((item) => item.id === id);
      return r ? { ...r } : null;
    },
    async checkDuplicateServiceKey(appName?: string, excludeId?: string) {
      if (!appName) return null;
      const key = appName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
      const dup = store.resources.find(
        (r) =>
          r.id !== excludeId &&
          (r.appName ?? "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "-") === key,
      );
      return dup ? { ...dup } : null;
    },
    async updateById(id: string, patch: Partial<TestRecord>) {
      const r = store.resources.find((item) => item.id === id);
      if (r) {
        Object.assign(r, patch);
        return { ...r };
      }
      return null;
    },
    async deleteById(id: string) {
      const idx = store.resources.findIndex((item) => item.id === id);
      if (idx > -1) {
        store.resources.splice(idx, 1);
        return true;
      }
      return false;
    },
  };

  const deploymentRepository = {
    store: store.deployments,
    async create(data: TestRecord) {
      const d = { ...data, createdAt: new Date() };
      store.deployments.push(d);
      return { ...d };
    },
    async updateById(id: string, patch: Partial<TestRecord>) {
      const d = store.deployments.find((item) => item.id === id);
      if (d) Object.assign(d, patch);
      return d ? { ...d } : null;
    },
  };

  const uow = {
    environmentRepository,
    projectRepository,
    serverRepository,
    certificateRepository,
    resourceRepository,
    deploymentRepository,
    transaction: async (fn: (unitOfWork: never) => Promise<unknown>) =>
      fn(uow as never),
    store,
  };

  return uow;
}

describe("Resource Actions Exhaustive Edge-Case Suite", () => {
  describe("Webhook Token Generation & Verification", () => {
    test("generates webhook tokens with 'upw_' prefix and 12-char display prefix", () => {
      const generated = generateWebhookToken();
      expect(generated.token).toStartWith("upw_");
      expect(generated.prefix.length).toBe(12);
      expect(generated.prefix).toBe(generated.token.slice(0, 12));
      expect(generated.hash).toBe(hashWebhookToken(generated.token));
    });

    test("SHA-256 webhook token hash is deterministic", () => {
      const token = "upw_sample_token_1234567890";
      const hash1 = hashWebhookToken(token);
      const hash2 = hashWebhookToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe("CreateResourceUseCase Edge Cases", () => {
    test("rejects resource creation if environment does not exist", async () => {
      const uow = createMockStoreUow();
      const useCase = new CreateResourceUseCase(uow as never);

      expect(
        useCase.execute({
          environmentId: "non-existent-env",
          name: "My App",
          type: "application",
          appName: "my-app",
        }),
      ).rejects.toThrow(ValidationError);
    });

    test("rejects duplicate app name across resources in the organization", async () => {
      const uow = createMockStoreUow();
      const envId = "env-1";
      uow.store.environments.push({ id: envId, projectId: "proj-1" });
      uow.store.resources.push({
        id: "res-1",
        name: "Existing App",
        appName: "existing-app",
      });

      const useCase = new CreateResourceUseCase(uow as never);

      expect(
        useCase.execute({
          environmentId: envId,
          name: "Existing App",
          appName: "existing-app",
          type: "application",
        }),
      ).rejects.toThrow(/is already used by resource/i);
    });
  });

  describe("UpdateResourceUseCase Edge Cases", () => {
    test("rejects updating app name to an existing duplicate app name", async () => {
      const uow = createMockStoreUow();
      uow.store.resources.push({
        id: "res-1",
        name: "App One",
        appName: "app-one",
      });
      uow.store.resources.push({
        id: "res-2",
        name: "App Two",
        appName: "app-two",
      });

      const useCase = new UpdateResourceUseCase(uow as never, null as never);

      expect(
        useCase.execute({
          id: "res-2",
          appName: "app-one",
        }),
      ).rejects.toThrow(/is already used by resource/i);
    });

    test("rejects changing external port on non-database application resources", async () => {
      const uow = createMockStoreUow();
      uow.store.resources.push({
        id: "res-app-1",
        name: "App One",
        type: "application",
        environmentId: "env-1",
      });

      const useCase = new UpdateResourceUseCase(uow as never, null as never);

      expect(
        useCase.execute({
          id: "res-app-1",
          externalPort: 5432,
        }),
      ).rejects.toThrow(
        /External port can only be changed on database resources/i,
      );
    });

    test("allows configuring a Docker image on application resources", async () => {
      const uow = createMockStoreUow();
      uow.store.resources.push({
        id: "res-docker-app",
        name: "Docker App",
        type: "application",
        environmentId: "env-1",
      });

      const useCase = new UpdateResourceUseCase(uow as never, null as never);
      const updated = await useCase.execute({
        id: "res-docker-app",
        dockerImage: "nginx:alpine",
      });

      expect(updated?.dockerImage).toBe("nginx:alpine");
    });

    test("rejects enabling rollback without selecting a Docker registry", async () => {
      const uow = createMockStoreUow();
      uow.store.resources.push({
        id: "res-app-2",
        name: "App Two",
        type: "application",
        environmentId: "env-1",
      });
      uow.store.environments.push({ id: "env-1", projectId: "proj-1" });
      uow.store.projects.push({ id: "proj-1", organizationId: "org-1" });

      const useCase = new UpdateResourceUseCase(uow as never, null as never);

      expect(
        useCase.execute({
          id: "res-app-2",
          rollbackActive: true,
        }),
      ).rejects.toThrow(
        /A Docker registry must be selected to enable rollbacks/i,
      );
    });
  });

  describe("DeleteResourceUseCase Edge Cases", () => {
    test("rejects deleting non-existent resource", async () => {
      const uow = createMockStoreUow();
      const mockCaddyService = { syncRouting: async () => {} };
      const mockDockerService = {
        controlService: async () => {},
        getContainers: async () => [],
      };

      const useCase = new DeleteResourceUseCase(
        uow as never,
        mockCaddyService as never,
        mockDockerService as never,
      );

      expect(useCase.execute({ id: "missing-resource-id" })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("RebuildDatabaseUseCase Edge Cases", () => {
    test("rejects rebuilding non-database resources", async () => {
      const uow = createMockStoreUow();
      uow.store.resources.push({
        id: "app-resource-id",
        name: "Node Web App",
        type: "application",
      });

      const useCase = new RebuildDatabaseUseCase(uow as never, {} as never);

      expect(
        useCase.execute({ id: "app-resource-id", confirm: true }),
      ).rejects.toThrow(/Only database resources can be rebuilt/i);
    });
  });

  describe("RotateResourceWebhookTokenUseCase Edge Cases", () => {
    test("rotates webhook token and updates database hash and prefix", async () => {
      const uow = createMockStoreUow();
      uow.store.resources.push({
        id: "res-wh-1",
        name: "App With Webhook",
        webhookTokenHash: "old-hash",
        webhookTokenPrefix: "old-prefix",
      });

      const useCase = new RotateResourceWebhookTokenUseCase(uow as never);
      const result = await useCase.execute({ id: "res-wh-1" });

      expect(result.token).toStartWith("upw_");
      expect(result.prefix.length).toBe(12);

      const updated = await uow.resourceRepository.findById("res-wh-1");
      expect(updated?.webhookTokenHash).toBe(hashWebhookToken(result.token));
      expect(updated?.webhookTokenPrefix).toBe(result.prefix);
    });
  });
});
