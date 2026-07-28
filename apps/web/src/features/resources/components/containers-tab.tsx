"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import { cn } from "@upstand/ui/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CircleX,
  Code,
  FileText,
  HardDrive,
  Network,
  Play,
  RotateCw,
  Settings,
  Square,
  Terminal,
  Upload,
} from "@/components/huge-icons";
import { ShowDockerLogs } from "@/components/shared/docker-logs";
import { TerminalDialogShell } from "@/components/shared/terminal-dialog-shell";
import {
  uploadArchive,
  validateArchiveDestination,
  validateArchiveFile,
} from "@/lib/archive-upload";
import { authClient } from "@/lib/auth-client";
import { getServerApiUrl } from "@/lib/server-url";
import type { ResourceDetailState } from "../hooks/use-resource-detail";
import { parseJsonObject } from "./general-tab.helpers";

type ContainerItem = {
  id: string;
  name: string;
  status: string;
  ports: string;
  node: string;
};

interface ContainersTabProps {
  resource: NonNullable<ResourceDetailState["resource"]>;
  secrets: ResourceDetailState["secrets"];
  liveContainers: ResourceDetailState["liveContainers"];
  containerLogsData: ResourceDetailState["containerLogsData"];
  controlContainer: ResourceDetailState["controlContainer"];
  isControllingContainer: boolean;
  setContainerModalOpen: (open: boolean) => void;
  setSelectedContainerId: (id: string | null) => void;
}

function resourceIngressNetwork(
  resource: NonNullable<ResourceDetailState["resource"]>,
): {
  name: string;
  scope: string;
} {
  let isolated = false;
  const config = parseJsonObject(resource.advancedConfig);
  isolated = config.isolatedDeployment === true;

  if (!isolated) {
    return {
      name: "upstand-network",
      scope: "Shared across non-isolated resources, projects, and environments",
    };
  }

  const suffix = String(resource.id)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  return {
    name: `upstand-resource-${suffix}`.slice(0, 63),
    scope:
      "Dedicated to this resource; Caddy is attached only while it has routes",
  };
}

