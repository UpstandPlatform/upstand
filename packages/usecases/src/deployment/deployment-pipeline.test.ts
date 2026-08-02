import { describe, expect, test } from "bun:test";
import type {
  CreateDeploymentDTO,
  Deployment,
  IUnitOfWork,
  Resource,
  Server,
} from "@upstand/domain";
import { RollbackResourceUseCase } from "../resource/rollback-resource.usecase";
import {
  assertBuildServerSupportsResource,
  assertDeploymentServerSupportsResource,
} from "../server/server-role";
import { QueueDeploymentUseCase } from "./queue-deployment.usecase";
import { ReconcileStaleDeploymentsUseCase } from "./reconcile-stale-deployments.usecase";

function createDeploymentTestUow() {
  const servers = new Map<string, Server>([
    [
      "deploy-server-1",
      {
        id: "deploy-server-1",
        organizationId: "org-1",
        name: "Deploy Target Host",
        serverType: "deploy",
        authType: "ssh_key",
        sshKeyId: "key-1",
        sshHostKeyFingerprint: "fingerprint-1",
        ipAddress: "192.168.1.10",
        port: 22,
        username: "root",
        enableDockerCleanup: false,
        status: "ready",
        setupError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "build-server-1",
      {
        id: "build-server-1",
        organizationId: "org-1",
        name: "Dedicated Build Host",
        serverType: "build",
        authType: "ssh_key",
        sshKeyId: "key-2",
        sshHostKeyFingerprint: "fingerprint-2",
        ipAddress: "192.168.1.20",
        port: 22,
        username: "root",
        enableDockerCleanup: false,
        status: "ready",
        setupError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  ]);

  const projects = new Map([
    [
      "project-1",
      {
        id: "project-1",
        organizationId: "org-1",
        name: "Test Project",
        archivedAt: null,
      },
    ],
  ]);

  const environments = new Map([
    [
      "env-1",
      {
        id: "env-1",
        projectId: "project-1",
        name: "Production",
      },
    ],
  ]);

  const resources = new Map<string, Resource>([
    [
      "resource-1",
      {
        id: "resource-1",
        environmentId: "env-1",
        organizationId: "org-1",
        name: "Web Application",
        appName: "web-app",
        type: "application",
        provider: "git",
        repositoryName: "upstand/app",
        gitBranch: "main",
        credentials: JSON.stringify({
          repositoryUrl: "https://github.com/upstand/app.git",
        }),
        serverId: "deploy-server-1",
        buildServerId: "build-server-1",
        status: "running",
        imageName: "registry.upstand.internal/app:v1",
        rollbackActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Resource,
    ],
  ]);

  const deployments = new Map<string, Deployment>();
  const outbox = new Map<string, Record<string, unknown>>();
  const buildSettings = new Map<string, Record<string, unknown>>();

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
    outboxRepository: {
      create: async (data: Record<string, unknown>) => {
        outbox.set(data.id as string, data);
        return data;
      },
    },
    dockerRegistryRepository: {
      findById: async () => null,
    },
    resourceRepository: {
      findById: async (id: string) => resources.get(id) ?? null,
      updateById: async (id: string, patch: Partial<Resource>) => {
        const resource = resources.get(id);
        if (!resource) return null;
        Object.assign(resource, patch);
        return resource;
      },
    },
    deploymentRepository: {
      create: async (data: CreateDeploymentDTO) => {
        const record = data as unknown as Record<string, unknown>;
        const createdAt = (record.createdAt as Date) ?? new Date();
        const updatedAt = (record.updatedAt as Date) ?? createdAt;
        const deployment = {
          id: data.id ?? `dep-${deployments.size + 1}`,
          resourceId: data.resourceId,
          serverId: data.serverId,
          title: data.title ?? "Deployment",
          status: data.status ?? "queued",
          sourceRevision: data.sourceRevision ?? "abc1234",
          isRollback: record.isRollback ?? false,
          logs: data.logs ?? "",
          lastError: record.lastError ?? null,
          createdAt,
          updatedAt,
        } as unknown as Deployment;
        deployments.set(deployment.id, deployment);
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
      findStaleRunning: async () =>
        [...deployments.values()].filter(
          (d) => d.status === "running" || d.status === "queued",
        ),
      markStale: async (id: string, _staleBefore: Date, reason: string) => {
        const dep = deployments.get(id);
        if (!dep) return false;
        dep.status = "failed";
        dep.lastError = reason;
        return true;
      },
    },
  } as unknown as IUnitOfWork;

  return { uow, servers, resources, deployments, outbox };
}

describe("Deployment Pipeline & Server Isolation Tests", () => {
  test("validates role separation for dual-server (Build Server vs Deploy Server) deployments", async () => {
    const { uow } = createDeploymentTestUow();

    const deployServer = await uow.serverRepository.findById("deploy-server-1");
    const buildServer = await uow.serverRepository.findById("build-server-1");

    if (!deployServer || !buildServer) {
      throw new Error("Target servers missing");
    }

    expect(() =>
      assertDeploymentServerSupportsResource(deployServer, "application"),
    ).not.toThrow();
    expect(() =>
      assertBuildServerSupportsResource(buildServer, "application"),
    ).not.toThrow();

    expect(() =>
      assertDeploymentServerSupportsResource(buildServer, "application"),
    ).toThrow("cannot host deployments");
  });

  test("queues deployment successfully and creates outbox command payload", async () => {
    const { uow, deployments, outbox } = createDeploymentTestUow();

    const queueUseCase = new QueueDeploymentUseCase(uow);
    const result = await queueUseCase.execute({
      resourceId: "resource-1",
      title: "Deploying v2 release",
      sourceRevision: "fedcba9876543210",
    });

    expect(result).toBeDefined();
    expect(deployments.size).toBe(1);
    const queuedDeployment = [...deployments.values()][0];
    expect(queuedDeployment?.resourceId).toBe("resource-1");
    expect(queuedDeployment?.sourceRevision).toBe("fedcba9876543210");
    expect(queuedDeployment?.status).toBe("queued");
    expect(outbox.size).toBe(1);
  });

  test("reconciles stale deployments when a worker crashes mid-build", async () => {
    const { uow, deployments } = createDeploymentTestUow();

    const oldDate = new Date(Date.now() - 3600 * 1000 * 2); // 2 hours ago
    await uow.deploymentRepository.create({
      id: "stuck-dep-1",
      resourceId: "resource-1",
      status: "queued",
      title: "Stuck deployment",
      createdAt: oldDate,
      updatedAt: oldDate,
    } as unknown as CreateDeploymentDTO);

    const reconcileUseCase = new ReconcileStaleDeploymentsUseCase(uow);
    const result = await reconcileUseCase.execute();

    expect(result.markedStale).toBe(1);
    expect(deployments.get("stuck-dep-1")?.status).toBe("failed");
    expect(deployments.get("stuck-dep-1")?.lastError).toContain(
      "heartbeat expired",
    );
  });

  test("triggers rollback pipeline pointing back to target deployment revision", async () => {
    const { uow, deployments } = createDeploymentTestUow();

    const mockDockerService = {
      rollbackService: async () => {},
    } as never;

    const rollbackUseCase = new RollbackResourceUseCase(uow, mockDockerService);
    const rolledBackResource = await rollbackUseCase.execute({
      id: "resource-1",
    });

    expect(rolledBackResource).toBeDefined();
    expect(rolledBackResource.status).toBe("running");
    expect(deployments.size).toBe(1);
    const rollbackDep = [...deployments.values()][0];
    expect(rollbackDep?.status).toBe("success");
    expect(rollbackDep?.title).toContain("Swarm service rollback");
  });

  test("queues deployment for password-authenticated remote server with valid credentials", async () => {
    const { uow, servers, resources, deployments } = createDeploymentTestUow();

    servers.set("pwd-server-1", {
      id: "pwd-server-1",
      organizationId: "org-1",
      name: "Password Target Host",
      serverType: "deploy",
      authType: "password",
      passwordCiphertext: "encrypted-password-data",
      passwordIv: "iv-data",
      passwordAuthTag: "tag-data",
      passwordVersion: 1,
      sshHostKeyFingerprint: "fingerprint-pwd",
      ipAddress: "192.168.1.30",
      port: 22,
      username: "root",
      enableDockerCleanup: false,
      status: "ready",
      setupError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    resources.set("pwd-resource-1", {
      id: "pwd-resource-1",
      environmentId: "env-1",
      name: "Password App",
      appName: "pwd-app",
      type: "application",
      provider: "git",
      credentials: JSON.stringify({
        repositoryUrl: "https://github.com/upstand/pwd-app.git",
      }),
      serverId: "pwd-server-1",
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Resource);

    const queueUseCase = new QueueDeploymentUseCase(uow);
    const result = await queueUseCase.execute({
      resourceId: "pwd-resource-1",
      title: "Deploying to password server",
    });

    expect(result).toBeDefined();
    expect(deployments.size).toBe(1);
    const queued = [...deployments.values()][0];
    expect(queued?.serverId).toBe("pwd-server-1");
    expect(queued?.status).toBe("queued");
  });

  test("rejects deployment for password-authenticated server when password credentials are missing", async () => {
    const { uow, servers, resources } = createDeploymentTestUow();

    servers.set("pwd-server-missing", {
      id: "pwd-server-missing",
      organizationId: "org-1",
      name: "Password Target Missing Credentials",
      serverType: "deploy",
      authType: "password",
      passwordCiphertext: null,
      passwordIv: null,
      passwordAuthTag: null,
      passwordVersion: null,
      sshHostKeyFingerprint: "fingerprint-pwd",
      ipAddress: "192.168.1.31",
      port: 22,
      username: "root",
      enableDockerCleanup: false,
      status: "ready",
      setupError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    resources.set("pwd-resource-missing", {
      id: "pwd-resource-missing",
      environmentId: "env-1",
      name: "Password App Missing Credentials",
      appName: "pwd-app-missing",
      type: "application",
      provider: "git",
      credentials: JSON.stringify({
        repositoryUrl: "https://github.com/upstand/pwd-app.git",
      }),
      serverId: "pwd-server-missing",
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Resource);

    const queueUseCase = new QueueDeploymentUseCase(uow);
    await expect(
      queueUseCase.execute({
        resourceId: "pwd-resource-missing",
      }),
    ).rejects.toThrow("password credentials configured");
  });
});
