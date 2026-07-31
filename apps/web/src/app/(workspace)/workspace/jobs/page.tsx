"use client";

import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  PlayIcon,
  Refresh01Icon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@upstand/ui/components/empty";
import { Input } from "@upstand/ui/components/input";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

type JobFilter = "all" | "enabled" | "failed" | "manual";

export default function WorkspaceJobsPage() {
  const organizationState = useRequiredActiveOrganization();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<JobFilter>("all");
  const [search, setSearch] = useState("");
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : "";
  const jobs = useQuery({
    ...trpc.schedule.listForOrganization.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });
  const runNow = useMutation({
    ...trpc.schedule.runNow.mutationOptions(),
    onSuccess: () => {
      toast.success("Job run accepted");
      void queryClient.invalidateQueries({
        queryKey: trpc.schedule.listForOrganization.queryKey(),
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const toggle = useMutation({
    ...trpc.schedule.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Job updated");
      void queryClient.invalidateQueries({
        queryKey: trpc.schedule.listForOrganization.queryKey(),
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const filteredJobs = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (jobs.data ?? []).filter((job) => {
      if (filter === "enabled" && !job.enabled) return false;
      if (filter === "failed" && job.lastRunStatus !== "failed") return false;
      if (filter === "manual" && job.source !== "manual") return false;
      if (!normalized) return true;
      return [job.name, job.projectName, job.resourceName, job.jobType]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [filter, jobs.data, search]);
  const logs = useQuery({
    ...trpc.schedule.listLogs.queryOptions({
      scheduleId: logsFor ?? undefined,
      limit: 40,
    }),
    enabled: Boolean(logsFor),
  });

  if (organizationState.status === "loading")
    return <Skeleton className="h-72 rounded-2xl" />;
  if (organizationState.status === "unavailable") {
    return (
      <Empty className="min-h-[50vh] rounded-2xl border">
        <EmptyHeader>
          <EmptyTitle>No workspace selected</EmptyTitle>
          <EmptyDescription>
            Select an organization to manage Jobs.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const counts = {
    all: jobs.data?.length ?? 0,
    enabled: jobs.data?.filter((job) => job.enabled).length ?? 0,
    failed:
      jobs.data?.filter((job) => job.lastRunStatus === "failed").length ?? 0,
    manual: jobs.data?.filter((job) => job.source === "manual").length ?? 0,
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-3xl tracking-tight">Jobs</h1>
          <p className="mt-1 text-muted-foreground">
            Schedules and automation across your projects.
          </p>
        </div>
        <Button
          className="rounded-xl"
          onClick={() => void jobs.refetch()}
          variant="outline"
        >
          <HugeiconsIcon icon={Refresh01Icon} /> Refresh
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {(["all", "enabled", "failed", "manual"] as const).map((key) => (
          <button
            className={`rounded-2xl border p-4 text-left transition-colors ${filter === key ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
            key={key}
            onClick={() => setFilter(key)}
            type="button"
          >
            <div className="text-muted-foreground text-xs uppercase tracking-wider">
              {key}
            </div>
            <div className="mt-2 font-semibold text-2xl">{counts[key]}</div>
          </button>
        ))}
      </div>
      <Input
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search Jobs, projects, or resources"
        value={search}
      />
      {jobs.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : jobs.isError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
          Jobs could not be loaded.
        </p>
      ) : filteredJobs.length === 0 ? (
        <Empty className="min-h-[45vh] rounded-2xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Task01Icon} />
            </EmptyMedia>
            <EmptyTitle>
              {jobs.data?.length ? "No matching Jobs" : "No Jobs yet"}
            </EmptyTitle>
            <EmptyDescription>
              {jobs.data?.length
                ? "Try another filter or search."
                : "Create a project resource schedule to see it here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3">
          {filteredJobs.map((job) => (
            <Card className="rounded-2xl border-border/70" key={job.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    {job.name}
                  </CardTitle>
                  <p className="mt-1 truncate text-muted-foreground text-sm">
                    {job.projectName ?? "Project"} /{" "}
                    {job.resourceName ?? "Resource"} · {job.jobType}
                  </p>
                </div>
                <Badge
                  variant={
                    job.lastRunStatus === "failed"
                      ? "destructive"
                      : job.enabled
                        ? "secondary"
                        : "outline"
                  }
                >
                  {job.lastRunStatus ??
                    (job.enabled ? "scheduled" : "disabled")}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-xs">
                <span className="inline-flex items-center gap-1">
                  <HugeiconsIcon icon={Clock01Icon} /> {job.cronExpression} ·{" "}
                  {job.timezone}
                </span>
                <span>
                  {job.lastRunAt
                    ? new Date(job.lastRunAt).toLocaleString()
                    : "Not run yet"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setLogsFor(job.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <HugeiconsIcon icon={ViewIcon} /> Logs
                  </Button>
                  <Button
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate({ id: job.id })}
                    size="sm"
                    variant="outline"
                  >
                    <HugeiconsIcon icon={PlayIcon} /> Run now
                  </Button>
                  <Button
                    disabled={toggle.isPending}
                    onClick={() =>
                      toggle.mutate({ id: job.id, enabled: !job.enabled })
                    }
                    size="sm"
                    variant={job.enabled ? "ghost" : "secondary"}
                  >
                    {job.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {logsFor ? (
        <Card className="rounded-2xl">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Job run history</CardTitle>
            <Button onClick={() => setLogsFor(null)} size="sm" variant="ghost">
              Close
            </Button>
          </CardHeader>
          <CardContent>
            {logs.isPending ? (
              <Skeleton className="h-24" />
            ) : logs.data?.length ? (
              <div className="grid gap-2">
                {logs.data.map((log) => (
                  <div
                    className="flex flex-wrap justify-between gap-2 rounded-xl border p-3 text-sm"
                    key={log.id}
                  >
                    <span className="inline-flex items-center gap-2">
                      <HugeiconsIcon
                        icon={
                          log.status === "success"
                            ? CheckmarkCircle02Icon
                            : Task01Icon
                        }
                      />
                      {log.status}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(log.executedAt).toLocaleString()} ·{" "}
                      {log.durationMs}ms
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No runs recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
