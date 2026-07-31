"use client";

import { ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { buttonVariants } from "@upstand/ui/components/button";
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
import { trpc } from "@/utils/trpc";

export default function WorkspaceNewAppPage() {
  const [search, setSearch] = useState("");
  const catalog = useQuery({
    ...trpc.template.catalog.queryOptions({
      search: search.trim() || undefined,
      page: 1,
      pageSize: 48,
    }),
  });
  const apps = (catalog.data?.items ?? []).filter(
    (app) =>
      !app.id.toLowerCase().includes("mail") &&
      !app.name.toLowerCase().includes("mail"),
  );

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            className="text-muted-foreground text-sm hover:text-foreground"
            href="/workspace/apps"
          >
            ← Apps
          </Link>
          <h1 className="mt-2 font-semibold text-3xl tracking-tight">
            Choose an App
          </h1>
          <p className="mt-1 text-muted-foreground">
            Start with a maintained catalog App, then configure its project and
            deployment target.
          </p>
        </div>
        <Link
          className={buttonVariants({
            className: "rounded-xl",
            variant: "outline",
          })}
          href="/templates"
        >
          Custom App
        </Link>
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
      {catalog.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton className="h-44 rounded-2xl" key={index} />
          ))}
        </div>
      ) : catalog.isError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
          The App catalog is unavailable. Try again when the control plane is
          ready.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {apps.map((app) => (
            <Card className="rounded-2xl border-border/70" key={app.id}>
              <CardHeader>
                {app.logoUrl ? (
                  <Image
                    alt=""
                    className="mb-2 size-12 rounded-xl border bg-background object-contain p-2"
                    height={48}
                    src={app.logoUrl}
                    unoptimized
                    width={48}
                  />
                ) : null}
                <CardTitle className="text-base">{app.name}</CardTitle>
                <p className="line-clamp-3 text-muted-foreground text-sm">
                  {app.description}
                </p>
              </CardHeader>
              <CardContent>
                <Link
                  className={buttonVariants({
                    className: "w-full rounded-xl",
                    size: "sm",
                  })}
                  href={
                    `/workspace/apps/new/${encodeURIComponent(app.id)}` as Route
                  }
                >
                  Configure <HugeiconsIcon icon={ArrowRight01Icon} />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
