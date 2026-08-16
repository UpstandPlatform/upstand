"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { ContainerFileExplorer } from "@/components/file-explorer/container-file-explorer";
import {
  ExternalLink,
  FileText,
  FolderOpenIcon,
  HardDrive,
  Info,
  Network,
  ServerIcon,
  X,
} from "@/components/huge-icons";
import { ShowDockerLogs } from "@/components/shared/docker-logs";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import type { DGNode } from "../types";
import { getStatusColor } from "../utils/colors";

export interface TopologyDetailPanelProps {
  node: DGNode | null;
  onClose: () => void;
}

type DestructiveAction = {
  command: "remove" | "remove-volume" | "remove-network";
  label: string;
  description: string;
};

function dockerId(node: DGNode, type: DGNode["type"]): string {
  const prefix = `${type}:`;
  if (!node.id.startsWith(prefix)) return node.id;
  const parts = node.id.split(":");
  return parts.slice(2).join(":") || node.name;
}

function TopologyNodeActions({
  node,
  organizationId,
}: {
  node: DGNode;
  organizationId?: string;
}) {
  const queryClient = useQueryClient();
  const [destructiveAction, setDestructiveAction] =
    useState<DestructiveAction | null>(null);

  const refreshTopology = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.topology.getGraph.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.server.inventory.queryKey(),
    });
  };

  const containerMutation = useMutation({
    ...trpc.server.controlContainer.mutationOptions(),
    onSuccess: () => {
      toast.success("Container command dispatched");
      setDestructiveAction(null);
      refreshTopology();
    },
    onError: (error) => toast.error(error.message),
  });

  const resourceMutation = useMutation({
    ...trpc.server.controlResource.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker resource command dispatched");
      setDestructiveAction(null);
      refreshTopology();
    },
    onError: (error) => toast.error(error.message),
  });

  const serverId = node.serverId ?? "local";
  const isPending = containerMutation.isPending || resourceMutation.isPending;
  const isPlatformNode = node.scope === "platform";
  const containerId = dockerId(node, "container");
  const state = (node.status ?? "").toLowerCase();
  const isRunning =
    state.includes("running") || state.includes("up") || state === "healthy";

  const dispatchContainer = (command: "restart" | "stop" | "start") => {
    if (!organizationId) return;
    containerMutation.mutate({
      organizationId,
      serverId,
      containerId,
      command,
    });
  };

  const dispatchResource = () => {
    if (
      !organizationId ||
      !destructiveAction ||
      destructiveAction.command === "remove"
    )
      return;
    resourceMutation.mutate({
      organizationId,
      serverId,
      resourceId: node.name,
      command: destructiveAction.command,
    });
  };

  const destructiveTitle =
    destructiveAction?.command === "remove"
      ? "Remove container?"
      : destructiveAction?.command === "remove-volume"
        ? "Remove volume?"
        : "Remove network?";

  if (!organizationId) {
    return (
      <p className="text-muted-foreground text-xs">
        Actions are unavailable until an active organization is selected.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {node.type === "container" && !isPlatformNode && (
          <>
            {isRunning ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => dispatchContainer("stop")}
              >
                {containerMutation.isPending ? <Spinner /> : null} Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => dispatchContainer("start")}
              >
                {containerMutation.isPending ? <Spinner /> : null} Start
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => dispatchContainer("restart")}
            >
              Restart
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                setDestructiveAction({
                  command: "remove",
                  label: "Remove",
                  description: `This permanently removes the Docker container “${node.name}”. Its image and named volumes are not removed.`,
                })
              }
            >
              Remove
            </Button>
          </>
        )}

        {node.type === "network" && !isPlatformNode && (
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              setDestructiveAction({
                command: "remove-network",
                label: "Remove network",
                description: `This removes the Docker network “${node.name}” after Docker confirms it is safe to delete. Connected containers may prevent removal.`,
              })
            }
          >
            Remove network
          </Button>
        )}

        {node.type === "volume" && !isPlatformNode && (
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              setDestructiveAction({
                command: "remove-volume",
                label: "Remove volume",
                description: `This permanently removes the Docker volume “${node.name}”. All data stored in it will be lost.`,
              })
            }
          >
            Remove volume
          </Button>
        )}
        {isPlatformNode && (
          <p className="text-muted-foreground text-xs">
            Platform-managed node. Destructive Docker actions are disabled.
          </p>
        )}
      </div>

      <ConfirmActionDialog
        open={Boolean(destructiveAction)}
        onOpenChange={(open) => !open && setDestructiveAction(null)}
        title={destructiveTitle ?? "Confirm Docker action"}
        description={destructiveAction?.description ?? ""}
        actionLabel={destructiveAction?.label ?? "Remove"}
        pending={resourceMutation.isPending || containerMutation.isPending}
        onConfirm={() => {
          if (destructiveAction?.command === "remove") {
            containerMutation.mutate({
              organizationId,
              serverId,
              containerId,
              command: "remove",
            });
          } else {
            dispatchResource();
          }
        }}
        requireConfirmText
      />
    </>
  );
}

