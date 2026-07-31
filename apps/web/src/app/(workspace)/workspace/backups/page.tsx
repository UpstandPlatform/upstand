"use client";

import {
  Database01Icon,
  PlayIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

export default function WorkspaceBackupsPage() {
  const organization = useRequiredActiveOrganization();
  const organizationId =
    organization.status === "ready" ? organization.organizationId : "";
  const schedules = useQuery({
    ...trpc.backup.listWebServerSchedules.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });
  const runs = useQuery({
    ...trpc.backup.listWebServerRuns.queryOptions({
      organizationId,
      limit: 25,
    }),
    enabled: Boolean(organizationId),
  });

  if (organization.status !== "ready") {
    return <Skeleton className="h-72 rounded-2xl" />;
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">Backups</h1>
        <p className="mt-1 text-muted-foreground">
          Protect control-plane and deployed resource data with the existing
          encrypted backup workflows.
        </p>
      </div>
      <Card className="rounded-2xl border-border/70">
        <CardHeader className="flex-row items-center justify-between border-b">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-muted p-2">
              <HugeiconsIcon icon={Database01Icon} />
            </div>
            <div>
              <CardTitle className="text-base">
                Control-plane schedules
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                Existing schedules run through the same scheduler used by the
                legacy dashboard.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void schedules.refetch();
              void runs.refetch();
            }}
          >
            <HugeiconsIcon icon={Refresh01Icon} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {schedules.isPending ? (
            <Skeleton className="m-5 h-24 rounded-xl" />
          ) : schedules.isError ? (
            <p className="p-5 text-destructive text-sm">
              Backup schedules could not be loaded.
            </p>
          ) : schedules.data.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-medium">No control-plane schedules yet</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Resource backup schedules remain available from each project’s
                Backups tab.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {schedules.data.map((schedule) => (
                <div
                  className="flex items-center justify-between gap-4 p-5"
                  key={schedule.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{schedule.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {schedule.cronExpression} · {schedule.timezone}
                    </p>
                  </div>
                  <Badge variant={schedule.enabled ? "secondary" : "outline"}>
                    {schedule.enabled ? "Enabled" : "Paused"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {runs.isPending ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : runs.data?.length ? (
            runs.data.map((run) => (
              <div
                className="flex items-center justify-between rounded-xl border p-4"
                key={run.id}
              >
                <div className="flex items-center gap-3">
                  <HugeiconsIcon
                    icon={PlayIcon}
                    className="text-muted-foreground"
                  />
                  <div>
                    <p className="font-medium text-sm">{run.status}</p>
                    <p className="text-muted-foreground text-xs">
                      {run.startedAt?.toLocaleString?.() ?? "Queued"}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={run.status === "succeeded" ? "secondary" : "outline"}
                >
                  {run.status}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              No backup runs recorded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
