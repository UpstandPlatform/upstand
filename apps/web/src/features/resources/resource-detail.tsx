"use client";

import {
  ComputerIcon,
  DatabaseIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Badge } from "@upstand/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EditableEntityIcon } from "@/components/editable-entity-icon";
import {
  Activity,
  Clock,
  Code,
  Globe,
  HardDrive,
  RefreshCw,
  Settings,
  Tag01Icon,
  Terminal,
} from "@/components/huge-icons";
import type { authClient } from "@/lib/auth-client";
import { ContainersTab } from "./components/containers-tab";
import { DeploymentsTab } from "./components/deployments-tab";
import { EnvironmentTab } from "./components/environment-tab";
import { MonitoringTab } from "./components/monitoring-tab";
import { TagsTab } from "./components/tags-tab";
import { useResourceDetail } from "./hooks/use-resource-detail";
import {
  determineResourceRuntimeStatus,
  type ResourceRuntimeStatus,
} from "./utils/resource-status";

const BackupPanel = dynamic(() =>
  import("@/features/backups").then((module) => module.BackupPanel),
);
const ConsoleTab = dynamic(() =>
  import("./components/console-tab").then((module) => module.ConsoleTab),
);
const ContainerFileExplorer = dynamic(() =>
  import("@/components/file-explorer/container-file-explorer").then(
    (module) => module.ContainerFileExplorer,
  ),
);
const CronJobsTab = dynamic(() =>
  import("./components/cron-jobs-tab").then((module) => module.CronJobsTab),
);
const DomainsTab = dynamic(() =>
  import("./components/domains-tab").then((module) => module.DomainsTab),
);
const GeneralTab = dynamic(() =>
  import("./components/general-tab").then((module) => module.GeneralTab),
);
const ResourceAdvancedSettings = dynamic(() =>
  import("@/components/resource/resource-advanced-settings").then(
    (module) => module.ResourceAdvancedSettings,
  ),
);
const ShowDockerLogs = dynamic(() =>
  import("@/components/shared/docker-logs").then(
    (module) => module.ShowDockerLogs,
  ),
);

const TYPE_ICONS: Record<string, IconSvgElement> = {
  application: ComputerIcon,
  database: DatabaseIcon,
  compose: ServerStack01Icon,
};

const TYPE_BG: Record<string, string> = {
  application: "bg-primary/10 text-primary",
  database: "bg-warning/10 text-warning",
  compose: "bg-info/10 text-info",
};

const RESOURCE_TABS = new Set([
  "general",
  "environment",
  "advanced",
  "domains",
  "deployments",
  "containers",
  "files",
  "backups",
  "logs",
  "console",
  "monitoring",
  "tags",
  "crons",
]);

interface ResourceDetailProps {
  projectId: string;
  environmentId: string;
  resourceId: string;
  session: typeof authClient.$Infer.Session;
}

