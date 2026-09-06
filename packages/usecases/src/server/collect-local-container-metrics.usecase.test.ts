import { describe, expect, test } from "bun:test";
import type { DockerContainer, DockerContainerStats } from "../ports/docker";
import { CollectLocalContainerMetricsUseCase } from "./collect-local-container-metrics.usecase";

const container = (id: string, state = "running"): DockerContainer => ({
  id,
  name: `app-${id}`,
  state,
  image: "private-image",
  status: "Up",
  ports: "",
  mounts: ["secret-mount"],
  networks: [],
  labels: ["private-label"],
  createdAt: null,
});
const stats = (id: string): DockerContainerStats => ({
  containerId: id,
  cpuPercent: 12,
  memoryUsageBytes: 20,
  memoryLimitBytes: 100,
  memoryPercent: 20,
  networkRxBytes: 1,
  networkTxBytes: 2,
  blockReadBytes: 3,
  blockWriteBytes: 4,
  pids: 1,
});

describe("local monitoring snapshot", () => {
  test("reads only running local containers, keeps all replicas, strips inventory metadata and coalesces calls", async () => {
    let reads = 0;
    const useCase = new CollectLocalContainerMetricsUseCase({
      async listContainers(target, options) {
        reads++;
        expect(target.kind).toBe("local");
        expect(options).toEqual({ state: "running" });
        return [container("1"), container("2"), container("3", "exited")];
      },
      async getContainerStats(target, id) {
        expect(target.kind).toBe("local");
        return stats(id);
      },
    });
    const [first, second] = await Promise.all([
      useCase.execute(),
      useCase.execute(),
    ]);
    expect(first).toEqual(second);
    expect(first.containers.map((sample) => sample.name)).toEqual([
      "app-1",
      "app-2",
    ]);
    expect(JSON.stringify(first)).not.toContain("secret-mount");
    expect(JSON.stringify(first)).not.toContain("private-image");
    expect(await useCase.execute()).toEqual(first);
    expect(reads).toBe(1);
  });

  test("fails collection visibly, drains pending work and retries without caching partial data", async () => {
    let fail = true;
    let completed = 0;
    const useCase = new CollectLocalContainerMetricsUseCase({
      async listContainers() {
        return [container("1"), container("2")];
      },
      async getContainerStats(_, id) {
        if (id === "1" && fail) throw new Error("daemon failure");
        await Bun.sleep(5);
        completed++;
        return stats(id);
      },
    });
    await expect(useCase.execute()).rejects.toThrow("collection failed");
    expect(completed).toBe(1);
    fail = false;
    expect((await useCase.execute()).containers).toHaveLength(2);
  });

  test("bounds collection concurrency and rejects oversized hosts without partial success", async () => {
    let active = 0;
    let maximum = 0;
    let count = 40;
    const inventory = {
      async listContainers() {
        return Array.from({ length: count }, (_, i) => container(String(i)));
      },
      async getContainerStats(_: unknown, id: string) {
        active++;
        maximum = Math.max(maximum, active);
        await Bun.sleep(1);
        active--;
        return stats(id);
      },
    };
    expect(
      (await new CollectLocalContainerMetricsUseCase(inventory).execute())
        .containers,
    ).toHaveLength(40);
    expect(maximum).toBeLessThanOrEqual(16);
    count = 257;
    await expect(
      new CollectLocalContainerMetricsUseCase(inventory).execute(),
    ).rejects.toThrow("exceeds 256");
  });
});
