"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import { Skeleton } from "@upstand/ui/components/skeleton";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

export default function WorkspaceAppsPage() {
  const organizationState = useRequiredActiveOrganization();
  const [search, setSearch] = useState("");
  const projects = useQuery({
    ...trpc.project.list.queryOptions({
      organizationId:
        organizationState.status === "ready"
          ? organizationState.organizationId
          : "",
    }),
    enabled: organizationState.status === "ready",
  });
  const catalog = useQuery({
    ...trpc.template.catalog.queryOptions({
      search: search || undefined,
      page: 1,
      pageSize: 24,
    }),
  });
  const apps = (catalog.data?.items ?? []).filter(
    (app) =>
      !app.id.toLowerCase().includes("mail") &&
      !app.name.toLowerCase().includes("mail"),
  );
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">Apps</h1>
        <p className="mt-1 text-muted-foreground">
          Install a catalog app and continue through the normal project
          deployment lifecycle.
        </p>
      </div>
      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupAddon>
        <InputGroupInput
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Apps"
          value={search}
        />
      </InputGroup>
      {(projects.data ?? []).some((project) => project.isApp) ? (
        <section className="grid gap-3">
          <div>
            <h2 className="font-medium text-lg">Installed Apps</h2>
            <p className="text-muted-foreground text-sm">
              Catalog Apps are managed as normal Upstand projects and keep the
              same deployment, backup, and rollback lifecycle.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(projects.data ?? [])
              .filter((project) => project.isApp)
              .map((project) => (
                <Card
                  className="rounded-2xl border-primary/30"
                  key={project.id}
                >
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{project.name}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {project.appCatalogId ?? "Custom App"}
                        {project.appVersion ? ` · ${project.appVersion}` : ""}
                      </p>
                    </div>
                    <Link
                      className="shrink-0 text-primary text-sm hover:underline"
                      href={`/workspace/projects/${project.id}` as Route}
                    >
                      Open →
                    </Link>
                  </CardContent>
                </Card>
              ))}
          </div>
        </section>
      ) : null}
      {catalog.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : catalog.isError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
          The App catalog is unavailable.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Card
              className="rounded-2xl border-border/70 transition-colors hover:bg-muted/40"
              key={app.id}
            >
              <CardHeader>
                <div className="flex items-start gap-3">
                  {app.logoUrl ? (
                    <Image
                      alt=""
                      className="size-10 rounded-xl border bg-background object-contain p-2"
                      height={40}
                      src={app.logoUrl}
                      unoptimized
                      width={40}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <CardTitle className="text-base">{app.name}</CardTitle>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {app.tags.slice(0, 3).join(" · ") || "Open-source App"}
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  {app.description}
                </p>
              </CardHeader>
              <CardContent>
                <Link
                  className="text-primary text-sm hover:underline"
                  href={
                    `/workspace/apps/new/${encodeURIComponent(app.id)}` as Route
                  }
                >
                  Install App →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
