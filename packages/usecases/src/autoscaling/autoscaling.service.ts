import type { IUnitOfWork, Resource } from "@upstand/domain";
import { parseResourceAdvancedConfig } from "@upstand/domain";
import type { CaddyServicePort } from "../ports/caddy";
import type { DockerServicePort } from "../ports/docker";
import { resolveServicesForResource } from "../resource/docker-client";
import { requestMonitoringAgent } from "../server/monitoring-agent.client";
import { parseAccessLogEntries } from "../web-server/caddy-access-logs";

type MetricRecord = Record<string, unknown>;

function numberAt(value: unknown, path: string): number | undefined {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : undefined;
}

function average(records: MetricRecord[], paths: string[]): number | undefined {
  const values = records.flatMap((record) =>
    paths
      .map((path) => numberAt(record, path))
      .filter((value): value is number => value !== undefined),
  );
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
}

export type AutoscalingDecision = {
  resourceId: string;
  currentReplicas: number;
  desiredReplicas: number;
  reason: string;
};

export class AutoscalingService {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly docker: DockerServicePort,
    private readonly lastScaledAt = new Map<string, number>(),
    private readonly caddy?: CaddyServicePort,
  ) {}

  async reconcileResource(
    resource: Resource,
  ): Promise<AutoscalingDecision | null> {
    const config = parseResourceAdvancedConfig(
      resource.advancedConfig,
    ).autoscaling;
    if (
      !config.enabled ||
      resource.type === "compose" ||
      resource.type === "database"
    )
      return null;
    const lastScaledAt = this.lastScaledAt.get(resource.id);
    if (
      lastScaledAt !== undefined &&
      Date.now() - lastScaledAt < config.cooldownSeconds * 1000
    ) {
      return null;
    }
    const services = this.caddy
      ? await resolveServicesForResource(
          resource,
          this.uow,
          this.docker,
          this.caddy,
        )
      : {
          dockerService: this.docker,
          caddyService: undefined,
          cleanup: () => {},
        };
    try {
      const current = await this.currentReplicaCount(
        resource,
        services.dockerService,
      );
      const metrics = await this.metrics(resource, services.caddyService);
      return await this.reconcileWithMetrics(
        resource,
        config,
        current,
        metrics,
        services.dockerService,
      );
    } finally {
      services.cleanup();
    }
  }

  private async reconcileWithMetrics(
    resource: Resource,
    config: ReturnType<typeof parseResourceAdvancedConfig>["autoscaling"],
    current: number,
    metrics: MetricRecord[],
    docker: DockerServicePort,
  ): Promise<AutoscalingDecision | null> {
    if (metrics.length === 0) return null;
    const cpu = average(metrics, ["CPU", "cpu"]);
    const memory = average(metrics, [
      "Memory.Percentage",
      "memoryPercent",
      "memory.percentage",
    ]);
    const requestsPerSecond = average(metrics, [
      "RequestsPerSecond",
      "requestsPerSecond",
      "requests.perSecond",
    ]);
    const custom = config.customMetric
      ? average(metrics, [config.customMetric])
      : undefined;
    const scaleUp =
      (config.targetCpuPercent !== undefined &&
        cpu !== undefined &&
        cpu > config.targetCpuPercent) ||
      (config.targetMemoryPercent !== undefined &&
        memory !== undefined &&
        memory > config.targetMemoryPercent) ||
      (config.targetRequestsPerSecond !== undefined &&
        requestsPerSecond !== undefined &&
        requestsPerSecond > config.targetRequestsPerSecond) ||
      (config.customMetricTarget !== undefined &&
        custom !== undefined &&
        custom > config.customMetricTarget);
    const scaleDown =
      !scaleUp &&
      (config.targetCpuPercent === undefined ||
        cpu === undefined ||
        cpu < config.targetCpuPercent * 0.6) &&
      (config.targetMemoryPercent === undefined ||
        memory === undefined ||
        memory < config.targetMemoryPercent * 0.6) &&
      (config.targetRequestsPerSecond === undefined ||
        requestsPerSecond === undefined ||
        requestsPerSecond < config.targetRequestsPerSecond * 0.6) &&
      (config.customMetricTarget === undefined ||
        custom === undefined ||
        custom < config.customMetricTarget * 0.6);
    let desired = current;
    if (scaleUp)
      desired = Math.min(config.maxReplicas, current + config.scaleUpStep);
    else if (scaleDown)
      desired = Math.max(config.minReplicas, current - config.scaleDownStep);
    if (desired === current) return null;
    await docker.scaleService(resource, desired);
    this.lastScaledAt.set(resource.id, Date.now());
    return {
      resourceId: resource.id,
      currentReplicas: current,
      desiredReplicas: desired,
      reason: `cpu=${cpu ?? "n/a"}, memory=${memory ?? "n/a"}, rps=${requestsPerSecond ?? "n/a"}${config.customMetric ? `, ${config.customMetric}=${custom ?? "n/a"}` : ""}`,
    };
  }

  async reconcileAll(): Promise<AutoscalingDecision[]> {
    const decisions: AutoscalingDecision[] = [];
    for (const resource of await this.uow.resourceRepository.findMany()) {
      try {
        const decision = await this.reconcileResource(resource);
        if (decision) decisions.push(decision);
      } catch {
        // A missing service or unavailable monitoring agent should not stop the
        // reconciliation loop for other resources.
      }
    }
    return decisions;
  }

  private async currentReplicaCount(
    resource: Resource,
    docker: DockerServicePort,
  ): Promise<number> {
    const containers = await docker.getContainers(resource);
    return containers.length;
  }

  private async metrics(
    resource: Resource,
    caddy?: CaddyServicePort,
  ): Promise<MetricRecord[]> {
    const result = await requestMonitoringAgent<unknown>(
      this.uow,
      resource.serverId || "local",
      "/metrics/containers",
      {
        query: new URLSearchParams({
          appName: resource.appName || resource.name,
          limit: "10",
        }),
      },
    );
    const metrics = Array.isArray(result)
      ? result.filter((value): value is MetricRecord =>
          Boolean(value && typeof value === "object"),
        )
      : [];
    if (!caddy) return metrics;
    try {
      const accessLogs = await caddy.getAccessLogs(2_000);
      const traffic = trafficMetricForResource(resource, accessLogs);
      return traffic ? [...metrics, traffic] : metrics;
    } catch {
      return metrics;
    }
  }
}

