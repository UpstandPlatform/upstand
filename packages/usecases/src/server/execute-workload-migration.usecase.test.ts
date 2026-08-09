import { describe, expect, test } from "bun:test";
import type {
  Deployment,
  IUnitOfWork,
  Resource,
  UpdateWorkloadMigrationDTO,
  WorkloadMigration,
} from "@upstand/domain";
import type {
  WorkloadMigrationPort,
  WorkloadMigrationPreflightResult,
} from "../ports/workload-migration";
import { ExecuteWorkloadMigrationUseCase } from "./execute-workload-migration.usecase";

function createHarness(
  preflight: WorkloadMigrationPreflightResult = {
    checks: [{ code: "ready", ok: true, message: "ready" }],
  },
) {
  const now = new Date();
  const resource = {
    id: "resource-1",
    environmentId: "environment-1",
    name: "app",
    type: "application",
    provider: "docker-registry",
    status: "running",
    serverId: "server-source",
    createdAt: now,
    updatedAt: now,
  } as unknown as Resource;
  const migration: WorkloadMigration = {
    id: "migration-1",
    organizationId: "organization-1",
    resourceId: resource.id,
    deploymentId: "deployment-1",
    sourceServerId: "server-source",
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
  };
  const deployment = {
    id: "deployment-1",
    resourceId: resource.id,
    status: "queued",
    title: "migration",
    logs: "",
    createdAt: now,
    updatedAt: now,
  } as Deployment;
  const calls: string[] = [];
  const port: WorkloadMigrationPort = {
    preflight: async () => {
      calls.push("preflight");
      return preflight;
    },
    transfer: async () => {
      calls.push("transfer");
    },
    deployShadow: async () => {
      calls.push("deployShadow");
    },
    validateShadow: async () => {
      calls.push("validateShadow");
    },
    cutover: async () => {
      calls.push("cutover");
    },
    rollback: async () => {
      calls.push("rollback");
    },
    cleanupSource: async () => {
      calls.push("cleanupSource");
    },
    cleanupShadow: async () => {
      calls.push("cleanupShadow");
    },
  };
  const uow = {
    transaction: async <T>(work: (tx: IUnitOfWork) => Promise<T>) =>
      work(uow as unknown as IUnitOfWork),
    resourceRepository: {
      findById: async () => resource,
      updateById: async (_id: string, patch: Partial<Resource>) => {
        Object.assign(resource, patch);
        return resource;
      },
    },
    deploymentRepository: {
      updateById: async (_id: string, patch: Partial<Deployment>) => {
        Object.assign(deployment, patch);
        return deployment;
      },
    },
    workloadMigrationRepository: {
      findById: async () => migration,
      claim: async (_id: string, executionToken: string, claimedAt: Date) => {
        if (
          [
            "completed",
            "failed",
            "cancelled",
            "awaiting-confirmation",
          ].includes(migration.status)
        ) {
          return null;
        }
        migration.executionToken = executionToken;
        migration.heartbeatAt = claimedAt;
        migration.attempt += 1;
        return migration;
      },
      updateOwned: async (
        _id: string,
        executionToken: string,
        patch: UpdateWorkloadMigrationDTO,
      ) => {
        if (
          migration.executionToken !== executionToken &&
          migration.executionToken !== null
        ) {
          return null;
        }
        Object.assign(migration, patch, { updatedAt: new Date() });
        return migration;
      },
    },
  } as unknown as IUnitOfWork;

  return { uow, port, calls, resource, migration, deployment };
}

describe("ExecuteWorkloadMigrationUseCase", () => {
  test("runs idempotent stages and moves placement only after cutover", async () => {
    const { uow, port, calls, resource, migration, deployment } =
      createHarness();
    const result = await new ExecuteWorkloadMigrationUseCase(uow, port).execute(
      migration.id,
      "worker-1",
    );

    expect(calls).toEqual([
      "preflight",
      "transfer",
      "deployShadow",
      "validateShadow",
      "cutover",
    ]);
    expect(result.status).toBe("awaiting-confirmation");
    expect(resource.serverId).toBe("server-target");
    expect(result.sourceRetained).toBe(true);
    expect(deployment.status).toBe("success");
  });

  test("fails preflight without changing live placement", async () => {
    const { uow, port, calls, resource, migration } = createHarness({
      checks: [
        { code: "disk_capacity", ok: false, message: "insufficient space" },
      ],
    });
    const result = await new ExecuteWorkloadMigrationUseCase(uow, port).execute(
      migration.id,
      "worker-1",
    );

    expect(calls).toEqual(["preflight"]);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("PREFLIGHT_FAILED");
    expect(resource.serverId).toBe("server-source");
  });

  test("returns an awaiting-confirmation migration without replaying cutover", async () => {
    const { uow, port, calls, migration } = createHarness();
    migration.status = "awaiting-confirmation";
    const result = await new ExecuteWorkloadMigrationUseCase(uow, port).execute(
      migration.id,
      "worker-2",
    );
    expect(result.status).toBe("awaiting-confirmation");
    expect(calls).toEqual([]);
  });
});
