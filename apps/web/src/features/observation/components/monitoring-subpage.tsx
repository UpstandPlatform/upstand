"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageSkeleton } from "@/components/dashboard/page-skeleton";
import { type Activity, Database } from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

type RangeKey = "1h" | "6h" | "24h" | "7d";

type MetricRecord = {
  timestamp: string;
  cpu: string | number;
  memUsed: string | number;
  memTotal: string | number;
  diskUsed: string | number;
  totalDisk: string | number;
  networkIn: string | number;
  networkOut: string | number;
  uptime: number;
  cpuModel: string;
  os: string;
  kernel: string;
  arch: string;
};

type ContainerMetricRecord = {
  timestamp: string;
  CPU: number;
  Memory: {
    percentage: number;
    used: number;
    total: number;
    usedUnit: string;
    totalUnit: string;
  };
  Network: {
    input: number;
    output: number;
    inputUnit: string;
    outputUnit: string;
  };
  BlockIO: { read: number; write: number; readUnit: string; writeUnit: string };
  ID: string;
  Name: string;
};

type ChartPoint = {
  timestamp: string;
  label: string;
  cpu: number;
  memory: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  uptime: number;
  os: string;
  kernel: string;
  arch: string;
  cpuModel: string;
};

const RANGE_OPTIONS: Array<{
  value: RangeKey;
  label: string;
  milliseconds: number;
}> = [
  { value: "1h", label: "Last hour", milliseconds: 60 * 60_000 },
  { value: "6h", label: "Last 6 hours", milliseconds: 6 * 60 * 60_000 },
  { value: "24h", label: "Last 24 hours", milliseconds: 24 * 60 * 60_000 },
  { value: "7d", label: "Last 7 days", milliseconds: 7 * 24 * 60 * 60_000 },
];