function trafficMetricForResource(
  resource: Resource,
  content: string,
): MetricRecord | null {
  let domains: unknown;
  try {
    domains = JSON.parse(resource.domains || "[]");
  } catch {
    return null;
  }
  const hosts = new Set(
    Array.isArray(domains)
      ? domains.flatMap((mapping) =>
          mapping &&
          typeof mapping === "object" &&
          typeof (mapping as Record<string, unknown>).host === "string"
            ? [(mapping as Record<string, unknown>).host as string]
            : [],
        )
      : [],
  );
  if (hosts.size === 0) return null;
  const now = Date.now();
  const windowStart = now - 60_000;
  const entries = parseAccessLogEntries(content).filter(
    (entry) =>
      hosts.has(entry.host) && Date.parse(entry.timestamp) >= windowStart,
  );
  if (entries.length === 0) return null;
  const durations = entries
    .map((entry) => entry.durationMs)
    .sort((a, b) => a - b);
  const p95Index = Math.min(
    durations.length - 1,
    Math.ceil(durations.length * 0.95) - 1,
  );
  const errors = entries.filter((entry) => entry.status >= 500).length;
  return {
    RequestsPerSecond: entries.length / 60,
    errorRate: (errors / entries.length) * 100,
    p95LatencyMs: durations[p95Index] ?? 0,
  };
}
