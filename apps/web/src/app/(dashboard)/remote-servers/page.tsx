"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import type { ServerType } from "@upstand/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { Checkbox } from "@upstand/ui/components/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { cn } from "@upstand/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import {
  AlertTriangleIcon,
  PlusIcon,
  ServerIcon,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { WebServerTerminalDialog } from "@/components/web-server-terminal-dialog";
import { RemoteServerCard } from "@/features/remote-servers/components/remote-server-card";
import { RemoteServerWizard } from "@/features/remote-servers/components/remote-server-wizard";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

const createServerTarget = getUpGalTargetDefinition("create-server");

export default function RemoteServersPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [serverType, setServerType] = useState<ServerType>("deploy");
  const [sshKeyId, setSshKeyId] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [enableDockerCleanup, setEnableDockerCleanup] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [setupServerId, setSetupServerId] = useState<string | null>(null);
  const [inspectServerId, setInspectServerId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalServerId, setTerminalServerId] = useState<string | undefined>(
    undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const {
    data: servers,
    refetch,
    isPending: loadingServers,
  } = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const { data: sshKeys } = useQuery({
    ...trpc.sshKey.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const createMutation = useMutation({
    ...trpc.server.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Remote server added successfully!");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add remote server");
    },
  });

  const scanHostKeyMutation = useMutation({
    ...trpc.server.scanHostKey.mutationOptions(),
  });

  const deleteMutation = useMutation({
    ...trpc.server.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Remote Server deleted");
      setDeleteTarget(null);
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete server");
    },
  });

  const updateMutation = useMutation({
    ...trpc.server.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Server updated successfully!");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update remote server");
    },
  });

  const setupMutation = useMutation({
    ...trpc.server.setup.mutationOptions(),
    onSuccess: () => {
      refetch();
    },
    onError: () => {
      refetch();
      toast.error("Remote server setup needs attention");
    },
  });

  const resetForm = () => {
    setEditingServerId(null);
    setName("");
    setDescription("");
    setServerType("deploy");
    setSshKeyId("");
    setIpAddress("");
    setPort(22);
    setUsername("root");
    setEnableDockerCleanup(false);
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!name || !ipAddress || !sshKeyId) {
      toast.error("Name, IP Address, and SSH Key are required");
      return;
    }
    const input = {
      organizationId,
      name,
      description: description || null,
      serverType,
      sshKeyId,
      ipAddress,
      port,
      username,
      enableDockerCleanup,
    };
    if (editingServerId) {
      updateMutation.mutate({ ...input, id: editingServerId });
    } else {
      toast.loading("Scanning remote server SSH host key...", {
        id: "host-key-scan",
      });
      scanHostKeyMutation.mutate(
        {
          organizationId,
          ipAddress: ipAddress.trim(),
          port,
        },
        {
          onSuccess: (data) => {
            toast.success(
              `Trusted host key fingerprint (${data.algorithm}): ${data.fingerprint}`,
              { id: "host-key-scan" },
            );
            createMutation.mutate({
              ...input,
              sshHostKeyFingerprint: data.fingerprint,
            });
          },
          onError: (err) => {
            toast.error(
              `Could not retrieve server SSH host key: ${err.message || "Connection refused"}. Please check if the IP and SSH port are correct and try again.`,
              { id: "host-key-scan", duration: 6000 },
            );
          },
        },
      );
    }
  };

  const handleTerminal = (serverId: string) => {
    setTerminalServerId(serverId);
    setTerminalOpen(true);
  };

  const handleEdit = (server: {
    id: string;
    name: string;
    description?: string | null;
    serverType: ServerType;
    sshKeyId?: string | null;
    ipAddress: string;
    port: number;
    username: string;
    enableDockerCleanup: boolean;
  }) => {
    setEditingServerId(server.id);
    setName(server.name);
    setDescription(server.description ?? "");
    setServerType(server.serverType);
    setSshKeyId(server.sshKeyId ?? "");
    setIpAddress(server.ipAddress);
    setPort(server.port);
    setUsername(server.username);
    setEnableDockerCleanup(server.enableDockerCleanup);
    setDialogOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const handleSetup = (id: string) => {
    setupMutation.reset();
    setSetupServerId(id);
    setupMutation.mutate({ id });
  };

  const setupServer = servers?.find((server) => server.id === setupServerId);
  const validationQuery = useQuery({
    ...trpc.server.validate.queryOptions({
      organizationId,
      serverId: inspectServerId || "",
    }),
    enabled: Boolean(organizationId && inspectServerId),
  });
  const hostTimeQuery = useQuery({
    ...trpc.server.time.queryOptions({
      organizationId,
      serverId: inspectServerId || "",
    }),
    enabled: Boolean(organizationId && inspectServerId),
  });
  const runtimeStatsQuery = useQuery({
    ...trpc.server.runtimeStats.queryOptions({
      organizationId,
      serverId: inspectServerId || "",
    }),
    enabled: Boolean(organizationId && inspectServerId),
  });
  const validationInfo =
    validationQuery.data &&
    typeof validationQuery.data === "object" &&
    !Array.isArray(validationQuery.data)
      ? (validationQuery.data as {
          serverVersion?: string;
          swarmState?: string;
        })
      : undefined;
  const closeSetupDialog = () => {
    if (setupMutation.isPending) return;
    setSetupServerId(null);
    setupMutation.reset();
  };

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Remote Servers"
        description={
          <span className="flex items-center gap-2">
            <span>
              Add isolated deploy, build, and database hosts with role-specific
              provisioning.
            </span>
          </span>
        }
        icon={<ServerIcon className="size-6 text-primary" />}
        actions={
          <div className="flex items-center gap-2">
            <UpGalTarget definition={createServerTarget}>
              <Button
                onClick={() => {
                  if (!servers || servers.length === 0) {
                    setWizardOpen(true);
                  } else {
                    resetForm();
                    setDialogOpen(true);
                  }
                }}
                className="gap-2 self-start sm:self-auto"
              >
                <PlusIcon data-icon="inline-start" />
                Create Server
              </Button>
            </UpGalTarget>
          </div>
        }
      />

      {loadingServers ? (
        <CardGridSkeleton count={3} />
      ) : servers && servers.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((srv) => (
            <RemoteServerCard
              key={srv.id}
              server={srv}
              onTerminal={handleTerminal}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onSetup={handleSetup}
              onInspect={setInspectServerId}
            />
          ))}
        </div>
      ) : (
        <PageEmpty
          icon={ServerIcon}
          title="No remote servers yet"
          description="Follow our step-by-step onboarding wizard to connect, provision, and verify your virtual private server."
          action={
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <UpGalTarget definition={createServerTarget}>
                <Button
                  onClick={() => setWizardOpen(true)}
                  size="lg"
                  className="gap-2 font-semibold shadow-lg shadow-primary/20"
                >
                  <PlusIcon data-icon="inline-start" />
                  Start Onboarding Wizard
                </Button>
              </UpGalTarget>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setDialogOpen(true);
                }}
              >
                Quick Add (Skip Wizard)
              </Button>
            </div>
          }
        />
      )}

      <Dialog
        open={!!inspectServerId}
        onOpenChange={(open) => !open && setInspectServerId(null)}
      >
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg flex-col overflow-hidden rounded-2xl border bg-background p-0 shadow-xl">
          <DialogHeader className="shrink-0 border-b bg-muted/30 p-4 sm:p-5">
            <DialogTitle className="flex items-center gap-2 font-bold text-base sm:text-lg">
              <ServerIcon className="size-5 text-primary" />
              Server Validation
            </DialogTitle>
            <DialogDescription className="text-xs">
              Real-time Docker daemon status, clock synchronization, and
              resource metrics for{" "}
              <strong className="text-foreground">
                {servers?.find((s) => s.id === inspectServerId)?.name}
              </strong>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-xs sm:p-5">
            {/* Docker Daemon */}
            <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-card-foreground transition-colors hover:border-border">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-foreground text-xs">
                  <span className="relative flex size-2">
                    {validationQuery.isPending ? (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    ) : null}
                    <span
                      className={cn(
                        "relative inline-flex size-2 rounded-full",
                        validationQuery.isPending
                          ? "bg-primary"
                          : validationQuery.isError
                            ? "bg-destructive"
                            : "bg-primary",
                      )}
                    />
                  </span>
                  Docker Daemon Validation
                </span>
                <Badge
                  variant={
                    validationQuery.isPending
                      ? "outline"
                      : validationQuery.isError
                        ? "destructive"
                        : "default"
                  }
                  className="text-[10px]"
                >
                  {validationQuery.isPending
                    ? "Checking"
                    : validationQuery.isError
                      ? "Failed"
                      : "Operational"}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground leading-relaxed">
                {validationQuery.isPending
                  ? "Verifying Docker version and daemon state..."
                  : validationQuery.isError
                    ? validationQuery.error.message
                    : `Version: ${validationInfo?.serverVersion ?? "unknown"}\nSwarm State: ${validationInfo?.swarmState ?? "unknown"}`}
              </p>
            </div>

            {/* Host Clock Sync */}
            <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-card-foreground transition-colors hover:border-border">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-foreground text-xs">
                  <span className="relative flex size-2">
                    {hostTimeQuery.isPending ? (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    ) : null}
                    <span
                      className={cn(
                        "relative inline-flex size-2 rounded-full",
                        hostTimeQuery.isPending
                          ? "bg-primary"
                          : hostTimeQuery.isError
                            ? "bg-destructive"
                            : "bg-primary",
                      )}
                    />
                  </span>
                  Host Clock Sync
                </span>
                <Badge
                  variant={
                    hostTimeQuery.isPending
                      ? "outline"
                      : hostTimeQuery.isError
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px]"
                >
                  {hostTimeQuery.isPending
                    ? "Syncing"
                    : hostTimeQuery.isError
                      ? "Error"
                      : "Synced"}
                </Badge>
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground leading-relaxed">
                {hostTimeQuery.isPending
                  ? "Reading host clock..."
                  : hostTimeQuery.isError
                    ? hostTimeQuery.error.message
                    : `ISO: ${hostTimeQuery.data?.iso}`}
              </p>
            </div>

            {/* Runtime Metrics */}
            <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-card-foreground transition-colors hover:border-border">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-foreground text-xs">
                  <span className="relative flex size-2">
                    {runtimeStatsQuery.isPending ? (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    ) : null}
                    <span
                      className={cn(
                        "relative inline-flex size-2 rounded-full",
                        runtimeStatsQuery.isPending
                          ? "bg-primary"
                          : runtimeStatsQuery.isError
                            ? "bg-destructive"
                            : "bg-primary",
                      )}
                    />
                  </span>
                  Runtime Metrics
                </span>
                <Badge
                  variant={
                    runtimeStatsQuery.isPending
                      ? "outline"
                      : runtimeStatsQuery.isError
                        ? "destructive"
                        : "outline"
                  }
                  className="text-[10px]"
                >
                  {runtimeStatsQuery.isPending
                    ? "Fetching"
                    : runtimeStatsQuery.isError
                      ? "Offline"
                      : "Metrics Live"}
                </Badge>
              </div>
              <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
                {runtimeStatsQuery.isPending ? (
                  <p>Reading Docker runtime stats...</p>
                ) : runtimeStatsQuery.isError ? (
                  <p className="text-destructive">
                    {runtimeStatsQuery.error.message}
                  </p>
                ) : runtimeStatsQuery.data ? (
                  <>
                    <p>
                      Docker Engine:{" "}
                      {runtimeStatsQuery.data.dockerVersion || "unknown"}
                    </p>
                    <p>
                      Active Containers:{" "}
                      {runtimeStatsQuery.data.activeContainers}
                    </p>
                    <p>CPU Utilization: {runtimeStatsQuery.data.cpu}%</p>
                    <p>
                      Memory Utilization: {runtimeStatsQuery.data.memoryPercent}
                      %
                    </p>
                  </>
                ) : (
                  <p>No runtime metrics available</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-muted/30 p-4">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setInspectServerId(null)}
            >
              Close Validation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingServerId ? "Update Server" : "Create Server"}
            </DialogTitle>
            <DialogDescription>
              {editingServerId
                ? "Update the server role, connection, or cleanup policy. Connection changes require setup again."
                : "Link a remote virtual private server (VPS) by configuring its network and auth credentials."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Server Name</Label>
              <Input
                id="name"
                required
                placeholder="Khan Server"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="e.g. Production deploy instance"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="serverType">Server Type</Label>
              <Select
                items={[
                  { value: "deploy", label: "Deploy Server" },
                  { value: "build", label: "Build Server" },
                  { value: "database", label: "DB Server" },
                ]}
                value={serverType}
                onValueChange={(value) =>
                  value && setServerType(value as ServerType)
                }
              >
                <SelectTrigger id="serverType" className="w-full">
                  <SelectValue placeholder="Select server type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deploy">Deploy Server</SelectItem>
                  <SelectItem value="build">Build Server</SelectItem>
                  <SelectItem value="database">DB Server</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {serverType === "deploy"
                  ? "Deploy hosts run Swarm, Caddy, and monitoring for application, database, and Compose workloads."
                  : serverType === "build"
                    ? "Build hosts run Docker and monitoring only; they compile application images but never receive deployed workloads."
                    : "Database hosts run an isolated Swarm and monitoring for database resources only; they do not expose Caddy."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sshKeyId">Select an SSH Key</Label>
              <Select
                items={(sshKeys ?? []).map((key) => ({
                  value: key.id,
                  label: `${key.name} (${key.algorithm})`,
                }))}
                value={sshKeyId}
                onValueChange={(value) => setSshKeyId(value ?? "")}
              >
                <SelectTrigger id="sshKeyId" className="w-full">
                  <SelectValue placeholder="Choose an SSH key" />
                </SelectTrigger>
                <SelectContent>
                  {sshKeys?.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      {key.name} ({key.algorithm})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ipAddress">IP Address</Label>
              <Input
                id="ipAddress"
                required
                placeholder="82.25.116.121"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  required
                  placeholder="22"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  required
                  placeholder="root"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="enableDockerCleanup"
                checked={enableDockerCleanup}
                onCheckedChange={(val) => setEnableDockerCleanup(Boolean(val))}
              />
              <Label
                htmlFor="enableDockerCleanup"
                className="cursor-pointer select-none text-xs"
              >
                Enable automatic daily Docker cleanup
              </Label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving..."
                  : editingServerId
                    ? "Update"
                    : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(setupServer)}
        onOpenChange={(open) => {
          if (!open) closeSetupDialog();
        }}
      >
        <DialogContent
          className="max-w-lg"
          showCloseButton={!setupMutation.isPending}
        >
          <DialogHeader>
            <DialogTitle>
              {setupMutation.isSuccess
                ? "Server ready"
                : setupMutation.isError
                  ? "Setup needs attention"
                  : `Setting up ${setupServer?.name ?? "server"}`}
            </DialogTitle>
            <DialogDescription>
              Upstand installs and verifies Docker, initializes this server's
              independent Swarm, creates its network, and starts Caddy routing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              {setupMutation.isPending ? (
                <Spinner className="size-5 shrink-0 text-primary" />
              ) : setupMutation.isSuccess ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 font-bold text-success text-xs">
                  ✓
                </span>
              ) : (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 font-bold text-destructive text-xs">
                  !
                </span>
              )}
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  {setupServer?.name ?? "Remote server"}
                </p>
                <p className="break-all text-muted-foreground text-xs">
                  {setupServer?.ipAddress}:{setupServer?.port}
                </p>
              </div>
            </div>

            {setupMutation.isPending && (
              <p className="text-muted-foreground text-sm">
                Provisioning Docker, the local Swarm, the Upstand network, and
                the routing service. This can take a few minutes on a new VPS.
              </p>
            )}

            {setupMutation.isSuccess && (
              <p className="text-sm text-success">
                {setupMutation.data.message}
              </p>
            )}

            {setupMutation.isError && (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle className="break-words">
                  {setupMutation.error.message}
                </AlertTitle>
                <AlertDescription>
                  Upstand does not force-leave an existing Swarm. An active
                  existing Swarm can be reused; if initialization failed,
                  resolve the Docker or advertised-address issue on the server,
                  then retry setup.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeSetupDialog}
              disabled={setupMutation.isPending}
            >
              Close
            </Button>
            {setupMutation.isError && setupServerId && (
              <Button
                type="button"
                onClick={() => handleSetup(setupServerId)}
                disabled={setupMutation.isPending}
              >
                Retry setup
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "Remote Server"}?`}
        description={`${deleteTarget?.name ?? "This remote server"} will be removed from the organization. Existing workloads on the host are not deleted. This action cannot be undone.`}
        actionLabel="Delete Server"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
        }}
      />

      <RemoteServerWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        organizationId={organizationId}
        onComplete={() => refetch()}
      />

      <WebServerTerminalDialog
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        serverId={terminalServerId}
      />
    </DashboardPage>
  );
}
