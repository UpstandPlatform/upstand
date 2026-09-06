import { mapWithConcurrency } from "../deployment/organization-resources.helper";
import type {
  DockerContainerStats,
  DockerInventoryReaderPort,
} from "../ports/docker";

export type LocalContainerSnapshot = {
  collectedAt: string;
  containers: Array<DockerContainerStats & { name: string }>;
};

/** Internal host telemetry only; no caller-controlled target or Docker operation. */
export class CollectLocalContainerMetricsUseCase {
  private pending: Promise<LocalContainerSnapshot> | undefined;
  private cached: LocalContainerSnapshot | undefined;

  constructor(
    private readonly inventory: Pick<
      DockerInventoryReaderPort,
      "listContainers" | "getContainerStats"
    >,
  ) {}

  execute(): Promise<LocalContainerSnapshot> {
    if (this.pending) return this.pending;
    if (
      this.cached &&
      Date.now() - Date.parse(this.cached.collectedAt) < 5_000
    ) {
      return Promise.resolve(this.cached);
    }
    this.pending = this.collect()
      .then((snapshot) => {
        this.cached = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async collect(): Promise<LocalContainerSnapshot> {
    const target = { kind: "local", name: "Local control plane" } as const;
    const containers = (
      await this.inventory.listContainers(target, { state: "running" })
    ).filter((container) => container.state === "running");
    // Fail visibly instead of exhausting the broker or silently truncating telemetry.
    if (containers.length > 256)
      throw new Error("Local monitoring snapshot exceeds 256 containers");
    let failed = false;
    const samples = await mapWithConcurrency(containers, async (container) => {
      try {
        const stats = await this.inventory.getContainerStats(
          target,
          container.id,
        );
        return { ...stats, name: container.name };
      } catch {
        failed = true;
        return undefined;
      }
    });
    // Drain the bounded workers before releasing single-flight protection.
    if (failed) throw new Error("Local container metrics collection failed");
    return {
      collectedAt: new Date().toISOString(),
      containers: samples.filter((sample) => sample !== undefined),
    };
  }
}
