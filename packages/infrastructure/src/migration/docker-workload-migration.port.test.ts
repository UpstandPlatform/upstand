import { describe, expect, test } from "bun:test";
import type { IUnitOfWork, Server } from "@upstand/domain";
import type {
  DockerWorkloadMigrationPort as DockerWorkloadMigrationServicePort,
  WorkloadMigrationContext,
} from "@upstand/usecases";
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
