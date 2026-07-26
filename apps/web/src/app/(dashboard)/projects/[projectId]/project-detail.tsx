"use client";

import {
  Alert02Icon,
  ArrowRight01Icon,
  ComputerIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import { Separator } from "@upstand/ui/components/separator";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { DangerZoneCard } from "@/components/dashboard/danger-zone-card";
import { EditableEntityIcon } from "@/components/editable-entity-icon";
import { FolderIcon, Trash2Icon } from "@/components/huge-icons";
import type { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

type Project = NonNullable<inferRouterOutputs<AppRouter>["project"]["get"]>;

// ─── Environment Card ──────────────────────────────────────────────────────────

function EnvironmentCard({
  projectId,
  environment,
  onDelete,
}: {
  projectId: string;
  environment: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    isDefault: boolean;
    isProtected: boolean;
    resourceCount: number;
  };
  onDelete: () => void;
}) {
  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  };

  return (
    <Card size="sm" className="flex flex-col justify-between">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <HugeiconsIcon
              icon={ComputerIcon}
              className="size-4"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-md">
              <Link
                href={`/projects/${projectId}/${environment.id}` as Route}
                className="hover:underline"
              >
                {environment.name}
              </Link>
            </CardTitle>
            <CardDescription>
              <span className="text-muted-foreground text-xs">
                <span className="font-semibold text-foreground">
                  {environment.resourceCount}
                </span>{" "}
                {environment.resourceCount === 1 ? "resource" : "resources"}
              </span>
            </CardDescription>
          </div>
        </div>
        {environment.isDefault && <Badge variant="outline">Production</Badge>}
      </CardHeader>

      <CardContent className="text-muted-foreground">
        {environment.description || "No description provided."}
      </CardContent>

      {!environment.isDefault && !environment.isProtected && (
        <>
          <Separator />

          <CardFooter className="flex items-center justify-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    onClick={handleDelete}
                    aria-label={`Delete environment ${environment.name}`}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </CardFooter>
        </>
      )}
    </Card>
  );
}

// ─── Create Env Dialog ─────────────────────────────────────────────────────────

function CreateEnvDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    ...trpc.environment.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Environment created successfully");
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated();
    },
    onError: (err) =>
      toast.error(err.message || "Failed to create environment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-border bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">
            New Environment
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Create an environment (e.g. Staging, Development) to isolate
            resources.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) {
              mutation.mutate({
                projectId,
                name: name.trim(),
                description: description.trim() || undefined,
              });
            }
          }}
          className="space-y-4 pt-2"
        >
          <div className="space-y-2">
            <Label htmlFor="env-name">Environment Name</Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Staging"
              autoComplete="off"
              autoFocus
              className="border-border/40 focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="env-desc">Description (Optional)</Label>
            <Input
              id="env-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Temporary staging environment"
              autoComplete="off"
              className="border-border/40 focus:border-primary"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim()}
              className="gap-2"
            >
              {mutation.isPending && <Spinner className="size-4" />}
              Create Environment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Env Dialog ─────────────────────────────────────────────────────────

