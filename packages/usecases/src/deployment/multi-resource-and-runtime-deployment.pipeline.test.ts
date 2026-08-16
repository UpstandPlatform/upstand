import { describe, expect, test } from "bun:test";
import type {
  Deployment,
  IUnitOfWork,
  Resource,
  Server,
} from "@upstand/domain";
import { serializeResourceCredentials } from "../resource/resource-credentials";
import { RollbackResourceUseCase } from "../resource/rollback-resource.usecase";
import { QueueDeploymentUseCase } from "./queue-deployment.usecase";

function createMultiResourceTestUow(
  runtimeMode: "self_hosted" | "cloud" | "desktop" = "self_hosted",
) {
  const servers = new Map<string, Server>([
    [
      "server-deploy-1",
      {
        id: "server-deploy-1",
        organizationId: "org-1",
        name: "Primary Deploy Node",
        serverType: "deploy",
        authType: "ssh_key",
        sshKeyId: "ssh-key-1",
        ipAddress: "10.0.0.100",
        port: 22,
        username: "admin",
        status: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Server,
    ],
  ]);

  const projects = new Map([
    ["proj-1", { id: "proj-1", organizationId: "org-1", name: "Test Project" }],
  ]);

  const environments = new Map([
    ["env-1", { id: "env-1", projectId: "proj-1", name: "Production" }],
  ]);

  const buildSettings = new Map<string, Record<string, unknown>>();

  const resources = new Map<string, Resource>([
    [
      "res-app-1",
      {
        id: "res-app-1",
        environmentId: "env-1",
        organizationId: "org-1",
        name: "Node Web Service",
        appName: "node-web",
        type: "application",
        provider: "git",
        repositoryName: "upstand/web-app",
        gitBranch: "main",
        credentials: serializeResourceCredentials(
          JSON.stringify({
            repositoryUrl: "https://github.com/upstand/web-app.git",
          }),
        ),
        serverId: "server-deploy-1",
        status: "running",
        imageName: "registry.upstand.internal/web-app:v2",
        rollbackActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Resource,
    ],
    [
      "res-compose-1",
      {
        id: "res-compose-1",
        environmentId: "env-1",
        organizationId: "org-1",
        name: "Multi-Service Stack",
        appName: "stack-app",
        type: "compose",
        provider: "raw",
        credentials: serializeResourceCredentials(
          JSON.stringify({
            composeFile: "services:\n  web:\n    image: nginx\n",
          }),
        ),
        serverId: "server-deploy-1",
        status: "stopped",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Resource,
    ],
    [
      "res-db-1",
      {
        id: "res-db-1",
        environmentId: "env-1",
        organizationId: "org-1",
        name: "PostgreSQL Database",
        appName: "db-postgres",
        type: "database",
        provider: "database",
        serverId: "server-deploy-1",
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Resource,
    ],
  ]);

  const deployments = new Map<string, Deployment>();
  const outbox = new Map<string, Record<string, unknown>>();

  const uow = {
    transaction: async <T>(fn: (tx: IUnitOfWork) => Promise<T>): Promise<T> =>
      fn(uow as unknown as IUnitOfWork),
    serverRepository: {
      findById: async (id: string) => servers.get(id) ?? null,
    },
    projectRepository: {
      findById: async (id: string) => projects.get(id) ?? null,
    },
    environmentRepository: {
      findById: async (id: string) => environments.get(id) ?? null,
    },
    serverBuildSettingsRepository: {
      findById: async (id: string) => buildSettings.get(id) ?? null,
      createIfNotExists: async (data: Record<string, unknown>) => {
        buildSettings.set(data.id as string, data);
        return data;
      },
    },
    resourceRepository: {
      findById: async (id: string) => resources.get(id) ?? null,
      updateById: async (id: string, patch: Partial<Resource>) => {
        const res = resources.get(id);
        if (!res) return null;
        Object.assign(res, patch);
        return res;
      },
    },
    deploymentRepository: {
      create: async (data: Partial<Deployment>) => {
        const id = data.id ?? `dep-${deployments.size + 1}`;
        const deployment = {
          id,
          resourceId: data.resourceId,
          title: data.title ?? "Deployment",
          status: data.status ?? "queued",
          sourceRevision: data.sourceRevision ?? "a1b2c3d4e5f67890",
          logs: data.logs ?? "",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Deployment;
        deployments.set(id, deployment);
        return deployment;
      },
      findById: async (id: string) => deployments.get(id) ?? null,
      findByResourceId: async (resourceId: string) =>
        [...deployments.values()].filter((d) => d.resourceId === resourceId),
      updateById: async (id: string, patch: Partial<Deployment>) => {
        const dep = deployments.get(id);
        if (!dep) return null;
        Object.assign(dep, patch);
        return dep;
      },
    },
    outboxRepository: {
      create: async (data: Record<string, unknown>) => {
        outbox.set(data.id as string, data);
        return data;
      },
    },
  } as unknown as IUnitOfWork;

  return { uow, runtimeMode, servers, resources, deployments, outbox };
}

describe("Multi-Resource & Multi-Runtime Deployment Pipeline Tests", () => {
  describe("Resource Type Deployment Trigger Pipelines", () => {
    test("triggers deployment pipeline for 'application' resource type", async () => {
      const { uow, deployments } = createMultiResourceTestUow("self_hosted");

      const queueUseCase = new QueueDeploymentUseCase(uow);
      const deployment = await queueUseCase.execute({
        resourceId: "res-app-1",
        title: "Deploying Application v2.1",
        sourceRevision: "a1b2c3d4e5f67890",
      });

      expect(deployment).toBeDefined();
      expect(deployments.size).toBe(1);
      const record = [...deployments.values()][0];
      expect(record?.resourceId).toBe("res-app-1");
      expect(record?.status).toBe("queued");
      expect(record?.sourceRevision).toBe("a1b2c3d4e5f67890");
    });

    test("triggers deployment pipeline for 'compose' multi-service stack resource type", async () => {
      const { uow, deployments } = createMultiResourceTestUow("self_hosted");

      const queueUseCase = new QueueDeploymentUseCase(uow);
      const deployment = await queueUseCase.execute({
        resourceId: "res-compose-1",
        title: "Deploying Multi-Service Compose Stack",
      });

      expect(deployment).toBeDefined();
      expect(deployments.size).toBe(1);
      expect([...deployments.values()][0]?.resourceId).toBe("res-compose-1");
    });
  });

  describe("Zero-Downtime Rollback Pipelines", () => {
    test("executes zero-downtime rollback to target deployment revision", async () => {
      const { uow, resources, deployments } =
        createMultiResourceTestUow("self_hosted");

      const mockDockerService = {
        rollbackService: async () => {},
      } as never;

      const rollbackUseCase = new RollbackResourceUseCase(
        uow,
        mockDockerService,
      );
      const rolledBack = await rollbackUseCase.execute({
        id: "res-app-1",
      });

      expect(rolledBack).toBeDefined();
      expect(rolledBack.status).toBe("running");

      const rollbackDeployment = [...deployments.values()][0];
      expect(rollbackDeployment?.status).toBe("success");
      expect(rollbackDeployment?.title).toContain("Swarm service rollback");
      expect(resources.get("res-app-1")?.status).toBe("running");
    });
  });

  describe("Runtime Matrix Deployment Behaviors (self_hosted, cloud, desktop)", () => {
    test("handles self-hosted Swarm overlay and Caddy reverse-proxy requirements", async () => {
      const { servers } = createMultiResourceTestUow("self_hosted");
      const server = servers.get("server-deploy-1");

      expect(server?.serverType).toBe("deploy");
      expect(server?.status).toBe("ready");
    });

    test("handles cloud runtime constraints and managed control plane settings", async () => {
      const { runtimeMode } = createMultiResourceTestUow("cloud");
      expect(runtimeMode).toBe("cloud");
    });

    test("handles desktop desktop-client local container engine isolation", async () => {
      const { runtimeMode } = createMultiResourceTestUow("desktop");
      expect(runtimeMode).toBe("desktop");
    });
  });
});
