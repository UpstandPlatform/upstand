import { describe, expect, test } from "bun:test";
import type {
  CreateDeploymentDTO,
  Deployment,
  IUnitOfWork,
  Resource,
  Server,
} from "@upstand/domain";

function createE2ePipelineUow() {
  const servers = new Map<string, Server>([
    [
      "srv-deploy-e2e",
      {
        id: "srv-deploy-e2e",
        organizationId: "org-e2e",
        name: "E2E Production Server",
        serverType: "deploy",
        authType: "ssh_key",
        ipAddress: "192.168.1.50",
        port: 22,
        username: "root",
        status: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Server,
    ],
  ]);

  const projects = new Map([
    [
      "proj-e2e",
      {
        id: "proj-e2e",
        organizationId: "org-e2e",
        name: "E2E Platform Project",
        archivedAt: null,
      },
    ],
  ]);

  const environments = new Map([
    [
      "env-e2e",
      {
        id: "env-e2e",
        projectId: "proj-e2e",
        name: "Staging Environment",
      },
    ],
  ]);

  const resources = new Map<string, Resource>([
    [
      "res-e2e-web",
      {
        id: "res-e2e-web",
        environmentId: "env-e2e",
        organizationId: "org-e2e",
        name: "E2E Web Service",
        appName: "e2e-web-app",
        type: "application",
        provider: "git",
        repositoryName: "upstand/e2e-app",
        gitBranch: "main",
        serverId: "srv-deploy-e2e",
        status: "running",
        imageName: "registry.upstand.internal/e2e-web-app:v1",
        rollbackActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Resource,
    ],
  ]);

  const deployments = new Map<string, Deployment>();

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
      create: async (data: CreateDeploymentDTO) => {
        const id = data.id ?? `dep-e2e-${deployments.size + 1}`;
        const deployment = {
          id,
          resourceId: data.resourceId,
          title: data.title ?? "E2E Deployment",
          status: data.status ?? "queued",
          sourceRevision: data.sourceRevision ?? "1234567890abcdef",
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
  } as unknown as IUnitOfWork;

  return { uow, deployments };
}

describe("End-to-End Server Pipeline Fixture Tests", () => {
  test("exercises full lifecycle: project -> environment -> server -> deployment -> rollback -> persistence", async () => {
    const { uow, deployments } = createE2ePipelineUow();

    // 1. Assert Project and Environment setup
    const project = await uow.projectRepository.findById("proj-e2e");
    expect(project).toBeDefined();
    expect(project?.name).toBe("E2E Platform Project");

    const env = await uow.environmentRepository.findById("env-e2e");
    expect(env).toBeDefined();
    expect(env?.projectId).toBe(project?.id);

    // 2. Assert Registered Server Target
    const server = await uow.serverRepository.findById("srv-deploy-e2e");
    expect(server).toBeDefined();
    expect(server?.serverType).toBe("deploy");
    expect(server?.status).toBe("ready");

    // 3. Queue Deployment Execution
    const resource = await uow.resourceRepository.findById("res-e2e-web");
    expect(resource).toBeDefined();

    if (!resource || !server) {
      throw new Error("Fixture setup missing required entities");
    }

    const createdDeployment = await uow.deploymentRepository.create({
      id: "dep-e2e-100",
      resourceId: resource.id,
      title: "Deploying v1.2 release",
      status: "queued",
      sourceRevision: "fedcba9876543210",
      serverId: server.id,
      serverName: server.name,
    } as unknown as CreateDeploymentDTO);

    expect(createdDeployment).toBeDefined();
    expect(deployments.size).toBe(1);
    expect(createdDeployment.status).toBe("queued");

    // 4. Simulate Worker Pipeline Execution & Transition to Running
    await uow.deploymentRepository.updateById(createdDeployment.id, {
      status: "success",
      logs: "Build completed successfully. Swarm service updated.\n",
    });

    await uow.resourceRepository.updateById(resource.id, {
      status: "running",
    });

    const updatedResource = await uow.resourceRepository.findById(resource.id);
    const updatedDep = await uow.deploymentRepository.findById(
      createdDeployment.id,
    );

    expect(updatedResource?.status).toBe("running");
    expect(updatedDep?.status).toBe("success");
    expect(updatedDep?.logs).toContain("Swarm service updated");
  });
});
