"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
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
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Separator } from "@upstand/ui/components/separator";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import { PageToolbar } from "@/components/dashboard/page-toolbar";
import { EditableEntityIcon } from "@/components/editable-entity-icon";
import {
  AlertTriangleIcon,
  ArchiveRestore,
  CopyIcon,
  FolderIcon,
  Pencil,
  PlusIcon,
  Trash2Icon,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import type { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

const createProjectTarget = getUpGalTargetDefinition("create-project");
const projectNameTarget = getUpGalTargetDefinition("project-name");
const createProjectSubmitTarget = getUpGalTargetDefinition(
  "create-project-submit",
);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type Project = inferRouterOutputs<AppRouter>["project"]["list"][number];
type Environment = inferRouterOutputs<AppRouter>["environment"]["list"][number];

function ProjectCard({
  project,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    ...trpc.project.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.project.list.queryKey(),
      });
    },
  });

  const { data: envs } = useQuery({
    ...trpc.environment.list.queryOptions({ projectId: project.id }),
    enabled: !!project.id,
  });

  const { envCount, totalResources } = useMemo(() => {
    return {
      envCount: envs?.length ?? 0,
      totalResources:
        envs?.reduce((acc, curr) => acc + curr.resourceCount, 0) ?? 0,
    };
  }, [envs]);

  const formattedDate = useMemo(
    () => dateFormatter.format(new Date(project.createdAt)),
    [project.createdAt],
  );

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit();
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDuplicate();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  };

  return (
    <Card size="sm" className="flex flex-col justify-between">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EditableEntityIcon
            icon={project.icon}
            defaultIcon={
              <FolderIcon className="size-4 text-primary" aria-hidden="true" />
            }
            entityName={project.name}
            entityType="project"
            sizeClassName="size-9 rounded-2xl"
            bgClassName="bg-primary/10 text-primary"
            onSaveIcon={async (newIcon) => {
              await updateMutation.mutateAsync({
                id: project.id,
                icon: newIcon,
              });
            }}
          />
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              <Link
                href={`/projects/${project.id}` as Route}
                className="hover:underline"
              >
                {project.name}
              </Link>
            </CardTitle>
            <CardDescription>
              <div className="flex gap-4 text-muted-foreground text-xs">
                <div>
                  <span className="font-semibold text-foreground">
                    {envCount}
                  </span>{" "}
                  {envCount === 1 ? "environment" : "environments"}
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {totalResources}
                  </span>{" "}
                  {totalResources === 1 ? "resource" : "resources"}
                </div>
              </div>
            </CardDescription>
          </div>
        </div>
        <Badge variant={project.archivedAt ? "secondary" : "success"}>
          {project.archivedAt ? "Archived" : "Active"}
        </Badge>
      </CardHeader>

      {project.description && (
        <CardContent className="line-clamp-2 pt-0 pb-3 text-muted-foreground text-xs">
          {project.description}
        </CardContent>
      )}

      <Separator />

      <CardFooter className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Created <span className="font-semibold">{formattedDate}</span>
        </span>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={updateMutation.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    updateMutation.mutate({
                      id: project.id,
                      archived: !project.archivedAt,
                    });
                  }}
                  aria-label={`${project.archivedAt ? "Restore" : "Archive"} project ${project.name}`}
                >
                  <ArchiveRestore aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>
              {project.archivedAt ? "Restore" : "Archive"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleEdit}
                  aria-label={`Edit project ${project.name}`}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleDuplicate}
                  aria-label={`Duplicate project ${project.name}`}
                >
                  <CopyIcon aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Duplicate</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="destructive"
                  size="icon-sm"
                  onClick={handleDelete}
                  aria-label={`Delete project ${project.name}`}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </CardFooter>
    </Card>
  );
}

