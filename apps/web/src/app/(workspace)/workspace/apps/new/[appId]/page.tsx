"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ServerStack01Icon,
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
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { useSystemConfig } from "@/hooks/use-system-config";
import { trpc } from "@/utils/trpc";

function safeName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
}

export default function WorkspaceAppInstallPage() {
  const params = useParams<{ appId: string }>();
  const appId = decodeURIComponent(params.appId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizationState = useRequiredActiveOrganization();
  const { capabilities } = useSystemConfig();
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : undefined;
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [target, setTarget] = useState(
    capabilities?.localRuntime ? "local" : "",
  );
  const [projectName, setProjectName] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [appName, setAppName] = useState("");

  const catalog = useQuery({
    ...trpc.template.catalog.queryOptions({ page: 1, pageSize: 48 }),
    enabled: Boolean(organizationId),
  });
  const app = catalog.data?.items.find((item) => item.id === appId);
  const projects = useQuery({
    ...trpc.project.list.queryOptions({ organizationId: organizationId ?? "" }),
    enabled: Boolean(organizationId),
  });
  const environments = useQuery({
    ...trpc.environment.list.queryOptions({ projectId }),
    enabled: Boolean(projectId),
  });
  const servers = useQuery({
    ...trpc.server.list.queryOptions({ organizationId: organizationId ?? "" }),
    enabled: Boolean(organizationId && capabilities?.remoteServers),
  });

  const readyServers = (servers.data ?? []).filter(
    (server) => server.status === "ready",
  );
  const selectedEnvironment = environments.data?.find(
    (environment) => environment.id === environmentId,
  );
  const selectedProject = projects.data?.find(
    (project) => project.id === projectId,
  );
  const createProject = useMutation({
    ...trpc.project.create.mutationOptions(),
    onSuccess: async (project) => {
      setProjectId(project.id);
      await queryClient.invalidateQueries({
        queryKey: trpc.project.list.queryKey(),
      });
      toast.success("Project created. Choose its environment to continue.");
    },
    onError: (error) => toast.error(error.message),
  });
  const deploy = useMutation({
    ...trpc.template.deploy.mutationOptions(),
    onSuccess: (resource) => {
      toast.success("App deployment queued");
      router.push(
        `/workspace/projects/${selectedProject?.id ?? ""}/${resource.environmentId}`,
      );
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!app) return;
    const initial = safeName(app.name) || safeName(app.id) || "app";
    setResourceName((current) => current || initial);
    setAppName((current) => current || initial);
  }, [app]);

  useEffect(() => {
    const first =
      environments.data?.find((environment) => environment.isDefault) ??
      environments.data?.[0];
    if (first && !environmentId) setEnvironmentId(first.id);
  }, [environments.data, environmentId]);

  const canSubmit = useMemo(
    () =>
      Boolean(
        organizationId &&
          app &&
          selectedEnvironment &&
          resourceName.trim() &&
          appName.trim() &&
          (target === "local" || target),
      ),
    [app, appName, organizationId, resourceName, selectedEnvironment, target],
  );

  if (organizationState.status === "loading")
    return <Spinner className="mx-auto mt-24" />;
  if (organizationState.status === "unavailable") {
    return (
      <p className="mx-auto max-w-xl rounded-xl border p-6 text-muted-foreground">
        Select a workspace before installing an App.
      </p>
    );
  }
  if (catalog.isPending) return <Spinner className="mx-auto mt-24" />;
  if (!app) {
    return (
      <p className="mx-auto max-w-xl rounded-xl border border-destructive/30 p-6 text-destructive">
        This App is not available in the catalog.
      </p>
    );
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || !selectedEnvironment || !canSubmit) return;
    deploy.mutate({
      organizationId,
      templateId: app.id,
      source: "builtin",
      environmentId: selectedEnvironment.id,
      resourceName: resourceName.trim(),
      appName: appName.trim(),
      composeType: "stack",
      serverId: target === "local" ? undefined : target,
    });
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div>
        <Link
          className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          href={"/workspace/apps/new" as Route}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} /> Back to Apps
        </Link>
        <div className="mt-4 flex items-start gap-4">
          {app.logoUrl ? (
            <Image
              alt=""
              className="size-16 rounded-2xl border bg-background object-contain p-3"
              height={64}
              src={app.logoUrl}
              unoptimized
              width={64}
            />
          ) : null}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-semibold text-3xl tracking-tight">
                Install {app.name}
              </h1>
              <Badge variant="outline">v{app.version}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{app.description}</p>
          </div>
        </div>
      </div>
      <form className="grid gap-6" onSubmit={submit}>
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Project and environment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label>Existing project</Label>
              <Select
                onValueChange={(value) => {
                  setProjectId(value ?? "");
                  setEnvironmentId("");
                }}
                value={projectId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {(projects.data ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Or create a new project below.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-project-name">New project name</Label>
              <Input
                id="new-project-name"
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="e.g. Analytics"
                value={projectName}
              />
              <Button
                disabled={
                  !organizationId ||
                  !projectName.trim() ||
                  createProject.isPending
                }
                onClick={() =>
                  createProject.mutate({
                    organizationId: organizationId as string,
                    name: projectName.trim(),
                    description: `Installed ${app.name}`,
                  })
                }
                type="button"
                variant="outline"
              >
                {createProject.isPending ? <Spinner /> : "Create project"}
              </Button>
            </div>
            <div className="grid gap-2">
              <Label>Environment</Label>
              <Select
                disabled={!projectId}
                onValueChange={(value) => setEnvironmentId(value ?? "")}
                value={environmentId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      projectId
                        ? "Select an environment"
                        : "Choose a project first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(environments.data ?? []).map((environment) => (
                    <SelectItem key={environment.id} value={environment.id}>
                      {environment.name}
                      {environment.isDefault ? " · default" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProject ? (
                <p className="text-muted-foreground text-xs">
                  Deploying into {selectedProject.name}.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Deployment target</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label>Where should this App run?</Label>
              <Select
                disabled={
                  !capabilities?.localRuntime && readyServers.length === 0
                }
                onValueChange={(value) => setTarget(value ?? "")}
                value={target}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a target" />
                </SelectTrigger>
                <SelectContent>
                  {capabilities?.localRuntime ? (
                    <SelectItem value="local">Control plane machine</SelectItem>
                  ) : null}
                  {readyServers.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name} · {server.ipAddress}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {capabilities?.localRuntime
                  ? "Local and ready remote targets are available."
                  : "This control plane requires a ready remote server."}
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="resource-name">Resource name</Label>
                <Input
                  id="resource-name"
                  onChange={(event) => setResourceName(event.target.value)}
                  value={resourceName}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="app-name">App name</Label>
                <Input
                  id="app-name"
                  onChange={(event) => setAppName(event.target.value)}
                  value={appName}
                />
              </div>
            </div>
            <div className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
              <HugeiconsIcon
                className="mb-2 size-5"
                icon={
                  capabilities?.localRuntime && target === "local"
                    ? ServerStack01Icon
                    : ServerStack01Icon
                }
              />
              The App is installed as a normal Upstand project resource. Its
              deployment, logs, domains, environment variables, rollback, and
              backups remain available through the existing lifecycle.
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-wrap justify-end gap-3">
          <Link className="rounded-xl" href={"/workspace/apps" as Route}>
            Cancel
          </Link>
          <Button
            className="rounded-xl"
            disabled={!canSubmit || deploy.isPending}
            type="submit"
          >
            {deploy.isPending ? (
              <Spinner />
            ) : (
              <>
                Install and deploy <HugeiconsIcon icon={ArrowRight01Icon} />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