export function ContainersTab({
  resource,
  secrets,
  liveContainers,
  containerLogsData,
  controlContainer,
  isControllingContainer,
  setContainerModalOpen,
  setSelectedContainerId,
}: ContainersTabProps) {
  const { data: organization } = authClient.useActiveOrganization();
  const containerList = (liveContainers ?? []) as ContainerItem[];
  const [selectedContainer, setSelectedContainer] =
    useState<ContainerItem | null>(null);
  const [containerModalType, setContainerModalType] = useState<
    "logs" | "config" | "networks" | "mounts" | null
  >(null);
  const [terminalContainer, setTerminalContainer] =
    useState<ContainerItem | null>(null);
  const [uploadContainerTarget, setUploadContainerTarget] =
    useState<ContainerItem | null>(null);
  const [uploadDestination, setUploadDestination] = useState("/tmp");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const dispatchContainerCommand = (
    containerId: string,
    command: "start" | "stop" | "restart" | "kill",
  ) => {
    toast.info(`Sending ${command} command to container...`);
    controlContainer({
      resourceId: resource.id,
      containerId,
      command,
    });
  };

  const uploadToContainer = async () => {
    if (!organization?.id || !uploadContainerTarget || !uploadFile) return;
    const fileError = validateArchiveFile(uploadFile);
    const destinationError = validateArchiveDestination(uploadDestination);
    if (fileError || destinationError) {
      toast.error(fileError || destinationError);
      return;
    }

    setIsUploading(true);
    try {
      const params = new URLSearchParams({
        organizationId: organization.id,
        destination: uploadDestination.trim(),
        resourceId: resource.id,
      });
      await uploadArchive({
        url: getServerApiUrl(
          `/api/docker/containers/${encodeURIComponent(uploadContainerTarget.id)}/upload?${params.toString()}`,
        ),
        file: uploadFile,
      });
      toast.success(`Archive uploaded to ${uploadContainerTarget.name}`);
      setUploadContainerTarget(null);
      setUploadFile(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Container upload failed",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const containerLogs = containerLogsData
    ? containerLogsData.trim().split("\n")
    : [];
  const ingressNetwork = resourceIngressNetwork(resource);

  const handleOpenModal = (
    container: ContainerItem,
    type: "logs" | "config" | "networks" | "mounts",
  ) => {
    setSelectedContainer(container);
    setContainerModalType(type);
    setSelectedContainerId(container.id);
    setContainerModalOpen(true);
  };

  const handleCloseModal = () => {
    setContainerModalType(null);
    setContainerModalOpen(false);
    setSelectedContainerId(null);
  };

  const getEnvMap = () => {
    return secrets.envVars;
  };

  return (
    <>
      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-semibold text-lg">
            {resource.type === "compose"
              ? resource.composeType === "compose"
                ? "Docker Compose Containers"
                : "Swarm Stack Replicas"
              : "Active Swarm Replicas"}
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            {resource.type === "compose" && resource.composeType === "compose"
              ? "Containers belonging to this Docker Compose project."
              : "Containers matching the deployed resource service specification."}
          </CardDescription>
        </CardHeader>
        <CardContent className="border-border/20 border-t pt-4">
          {containerList.length > 0 ? (
            <div className="overflow-hidden border border-border/20 bg-card/10">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-border/20 border-b bg-muted/10 text-muted-foreground text-xs uppercase">
                    <th className="p-3">Replica Name</th>
                    <th className="p-3">Docker Container ID</th>
                    <th className="p-3">State</th>
                    <th className="p-3">Ports</th>
                    <th className="p-3">Created</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {containerList.map((con) => (
                    <tr
                      key={con.id}
                      className="border-border/10 border-b hover:bg-muted/5"
                    >
                      <td className="p-3 font-semibold text-foreground">
                        {con.name}
                      </td>
                      <td className="p-3 font-mono text-muted-foreground text-xs">
                        {con.id}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              con.status === "running"
                                ? "animate-pulse bg-success"
                                : "bg-muted-foreground/50",
                            )}
                          />
                          <span className="font-semibold text-foreground text-xs uppercase">
                            {con.status}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-muted-foreground text-xs">
                        {con.ports}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {con.node}
                      </td>
                      <td className="p-3 text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions for ${con.name}`}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <Settings className="size-4" aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-48 border border-border/45 bg-card shadow-xl"
                          >
                            <DropdownMenuItem
                              onClick={() =>
                                dispatchContainerCommand(con.id, "restart")
                              }
                            >
                              <RotateCw className="mr-2 size-4" /> Restart
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                dispatchContainerCommand(con.id, "start")
                              }
                            >
                              <Play className="mr-2 size-4" /> Start
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                dispatchContainerCommand(con.id, "stop")
                              }
                            >
                              <Square className="mr-2 size-4 text-destructive" />{" "}
                              Stop
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isControllingContainer}
                              className="text-destructive focus:text-destructive"
                              onClick={() =>
                                dispatchContainerCommand(con.id, "kill")
                              }
                            >
                              <CircleX className="mr-2 size-4" /> Kill
                            </DropdownMenuItem>
                            <hr className="my-1 border-border/20" />
                            <DropdownMenuItem
                              onClick={() => handleOpenModal(con, "logs")}
                            >
                              <FileText className="mr-2 size-4" /> View Logs
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleOpenModal(con, "config")}
                            >
                              <Code className="mr-2 size-4" /> View Config
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleOpenModal(con, "networks")}
                            >
                              <Network className="mr-2 size-4" /> View Networks
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleOpenModal(con, "mounts")}
                            >
                              <HardDrive className="mr-2 size-4" /> View Mounts
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setTerminalContainer(con)}
                            >
                              <Terminal className="mr-2 size-4" /> Open Terminal
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setUploadContainerTarget(con);
                                setUploadDestination("/tmp");
                                setUploadFile(null);
                              }}
                            >
                              <Upload className="mr-2 size-4" /> Upload .tar
                              archive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No containers.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={uploadContainerTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isUploading) {
            setUploadContainerTarget(null);
            setUploadFile(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload archive to container</DialogTitle>
            <DialogDescription>
              Select an uncompressed .tar archive and an absolute destination
              directory inside the container.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label
                className="font-medium text-sm"
                htmlFor="container-archive"
              >
                Archive
              </Label>
              <Input
                id="container-archive"
                type="file"
                accept=".tar,application/x-tar"
                onChange={(event) =>
                  setUploadFile(event.currentTarget.files?.[0] ?? null)
                }
              />
            </div>
            <div className="grid gap-2">
              <Label
                className="font-medium text-sm"
                htmlFor="container-destination"
              >
                Destination directory
              </Label>
              <Input
                id="container-destination"
                value={uploadDestination}
                onChange={(event) => setUploadDestination(event.target.value)}
                placeholder="/tmp"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadContainerTarget(null)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void uploadToContainer()}
              disabled={!uploadFile || isUploading}
            >
              {isUploading ? "Uploading…" : "Upload archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Container detail dialogs */}
      <Dialog
        open={containerModalType !== null}
        onOpenChange={(v) => !v && handleCloseModal()}
      >
        <DialogContent className="no-scrollbar max-h-[90svh] w-[calc(100vw-1rem)] max-w-[min(96vw,48rem)] rounded-2xl border border-border bg-card shadow-2xl sm:min-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-bold text-foreground text-lg">
              {containerModalType === "logs" && (
                <FileText className="size-5 text-primary" />
              )}
              {containerModalType === "config" && (
                <Code className="size-5 text-amber-500" />
              )}
              {containerModalType === "networks" && (
                <Network className="size-5 text-emerald-500" />
              )}
              {containerModalType === "mounts" && (
                <HardDrive className="size-5 text-violet-500" />
              )}
              <span className="capitalize">{containerModalType}</span>:{" "}
              {selectedContainer?.name}
            </DialogTitle>
            <DialogDescription className="font-normal text-muted-foreground text-xs">
              Swarm replica ID: {selectedContainer?.id}
            </DialogDescription>
          </DialogHeader>

          {containerModalType === "logs" && (
            <ShowDockerLogs
              containerId={selectedContainer?.id || ""}
              logs={containerLogs}
            />
          )}

          {containerModalType === "config" && (
            <pre className="max-h-80 select-text overflow-auto rounded-md border border-border/40 bg-muted/20 p-4 font-mono text-xs">
              {JSON.stringify(
                {
                  Image: resource.dockerImage || "app:latest",
                  Service: resource.appName,
                  Labels: {
                    "swarm.service.name": resource.appName,
                    "upstand.resource.id": resource.id,
                  },
                  RestartPolicy: {
                    Name: "on-failure",
                    MaximumRetryCount: 3,
                  },
                  Environment: getEnvMap(),
                },
                null,
                2,
              )}
            </pre>
          )}

          {containerModalType === "networks" && (
            <div className="space-y-3 bg-muted/10 p-4 text-foreground text-sm">
              <div className="flex justify-between border-border/10 border-b pb-1.5">
                <span className="text-muted-foreground">Ingress network</span>
                <span className="font-mono font-semibold">
                  {ingressNetwork.name}
                </span>
              </div>
              <div className="flex justify-between border-border/10 border-b pb-1.5">
                <span className="text-muted-foreground">Sharing scope</span>
                <span className="max-w-[14rem] text-right font-semibold text-xs">
                  {ingressNetwork.scope}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                User-defined Compose networks are preserved. Upstand adds this
                ingress network so Caddy and routed services share a stable DNS
                path.
              </p>
            </div>
          )}

          {containerModalType === "mounts" && (
            <div className="space-y-3 bg-muted/10 p-4 text-foreground text-sm">
              <div className="flex flex-col gap-1 border-border/10 border-b pb-2">
                <span className="font-semibold text-muted-foreground text-xs">
                  VOLUME MOUNT
                </span>
                <span className="font-medium text-primary text-xs">
                  Runtime mount details come from the deployed Docker definition
                  and are not guessed by the dashboard.
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Driver</span>
                <span className="font-mono font-semibold text-xs">
                  local (overlayfs)
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button onClick={handleCloseModal}>Close View</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ContainerTerminalDialog
        resourceId={resource.id}
        container={terminalContainer}
        onClose={() => setTerminalContainer(null)}
      />
    </>
  );
}

function ContainerTerminalDialog({
  resourceId,
  container,
  onClose,
}: {
  resourceId: string;
  container: ContainerItem | null;
  onClose(): void;
}) {
  const { data: organization } = authClient.useActiveOrganization();
  const [token, setToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!container) {
      setToken(null);
    }
  }, [container]);

  const disconnect = () => {
    setToken(null);
  };

  const connect = async () => {
    if (!organization?.id || !container) return;
    setConnecting(true);
    try {
      const response = await fetch(
        getServerApiUrl("/api/container-terminal/session"),
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: organization.id,
            resourceId,
            containerId: container.id,
          }),
        },
      );
      const data = (await response.json()) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !data.token)
        throw new Error(data.error || "Unable to open terminal");
      setToken(data.token);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to open terminal",
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <TerminalDialogShell
      open={Boolean(container)}
      onOpenChange={(open) => !open && onClose()}
      title="Container terminal"
      description={
        <>
          Interactive shell for container{" "}
          <span className="font-mono font-semibold text-foreground">
            {container?.name}
          </span>
          .
        </>
      }
      token={token}
      connecting={connecting}
      emptyMessage="Connecting to container terminal..."
      onTerminalClose={disconnect}
      controls={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button
            className="flex-1 sm:flex-none"
            onClick={connect}
            disabled={connecting || token !== null}
          >
            {connecting
              ? "Connecting…"
              : token !== null
                ? "Connected"
                : "Connect"}
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      }
    />
  );
}