function DuplicateProjectDialog({
  open,
  onOpenChange,
  project,
  organizationId,
  onDuplicated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: string; name: string } | null;
  organizationId: string;
  onDuplicated: () => void;
}) {
  const [name, setName] = useState("");
  const mutation = useMutation({
    ...trpc.project.duplicate.mutationOptions(),
    onSuccess: () => {
      toast.success("Project duplicated");
      onOpenChange(false);
      onDuplicated();
    },
    onError: (error) =>
      toast.error(error.message || "Failed to duplicate project"),
  });
  useEffect(() => {
    if (open && project) setName(`${project.name} Copy`);
  }, [open, project]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Project</DialogTitle>
          <DialogDescription>
            Copy environments and resource configuration without copying runtime
            deployments.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (project && name.trim())
              mutation.mutate({
                id: project.id,
                organizationId,
                name: name.trim(),
              });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="duplicate-project-name">
                New Project Name
              </FieldLabel>
              <Input
                id="duplicate-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyProjects({
  onNew,
  hasOrganization,
}: {
  onNew: () => void;
  hasOrganization: boolean;
}) {
  const handleAction = () => {
    if (hasOrganization) {
      onNew();
      return;
    }

    // The project API correctly requires an organization. Guide a user who
    // has not completed organization setup to the existing organization
    // dialog instead of opening a project form that can only fail.
    window.dispatchEvent(new CustomEvent("open-create-org-dialog"));
  };

  return (
    <PageEmpty
      icon={FolderIcon}
      title={
        hasOrganization ? "No projects yet" : "Create an organization first"
      }
      description={
        hasOrganization
          ? "Create your first project to start deploying apps and services."
          : "Create an organization to start deploying apps and services."
      }
      action={
        <UpGalTarget definition={createProjectTarget}>
          <Button onClick={handleAction} size="sm" className="mt-1 gap-2">
            <PlusIcon data-icon="inline-start" />
            {hasOrganization ? "Create Project" : "Create Organization"}
          </Button>
        </UpGalTarget>
      }
    />
  );
}

function CreateProjectDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const mutation = useMutation({
    ...trpc.project.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Project created successfully");
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated();
    },
    onError: (err) => toast.error(err.message || "Failed to create project"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-border bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">
            Create Project
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Projects group your environments, apps, and services together.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              mutation.mutate({
                name: name.trim(),
                description: description.trim() || undefined,
                organizationId,
              });
          }}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="proj-name">Project Name</FieldLabel>
              <UpGalTarget definition={projectNameTarget}>
                <Input
                  id="proj-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Production Web App"
                  autoComplete="off"
                  autoFocus
                  className="border-border/40 focus:border-primary"
                />
              </UpGalTarget>
            </Field>
            <Field>
              <FieldLabel htmlFor="proj-desc">
                Description (Optional)
              </FieldLabel>
              <Input
                id="proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Primary production services and APIs"
                autoComplete="off"
                className="border-border/40 focus:border-primary"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <UpGalTarget definition={createProjectSubmitTarget}>
              <Button
                type="submit"
                disabled={mutation.isPending || !name.trim()}
                className="gap-2"
              >
                {mutation.isPending && <Spinner className="size-4" />}
                Create Project
              </Button>
            </UpGalTarget>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectDialog({
  open,
  onOpenChange,
  project,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: { id: string; name: string; description?: string | null } | null;
  onUpdated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open && project) {
      setName(project.name || "");
      setDescription(project.description || "");
    }
  }, [open, project]);

  const mutation = useMutation({
    ...trpc.project.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Project updated successfully");
      onOpenChange(false);
      onUpdated();
    },
    onError: (err) => toast.error(err.message || "Failed to update project"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-border bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">Edit Project</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Update your project's name and description.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (project && name.trim()) {
              mutation.mutate({
                id: project.id,
                name: name.trim(),
                description: description.trim() || null,
              });
            }
          }}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-proj-name">Project Name</FieldLabel>
              <Input
                id="edit-proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production Web App"
                autoComplete="off"
                autoFocus
                className="border-border/40 focus:border-primary"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-proj-desc">
                Description (Optional)
              </FieldLabel>
              <Input
                id="edit-proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Primary production services and APIs"
                autoComplete="off"
                className="border-border/40 focus:border-primary"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
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
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  organizationId,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: { id: string; name: string } | null;
  organizationId: string;
  onDeleted: () => void;
}) {
  const [envsWithResources, setEnvsWithResources] = useState<Environment[]>([]);
  const [_checking, _setChecking] = useState(false);

  const { data: envs } = useQuery({
    ...trpc.environment.list.queryOptions({ projectId: project?.id ?? "" }),
    enabled: !!project?.id,
  });

  useEffect(() => {
    if (envs) {
      const busy = envs.filter((environment) => environment.resourceCount > 0);
      setEnvsWithResources(busy);
    }
  }, [envs]);

  const mutation = useMutation({
    ...trpc.project.deleteProject.mutationOptions(),
    onSuccess: () => {
      toast.success("Project deleted successfully");
      onOpenChange(false);
      onDeleted();
    },
    onError: (err) => toast.error(err.message || "Failed to delete project"),
  });

  const hasBusyEnvironments = envsWithResources.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "rounded-2xl border bg-card shadow-2xl",
          hasBusyEnvironments ? "border-warning/30" : "border-destructive/30",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-bold text-xl">
            {hasBusyEnvironments ? (
              <span className="flex items-center gap-2 text-warning">
                <AlertTriangleIcon className="size-5" />
                Cannot Delete Project
              </span>
            ) : (
              <span className="flex items-center gap-2 text-destructive">
                <AlertTriangleIcon className="size-5" />
                Delete Project
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {hasBusyEnvironments ? (
              <span>
                Project{" "}
                <span className="font-semibold text-foreground">
                  {project?.name}
                </span>{" "}
                contains active resources. You must first delete all resources
                in all environments before you can delete this project.
              </span>
            ) : (
              <span>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">
                  {project?.name}
                </span>
                ? This action is permanent and cannot be undone.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {hasBusyEnvironments && (
          <div className="my-2 flex flex-col gap-2 border-warning/10 bg-warning/5 p-4">
            <h4 className="font-semibold text-warning text-xs uppercase tracking-wider">
              Environments with Resources
            </h4>
            <ul className="flex flex-col gap-1.5 text-sm">
              {envsWithResources.map((env) => (
                <li
                  key={env.id}
                  className="flex items-center justify-between text-muted-foreground"
                >
                  <span>{env.name}</span>
                  <span className="rounded-full bg-warning/10 px-2 py-0.5 font-semibold text-warning text-xs">
                    {env.resourceCount}{" "}
                    {env.resourceCount === 1 ? "resource" : "resources"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {hasBusyEnvironments ? "Close" : "Cancel"}
          </Button>
          {!hasBusyEnvironments && (
            <Button
              type="button"
              variant="destructive"
              disabled={mutation.isPending}
              className="gap-2"
              onClick={() => {
                if (project) {
                  mutation.mutate({ id: project.id, organizationId });
                }
              }}
            >
              {mutation.isPending && <Spinner className="size-4" />} Delete
              Project
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Projects(_props: {
  session: typeof authClient.$Infer.Session;
}) {
  const organizationState = useRequiredActiveOrganization();

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [duplicateProjectOpen, setDuplicateProjectOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<{
    id: string;
    name: string;
    description?: string | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : "";

  const {
    data: projects,
    isLoading: loadingProjects,
    refetch,
  } = useQuery({
    ...trpc.project.list.queryOptions({
      organizationId,
      includeArchived: showArchived,
    }),
    enabled: organizationState.status === "ready",
  });

  const filteredProjects =
    projects?.filter((project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ) ?? [];

  return (
    <DashboardPage>
      {/* Header section */}
      <DashboardPageHeader
        title="Projects"
        description={
          <>
            Manage your apps, databases, and environments under{" "}
            <span className="font-semibold text-foreground">
              {organizationState.organization?.name || "your organization"}
            </span>
            .
          </>
        }
        icon={<FolderIcon className="size-6 text-primary" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowArchived((value) => !value)}
            >
              <ArchiveRestore data-icon="inline-start" />
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            {(filteredProjects.length > 0 || showArchived) && (
              <UpGalTarget definition={createProjectTarget}>
                <Button
                  onClick={() => setCreateProjectOpen(true)}
                  className="gap-2 font-medium"
                  disabled={!organizationId}
                >
                  <PlusIcon data-icon="inline-start" />
                  Create Project
                </Button>
              </UpGalTarget>
            )}
          </div>
        }
      />

      {filteredProjects.length > 0 && (
        <PageToolbar
          search={searchQuery}
          searchPlaceholder="Search projects…"
          onSearchChange={setSearchQuery}
          onClearSearch={() => setSearchQuery("")}
          hasActiveFilters={Boolean(searchQuery)}
        />
      )}

      {/* Projects Grid */}
      {loadingProjects ? (
        <CardGridSkeleton count={3} />
      ) : filteredProjects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredProjects.map((proj) => (
            <ProjectCard
              key={proj.id}
              project={proj}
              onEdit={() => {
                setSelectedProject(proj);
                setEditProjectOpen(true);
              }}
              onDelete={() => {
                setSelectedProject(proj);
                setDeleteProjectOpen(true);
              }}
              onDuplicate={() => {
                setSelectedProject(proj);
                setDuplicateProjectOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyProjects
          hasOrganization={organizationState.status === "ready"}
          onNew={() => setCreateProjectOpen(true)}
        />
      )}

      {/* Modals */}
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        organizationId={organizationId}
        onCreated={refetch}
      />

      <EditProjectDialog
        open={editProjectOpen}
        onOpenChange={setEditProjectOpen}
        project={selectedProject}
        onUpdated={refetch}
      />

      <DeleteProjectDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        project={selectedProject}
        organizationId={organizationId}
        onDeleted={refetch}
      />
      <DuplicateProjectDialog
        open={duplicateProjectOpen}
        onOpenChange={setDuplicateProjectOpen}
        project={selectedProject}
        organizationId={organizationId}
        onDuplicated={refetch}
      />
    </DashboardPage>
  );
}
