"use client";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { Separator } from "@upstand/ui/components/separator";
import type { Route } from "next";
import Link from "next/link";
import { EditableEntityIcon } from "@/components/editable-entity-icon";
import {
  ArchiveRestore,
  CopyIcon,
  FolderIcon,
  MoreVerticalIcon,
  Pencil,
  Trash2Icon,
} from "@/components/huge-icons";
import { useProjectCard } from "../hooks/use-project-card";

type Project = inferRouterOutputs<AppRouter>["project"]["list"][number];

export function ProjectCard({
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
  const {
    archiveOrRestore,
    environmentCount,
    formattedCreatedAt,
    isUpdating,
    totalResources,
    updateIcon,
  } = useProjectCard({ project });

  return (
    <Card
      size="sm"
      className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md"
    >
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
            onSaveIcon={updateIcon}
          />
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              <Link
                href={`/projects/${project.id}` as Route}
                className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {project.name}
              </Link>
            </CardTitle>
            <CardDescription>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
                <span>
                  <span className="font-semibold text-foreground">
                    {environmentCount}
                  </span>{" "}
                  {environmentCount === 1 ? "environment" : "environments"}
                </span>
                <span>
                  <span className="font-semibold text-foreground">
                    {totalResources}
                  </span>{" "}
                  {totalResources === 1 ? "resource" : "resources"}
                </span>
              </div>
            </CardDescription>
          </div>
        </div>
        <Badge variant={project.archivedAt ? "secondary" : "success"}>
          {project.archivedAt ? "Archived" : "Active"}
        </Badge>
      </CardHeader>

      {project.description && (
        <CardContent className="line-clamp-2 pt-0 pb-3 text-muted-foreground text-xs leading-relaxed">
          {project.description}
        </CardContent>
      )}

      <Separator />

      <CardFooter className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          Created <span className="font-semibold">{formattedCreatedAt}</span>
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isUpdating}
                aria-label={`Actions for project ${project.name}`}
              >
                <MoreVerticalIcon aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={archiveOrRestore}>
              <ArchiveRestore aria-hidden="true" />
              {project.archivedAt ? "Restore project" : "Archive project"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil aria-hidden="true" />
              Edit project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <CopyIcon aria-hidden="true" />
              Duplicate project
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon aria-hidden="true" />
              Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}