export function TopologyDetailPanel({
  node,
  onClose,
}: TopologyDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "files">(
    "overview",
  );
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id;
  const isContainer = node?.type === "container";
  const isVolume = node?.type === "volume";
  const containerId = node ? dockerId(node, "container") : undefined;

  useEffect(() => {
    setActiveTab("overview");
  }, []);

  const logsQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      organizationId: organizationId ?? "",
      serverId: node?.serverId ?? "local",
      kind: "logs",
      containerId: containerId ?? "",
      tail: 150,
    }),
    enabled:
      Boolean(organizationId) &&
      isContainer &&
      activeTab === "logs" &&
      Boolean(containerId),
    refetchInterval: activeTab === "logs" ? 4000 : false,
  });

  const statusInfo = node ? getStatusColor(node.status) : null;
  const resourceHref = useMemo(() => {
    if (!node) return null;
    if (node.type === "container") {
      return `/docker?serverId=${node.serverId ?? "local"}&containerId=${encodeURIComponent(node.name)}`;
    }
    if (node.type === "server" || node.type === "swarm_node") {
      return node.serverId
        ? `/remote-servers?serverId=${encodeURIComponent(node.serverId)}`
        : "/remote-servers";
    }
    if (node.type === "volume") {
      return `/docker?serverId=${node.serverId ?? "local"}&tab=volumes`;
    }
    return `/docker?serverId=${node.serverId ?? "local"}&tab=networks`;
  }, [node]);

  if (!node || !statusInfo) return null;

  const resourceLabel =
    node.type === "container"
      ? "Open in Docker dashboard"
      : node.type === "server" || node.type === "swarm_node"
        ? "Manage server"
        : node.type === "volume"
          ? "Inspect volume"
          : "Inspect network";

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex min-h-0 w-full max-w-full flex-col gap-3 overflow-y-auto border-border border-l bg-card p-3 text-card-foreground shadow-2xl sm:w-[min(36rem,calc(100%-1rem))] sm:p-4 lg:w-[40rem]">
      <div className="flex shrink-0 items-start justify-between gap-3 border-border border-b pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {node.type === "container" && (
            <FileText className="size-5 shrink-0 text-primary" />
          )}
          {node.type === "server" && (
            <ServerIcon className="size-5 shrink-0 text-primary" />
          )}
          {node.type === "swarm_node" && (
            <ServerIcon className="size-5 shrink-0 text-cyan-500" />
          )}
          {node.type === "volume" && (
            <HardDrive className="size-5 shrink-0 text-amber-500" />
          )}
          {node.type === "network" && (
            <Network className="size-5 shrink-0 text-emerald-500" />
          )}
          <div className="min-w-0">
            <span className="block font-bold text-[10px] text-muted-foreground uppercase tracking-wider">
              {node.type.replace("_", " ")}
            </span>
            <h3 className="m-0 break-all font-bold text-foreground text-sm">
              {node.name}
            </h3>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 shrink-0"
          aria-label="Close topology details"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 font-semibold text-xs capitalize"
            style={{
              backgroundColor: statusInfo.bg,
              color: statusInfo.text,
            }}
          >
            ● {node.status ?? "Active"}
          </span>
          {node.serverName && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              Host: {node.serverName}
            </span>
          )}
        </div>
        <TopologyNodeActions node={node} organizationId={organizationId} />
        {resourceHref && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full border-border text-xs"
            nativeButton={false}
            render={
              <Link href={resourceHref as Route}>
                <ExternalLink className="mr-1.5 size-3.5" />
                {resourceLabel}
              </Link>
            }
          />
        )}
      </div>

      {isContainer || isVolume ? (
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "overview" | "logs" | "files")
          }
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList
            className={
              isContainer
                ? "mb-2 grid h-8 grid-cols-2"
                : "mb-2 grid h-8 grid-cols-2"
            }
          >
            <TabsTrigger value="overview" className="font-semibold text-xs">
              <Info className="mr-1 size-3.5" /> Overview
            </TabsTrigger>
            {isContainer ? (
              <TabsTrigger value="logs" className="font-semibold text-xs">
                <FileText className="mr-1 size-3.5" /> Live logs
              </TabsTrigger>
            ) : (
              <TabsTrigger value="files" className="font-semibold text-xs">
                <FolderOpenIcon className="mr-1 size-3.5" /> Files
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent
            value="overview"
            className="mt-0 min-h-0 flex-1 space-y-3 overflow-y-auto text-xs"
          >
            {node.image && (
              <DetailField label="Image tag" value={node.image} mono />
            )}
            {node.ports && node.ports.length > 0 && (
              <div>
                <div className="mb-1.5 font-medium text-[11px] text-muted-foreground">
                  Port mappings
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {node.ports.map((port, portIndex) => (
                    <Badge
                      key={`${port.host}-${port.container}-${port.protocol}-${node.id}-${portIndex}`}
                      variant="outline"
                      className="border-border bg-muted/50 px-2 py-0.5 font-mono text-foreground text-xs"
                    >
                      :{port.host} → :{port.container}/{port.protocol ?? "tcp"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {node.source && (
              <DetailField
                label="Compose project / namespace"
                value={node.source}
              />
            )}
            {node.driver && (
              <DetailField label="Storage driver" value={node.driver} mono />
            )}
            {node.ipAddress && (
              <DetailField label="IP address" value={node.ipAddress} mono />
            )}
            {node.subnet && (
              <DetailField label="Subnet" value={node.subnet} mono />
            )}
            {node.createdAt && (
              <DetailField
                label="Created at"
                value={new Date(node.createdAt).toLocaleString()}
              />
            )}
            {node.type === "volume" && !node.resourceId && (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-muted-foreground">
                This volume is not associated with a managed Upstand resource,
                so file operations are unavailable.
              </p>
            )}
          </TabsContent>

          {isContainer && (
            <TabsContent value="logs" className="mt-0 min-h-0 flex-1">
              <ShowDockerLogs
                containerId={node.name}
                logs={
                  typeof logsQuery.data === "string"
                    ? logsQuery.data
                    : undefined
                }
                isFetching={logsQuery.isFetching}
                maxHeightClass="h-full"
              />
            </TabsContent>
          )}

          {isVolume && (
            <TabsContent
              value="files"
              className="mt-0 min-h-0 flex-1 overflow-hidden"
            >
              {node.resourceId ? (
                <ContainerFileExplorer
                  resourceId={node.resourceId}
                  initialContainerId={node.containerId}
                  initialMountPath={node.mountPath}
                  initialPath="/"
                  title={`Files · ${node.name}`}
                  compact
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-border bg-muted/20 p-6 text-center text-muted-foreground text-xs">
                  <p>
                    File browsing is available for volumes mounted by a managed
                    resource.
                  </p>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-xs">
          {node.role && <DetailField label="Role" value={node.role} />}
          {node.ipAddress && (
            <DetailField label="IP address" value={node.ipAddress} mono />
          )}
          {node.subnet && (
            <DetailField label="Subnet" value={node.subnet} mono />
          )}
          <p className="rounded-md border border-border bg-muted/40 p-3 text-muted-foreground">
            Select a related container, network, or volume to inspect its live
            relationships and available operations.
          </p>
        </div>
      )}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 font-medium text-[11px] text-muted-foreground">
        {label}
      </div>
      <div
        className={`break-all font-semibold text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
