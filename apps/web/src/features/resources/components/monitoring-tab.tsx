"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  MemoryStick,
  Network,
} from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";

type RangeKey = "1h" | "24h" | "7d";
type LiveStats = {
  collectedAt?: string;
  cpu?: number | null;
  ram?: number | null;
  ramUsage?: number | null;
  cpuPercent?: number | null;
  memoryPercent?: number | null;
  memoryUsageBytes?: number | null;
  containerCount?: number | null;
  networkRxBytes?: number | null;
  networkTxBytes?: number | null;
};
type ContainerMetric = {
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
  ID: string;
  Name: string;
};
type Point = {
  label: string;
  cpu: number;
  memory: number;
  networkIn: number;
  networkOut: number;
};

const RANGE_OPTIONS: Array<{
  value: RangeKey;
  label: string;
  milliseconds: number;
}> = [
  { value: "1h", label: "Last hour", milliseconds: 60 * 60_000 },
  { value: "24h", label: "Last 24 hours", milliseconds: 24 * 60 * 60_000 },
  { value: "7d", label: "Last 7 days", milliseconds: 7 * 24 * 60 * 60_000 },
];

const finite = (value: number | string | null | undefined) => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatBytes = (bytes: number) => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** exponent)} ${units[exponent]}`;
};

function MetricChart({
  data,
  dataKey,
  color,
  title,
  description,
  unit = "%",
}: {
  data: Point[];
  dataKey: keyof Point;
  color: string;
  title: string;
  description: string;
  unit?: string;
}) {
  return (
    <Card className="border-border/40 bg-card/20">
      <CardHeader>
        <CardTitle className="font-semibold text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-56 border-border/20 border-t pt-4">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Collecting history…
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
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={10}
                unit={unit}
              />
              <Tooltip />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                fill={color}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function MonitoringTab({
  appName,
  organizationId,
  serverId,
  statsData,
  statsError,
  isLoadingStats,
  refetchStats,
}: {
  appName?: string | null;
  organizationId?: string;
  serverId?: string;
  statsData?: LiveStats | null;
  statsError?: string;
  isLoadingStats: boolean;
  refetchStats: () => Promise<unknown>;
}) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("24h");
  const range = useMemo(() => {
    const option =
      RANGE_OPTIONS.find((item) => item.value === rangeKey) ?? RANGE_OPTIONS[1];
    return {
      from: new Date(Date.now() - option.milliseconds).toISOString(),
      label: option.label,
    };
  }, [rangeKey]);
  const historyQuery = useQuery({
    ...trpc.server.historicalMetrics.queryOptions({
      organizationId: organizationId as string,
      serverId: serverId ?? "",
      appName: appName ?? undefined,
      containerMetrics: true,
      from: range.from,
      limit: rangeKey === "7d" ? "1000" : "500",
    }),
    enabled: Boolean(organizationId && serverId && appName),
    refetchInterval: 30_000,
  });

  const points = useMemo<Point[]>(() => {
    if (!Array.isArray(historyQuery.data)) return [];
    const buckets = new Map<number, Map<string, ContainerMetric>>();
    for (const metric of historyQuery.data as ContainerMetric[]) {
      const timestamp = new Date(metric.timestamp).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const bucket = Math.floor(timestamp / 60_000);
      const containers =
        buckets.get(bucket) ?? new Map<string, ContainerMetric>();
      const current = containers.get(metric.Name);
      if (
        !current ||
        new Date(metric.timestamp) > new Date(current.timestamp)
      ) {
        containers.set(metric.Name, metric);
      }
      buckets.set(bucket, containers);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucket, metrics]) => {
        const values = [...metrics.values()];
        return {
          label: new Date(bucket * 60_000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          cpu: values.reduce((sum, metric) => sum + finite(metric.CPU), 0),
          memory:
            values.length > 0
              ? values.reduce(
                  (sum, metric) => sum + finite(metric.Memory?.percentage),
                  0,
                ) / values.length
              : 0,
          networkIn: values.reduce(
            (sum, metric) => sum + finite(metric.Network?.input),
            0,
          ),
          networkOut: values.reduce(
            (sum, metric) => sum + finite(metric.Network?.output),
            0,
          ),
        };
      });
  }, [historyQuery.data]);

  const latestContainers = useMemo(() => {
    const latest = new Map<string, ContainerMetric>();
    for (const metric of (Array.isArray(historyQuery.data)
      ? historyQuery.data
      : []) as ContainerMetric[]) {
      const current = latest.get(metric.Name);
      if (!current || new Date(metric.timestamp) > new Date(current.timestamp))
        latest.set(metric.Name, metric);
    }
    return [...latest.values()].sort((a, b) => b.CPU - a.CPU);
  }, [historyQuery.data]);

  const liveCpu = finite(statsData?.cpu ?? statsData?.cpuPercent);
  const liveMemory = finite(statsData?.ram ?? statsData?.memoryPercent);
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy={isLoadingStats || historyQuery.isPending}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold text-lg">Resource monitoring</h2>
          <p className="text-muted-foreground text-sm">
            {appName
              ? `Persisted Docker metrics for ${appName}.`
              : "Live Docker metrics for this resource."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={RANGE_OPTIONS}
            value={rangeKey}
            onValueChange={(value) => value && setRangeKey(value as RangeKey)}
          >
            <SelectTrigger
              className="h-9 w-40"
              aria-label="Resource monitoring time range"
            >
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetchStats()}
            disabled={isLoadingStats}
          >
            {isLoadingStats ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {statsError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">
                Live metrics are unavailable
              </p>
              <p className="mt-1 text-muted-foreground text-xs">{statsError}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetchStats()}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {historyQuery.error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm"
          role="alert"
        >
          Historical metrics could not be loaded: {historyQuery.error.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs">Current CPU</p>
              <p className="mt-1 font-semibold text-xl tabular-nums">
                {liveCpu.toFixed(1)}%
              </p>
            </div>
            <Cpu className="size-5 text-primary" aria-hidden="true" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs">Current memory</p>
              <p className="mt-1 font-semibold text-xl tabular-nums">
                {liveMemory.toFixed(1)}%
              </p>
            </div>
            <MemoryStick className="size-5 text-primary" aria-hidden="true" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs">Active containers</p>
              <p className="mt-1 font-semibold text-xl tabular-nums">
                {isLoadingStats && !statsData
                  ? "…"
                  : (statsData?.containerCount ?? latestContainers.length)}
              </p>
            </div>
            <Activity className="size-5 text-primary" aria-hidden="true" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs">Network traffic</p>
              <p className="mt-1 font-semibold text-xl tabular-nums">
                {formatBytes(
                  finite(statsData?.networkRxBytes) +
                    finite(statsData?.networkTxBytes),
                )}
              </p>
            </div>
            <Network className="size-5 text-primary" aria-hidden="true" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MetricChart
          data={points}
          dataKey="cpu"
          color="var(--color-primary)"
          title="CPU utilization"
          description={`${range.label} of persisted container samples.`}
        />
        <MetricChart
          data={points}
          dataKey="memory"
          color="var(--color-chart-2)"
          title="Memory utilization"
          description="Aggregated container memory percentage."
        />
        <MetricChart
          data={points}
          dataKey="networkIn"
          color="var(--color-chart-3)"
          title="Network received"
          description="Latest sampled receive counter."
          unit=""
        />
        <MetricChart
          data={points}
          dataKey="networkOut"
          color="var(--color-chart-4)"
          title="Network sent"
          description="Latest sampled transmit counter."
          unit=""
        />
      </div>

      <Card className="border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-semibold text-base">
            Container breakdown
          </CardTitle>
          <CardDescription>
            Latest persisted sample per container, sorted by CPU usage.
          </CardDescription>
        </CardHeader>
        <CardContent className="border-border/20 border-t pt-4">
          {latestContainers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No persisted container samples are available yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-muted/30 text-left text-muted-foreground text-xs uppercase">
                  <tr>
                    <th className="p-3 font-medium">Container</th>
                    <th className="p-3 font-medium">CPU</th>
                    <th className="p-3 font-medium">Memory</th>
                    <th className="p-3 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <ArrowDownToLine
                          className="size-3"
                          aria-hidden="true"
                        />
                        In
                      </span>
                    </th>
                    <th className="p-3 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <ArrowUpFromLine
                          className="size-3"
                          aria-hidden="true"
                        />
                        Out
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {latestContainers.map((metric) => (
                    <tr
                      key={`${metric.ID}-${metric.timestamp}`}
                      className="border-t"
                    >
                      <td
                        className="max-w-[240px] truncate p-3 font-medium"
                        title={metric.Name}
                      >
                        {metric.Name}
                      </td>
                      <td className="p-3 tabular-nums">
                        {finite(metric.CPU).toFixed(1)}%
                      </td>
                      <td className="p-3 tabular-nums">
                        {finite(metric.Memory?.percentage).toFixed(1)}%
                      </td>
                      <td className="p-3 tabular-nums">
                        {metric.Network?.input} {metric.Network?.inputUnit}
                      </td>
                      <td className="p-3 tabular-nums">
                        {metric.Network?.output} {metric.Network?.outputUnit}
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