const numberValue = (value: string | number | null | undefined) => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** exponent)} ${units[exponent]}`;
};

const formatUptime = (seconds: number) => {
  if (!seconds) return "Unknown";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
};

function MonitoringChart({
  data,
  dataKeys,
  description,
  title,
  yAxisUnit = "%",
}: {
  data: ChartPoint[];
  dataKeys: Array<{ key: keyof ChartPoint; color: string; name: string }>;
  description: string;
  title: string;
  yAxisUnit?: string;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-72">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Collecting historical samples…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
            >
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={10}
                minTickGap={24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={10}
                unit={yAxisUnit}
              />
              <Tooltip />
              {dataKeys.map((item) => (
                <Area
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  fill={item.color}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  description,
  icon: Icon,
  label,
  value,
}: {
  description: string;
  icon?: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="font-medium text-muted-foreground text-sm">
          {label}
        </CardTitle>
        {Icon && <Icon className="size-4 text-primary" aria-hidden="true" />}
      </CardHeader>
      <CardContent>
        <p className="font-semibold text-xl tabular-nums tracking-tight">
          {value}
        </p>
        <p className="mt-1 text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}

function DockerDiskUsagePieChart({
  buildCacheBytes = 0,
  containerBytes = 0,
  imageBytes = 0,
  volumeBytes = 0,
}: {
  buildCacheBytes?: number;
  containerBytes?: number;
  imageBytes?: number;
  volumeBytes?: number;
}) {
  const totalBytes =
    buildCacheBytes + containerBytes + imageBytes + volumeBytes;

  const categories = [
    { name: "Build Cache", value: buildCacheBytes, color: "#a855f7" },
    { name: "Containers", value: containerBytes, color: "#ec4899" },
    { name: "Images", value: imageBytes, color: "#3b82f6" },
    { name: "Volumes", value: volumeBytes, color: "#f59e0b" },
  ];

  const activeCategories = categories.filter((item) => item.value > 0);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4 text-primary" aria-hidden="true" />
          Docker disk usage
        </CardTitle>
        <CardDescription>
          Storage breakdown including Build Cache, Containers, Images, and
          Volumes ({formatBytes(totalBytes)} total)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {totalBytes === 0 ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
            No Docker storage metrics reported for this server.
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div className="relative h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      activeCategories.length > 0
                        ? activeCategories
                        : categories
                    }
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {(activeCategories.length > 0
                      ? activeCategories
                      : categories
                    ).map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.color}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val) => {
                      const num =
                        typeof val === "number" ? val : Number(val ?? 0);
                      const pct =
                        totalBytes > 0
                          ? ((num / totalBytes) * 100).toFixed(1)
                          : "0.0";
                      return [`${formatBytes(num)} (${pct}%)`, "Storage"];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-semibold text-lg tabular-nums tracking-tight">
                  {formatBytes(totalBytes)}
                </span>
                <span className="font-medium text-muted-foreground text-xs">
                  Docker Usage
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {categories.map((item) => {
                const percentage =
                  totalBytes > 0
                    ? ((item.value / totalBytes) * 100).toFixed(1)
                    : "0.0";
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between rounded-md border p-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-medium">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-right tabular-nums">
                      <span className="font-semibold">
                        {formatBytes(item.value)}
                      </span>
                      <span className="w-12 text-muted-foreground text-xs">
                        {percentage}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MonitoringSubpage() {
  const organizationState = useRequiredActiveOrganization();
  const activeOrganization =
    organizationState.status === "ready"
      ? organizationState.organization
      : null;

  const organizationId = organizationState.organizationId as string;
  const [selectedServerId, setSelectedServerId] = useState("local");
  const [rangeKey, setRangeKey] = useState<RangeKey>("24h");
  const [cpuThreshold, setCpuThreshold] = useState(90);
  const [memoryThreshold, setMemoryThreshold] = useState(90);

  const range = useMemo(() => {
    const option =
      RANGE_OPTIONS.find((item) => item.value === rangeKey) ?? RANGE_OPTIONS[2];
    return {
      from: new Date(Date.now() - option.milliseconds).toISOString(),
      label: option.label,
      limit: rangeKey === "7d" ? "1500" : "800",
    };
  }, [rangeKey]);

  const serversQuery = useQuery({
    ...trpc.server.list.queryOptions({
      organizationId,
    }),
    enabled: organizationState.status === "ready",
  });

  const monitoringSettingsQuery = useQuery({
    ...trpc.server.monitoringSettings.queryOptions({
      organizationId,
      serverId: selectedServerId,
    }),
    enabled: organizationState.status === "ready",
  });

  const monitoringStatusQuery = useQuery({
    ...trpc.server.monitoringStatus.queryOptions({
      organizationId,
      serverId: selectedServerId,
    }),
    enabled: organizationState.status === "ready",
    refetchInterval: 30_000,
  });

  const historicalQuery = useQuery({
    ...trpc.server.historicalMetrics.queryOptions({
      organizationId,
      serverId: selectedServerId,
      from: range.from,
      limit: range.limit,
    }),
    enabled:
      organizationState.status === "ready" &&
      monitoringSettingsQuery.data?.isConfigured === true &&
      monitoringStatusQuery.data?.reachable !== false,
    refetchInterval: 30_000,
  });

  const containerQuery = useQuery({
    ...trpc.server.historicalMetrics.queryOptions({
      organizationId,
      serverId: selectedServerId,
      containerMetrics: true,
      from: range.from,
      limit: "1000",
    }),
    enabled:
      organizationState.status === "ready" &&
      monitoringSettingsQuery.data?.isConfigured === true &&
      historicalQuery.isSuccess,
    refetchInterval: 30_000,
  });

  const runtimeQuery = useQuery({
    ...trpc.server.runtimeStats.queryOptions({
      organizationId,
      serverId: selectedServerId === "local" ? undefined : selectedServerId,
    }),
    enabled: organizationState.status === "ready",
    refetchInterval: 10_000,
  });

  const updateMonitoringSettings = useMutation(
    trpc.server.updateMonitoringSettings.mutationOptions({
      onSuccess: (settings) => {
        setCpuThreshold(settings.cpuThreshold);
        setMemoryThreshold(settings.memoryThreshold);
      },
    }),
  );

  useEffect(() => {
    if (!monitoringSettingsQuery.data) return;
    setCpuThreshold(monitoringSettingsQuery.data.cpuThreshold);
    setMemoryThreshold(monitoringSettingsQuery.data.memoryThreshold);
  }, [monitoringSettingsQuery.data]);

  const history = useMemo<ChartPoint[]>(() => {
    if (!Array.isArray(historicalQuery.data)) return [];
    return (historicalQuery.data as MetricRecord[]).map((metric) => {
      const collectedAt = new Date(metric.timestamp);
      const memoryUsed = numberValue(metric.memUsed);
      return {
        timestamp: metric.timestamp,
        label: collectedAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        cpu: numberValue(metric.cpu),
        memory: memoryUsed,
        disk: numberValue(metric.diskUsed),
        networkIn: numberValue(metric.networkIn),
        networkOut: numberValue(metric.networkOut),
        uptime: metric.uptime,
        os: metric.os,
        kernel: metric.kernel,
        arch: metric.arch,
        cpuModel: metric.cpuModel,
      };
    });
  }, [historicalQuery.data]);

  const containers = useMemo(() => {
    if (!Array.isArray(containerQuery.data)) return [];
    const latest = new Map<string, ContainerMetricRecord>();
    for (const metric of containerQuery.data as ContainerMetricRecord[]) {
      const current = latest.get(metric.Name);
      if (!current || new Date(metric.timestamp) > new Date(current.timestamp))
        latest.set(metric.Name, metric);
    }
    return [...latest.values()].sort((a, b) => b.CPU - a.CPU);
  }, [containerQuery.data]);

  const latest = history.at(-1);
  const stats = runtimeQuery.data;

  if (runtimeQuery.isPending && !stats) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Target Server & Range Selectors */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={selectedServerId}
            onValueChange={(value) => value && setSelectedServerId(value)}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select server" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local Server</SelectItem>
              {serversQuery.data
                ?.filter((server) => server.status === "ready")
                .map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select
            value={rangeKey}
            onValueChange={(value) => value && setRangeKey(value as RangeKey)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Monitoring agent</p>
            <p className="truncate text-muted-foreground text-sm">
              {monitoringStatusQuery.data?.status === "not_configured"
                ? "This server has not been provisioned for monitoring yet."
                : monitoringStatusQuery.data?.collectionError ||
                  (monitoringStatusQuery.data?.lastCollectedAt
                    ? `Last sample ${new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(
                        new Date(monitoringStatusQuery.data.lastCollectedAt),
                      )}`
                    : "Waiting for the first sample…")}
            </p>
          </div>
          <Badge
            variant={
              monitoringStatusQuery.data?.status === "healthy"
                ? "default"
                : monitoringStatusQuery.data?.status === "not_configured"
                  ? "secondary"
                  : "destructive"
            }
          >
            {monitoringStatusQuery.isPending
              ? "Checking…"
              : monitoringStatusQuery.data?.status === "healthy"
                ? "Healthy"
                : monitoringStatusQuery.data?.status === "not_configured"
                  ? "Not configured"
                  : "Needs attention"}
          </Badge>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Workload CPU"
          value={`${stats?.cpu ?? latest?.cpu ?? 0}%`}
          description={`${stats?.cpuCores ?? 0} host cores available`}
        />
        <StatCard
          label="Workload memory"
          value={`${stats?.memoryPercent ?? latest?.memory ?? 0}%`}
          description={`${formatBytes((stats?.memoryUsage ?? 0) * 1024 * 1024)} used`}
        />
        <StatCard
          label="Active containers"
          value={String(stats?.activeContainers ?? containers.length)}
          description="Running workloads"
        />
        <StatCard
          label="Docker storage"
          value={formatBytes(
            (stats?.dockerImageBytes ?? 0) +
              (stats?.dockerContainerBytes ?? 0) +
              (stats?.dockerVolumeBytes ?? 0) +
              (stats?.dockerBuildCacheBytes ?? 0),
          )}
          description="Build cache, containers, images, and volumes"
        />
        <StatCard
          label="Host uptime"
          value={formatUptime(latest?.uptime ?? 0)}
          description={latest?.os ?? "Waiting for host metadata"}
        />
      </section>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Alert thresholds</CardTitle>
          <CardDescription>
            Send a notification when host CPU or memory exceeds these values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!activeOrganization?.id) return;
              updateMonitoringSettings.mutate({
                organizationId: activeOrganization.id,
                serverId: selectedServerId,
                cpuThreshold,
                memoryThreshold,
              });
            }}
          >
            <FieldGroup className="grid gap-4 sm:flex-1 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="monitoring-cpu-threshold">
                  CPU Threshold (%)
                </FieldLabel>
                <Input
                  id="monitoring-cpu-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={cpuThreshold}
                  onChange={(event) =>
                    setCpuThreshold(Number(event.target.value))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="monitoring-memory-threshold">
                  Memory Threshold (%)
                </FieldLabel>
                <Input
                  id="monitoring-memory-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={memoryThreshold}
                  onChange={(event) =>
                    setMemoryThreshold(Number(event.target.value))
                  }
                />
              </Field>
            </FieldGroup>
            <Button
              type="submit"
              disabled={
                updateMonitoringSettings.isPending ||
                monitoringSettingsQuery.isPending
              }
              className="sm:shrink-0"
            >
              {updateMonitoringSettings.isPending
                ? "Saving…"
                : "Save Thresholds"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2">
        <MonitoringChart
          data={history}
          dataKeys={[
            { key: "cpu", color: "var(--color-primary)", name: "CPU" },
          ]}
          title="CPU utilization"
          description="Host CPU utilization collected by the monitoring agent."
        />
        <MonitoringChart
          data={history}
          dataKeys={[
            { key: "memory", color: "var(--color-chart-2)", name: "Memory" },
          ]}
          title="Memory utilization"
          description="Used memory as a percentage of total host memory."
        />
        <MonitoringChart
          data={history}
          dataKeys={[
            { key: "disk", color: "var(--color-chart-3)", name: "Disk" },
          ]}
          title="Disk utilization"
          description="Root filesystem utilization over the selected range."
        />
        <MonitoringChart
          data={history}
          dataKeys={[
            {
              key: "networkIn",
              color: "var(--color-chart-4)",
              name: "Received",
            },
            { key: "networkOut", color: "var(--color-chart-5)", name: "Sent" },
          ]}
          title="Network traffic"
          description="Cumulative network counters reported by the host."
          yAxisUnit=" MB"
        />
      </section>

      <DockerDiskUsagePieChart
        buildCacheBytes={stats?.dockerBuildCacheBytes}
        containerBytes={stats?.dockerContainerBytes}
        imageBytes={stats?.dockerImageBytes}
        volumeBytes={stats?.dockerVolumeBytes}
      />

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4 text-primary" aria-hidden="true" />
            Container resource breakdown
          </CardTitle>
          <CardDescription>
            Latest persisted Docker metrics for the selected server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {containers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No container metrics are available in this range.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted/30 text-left text-muted-foreground text-xs uppercase">
                  <tr>
                    <th className="p-3 font-medium">Container</th>
                    <th className="p-3 font-medium">CPU</th>
                    <th className="p-3 font-medium">Memory</th>
                    <th className="p-3 font-medium">Network in</th>
                    <th className="p-3 font-medium">Network out</th>
                    <th className="p-3 font-medium">Sampled</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((container) => (
                    <tr
                      key={`${container.ID}-${container.timestamp}`}
                      className="border-t"
                    >
                      <td
                        className="max-w-[260px] truncate p-3 font-medium"
                        title={container.Name}
                      >
                        {container.Name}
                      </td>
                      <td className="p-3 tabular-nums">
                        {container.CPU.toFixed(1)}%
                      </td>
                      <td className="p-3 tabular-nums">
                        {container.Memory.percentage.toFixed(1)}%
                      </td>
                      <td className="p-3 tabular-nums">
                        {container.Network.input} {container.Network.inputUnit}
                      </td>
                      <td className="p-3 tabular-nums">
                        {container.Network.output}{" "}
                        {container.Network.outputUnit}
                      </td>
                      <td className="whitespace-nowrap p-3 text-muted-foreground text-xs">
                        {new Date(container.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
