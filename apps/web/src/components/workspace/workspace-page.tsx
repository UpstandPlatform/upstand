"use client";

import {
  ArrowRight01Icon,
  Folder01Icon,
  PlusSignIcon,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@upstand/ui/components/empty";
import { Skeleton } from "@upstand/ui/components/skeleton";
import type { Route } from "next";
import Link from "next/link";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

function QueryState({ pending, error }: { pending: boolean; error: boolean }) {
  if (pending) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }
  if (error) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
        Unable to load workspace data. Retry when the control plane is
        available.
      </p>
    );
  }
  return null;
}

export function WorkspaceHome() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : undefined;
  const projects = useQuery({
    ...trpc.project.list.queryOptions({ organizationId: organizationId ?? "" }),
    enabled: Boolean(organizationId),
  });
  const deployments = useQuery({
    ...trpc.deployment.getDeployments.queryOptions({
      organizationId: organizationId ?? "",
    }),
    enabled: Boolean(organizationId),
  });

  if (organizationState.status === "loading") {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (organizationState.status === "unavailable") {
    return (
      <Empty className="min-h-[50vh] rounded-2xl border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Folder01Icon} />
          </EmptyMedia>
          <EmptyTitle>No workspace selected</EmptyTitle>
          <EmptyDescription>
            Create or select an organization to manage projects and deployments.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const projectItems = projects.data ?? [];
  const deploymentItems = deployments.data ?? [];

  const userProjects = projectItems.filter(
    (p) => !(p as { isApp?: boolean }).isApp,
  );
  const appProjects = projectItems.filter(
    (p) => (p as { isApp?: boolean }).isApp,
  );

  const successfulDeployments = deploymentItems.filter(
    (deployment) => deployment.status === "success",
  ).length;
  const successRate =
    deploymentItems.length === 0
      ? 0
      : Math.round((successfulDeployments / deploymentItems.length) * 100);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">
          {greeting}, {organizationState.organization.name}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Here&apos;s an overview of your projects, apps, and deployments.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left Column */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/70">
            <CardHeader className="flex flex-row items-center justify-between border-b px-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <HugeiconsIcon icon={Folder01Icon} className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-base">Your Projects</CardTitle>
                  <p className="text-muted-foreground text-xs">
                    {projects.isPending
                      ? "Loading..."
                      : `${userProjects.length} projects`}
                  </p>
                </div>
              </div>
              <Link
                className="inline-flex items-center gap-1 font-medium text-muted-foreground text-sm hover:text-foreground"
                href={"/workspace/projects" as Route}
              >
                View all{" "}
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {projects.isPending || deployments.isPending ? (
                <QueryState pending error={false} />
              ) : projects.isError || deployments.isError ? (
                <QueryState pending={false} error />
              ) : userProjects.length === 0 ? (
                <Empty className="min-h-72 border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={Folder01Icon} />
                    </EmptyMedia>
                    <EmptyTitle>Launch your first project</EmptyTitle>
                    <EmptyDescription>
                      Connect a repository, start from a template, or deploy a
                      local folder.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <div className="flex flex-wrap justify-center gap-3">
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground text-sm"
                        href={"/workspace/projects" as Route}
                      >
                        <HugeiconsIcon icon={PlusSignIcon} />
                        Create project
                      </Link>
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-xl border px-4 font-medium text-sm"
                        href={"/workspace/apps" as Route}
                      >
                        Browse Apps
                      </Link>
                    </div>
                  </EmptyContent>
                </Empty>
              ) : (
                <div className="divide-y divide-border/50">
                  {userProjects.slice(0, 6).map((project) => (
                    <Link
                      className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-muted/40"
                      href={`/projects/${project.id}`}
                      key={project.id}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {project.name}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-muted-foreground text-xs">
                          {project.description || "No description provided"}
                        </p>
                      </div>
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className="size-4 text-muted-foreground"
                      />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shortcuts Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Link
              href={"/workspace/projects" as Route}
              className="rounded-xl border border-border/50 bg-card/70 p-4 transition-all hover:bg-muted/40"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={Folder01Icon} className="size-4" />
              </div>
              <p className="font-medium text-sm">Import Git</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                From repository
              </p>
            </Link>
            <Link
              href={"/workspace/apps" as Route}
              className="rounded-xl border border-border/50 bg-card/70 p-4 transition-all hover:bg-muted/40"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              </div>
              <p className="font-medium text-sm">Catalog Apps</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                One-click install
              </p>
            </Link>
            <Link
              href={"/workspace/settings" as Route}
              className="rounded-xl border border-border/50 bg-card/70 p-4 transition-all hover:bg-muted/40"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </div>
              <p className="font-medium text-sm">Settings</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                Preferences &amp; tokens
              </p>
            </Link>
            <Link
              href={"/workspace/servers" as Route}
              className="rounded-xl border border-border/50 bg-card/70 p-4 transition-all hover:bg-muted/40"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </div>
              <p className="font-medium text-sm">Servers</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                Manage targets
              </p>
            </Link>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-5">
          {/* Activity Summary */}
          <Card className="rounded-2xl border-border/70 bg-card/70 p-5">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="font-semibold text-sm">Activity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-0 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  Active Projects
                </span>
                <span className="font-semibold text-sm">
                  {projectItems.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  Total Deployments
                </span>
                <span className="font-semibold text-sm">
                  {deploymentItems.length}
                </span>
              </div>
              <div className="flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-xs">
                  Success Rate
                </span>
                <Badge variant={successRate >= 80 ? "secondary" : "outline"}>
                  {successRate}%
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Apps Card */}
          <Card className="rounded-2xl border-border/70 bg-card/70 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Apps Catalog</h3>
              <Link
                href={"/workspace/apps" as Route}
                className="font-medium text-muted-foreground text-xs hover:text-foreground"
              >
                Browse &rarr;
              </Link>
            </div>
            {appProjects.length === 0 ? (
              <div className="flex flex-col items-center py-2 text-center">
                <p className="text-muted-foreground text-xs">
                  Deploy database, caching, or web apps with a single click.
                </p>
                <div className="mt-3 flex items-center justify-center -space-x-1.5">
                  {[
                    "PostgreSQL",
                    "Redis",
                    "MinIO",
                    "PocketBase",
                    "Metabase",
                  ].map((name) => (
                    <div
                      key={name}
                      title={name}
                      className="flex size-7 items-center justify-center rounded-full border bg-muted font-bold text-[10px]"
                    >
                      {name[0]}
                    </div>
                  ))}
                </div>
                <Link
                  href={"/workspace/apps" as Route}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 font-medium text-primary-foreground text-xs"
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                  Install an App
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {appProjects.slice(0, 4).map((app) => (
                  <Link
                    key={app.id}
                    href={`/projects/${app.id}`}
                    className="flex items-center justify-between py-2 text-xs hover:text-primary"
                  >
                    <span className="truncate font-medium">{app.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      App
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceProjects() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : undefined;
  const projects = useQuery({
    ...trpc.project.list.queryOptions({ organizationId: organizationId ?? "" }),
    enabled: Boolean(organizationId),
  });
  if (organizationState.status !== "ready")
    return <WorkspaceUnavailable state={organizationState.status} />;
  const items = projects.data ?? [];
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-3xl tracking-tight">Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Deploy from Git, a template, or a local folder.
          </p>
        </div>
        <Button onClick={() => window.location.assign("/projects")}>
          <HugeiconsIcon icon={PlusSignIcon} />
          Create project
        </Button>
      </div>
      {projects.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : projects.isError ? (
        <QueryState pending={false} error />
      ) : items.length === 0 ? (
        <Empty className="min-h-[50vh] rounded-2xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Folder01Icon} />
            </EmptyMedia>
            <EmptyTitle>Start your first project</EmptyTitle>
            <EmptyDescription>
              Import a Git repository or browse the existing template catalog.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => window.location.assign("/projects")}>
                <HugeiconsIcon icon={PlusSignIcon} />
                Create project
              </Button>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-xl border px-4 font-medium text-sm"
                href={"/workspace/apps" as Route}
              >
                Browse Apps
              </Link>
            </div>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((project) => (
            <Card className="rounded-2xl border-border/70" key={project.id}>
              <CardHeader>
                <CardTitle>{project.name}</CardTitle>
                <p className="text-muted-foreground text-sm">
                  {project.description || "No description"}
                </p>
              </CardHeader>
              <CardContent>
                <Link
                  className="inline-flex h-9 items-center gap-2 rounded-xl border px-3 font-medium text-sm"
                  href={`/projects/${project.id}` as Route}
                >
                  Open project <HugeiconsIcon icon={ArrowRight01Icon} />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceUnavailable({ state }: { state: "loading" | "unavailable" }) {
  return state === "loading" ? (
    <Skeleton className="h-72 rounded-2xl" />
  ) : (
    <Empty className="min-h-[50vh] rounded-2xl border">
      <EmptyHeader>
        <EmptyTitle>No workspace selected</EmptyTitle>
        <EmptyDescription>Select an organization to continue.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
