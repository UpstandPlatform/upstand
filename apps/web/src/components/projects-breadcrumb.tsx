"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  BreadcrumbItem,
  BreadcrumbSeparator,
} from "@upstand/ui/components/breadcrumb";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@upstand/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@upstand/ui/components/popover";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/utils/trpc";

interface ProjectsBreadcrumbProps {
  activeOrg: { id: string; name: string };
  pathname: string;
}

interface BreadcrumbDropdownProps {
  label: string;
  items: Array<{ id: string; name: string }>;
  loading?: boolean;
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  headerAction?: {
    label: string;
    onAction: () => void;
  };
}

function BreadcrumbDropdown({
  label,
  items,
  loading,
  onSelect,
  placeholder = "Search...",
  emptyText = "No items found.",
  headerAction,
}: BreadcrumbDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="group flex max-w-[140px] cursor-pointer items-center gap-1 font-medium text-foreground text-sm hover:text-foreground/80 focus:outline-hidden sm:max-w-[180px]">
        <span className="truncate">{label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-data-open:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[200px] gap-0 overflow-hidden rounded-2xl border border-border/40 p-0 shadow-md"
      >
        <Command className="rounded-none border-none">
          <CommandInput placeholder={placeholder} className="h-8" />
          <CommandList className="max-h-[220px]">
            {headerAction && (
              <>
                <CommandGroup>
                  <CommandItem
                    className="cursor-pointer text-xs"
                    onSelect={() => {
                      headerAction.onAction();
                      setOpen(false);
                    }}
                  >
                    {headerAction.label}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {loading ? (
              <div className="py-4 text-center text-muted-foreground text-xs">
                Loading...
              </div>
            ) : items.length === 0 ? (
              <CommandEmpty className="py-4 text-center text-muted-foreground text-xs">
                {emptyText}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.name}
                    onSelect={() => {
                      onSelect(item.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer text-xs"
                  >
                    {item.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ProjectsBreadcrumb({
  activeOrg,
  pathname,
}: ProjectsBreadcrumbProps) {
  const router = useRouter();
  const organizationId = activeOrg.id;

  // Split pathname: e.g. /projects/proj_id/env_id/res_id
  const segments = pathname.split("/").filter(Boolean);
  const projectId = segments[1];
  const environmentId = segments[2];
  const resourceId = segments[3];

  // Fetch all projects for the organization
  const { data: projects, isLoading: loadingProjects } = useQuery({
    ...trpc.project.list.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Fetch environments if projectId exists
  const { data: environments, isLoading: loadingEnvs } = useQuery({
    ...trpc.environment.list.queryOptions({ projectId: projectId ?? "" }),
    enabled: !!projectId,
  });

  // Fetch resources if environmentId exists
  const { data: resources, isLoading: loadingResources } = useQuery({
    ...trpc.resource.list.queryOptions({ environmentId: environmentId ?? "" }),
    enabled: !!environmentId,
  });

  // Find names in local cache to avoid extra detailed queries
  const currentProject = projects?.find((p) => p.id === projectId);
  const currentProjectName = currentProject?.name || "Project";

  const currentEnv = environments?.find((e) => e.id === environmentId);
  const currentEnvironmentName = currentEnv?.name || "Environment";

  const currentResource = resources?.find((r) => r.id === resourceId);
  const currentResourceName = currentResource?.name || "Resource";

  const projectItems = projects
    ? projects.map((p) => ({ id: p.id, name: p.name }))
    : [];
  const environmentItems = environments
    ? environments.map((e) => ({ id: e.id, name: e.name }))
    : [];
  const resourceItems = resources
    ? resources.map((r) => ({ id: r.id, name: r.name }))
    : [];

  return (
    <>
      {/* LEVEL 1: Projects Page / Current Project */}
      <BreadcrumbItem>
        {!projectId ? (
          <BreadcrumbDropdown
            label="Projects"
            items={projectItems}
            loading={loadingProjects}
            onSelect={(id) => router.push(`/projects/${id}`)}
            placeholder="Search projects..."
            emptyText="No projects found."
          />
        ) : (
          <BreadcrumbDropdown
            label={currentProjectName}
            items={projectItems}
            loading={loadingProjects}
            onSelect={(id) => router.push(`/projects/${id}`)}
            placeholder="Switch project..."
            emptyText="No projects found."
            headerAction={{
              label: "All Projects",
              onAction: () => router.push("/projects"),
            }}
          />
        )}
      </BreadcrumbItem>

      {/* LEVEL 2: Environments */}
      {projectId && (
        <>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {!environmentId ? (
              <BreadcrumbDropdown
                label="Environments"
                items={environmentItems}
                loading={loadingEnvs}
                onSelect={(id) => router.push(`/projects/${projectId}/${id}`)}
                placeholder="Select environment..."
                emptyText="No environments found."
              />
            ) : (
              <BreadcrumbDropdown
                label={currentEnvironmentName}
                items={environmentItems}
                loading={loadingEnvs}
                onSelect={(id) => router.push(`/projects/${projectId}/${id}`)}
                placeholder="Switch environment..."
                emptyText="No environments found."
                headerAction={{
                  label: `${currentProjectName} Overview`,
                  onAction: () => router.push(`/projects/${projectId}`),
                }}
              />
            )}
          </BreadcrumbItem>
        </>
      )}

      {/* LEVEL 3: Resources */}
      {projectId && environmentId && (
        <>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {!resourceId ? (
              <BreadcrumbDropdown
                label="Resources"
                items={resourceItems}
                loading={loadingResources}
                onSelect={(id) =>
                  router.push(`/projects/${projectId}/${environmentId}/${id}`)
                }
                placeholder="Select resource..."
                emptyText="No resources found."
              />
            ) : (
              <BreadcrumbDropdown
                label={currentResourceName}
                items={resourceItems}
                loading={loadingResources}
                onSelect={(id) =>
                  router.push(`/projects/${projectId}/${environmentId}/${id}`)
                }
                placeholder="Switch resource..."
                emptyText="No resources found."
                headerAction={{
                  label: `${currentEnvironmentName} Overview`,
                  onAction: () =>
                    router.push(`/projects/${projectId}/${environmentId}`),
                }}
              />
            )}
          </BreadcrumbItem>
        </>
      )}
    </>
  );
}
