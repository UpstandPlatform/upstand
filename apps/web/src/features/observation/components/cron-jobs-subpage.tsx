"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { useState } from "react";
import { toast } from "sonner";
import { PageEmpty } from "@/components/dashboard/page-empty";
import {
  CardGridSkeleton,
  TableSkeleton,
} from "@/components/dashboard/page-skeleton";
import {
  Activity,
  CheckCircle,
  Clock,
  FileText,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

export function CronJobsSubpage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [timespan, setTimespan] = useState<"24h" | "7d" | "30d">("30d");
  const [status, setStatus] = useState<"all" | "success" | "failed">("all");
  const [search, setSearch] = useState("");
  type ObservabilityItem =
    inferRouterOutputs<AppRouter>["schedule"]["listObservability"]["items"][number];
  const [viewingLogJob, setViewingLogJob] = useState<ObservabilityItem | null>(
    null,
  );

  const observabilityQuery = useQuery({
    ...trpc.schedule.listObservability.queryOptions({
      organizationId,
      timespan,
      status,
      search: search.trim() || undefined,
    }),
    enabled: organizationState.status === "ready",
  });

  const logsQuery = useQuery({
    ...trpc.schedule.listLogs.queryOptions({
      scheduleId: viewingLogJob?.id,
      limit: 50,
    }),
    enabled: Boolean(viewingLogJob?.id),
  });

  const runNowMutation = useMutation({
    ...trpc.schedule.runNow.mutationOptions(),
    onSuccess: () => {
      toast.success("Schedule triggered successfully");
      void observabilityQuery.refetch();
    },
    onError: (error) =>
      toast.error(error.message || "Failed to trigger schedule"),
  });

  const data = observabilityQuery.data;

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      {observabilityQuery.isLoading ? (
        <CardGridSkeleton count={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-muted/20">
            <CardHeader>
              <CardDescription className="flex items-center justify-between font-medium text-xs">
                Active Cron Jobs
                <Clock className="size-4 text-primary" />
              </CardDescription>
              <CardTitle className="font-bold text-2xl">
                {data?.totalJobs ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-muted-foreground text-xs">
              Configured cron schedules
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader>
              <CardDescription className="flex items-center justify-between font-medium text-xs">
                Total Invocations ({timespan})
                <Activity className="size-4 text-info" />
              </CardDescription>
              <CardTitle className="font-bold text-2xl">
                {data?.totalInvocations ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-muted-foreground text-xs">
              Executions in past {timespan}
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader>
              <CardDescription className="flex items-center justify-between font-medium text-xs">
                P75 Latency
                <Clock className="size-4 text-warning" />
              </CardDescription>
              <CardTitle className="font-bold text-2xl tabular-nums">
                {data?.p75DurationMs ?? 0} ms
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-muted-foreground text-xs">
              75th percentile duration
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader>
              <CardDescription className="flex items-center justify-between font-medium text-xs">
                Success Rate
                <CheckCircle className="size-4 text-success" />
              </CardDescription>
              <CardTitle className="font-bold text-2xl tabular-nums">
                {(data?.successRate ?? 100).toFixed(1)}%
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-muted-foreground text-xs">
              Completed without error
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon align="inline-start">
              <Search className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search route, command, or resource..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>

          <Select
            value={timespan}
            onValueChange={(val) => setTimespan(val as "24h" | "7d" | "30d")}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Timespan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Past 24 Hours</SelectItem>
              <SelectItem value="7d">Past 7 Days</SelectItem>
              <SelectItem value="30d">Past 30 Days</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(val) =>
              setStatus(val as "all" | "success" | "failed")
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void observabilityQuery.refetch()}
          disabled={observabilityQuery.isFetching}
          className="gap-2"
        >
          <RefreshCw
            className={`size-3.5 ${observabilityQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Observability Table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          {observabilityQuery.isLoading ? (
            <TableSkeleton rows={5} />
          ) : (data?.items.length ?? 0) === 0 ? (
            <PageEmpty
              icon={Clock}
              title="No cron jobs found"
              description="No configured cron schedules match your current filters or organization."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cron Job / Target</TableHead>
                    <TableHead>Route / Command</TableHead>
                    <TableHead>Schedule (Unix/Cron)</TableHead>
                    <TableHead className="text-right">Invocations</TableHead>
                    <TableHead className="text-right">P75 Duration</TableHead>
                    <TableHead>Last Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((job) => (
                    <TableRow key={job.id} className="hover:bg-muted/40">
                      <TableCell className="max-w-[200px]">
                        <div className="flex flex-col">
                          <span className="truncate font-semibold text-foreground text-sm">
                            {job.name}
                          </span>
                          <span className="truncate text-muted-foreground text-xs">
                            {job.resourceName || "Standalone"} ({job.jobType})
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="max-w-[220px]">
                        <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-foreground text-xs">
                          {job.command || "N/A"}
                        </code>
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Badge variant="outline" className="font-mono">
                            {job.cronExpression}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            ({job.timezone})
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {job.invocationsCount}
                      </TableCell>

                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {job.p75DurationMs} ms
                      </TableCell>

                      <TableCell>
                        {job.lastRunStatus === "success" ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle className="size-3" /> Success
                          </Badge>
                        ) : job.lastRunStatus === "failed" ? (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="size-3" /> Failed
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Not run</Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            title="Run Now"
                            disabled={runNowMutation.isPending}
                            onClick={() =>
                              runNowMutation.mutate({ id: job.id })
                            }
                          >
                            <Play className="size-3.5 text-success" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground"
                            title="View Execution Logs"
                            onClick={() => setViewingLogJob(job)}
                          >
                            <FileText className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Execution Logs Modal */}
      <Dialog
        open={Boolean(viewingLogJob)}
        onOpenChange={(open) => !open && setViewingLogJob(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              Execution Logs: {viewingLogJob?.name}
            </DialogTitle>
            <DialogDescription>
              Recent execution history and response payloads for schedule{" "}
              <code className="font-mono font-semibold text-foreground">
                {viewingLogJob?.cronExpression}
              </code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {logsQuery.isLoading ? (
              <TableSkeleton rows={4} />
            ) : (logsQuery.data?.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">
                No execution logs recorded yet for this schedule.
              </p>
            ) : (
              <div className="max-h-[400px] space-y-3 overflow-y-auto">
                {logsQuery.data?.map((log) => (
                  <div
                    key={log.id}
                    className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.status === "success" ? (
                          <Badge variant="success">Success</Badge>
                        ) : (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                        {log.statusCode && (
                          <span className="font-mono text-muted-foreground">
                            HTTP {log.statusCode}
                          </span>
                        )}
                        <span className="font-mono text-muted-foreground">
                          {log.durationMs} ms
                        </span>
                      </div>
                      <span className="font-mono text-muted-foreground">
                        {new Date(log.executedAt).toLocaleString()}
                      </span>
                    </div>

                    {log.errorMessage && (
                      <p className="break-all font-mono text-destructive">
                        Error: {log.errorMessage}
                      </p>
                    )}

                    {log.responseBody && (
                      <pre className="max-h-32 select-all overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
                        {log.responseBody}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
