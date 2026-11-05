import { describe, expect, test } from "bun:test";
import type {
  IUnitOfWork,
  Resource,
  Server,
  WorkloadMigration,
} from "@upstand/domain";
import type {
  DockerWorkloadMigrationPort as DockerWorkloadMigrationServicePort,
  WorkloadMigrationContext,
} from "@upstand/usecases";
import type { CaddyResource } from "@upstand/usecases/ports/caddy";
import type { CaddyService } from "@upstand/usecases/web-server/caddy.service";
import { DockerWorkloadMigrationPort } from "./docker-workload-migration.port";

function createPreflightContext(
  targetServerId: string,
): WorkloadMigrationContext {
  return {
    migration: {
      id: "mig-1",
      deploymentId: "dep-current",
      resourceId: "res-1",
      sourceServerId: "server-source",
      targetServerId,
      checkpoint: {},
    },
    resource: {
      id: "res-1",
      name: "api",
      appName: "api",
      type: "application",
      advancedConfig: null,
      envVars: null,
      credentials: null,
    },
    checkpoint: {},
    executionToken: "token-1",
    onProgress: async () => undefined,
  } as unknown as WorkloadMigrationContext;
}

function createUow(target: Server): IUnitOfWork {
  return {
    deploymentRepository: {
      findByResourceId: async () => [
        {
          id: "dep-previous",
          status: "success",
          deploymentPlan: {
            artifact: {
              reference:
                "registry.example.com/api@sha256:0000000000000000000000000000000000000000000000000000000000000000",
              digest:
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            },
          },
        },
      ],
    },
    serverRepository: {
      findById: async (id: string) => (id === target.id ? target : null),
    },
  } as unknown as IUnitOfWork;
}

describe("DockerWorkloadMigrationPort preflight", () => {
  const dockerService = {} as unknown as DockerWorkloadMigrationServicePort;
  const caddyService = {} as unknown as CaddyService;

  test("fails closed when the target server no longer accepts the workload", async () => {
    const target = {
      id: "server-database",
      organizationId: "org-1",
      name: "Database Node",
      status: "ready",
      serverType: "database",
    } as unknown as Server;

    const result = await new DockerWorkloadMigrationPort(
      createUow(target),
      dockerService,
      caddyService,
    ).preflight(createPreflightContext("server-database"));

    const roleCheck = result.checks.find(
      (check) => check.code === "target_role",
    );
    expect(roleCheck?.ok).toBe(false);
    expect(roleCheck?.message).toContain("can only host database resources");
  });

  test("passes the role check for a deploy server", async () => {
    const target = {
      id: "server-deploy",
      organizationId: "org-1",
      name: "Deploy Node",
      status: "ready",
      serverType: "deploy",
    } as unknown as Server;

    const result = await new DockerWorkloadMigrationPort(
      createUow(target),
      dockerService,
      caddyService,
    ).preflight(createPreflightContext("server-deploy"));

    expect(
      result.checks.find((check) => check.code === "target_role")?.ok,
    ).toBe(true);
  });
});

function createMigrationContext(
  status: WorkloadMigration["status"],
  resourceServerId = "server-source",
): WorkloadMigrationContext {
  const checkpoint = {
    artifactReference: `registry.example.com/api@sha256:${"0".repeat(64)}`,
    artifactDigest: `sha256:${"0".repeat(64)}`,
    shadowDeployed: true,
  };
  const migration = {
    id: "migration-1",
    deploymentId: "deployment-1",
    resourceId: "resource-1",
    sourceServerId: "server-source",
    targetServerId: "server-target",
    status,
    checkpoint,
  } as unknown as WorkloadMigration;
  const resource = {
    id: migration.resourceId,
    name: "api",
    appName: "api",
    type: "application",
    serverId: resourceServerId,
    domains: JSON.stringify([{ host: "api.example.com", port: 3000 }]),
    advancedConfig: "{}",
    envVars: null,
    credentials: null,
  } as unknown as Resource;
  return {
    migration,
    resource,
    checkpoint,
    onProgress: async () => undefined,
  } as WorkloadMigrationContext;
}

function createRoutingResource(
  id: string,
  serverId: string,
): CaddyResource & { serverId: string } {
  return {
    id,
    name: id,
    type: "application",
    appName: id,
    serverId,
    domains: JSON.stringify([{ host: `${id}.example.com`, port: 3000 }]),
    composeType: null,
    advancedConfig: "{}",
  } as CaddyResource & { serverId: string };
}

function createRoutingUnitOfWork(
  resources: (CaddyResource & { serverId: string })[],
) {
  return {
    resourceRepository: {
      findMany: async () => resources,
    },
    webServerSettingsRepository: {
      findGlobal: async () => ({ accessLogsEnabled: true }),
    },
    certificateRepository: {
      findAll: async () => [],
    },
  } as unknown as IUnitOfWork;
}

function createCaddyService(calls: CaddyResource[][]): CaddyService {
  return {
    syncResourceConfigs: async (resources: CaddyResource[]) => {
      calls.push(resources);
      return { success: true, domains: [], changed: true };
    },
  } as unknown as CaddyService;
}