function composeFileFromCredentials(credentials: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(credentials);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "composeFile" in parsed &&
      typeof parsed.composeFile === "string"
    ) {
      return parsed.composeFile;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export default function ResourceDetail({
  projectId,
  environmentId,
  resourceId,
}: ResourceDetailProps) {
  const [selectedLogContainerId, setSelectedLogContainerId] = useState("all");
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null,
  );
  const [containerModalOpen, setContainerModalOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    requestedTab && RESOURCE_TABS.has(requestedTab) ? requestedTab : "general",
  );

  useEffect(() => {
    if (requestedTab && RESOURCE_TABS.has(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const changeTab = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === "general") params.delete("tab");
    else params.set("tab", value);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}` as Route, {
      scroll: false,
    });
  };

  const {
    project,
    sshKeys,
    servers,
    gitProviders,
    certificates,
    resource,
    secrets,
    refetchSecrets,
    loadingResource,
    routingTargets,
    liveContainers,
    liveContainersPending,
    liveContainersError,
    deployments,
    refetchDeployments,
    logsData,
    statsData,
    statsError,
    isLoadingStats,
    refetchStats,
    containerLogsData,
    updateResource,
    isUpdatingResource,
    deployResource,
    isDeployingResource,
    controlResource,
    isControllingResource,
    rebuildDatabase,
    isRebuildingDatabase,
    controlContainer,
    isControllingContainer,
    deleteResource,
    isDeletingResource,
  } = useResourceDetail({
    projectId,
    environmentId,
    resourceId,
    activeTab,
    selectedLogContainerId,
    selectedContainerId: selectedContainerId || undefined,
    containerModalOpen,
    statsIntervalEnabled: activeTab === "monitoring",
  });

  const realLogs = useMemo(() => {
    if (!logsData) return [];
    return logsData.trim().split("\n");
  }, [logsData]);

  const containerList = liveContainers ?? [];

  if (loadingResource || !resource) {
    return (
      <div className="flex h-[50dvh] items-center justify-center">
        <RefreshCw className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const runtimeStatus: ResourceRuntimeStatus = liveContainersError
    ? "unknown"
    : liveContainersPending && liveContainers === undefined
      ? "unknown"
      : determineResourceRuntimeStatus(resource.status, liveContainers);
  const displayedStatus =
    runtimeStatus === "unknown" ? resource.status : runtimeStatus;

  const Icon = TYPE_ICONS[resource.type] || ComputerIcon;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-8 overflow-x-hidden px-4 py-8 md:px-8">
      {/* Header section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <EditableEntityIcon
            icon={resource.icon}
            defaultIcon={<HugeiconsIcon icon={Icon} className="size-6" />}
            entityName={resource.name}
            entityType="resource"
            sizeClassName="size-12 rounded-xl"
            bgClassName={TYPE_BG[resource.type] || "bg-primary/10 text-primary"}
            onSaveIcon={async (newIcon) => {
              await updateResource({ id: resource.id, icon: newIcon });
            }}
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-2xl text-foreground">
                {resource.name}
              </h1>
              <Badge variant="outline" className="capitalize">
                {resource.type}
              </Badge>
            </div>
            <p className="mt-1 font-normal text-muted-foreground text-xs">
              Status:{" "}
              <span
                className={cn(
                  "font-bold",
                  runtimeStatus === "running"
                    ? "text-success"
                    : runtimeStatus === "errored"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {displayedStatus}
              </span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
              <HugeiconsIcon icon={ServerStack01Icon} className="size-3.5" />
              Deployed on{" "}
              <span className="font-medium text-foreground">
                {servers.find((server) => server.id === resource.serverId)
                  ?.name ??
                  (resource.serverId === "local"
                    ? "Local Docker"
                    : resource.serverId === "manager"
                      ? "Swarm manager"
                      : "Not assigned")}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={changeTab}
        className="min-w-0 space-y-6"
      >
        <TabsList className="w-full max-w-full justify-start gap-1 overflow-x-auto border border-border/40 bg-card/45 p-1 [scrollbar-width:thin]">
          <TabsTrigger value="general" className="shrink-0 gap-2">
            <Settings className="size-4" /> General
          </TabsTrigger>
          <TabsTrigger value="environment" className="shrink-0 gap-2">
            <Code className="size-4" /> Environment
          </TabsTrigger>
          {resource.type !== "database" && (
            <TabsTrigger value="advanced" className="shrink-0 gap-2">
              <Settings className="size-4" /> Advanced
            </TabsTrigger>
          )}
          {resource.type !== "database" && (
            <TabsTrigger value="domains" className="shrink-0 gap-2">
              <Globe className="size-4" /> Domains
            </TabsTrigger>
          )}
          <TabsTrigger value="deployments" className="shrink-0 gap-2">
            <RefreshCw className="size-4" /> Deployments
          </TabsTrigger>
          <TabsTrigger value="containers" className="shrink-0 gap-2">
            <HugeiconsIcon icon={ServerStack01Icon} className="size-4" />{" "}
            Containers
          </TabsTrigger>
          <TabsTrigger value="files" className="shrink-0 gap-2">
            <HardDrive className="size-4" /> Files
          </TabsTrigger>
          <TabsTrigger value="backups" className="shrink-0 gap-2">
            <HardDrive className="size-4" /> Backups
          </TabsTrigger>
          <TabsTrigger value="logs" className="shrink-0 gap-2">
            <Terminal className="size-4" /> Logs
          </TabsTrigger>
          <TabsTrigger value="console" className="shrink-0 gap-2">
            <Terminal className="size-4" /> Console
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="shrink-0 gap-2">
            <Activity className="size-4" /> Monitoring
          </TabsTrigger>
          <TabsTrigger value="tags" className="shrink-0 gap-2">
            <Tag01Icon className="size-4" /> Tags
          </TabsTrigger>
          {resource.type !== "database" && (
            <TabsTrigger value="crons" className="shrink-0 gap-2">
              <Clock className="size-4" /> Cron Jobs
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general" className="min-w-0 space-y-6 outline-none">
          <GeneralTab
            resource={resource}
            secrets={secrets}
            refetchSecrets={refetchSecrets}
            deployments={deployments}
            sshKeys={sshKeys}
            servers={servers}
            gitProviders={gitProviders}
            updateResource={updateResource}
            isUpdatingResource={isUpdatingResource}
            deployResource={deployResource}
            isDeployingResource={isDeployingResource}
            controlResource={controlResource}
            isControllingResource={isControllingResource}
            rebuildDatabase={rebuildDatabase}
            isRebuildingDatabase={isRebuildingDatabase}
            deleteResource={deleteResource}
            isDeletingResource={isDeletingResource}
            runtimeStatus={runtimeStatus}
          />
        </TabsContent>

        <TabsContent
          value="environment"
          className="min-w-0 space-y-6 outline-none"
        >
          <EnvironmentTab
            resource={resource}
            secrets={secrets}
            updateResource={updateResource}
            isUpdatingResource={isUpdatingResource}
          />
        </TabsContent>

        <TabsContent
          value="advanced"
          className="min-w-0 space-y-6 outline-none"
        >
          <ResourceAdvancedSettings
            resourceId={resourceId}
            resourceType={resource.type}
            advancedConfig={resource.advancedConfig}
            organizationId={project?.organizationId}
            composeFile={
              resource.type === "compose" && secrets.credentials
                ? composeFileFromCredentials(secrets.credentials)
                : undefined
            }
          />
        </TabsContent>

        {resource.type !== "database" && (
          <TabsContent
            value="domains"
            className="min-w-0 space-y-6 outline-none"
          >
            <DomainsTab
              organizationId={project?.organizationId ?? ""}
              resource={resource}
              updateResource={updateResource}
              isUpdatingResource={isUpdatingResource}
              routingTargets={routingTargets}
              certificates={certificates}
              servers={servers}
            />
          </TabsContent>
        )}

        <TabsContent
          value="deployments"
          className="min-w-0 space-y-6 outline-none"
        >
          <DeploymentsTab
            resource={resource}
            deployments={deployments}
            refetchDeployments={refetchDeployments}
            deployResource={deployResource}
            isDeployingResource={isDeployingResource}
            onNavigateToCrons={() => changeTab("crons")}
          />
        </TabsContent>

        <TabsContent
          value="containers"
          className="min-w-0 space-y-6 outline-none"
        >
          <ContainersTab
            resource={resource}
            secrets={secrets}
            liveContainers={liveContainers}
            containerLogsData={containerLogsData}
            controlContainer={controlContainer}
            isControllingContainer={isControllingContainer}
            setContainerModalOpen={setContainerModalOpen}
            setSelectedContainerId={setSelectedContainerId}
          />
        </TabsContent>

        <TabsContent value="files" className="min-w-0 space-y-6 outline-none">
          <ContainerFileExplorer resourceId={resource.id} />
        </TabsContent>

        <TabsContent value="backups" className="min-w-0 space-y-6 outline-none">
          {project?.organizationId && (
            <BackupPanel
              resource={resource}
              organizationId={project.organizationId}
            />
          )}
        </TabsContent>

        <TabsContent value="logs" className="min-w-0 space-y-6 outline-none">
          <Card className="border border-border/40 bg-card/20">
            <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="font-semibold text-lg">
                  Container Logs
                </CardTitle>
                <CardDescription className="font-normal text-muted-foreground text-sm">
                  View live stderr/stdout output streams from active containers.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="log-container-select"
                  className="whitespace-nowrap font-medium text-muted-foreground text-xs"
                >
                  Filter by Container:
                </Label>
                <Select
                  items={[
                    { value: "all", label: "All Containers" },
                    ...containerList.map((con) => ({
                      value: con.id,
                      label: `${con.name} (${con.id.substring(0, 7)})`,
                    })),
                  ]}
                  value={selectedLogContainerId}
                  onValueChange={(value) =>
                    setSelectedLogContainerId(value ?? "all")
                  }
                >
                  <SelectTrigger
                    id="log-container-select"
                    className="h-9 w-56 border-border/40 bg-background text-xs"
                  >
                    <SelectValue placeholder="Select Container" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All Containers
                    </SelectItem>
                    {containerList.map((con) => (
                      <SelectItem
                        key={con.id}
                        value={con.id}
                        className="text-xs"
                      >
                        {con.name} ({con.id.substring(0, 7)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="border-border/20 border-t pt-4">
              <ShowDockerLogs
                containerId={selectedLogContainerId}
                logs={realLogs}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="console" className="min-w-0 space-y-6 outline-none">
          {project?.organizationId && (
            <ConsoleTab
              resource={resource}
              organizationId={project.organizationId}
              containers={containerList}
            />
          )}
        </TabsContent>

        <TabsContent
          value="monitoring"
          className="min-w-0 space-y-6 outline-none"
        >
          <MonitoringTab
            appName={resource.appName ?? resource.name}
            organizationId={project?.organizationId}
            // Resources created on the control plane use a null serverId;
            // their monitoring agent is the local agent.
            serverId={resource.serverId ?? "local"}
            statsData={statsData}
            statsError={statsError}
            isLoadingStats={isLoadingStats}
            refetchStats={refetchStats}
          />
        </TabsContent>
        <TabsContent value="tags" className="min-w-0 space-y-6 outline-none">
          {project?.organizationId && (
            <TagsTab
              resourceId={resourceId}
              organizationId={project.organizationId}
            />
          )}
        </TabsContent>
        {resource.type !== "database" && (
          <TabsContent value="crons" className="min-w-0 space-y-6 outline-none">
            <CronJobsTab resource={resource} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
