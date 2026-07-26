"use client";

import { Activity01FreeIcons } from "@hugeicons/core-free-icons";
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
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Separator } from "@upstand/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@upstand/ui/components/sheet";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import { Switch } from "@upstand/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { PagePagination } from "@/components/dashboard/page-pagination";
import { Activity, Copy, Download, Eye } from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { copyText, downloadJson } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

const STATUS_GROUPS = ["all", "1xx", "2xx", "3xx", "4xx", "5xx"] as const;
const SORT_FIELDS = [
  "timestamp",
  "status",
  "duration",
  "host",
  "method",
] as const;

type LogEntry = NonNullable<
  ReturnType<typeof useAccessLogs>["data"]
>["entries"][number];

function dateInput(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function toRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  return { from: start, to: end };
}

function useAccessLogs(enabled: boolean) {
  const [from, setFrom] = useState(dateInput(3));
  const [to, setTo] = useState(dateInput(0));
  const [page, setPage] = useState(1);
  const [statusGroup, setStatusGroup] =
    useState<(typeof STATUS_GROUPS)[number]>("all");
  const [sortBy, setSortBy] =
    useState<(typeof SORT_FIELDS)[number]>("timestamp");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const range = useMemo(() => toRange(from, to), [from, to]);

  const query = useQuery({
    ...trpc.webServer.accessLogs.queryOptions({
      ...range,
      page,
      pageSize: 25,
      statusGroup,
      sortBy,
      sortDirection,
    }),
    enabled,
  });

  const stats = useQuery({
    ...trpc.webServer.accessLogStats.queryOptions(range),
    enabled,
  });

  return {
    ...query,
    stats,
    from,
    setFrom,
    to,
    setTo,
    page,
    setPage,
    statusGroup,
    setStatusGroup,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
  };
}