function DeleteEnvDialog({
  open,
  onOpenChange,
  environment,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  environment: { id: string; name: string; resourceCount: number } | null;
  onDeleted: () => void;
}) {
  const mutation = useMutation({
    ...trpc.environment.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Environment deleted successfully");
      onOpenChange(false);
      onDeleted();
    },
    onError: (err) =>
      toast.error(err.message || "Failed to delete environment"),
  });

  const hasResources = (environment?.resourceCount ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "rounded-2xl border bg-card shadow-2xl",
          hasResources ? "border-warning/30" : "border-destructive/30",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-bold text-xl">
            {hasResources ? (
              <span className="flex items-center gap-2 text-warning">
                <HugeiconsIcon icon={Alert02Icon} className="size-5" />
                Cannot Delete Environment
              </span>
            ) : (
              <span className="flex items-center gap-2 text-destructive">
                <HugeiconsIcon icon={Alert02Icon} className="size-5" />
                Delete Environment
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {hasResources ? (
              <span>
                Environment{" "}
                <span className="font-semibold text-foreground">
                  {environment?.name}
                </span>{" "}
                contains {environment?.resourceCount} active{" "}
                {environment?.resourceCount === 1 ? "resource" : "resources"}.
                You must delete all resources in this environment before you can
                delete it.
              </span>
            ) : (
              <span>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">
                  {environment?.name}
                </span>
                ? This action is permanent and cannot be undone.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {hasResources ? "Close" : "Cancel"}
          </Button>
          {!hasResources && (
            <Button
              type="button"
              variant="destructive"
              disabled={mutation.isPending}
              className="gap-2"
              onClick={() => {
                if (environment) {
                  mutation.mutate({ id: environment.id });
                }
              }}
            >
              {mutation.isPending && <Spinner className="size-4" />} Delete
              Environment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── General Settings ─────────────────────────────────────────────────────────

function ProjectGeneralSettings({
  project,
}: {
  project: Pick<Project, "id" | "name" | "description">;
}) {
  const [name, setName] = useState(project.name || "");
  const [description, setDescription] = useState(project.description || "");

  useEffect(() => {
    setName(project.name || "");
    setDescription(project.description || "");
  }, [project.name, project.description]);

  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    ...trpc.project.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Project updated successfully");
      queryClient.invalidateQueries({
        queryKey: trpc.project.get.queryKey({ id: project.id }),
      });
      queryClient.invalidateQueries({
        queryKey: trpc.project.list.queryKey(),
      });
    },
    onError: (err) => toast.error(err.message || "Failed to update project"),
  });

  const isChanged =
    name.trim() !== (project.name || "") ||
    description.trim() !== (project.description || "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-semibold text-lg">
          General Settings
        </CardTitle>
        <CardDescription>
          Update your project name and description.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            updateMutation.mutate({
              id: project.id,
              name: name.trim(),
              description: description.trim() || null,
            });
          }
        }}
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="detail-proj-name">Project Name</Label>
            <Input
              id="detail-proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project Name"
              className="border-border/40 focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="detail-proj-desc">Description (Optional)</Label>
            <Input
              id="detail-proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Primary production services and APIs"
              className="border-border/40 focus:border-primary"
            />
          </div>
        </CardContent>
        <CardFooter className="float-end pt-4">
          <Button
            type="submit"
            disabled={!isChanged || !name.trim() || updateMutation.isPending}
            className="gap-2"
          >
            {updateMutation.isPending && <Spinner className="size-4" />}
            Save Changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ─── Main Detail ───────────────────────────────────────────────────────────────

export default function ProjectDetail({
  projectId,
}: {
  projectId: string;
  session: typeof authClient.$Infer.Session;
}) {
  const router = useRouter();
  const [createEnvOpen, setCreateEnvOpen] = useState(false);
  const [deleteEnvOpen, setDeleteEnvOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState<{
    id: string;
    name: string;
    resourceCount: number;
  } | null>(null);

  // Fetch project details
  const { data: project, isPending: loadingProject } = useQuery({
    ...trpc.project.get.queryOptions({ id: projectId }),
  });

  // Fetch environments
  const {
    data: environments,
    isPending: loadingEnvs,
    refetch: refetchEnvs,
  } = useQuery({
    ...trpc.environment.list.queryOptions({ projectId }),
  });

  const queryClient = useQueryClient();
  const updateProjectMutation = useMutation({
    ...trpc.project.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.project.get.queryKey({ id: projectId }),
      });
    },
  });

  // Delete project mutation
  const deleteProjectMutation = useMutation({
    ...trpc.project.deleteProject.mutationOptions(),
    onSuccess: () => {
      toast.success("Project deleted successfully");
      router.push("/projects" as Route);
    },
    onError: (err) => toast.error(err.message || "Failed to delete project"),
  });

  if (loadingProject) {
    return (
      <div className="flex min-h-60 items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4 overflow-x-hidden px-4 py-8 text-center">
        <p className="text-muted-foreground">Project not found.</p>
        <Link href={"/projects" as Route}>
          <Button variant="outline">Back to Projects</Button>
        </Link>
      </div>
    );
  }

  const hasResources =
    environments?.some((environment) => environment.resourceCount > 0) ?? false;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8 overflow-x-hidden px-4 py-8 md:px-8">
      {/* Breadcrumbs / Header */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <Link
            href={"/projects" as Route}
            className="transition-colors hover:text-primary"
          >
            Projects
          </Link>
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
          <span className="min-w-0 truncate font-medium text-foreground">
            {project.name}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <EditableEntityIcon
              icon={project.icon}
              defaultIcon={
                <FolderIcon
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
              }
              entityName={project.name}
              entityType="project"
              sizeClassName="size-11 rounded-2xl"
              bgClassName="bg-primary/10 text-primary"
              onSaveIcon={async (newIcon) => {
                await updateProjectMutation.mutateAsync({
                  id: project.id,
                  icon: newIcon,
                });
              }}
            />
            <div className="min-w-0">
              <h1 className="truncate text-balance font-bold text-2xl text-foreground">
                {project.name}
              </h1>
              <p className="text-muted-foreground text-sm">
                {project.description ||
                  "Project environments and configuration."}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-auto">
            <Button
              onClick={() => setCreateEnvOpen(true)}
              className="w-full gap-2 font-medium sm:w-auto"
            >
              <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              New Environment
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="environments" className="min-w-0 space-y-6">
        <TabsList className="scrollbar-thin w-full max-w-full justify-start">
          <TabsTrigger value="environments">Environments</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="environments" className="outline-none">
          {loadingEnvs ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="size-6" />
            </div>
          ) : environments && environments.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {environments.map((environment) => (
                <EnvironmentCard
                  key={environment.id}
                  projectId={projectId}
                  environment={environment}
                  onDelete={() => {
                    setSelectedEnv(environment);
                    setDeleteEnvOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No environments found.
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="outline-none">
          <div className="max-w-2xl space-y-6">
            {/* General Settings */}
            <ProjectGeneralSettings project={project} />

            {/* Project deletion */}
            <DangerZoneCard
              title="Delete Project"
              description="Permanently delete this project. This will delete all environments and resources inside them."
              actionLabel="Delete Project"
              onAction={() => setDeleteDialogOpen(true)}
              disabled={hasResources}
              pending={deleteProjectMutation.isPending}
              warningText={
                hasResources
                  ? "You must first delete all active resources in your environments to delete the project."
                  : undefined
              }
              infoText={
                !hasResources
                  ? "This project has no active resources and is safe to delete."
                  : undefined
              }
            />
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Project?"
        description={`Are you sure you want to delete "${project.name}"? All associated environments and data will be permanently removed. This action cannot be undone.`}
        actionLabel="Delete Project"
        requireConfirmText={true}
        pending={deleteProjectMutation.isPending}
        onConfirm={() => {
          deleteProjectMutation.mutate({
            id: projectId,
            organizationId: project.organizationId,
          });
        }}
      />

      {/* Modals */}
      <CreateEnvDialog
        open={createEnvOpen}
        onOpenChange={setCreateEnvOpen}
        projectId={projectId}
        onCreated={refetchEnvs}
      />

      <DeleteEnvDialog
        open={deleteEnvOpen}
        onOpenChange={setDeleteEnvOpen}
        environment={selectedEnv}
        onDeleted={refetchEnvs}
      />
    </div>
  );
}
