"use client";

import { ArrowRight01Icon, Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
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
import { Skeleton } from "@upstand/ui/components/skeleton";
import Link from "next/link";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

export default function WorkspaceDeploymentsPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : undefined;
  const deployments = useQuery({
    ...trpc.deployment.getDeployments.queryOptions({
      organizationId: organizationId ?? "",
    }),
    enabled: Boolean(organizationId),
  });
  if (organizationState.status === "loading")
    return <Skeleton className="h-72 rounded-2xl" />;
  if (organizationState.status === "unavailable")
    return (
      <Empty className="min-h-[50vh] rounded-2xl border">
        <EmptyHeader>
          <EmptyTitle>No workspace selected</EmptyTitle>
          <EmptyDescription>
            Select an organization to view deployments.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const items = deployments.data ?? [];
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">Deployments</h1>
        <p className="mt-1 text-muted-foreground">
          Cross-project deployment history from this control plane.
        </p>
      </div>
      {deployments.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : deployments.isError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
          Deployment history is unavailable.
        </p>
      ) : items.length === 0 ? (
        <Empty className="min-h-[50vh] rounded-2xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Rocket01Icon} />
            </EmptyMedia>
            <EmptyTitle>No deployments yet</EmptyTitle>
            <EmptyDescription>
              Deploy a project to see its status, target, logs, and history
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3">
          {items.map((deployment) => (
            <Card className="rounded-2xl border-border/70" key={deployment.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">
                    {deployment.title}
                  </CardTitle>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {deployment.projectName} / {deployment.environmentName} /{" "}
                    {deployment.resourceName}
                  </p>
                </div>
                <Badge
                  variant={
                    deployment.status === "success"
                      ? "secondary"
                      : deployment.status === "failed"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {deployment.status}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-xs">
                <span>{deployment.serverName || "Local target"}</span>
                <span>{new Date(deployment.createdAt).toLocaleString()}</span>
                {deployment.projectId ? (
                  <Link
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    href={`/workspace/projects/${deployment.projectId}`}
                  >
                    Open project{" "}
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="size-3.5"
                    />
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