function statusVariant(
  status: number,
): "default" | "secondary" | "destructive" | "outline" {
  if (status >= 500) return "destructive";
  if (status >= 400) return "secondary";
  if (status >= 300) return "outline";
  return "default";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function AccessLogDetail({
  entry,
  onClose,
}: {
  entry: LogEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  const json = JSON.stringify(entry.raw, null, 2);
  const copyIp = async () => {
    await copyText(entry.remoteIp);
    toast.success("Client IP copied");
  };
  const download = () => downloadJson(entry.raw, `request-${entry.id}.json`);

  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Request details</SheetTitle>
          <SheetDescription>
            {formatDate(entry.timestamp)} · {entry.method} {entry.uri}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-6 pb-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Host</p>
              <p className="break-all font-medium">{entry.host || "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Client IP</p>
              <p className="break-all font-medium">{entry.remoteIp || "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Status</p>
              <Badge variant={statusVariant(entry.status)}>
                {entry.status || "unknown"}
              </Badge>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Duration</p>
              <p className="font-medium tabular-nums">
                {entry.durationMs.toFixed(2)} ms
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyIp}
              disabled={!entry.remoteIp}
            >
              <Copy data-icon="inline-start" /> Copy IP
            </Button>
            <Button variant="outline" size="sm" onClick={download}>
              <Download data-icon="inline-start" /> Download JSON
            </Button>
          </div>
          <pre className="max-h-[50dvh] overflow-auto rounded-lg bg-muted/50 p-4 text-xs leading-relaxed">
            {json}
          </pre>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RequestsTable({
  logs,
  onSelect,
}: {
  logs: ReturnType<typeof useAccessLogs>;
  onSelect: (entry: LogEntry) => void;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <CardTitle>Incoming requests</CardTitle>
          <CardDescription>
            Individual HTTP requests recorded by Caddy.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={logs.statusGroup}
            onValueChange={(value) => {
              logs.setStatusGroup(value as typeof logs.statusGroup);
              logs.setPage(1);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_GROUPS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "all" ? "All status" : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={logs.sortBy}
            onValueChange={(value) => {
              logs.setSortBy(value as typeof logs.sortBy);
              logs.setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_FIELDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "duration"
                    ? "Duration"
                    : value[0].toUpperCase() + value.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              logs.setSortDirection(
                logs.sortDirection === "desc" ? "asc" : "desc",
              )
            }
            aria-label="Toggle sort direction"
          >
            {logs.sortDirection === "desc" ? "Newest" : "Oldest"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Host / URI</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.isPending ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.data?.entries.length ? (
                logs.data.entries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onSelect(entry)}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {formatDate(entry.timestamp)}
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate font-medium">
                        {entry.host || "—"}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {entry.uri || "/"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.method || "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(entry.status)}>
                        {entry.status || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {entry.durationMs.toFixed(1)} ms
                    </TableCell>
                    <TableCell>
                      <Eye className="size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No requests match this range or filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <PagePagination
          page={logs.page}
          pageSize={25}
          total={logs.data?.total ?? 0}
          onPageChange={logs.setPage}
        />
      </CardContent>
    </Card>
  );
}

export function RequestsSubpage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const logs = useAccessLogs(Boolean(organizationId));
  const status = useQuery({
    ...trpc.webServer.accessLogStatus.queryOptions(),
    enabled: Boolean(organizationId),
  });

  const toggleMutation = useMutation({
    ...trpc.webServer.toggleAccessLogs.mutationOptions(),
  });
  const cleanupMutation = useMutation({
    ...trpc.webServer.updateAccessLogCleanup.mutationOptions(),
  });

  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [cleanupCron, setCleanupCron] = useState("0 3 * * *");

  useEffect(() => {
    if (status.data?.cleanupCron) setCleanupCron(status.data.cleanupCron);
  }, [status.data?.cleanupCron]);

  const pending = toggleMutation.isPending;
  const active = Boolean(status.data?.enabled);

  const toggle = async () => {
    const wasEnabled = Boolean(status.data?.enabled);
    try {
      await toggleMutation.mutateAsync({ enabled: !wasEnabled });
      await status.refetch();
      toast.success(
        wasEnabled
          ? "Caddy access logging disabled"
          : "Caddy access logging enabled",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update access logging",
      );
    }
  };

  if (status.isPending) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Activity className="size-5" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Caddy access logs</h2>
                <p className="max-w-2xl text-muted-foreground text-sm">
                  Store structured request logs in a managed Docker volume.
                  Enabling this configures Caddy access logging and manages log
                  rotation.
                </p>
              </div>
            </div>
            <Switch
              checked={active}
              onCheckedChange={toggle}
              disabled={pending}
            />
          </div>

          {active && (
            <div className="flex flex-col gap-2">
              <Separator />
              <div className="mt-4">
                <Label htmlFor="access-log-cleanup">Log cleanup schedule</Label>
                <p className="mt-1 text-muted-foreground text-xs">
                  Cron schedule for rotating old access-log files.
                </p>
              </div>
              <div className="flex w-full gap-2 sm:max-w-sm">
                <Input
                  id="access-log-cleanup"
                  value={cleanupCron}
                  onChange={(event) => setCleanupCron(event.target.value)}
                  placeholder="0 3 * * *"
                />
                <Button
                  variant="outline"
                  disabled={cleanupMutation.isPending || !cleanupCron.trim()}
                  onClick={async () => {
                    try {
                      await cleanupMutation.mutateAsync({
                        cron: cleanupCron.trim(),
                      });
                      await status.refetch();
                      toast.success("Cleanup schedule updated");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Unable to update cleanup schedule",
                      );
                    }
                  }}
                >
                  {cleanupMutation.isPending ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Saving…
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {active ? (
        <>
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Request distribution</CardTitle>
              <CardDescription>
                Requests grouped by hour in the selected date range.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="requests-from">From</Label>
                  <Input
                    id="requests-from"
                    type="date"
                    value={logs.from}
                    onChange={(event) => {
                      logs.setFrom(event.target.value);
                      logs.setPage(1);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="requests-to">To</Label>
                  <Input
                    id="requests-to"
                    type="date"
                    value={logs.to}
                    onChange={(event) => {
                      logs.setTo(event.target.value);
                      logs.setPage(1);
                    }}
                  />
                </div>
              </div>
              <div className="h-64 w-full">
                {logs.stats.isPending ? (
                  <div className="flex h-full items-center justify-center">
                    <Spinner />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={logs.stats.data ?? []}
                      margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                    >
                      <defs>
                        <linearGradient
                          id="requests-area"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--color-primary)"
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-primary)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={(value) =>
                          new Intl.DateTimeFormat(undefined, {
                            hour: "numeric",
                          }).format(new Date(value))
                        }
                        tickLine={false}
                        axisLine={false}
                        fontSize={10}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        fontSize={10}
                      />
                      <Tooltip
                        labelFormatter={(value) => formatDate(String(value))}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Requests"
                        stroke="var(--color-primary)"
                        fill="url(#requests-area)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <RequestsTable logs={logs} onSelect={setSelected} />
          <AccessLogDetail entry={selected} onClose={() => setSelected(null)} />
        </>
      ) : (
        <PageEmpty
          icon={Activity01FreeIcons}
          title="Request monitoring is off"
          description="Enable Caddy access logs to start collecting request distribution and detailed HTTP entries."
          action={
            <Button onClick={toggle} disabled={pending}>
              {pending ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Enabling…
                </>
              ) : (
                "Enable Monitoring"
              )}
            </Button>
          }
        />
      )}
    </div>
  );
}
