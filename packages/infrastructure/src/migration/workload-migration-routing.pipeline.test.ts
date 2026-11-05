import { describe, expect, test } from "bun:test";
import type {
  Deployment,
  IUnitOfWork,
  Resource,
  Server,
  WorkloadMigration,
} from "@upstand/domain";
import type { DockerWorkloadMigrationPort as DockerWorkloadMigrationServicePort } from "@upstand/usecases";
import {
  ConfirmWorkloadMigrationUseCase,
  ExecuteWorkloadMigrationUseCase,
} from "@upstand/usecases";
import type { CaddyResource } from "@upstand/usecases/ports/caddy";
import type { CaddyService } from "@upstand/usecases/web-server/caddy.service";
import { DockerWorkloadMigrationPort } from "./docker-workload-migration.port";

const ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}`;
const ARTIFACT_REFERENCE = `registry.example.com/api@${ARTIFACT_DIGEST}`;

function createInMemoryMigrationUnitOfWork() {
  const now = new Date();
  const resource = {
    id: "resource-1",
    environmentId: "environment-1",
    name: "api",
    appName: "api",
    type: "application",
    status: "running",
    provider: "docker-registry",
    serverId: "local",
    domains: JSON.stringify([{ host: "api.example.com", port: 3000 }]),
    advancedConfig: "{}",
    envVars: "{}",
    credentials: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as Resource;
  const migration = {
    id: "migration-1",
    organizationId: "organization-1",
    resourceId: resource.id,
    deploymentId: "deployment-1",
    sourceServerId: "local",
    targetServerId: "server-target",
    status: "queued",
    progress: 0,
    executionToken: null,
    attempt: 0,
    cancelRequested: false,
    cleanupConfirmed: false,
    sourceRetained: true,
    checkpoint: {},
    errorCode: null,
    errorMessage: null,
    heartbeatAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as WorkloadMigration;
  const deployment = {
    id: migration.deploymentId,
    resourceId: resource.id,
    status: "queued",
    title: "migration",
    logs: "",
    createdAt: now,
    updatedAt: now,
  } as Deployment;
  const previousDeployment = {
    id: "deployment-previous",
    resourceId: resource.id,
    status: "success",
    deploymentPlan: {
      artifact: {
        reference: ARTIFACT_REFERENCE,
        digest: ARTIFACT_DIGEST,
      },
    },
  } as unknown as Deployment;
  const targetServer = {
    id: "server-target",
    organizationId: "organization-1",
    name: "Deployment server",
    status: "ready",
    serverType: "deploy",
  } as unknown as Server;

  const uow = {
    transaction: async <T>(work: (tx: IUnitOfWork) => Promise<T>) =>
      work(uow as unknown as IUnitOfWork),
    resourceRepository: {
      findById: async (id: string) => (id === resource.id ? resource : null),
      updateById: async (id: string, patch: Partial<Resource>) => {
        if (id !== resource.id) return null;
        Object.assign(resource, patch);
        return resource;
      },
      findForCaddyByDeploymentServerId: async (serverId: string) => {
        const isLocal = ["local", "manager"].includes(serverId);
        if (isLocal) {
          return resource.serverId &&
            !["local", "manager"].includes(resource.serverId)
            ? []
            : [resource];
        }
        return resource.serverId === serverId ? [resource] : [];
      },
    },
    deploymentRepository: {
      findByResourceId: async () => [previousDeployment, deployment],
      updateById: async (id: string, patch: Partial<Deployment>) => {
        if (id !== deployment.id) return null;
        Object.assign(deployment, patch);
        return deployment;
      },
    },
    serverRepository: {
      findById: async (id: string) =>
        id === targetServer.id ? targetServer : null,
    },
    webServerSettingsRepository: {
      findGlobal: async () => ({ accessLogsEnabled: true }),
    },
    certificateRepository: {
      findAll: async () => [],
    },
    workloadMigrationRepository: {
      claim: async (_id: string, executionToken: string, claimedAt: Date) => {
        if (["completed", "failed", "cancelled"].includes(migration.status)) {
          return null;
        }
        migration.executionToken = executionToken;
        migration.heartbeatAt = claimedAt;
        migration.attempt += 1;
        return migration;
      },
      findById: async (id: string) => (id === migration.id ? migration : null),
      updateOwned: async (
        id: string,
        executionToken: string,
        patch: Partial<WorkloadMigration>,
      ) => {
        if (
          id !== migration.id ||
          migration.executionToken !== executionToken
        ) {
          return null;
        }
        Object.assign(migration, patch, { updatedAt: new Date() });
        return migration;
      },
      updateById: async (id: string, patch: Partial<WorkloadMigration>) => {
        if (id !== migration.id) return null;
        Object.assign(migration, patch, { updatedAt: new Date() });
        return migration;
      },
    },
  } as unknown as IUnitOfWork;

  return { uow, resource, migration, deployment };
}

describe("workload migration routing pipeline", () => {
  test("cutover keeps the target route and cleanup removes the local source route", async () => {
    const caddySnapshots: Array<{
      serverId: string;
      resourceIds: string[];
    }> = [];
    const removedResources: Array<{ id: string; serverId?: string | null }> =
      [];
    const dockerService = {
      getServerRuntimeStats: async () => ({}),
      serviceExists: async () => false,
      sanitizeName: (name: string) => name,
      deployAppImage: async () => undefined,
      waitForServiceConvergence: async () => ({ healthy: true }),
      runPostDeploySmokeTest: async () => ({ healthy: true }),
      removeResource: async (resource: Resource) => {
        removedResources.push({ id: resource.id, serverId: resource.serverId });
      },
    };
    const caddyService = {
      syncResourceConfigs: async (resources: CaddyResource[]) => ({
        success: true as const,
        domains: [],
        changed: true,
        resources,
      }),
    } as unknown as CaddyService;
    const { uow, resource, migration, deployment } =
      createInMemoryMigrationUnitOfWork();
    const migrationPort = new DockerWorkloadMigrationPort(
      uow,
      dockerService as unknown as DockerWorkloadMigrationServicePort,
      caddyService,
      async (resolvedResource, _uow, resolvedDockerService) => ({
        dockerService: resolvedDockerService,
        caddyService: {
          syncResourceConfigs: async (resources: CaddyResource[]) => {
            caddySnapshots.push({
              serverId: resolvedResource.serverId ?? "local",
              resourceIds: resources.map(({ id }) => id),
            });
            return { success: true as const, domains: [], changed: true };
          },
        } as unknown as CaddyService,
        cleanup: () => undefined,
      }),
    );
    const executor = new ExecuteWorkloadMigrationUseCase(uow, migrationPort);
    const confirmer = new ConfirmWorkloadMigrationUseCase(uow, migrationPort);

    const cutover = await executor.execute(migration.id, "worker-1");
    const cutoverStatus = cutover.status;
    const completed = await confirmer.execute({
      organizationId: migration.organizationId,
      migrationId: migration.id,
      confirmCleanup: true,
    });

    expect(cutoverStatus).toBe("awaiting-confirmation");
    expect(completed.status).toBe("completed");
    expect(completed.cleanupConfirmed).toBe(true);
    expect(resource.serverId).toBe("server-target");
    expect(deployment.status).toBe("success");
    expect(caddySnapshots).toEqual([
      { serverId: "server-target", resourceIds: ["resource-1"] },
      { serverId: "local", resourceIds: [] },
    ]);
    expect(removedResources).toEqual([{ id: "resource-1", serverId: "local" }]);
  });
});