function createDockerService(
  calls: Array<{ id: string; serverId: string | null | undefined }>,
): DockerWorkloadMigrationServicePort {
  return {
    removeResource: async (resource: Resource) => {
      calls.push({ id: resource.id, serverId: resource.serverId });
    },
  } as unknown as DockerWorkloadMigrationServicePort;
}

function resolveDefaultServices(
  _resource: Resource,
  _uow: IUnitOfWork,
  dockerService: DockerWorkloadMigrationServicePort,
  caddyService: CaddyService,
) {
  return Promise.resolve({
    dockerService,
    caddyService,
    cleanup: () => undefined,
  });
}

describe("DockerWorkloadMigrationPort Caddy reconciliation", () => {
  test("cutover only routes resources on the target server", async () => {
    const caddyCalls: CaddyResource[][] = [];
    const resources = [
      createRoutingResource("resource-1", "server-source"),
      createRoutingResource("source-app", "server-source"),
      createRoutingResource("target-app", "server-target"),
      createRoutingResource("other-server-app", "server-other"),
    ];
    const caddyService = createCaddyService(caddyCalls);
    const dockerService = createDockerService([]);
    const context = createMigrationContext("cutting-over");
    const port = new DockerWorkloadMigrationPort(
      createRoutingUnitOfWork(resources),
      dockerService,
      caddyService,
      resolveDefaultServices,
    );

    await port.cutover(context);

    expect(caddyCalls).toHaveLength(1);
    expect(caddyCalls[0]?.map((resource) => resource.id).sort()).toEqual([
      "resource-1",
      "target-app",
    ]);
    expect(
      caddyCalls[0]?.find((resource) => resource.id === "resource-1"),
    ).toMatchObject({ serverId: "server-target" });
  });

  test("source cleanup removes its route before removing the source service", async () => {
    const caddyCalls: CaddyResource[][] = [];
    const operations: string[] = [];
    const resources = [
      createRoutingResource("resource-1", "server-target"),
      createRoutingResource("source-app", "server-source"),
      createRoutingResource("target-app", "server-target"),
    ];
    const caddyService = {
      ...createCaddyService(caddyCalls),
      syncResourceConfigs: async (routes: CaddyResource[]) => {
        operations.push("sync-caddy");
        caddyCalls.push(routes);
        return { success: true, domains: [], changed: true };
      },
    } as unknown as CaddyService;
    const dockerService = {
      removeResource: async (resource: Resource) => {
        operations.push("remove-source");
        expect(resource.serverId).toBe("server-source");
      },
    } as unknown as DockerWorkloadMigrationServicePort;
    const context = createMigrationContext(
      "awaiting-confirmation",
      "server-target",
    );
    const port = new DockerWorkloadMigrationPort(
      createRoutingUnitOfWork(resources),
      dockerService,
      caddyService,
      resolveDefaultServices,
    );

    await port.cleanupSource(context);

    expect(operations).toEqual(["sync-caddy", "remove-source"]);
    expect(caddyCalls[0]?.map((resource) => resource.id)).toEqual([
      "source-app",
    ]);
  });

  test("rollback removes the target route before removing the shadow service", async () => {
    const caddyCalls: CaddyResource[][] = [];
    const operations: string[] = [];
    const resources = [
      createRoutingResource("resource-1", "server-target"),
      createRoutingResource("source-app", "server-source"),
      createRoutingResource("target-app", "server-target"),
    ];
    const caddyService = {
      ...createCaddyService(caddyCalls),
      syncResourceConfigs: async (routes: CaddyResource[]) => {
        operations.push("sync-caddy");
        caddyCalls.push(routes);
        return { success: true, domains: [], changed: true };
      },
    } as unknown as CaddyService;
    const dockerService = {
      removeResource: async (resource: Resource) => {
        operations.push("remove-shadow");
        expect(resource.serverId).toBe("server-target");
      },
    } as unknown as DockerWorkloadMigrationServicePort;
    const context = createMigrationContext("rolling-back", "server-target");
    const port = new DockerWorkloadMigrationPort(
      createRoutingUnitOfWork(resources),
      dockerService,
      caddyService,
      resolveDefaultServices,
    );

    await port.rollback(context);

    expect(operations).toEqual(["sync-caddy", "remove-shadow"]);
    expect(caddyCalls[0]?.map((resource) => resource.id)).toEqual([
      "target-app",
    ]);
  });

  test("cleanup does not remove a service if Caddy rejects route removal", async () => {
    const removals: string[] = [];
    const caddyService = {
      syncResourceConfigs: async () => {
        throw new Error("Caddy configuration is invalid");
      },
    } as unknown as CaddyService;
    const dockerService = {
      removeResource: async (resource: Resource) => {
        removals.push(resource.id);
      },
    } as unknown as DockerWorkloadMigrationServicePort;
    const context = createMigrationContext(
      "awaiting-confirmation",
      "server-target",
    );
    const port = new DockerWorkloadMigrationPort(
      createRoutingUnitOfWork([
        createRoutingResource("resource-1", "server-target"),
      ]),
      dockerService,
      caddyService,
      resolveDefaultServices,
    );

    await expect(port.cleanupSource(context)).rejects.toThrow(
      "Caddy configuration is invalid",
    );
    expect(removals).toEqual([]);
  });
});
