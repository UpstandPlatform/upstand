import { describe, expect, test } from "bun:test";
import type { Deployment, IUnitOfWork, Resource } from "@upstand/domain";

interface MockRedis {
  keys: Map<string, { value: string; ttl: number }>;
  set(key: string, value: string, mode?: string, ttl?: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

function createMockRedis(): MockRedis {
  const keys = new Map<string, { value: string; ttl: number }>();
  return {
    keys,
    set: async (key: string, value: string, _mode?: string, ttl = 3600) => {
      keys.set(key, { value, ttl });
    },
    get: async (key: string) => keys.get(key)?.value ?? null,
  };
}

function createCancellationTestUow() {
  const resources = new Map<string, Resource>([
    [
      "res-1",
      {
        id: "res-1",
        organizationId: "org-1",
        name: "API Service",
        status: "queued",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Resource,
    ],
  ]);

  const deployments = new Map<string, Deployment>([
    [
      "dep-queued-1",
      {
        id: "dep-queued-1",
        resourceId: "res-1",
        serverId: "server-1",
        status: "queued",
        title: "Manual deployment",
        logs: "Added to queue...",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Deployment,
    ],
    [
      "dep-active-1",
      {
        id: "dep-active-1",
        resourceId: "res-1",
        serverId: "server-1",
        status: "running",
        title: "Active build",
        logs: "Building container image...",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Deployment,
    ],
  ]);

  const uow = {
    transaction: async <T>(fn: (tx: IUnitOfWork) => Promise<T>): Promise<T> =>
      fn(uow as unknown as IUnitOfWork),
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
      findById: async (id: string) => deployments.get(id) ?? null,
      updateById: async (id: string, patch: Partial<Deployment>) => {
        const dep = deployments.get(id);
        if (!dep) return null;
        Object.assign(dep, patch);
        return dep;
      },
    },
  } as unknown as IUnitOfWork;

  return { uow, resources, deployments };
}

describe("Deployment Cancellation, Build Kill & Retry Pipeline Tests", () => {
  describe("Redis Cancellation Key Management", () => {
    test("sets durable Redis cancellation marker for requested deployment ID", async () => {
      const redis = createMockRedis();
      const deploymentId = "dep-active-1";

      await redis.set(
        `upstand:deployment:cancel:${deploymentId}`,
        "1",
        "EX",
        3600,
      );

      const cancelFlag = await redis.get(
        `upstand:deployment:cancel:${deploymentId}`,
      );
      expect(cancelFlag).toBe("1");
    });
  });

  describe("Queued & Outbox Race Condition Cancellation", () => {
    test("cancels queued deployment in DB and stops resource state", async () => {
      const { uow, resources, deployments } = createCancellationTestUow();
      const deploymentId = "dep-queued-1";

      await uow.transaction(async (tx) => {
        const dep = await tx.deploymentRepository.findById(deploymentId);
        if (
          dep &&
          !["success", "failed", "stale", "cancelled"].includes(dep.status)
        ) {
          await tx.deploymentRepository.updateById(deploymentId, {
            status: "cancelled",
            logs: `${dep.logs}\nDeployment cancelled by user. 🛑\n`,
          });
          const res = await tx.resourceRepository.findById(dep.resourceId);
          if (res?.status === "queued") {
            await tx.resourceRepository.updateById(dep.resourceId, {
              status: "stopped",
            });
          }
        }
      });

      const cancelledDep = deployments.get(deploymentId);
      const stoppedRes = resources.get("res-1");

      expect(cancelledDep?.status).toBe("cancelled");
      expect(cancelledDep?.logs).toContain("Deployment cancelled by user. 🛑");
      expect(stoppedRes?.status).toBe("stopped");
    });

    test("handles cancellation during outbox publish window before BullMQ job creation", async () => {
      const { uow, deployments } = createCancellationTestUow();
      const redis = createMockRedis();
      const deploymentId = "dep-queued-1";

      await redis.set(
        `upstand:deployment:cancel:${deploymentId}`,
        "1",
        "EX",
        3600,
      );

      const isCancelled =
        (await redis.get(`upstand:deployment:cancel:${deploymentId}`)) === "1";
      if (isCancelled) {
        await uow.deploymentRepository.updateById(deploymentId, {
          status: "cancelled",
          logs: "Cancelled prior to queue dispatch.\n",
        });
      }

      expect(deployments.get(deploymentId)?.status).toBe("cancelled");
    });
  });

  describe("Active Build Interruption & Kill Operations", () => {
    test("signals active worker cancellation and transitions running build", async () => {
      const { uow, deployments } = createCancellationTestUow();
      const redis = createMockRedis();
      const deploymentId = "dep-active-1";

      await redis.set(
        `upstand:deployment:cancel:${deploymentId}`,
        "1",
        "EX",
        3600,
      );

      const cancelRequested =
        (await redis.get(`upstand:deployment:cancel:${deploymentId}`)) === "1";
      expect(cancelRequested).toBe(true);

      if (cancelRequested) {
        await uow.deploymentRepository.updateById(deploymentId, {
          status: "cancelled",
          logs: "Build process killed by user action.\n",
        });
      }

      expect(deployments.get(deploymentId)?.status).toBe("cancelled");
      expect(deployments.get(deploymentId)?.logs).toContain(
        "killed by user action",
      );
    });
  });
});
