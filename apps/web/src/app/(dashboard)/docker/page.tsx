"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Skeleton } from "@upstand/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import {
  CardGridSkeleton,
  TableSkeleton,
} from "@/components/dashboard/page-skeleton";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Code,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Info,
  Layers,
  LineChart,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  Server,
  Square,
  Trash2,
  Upload,
} from "@/components/huge-icons";
import { CodeBlock } from "@/components/shared/code-block";
import { ShowDockerLogs } from "@/components/shared/docker-logs";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import {
  uploadArchive,
  validateArchiveDestination,
  validateArchiveFile,
} from "@/lib/archive-upload";
import { getServerApiUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";

const kinds = [
  { id: "info", label: "Overview", icon: Info },
  { id: "containers", label: "Containers", icon: Server },
  { id: "images", label: "Images", icon: Layers },
  { id: "volumes", label: "Volumes", icon: HardDrive },
  { id: "networks", label: "Networks", icon: Network },
  { id: "services", label: "Services", icon: Activity },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "stats", label: "Live Stats", icon: LineChart },
] as const;

type DockerContainerState =
  | "created"
  | "running"
  | "paused"
  | "restarting"
  | "removing"
  | "exited"
  | "dead";
type DockerInventoryLogLevel =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "debug";

interface DockerInfo {
  name: string;
  serverVersion: string;
  operatingSystem: string;
  architecture: string;
  containers: number;
  images: number;
  memoryBytes: number;
  swarmState: string;
}

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  mounts: string[];
  networks: string[];
  labels: string[];
  createdAt: string | null;
}

interface DockerImage {
  id: string;
  tags: string[];
  sizeBytes: number;
  createdAt: string | null;
}

interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
}

interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
}

interface DockerServiceSummary {
  id: string;
  name: string;
  mode: string;
  replicas: string;
  image: string;
  ports: string;
}

interface DockerContainerStats {
  containerId: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

function isDockerContainerState(value: string): value is DockerContainerState {
  return [
    "created",
    "running",
    "paused",
    "restarting",
    "removing",
    "exited",
    "dead",
  ].includes(value);
}

function isDockerInventoryLogLevel(
  value: string,
): value is DockerInventoryLogLevel {
  return ["error", "warning", "success", "info", "debug"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isDockerContainer(value: unknown): value is DockerContainer {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.image) &&
    isString(value.state) &&
    isString(value.status) &&
    isString(value.ports) &&
    isStringArray(value.mounts) &&
    isStringArray(value.networks) &&
    isStringArray(value.labels) &&
    (value.createdAt === null || isString(value.createdAt))
  );
}

function isDockerImage(value: unknown): value is DockerImage {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isStringArray(value.tags) &&
    isNumber(value.sizeBytes) &&
    (value.createdAt === null || isString(value.createdAt))
  );
}

function isDockerVolume(value: unknown): value is DockerVolume {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.driver) &&
    isString(value.mountpoint)
  );
}

function isDockerNetwork(value: unknown): value is DockerNetwork {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.driver) &&
    isString(value.scope) &&
    isBoolean(value.internal) &&
    isBoolean(value.attachable)
  );
}

function isDockerService(value: unknown): value is DockerServiceSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.mode) &&
    isString(value.replicas) &&
    isString(value.image) &&
    isString(value.ports)
  );
}

function isDockerInfo(value: unknown): value is DockerInfo {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.serverVersion) &&
    isString(value.operatingSystem) &&
    isString(value.architecture) &&
    isNumber(value.containers) &&
    isNumber(value.images) &&
    isNumber(value.memoryBytes) &&
    isString(value.swarmState)
  );
}

function isDockerStats(value: unknown): value is DockerContainerStats {
  return (
    isRecord(value) &&
    isString(value.containerId) &&
    isNumber(value.cpuPercent) &&
    isNumber(value.memoryUsageBytes) &&
    isNumber(value.memoryLimitBytes) &&
    isNumber(value.memoryPercent) &&
    isNumber(value.networkRxBytes) &&
    isNumber(value.networkTxBytes) &&
    isNumber(value.blockReadBytes) &&
    isNumber(value.blockWriteBytes) &&
    isNumber(value.pids)
  );
}

function getInventoryItems<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

type PendingRemoval =
  | { kind: "container"; id: string; label: string }
  | {
      kind: "resource";
      id: string;
      label: string;
      command: "remove-image" | "remove-network" | "remove-volume";
    };

export default function DockerInventoryPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : "";
  const [serverId, setServerId] = useState("local");
  const [kind, setKind] = useState<(typeof kinds)[number]["id"]>("info");

  // Filtering & controls states
  const [containerId, setContainerId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [since, setSince] = useState("");
  const [tail, setTail] = useState("150");
  const [logSearch] = useState("");
  const [logLevels] = useState<string[]>([]);
  const [volumeDestination, setVolumeDestination] = useState("/");
  const [containerDestination, setContainerDestination] = useState("/tmp");
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(
    null,
  );

  // Auto-scroll logic for logs
  const [autoScroll] = useState(true);
  const logContainerRef = useRef<HTMLPreElement>(null);

  // Developer panel toggle
  const [showRawJson, setShowRawJson] = useState(false);

  // Queries
  const serversQuery = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  // Query all containers on the server to populate logs/stats selects
  const containersQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      organizationId,
      serverId,
      kind: "containers",
    }),
    enabled: organizationState.status === "ready",
  });

  const inventoryQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      organizationId,
      serverId,
      kind,
      containerId:
        (kind === "logs" || kind === "stats") && containerId
          ? containerId
          : undefined,
      serviceName: kind === "logs" && serviceName ? serviceName : undefined,
      search: kind === "containers" && search ? search : undefined,
      state:
        kind === "containers" && state
          ? isDockerContainerState(state)
            ? state
            : undefined
          : undefined,
      since:
        kind === "logs" && since
          ? Math.floor(new Date(since).getTime() / 1000)
          : undefined,
      searchLogs: kind === "logs" && logSearch ? logSearch : undefined,
      logLevels:
        kind === "logs" && logLevels.length > 0
          ? logLevels.filter(isDockerInventoryLogLevel)
          : undefined,
      tail: Math.min(1000, Math.max(1, Number(tail) || 150)),
    }),
    enabled:
      Boolean(organizationId) &&
      // logs requires at least a container ID or service name to avoid a server-side error
      (kind !== "logs" || Boolean(containerId) || Boolean(serviceName)) &&
      // stats requires a container ID
      (kind !== "stats" || Boolean(containerId)),
    refetchInterval:
      kind === "stats" ? 3_000 : kind === "info" ? 10_000 : false,
  });

  const dockerInfo = isDockerInfo(inventoryQuery.data)
    ? inventoryQuery.data
    : null;
  const dockerStats = isDockerStats(inventoryQuery.data)
    ? inventoryQuery.data
    : null;

  // Keep logs scrolled down if auto-scroll is checked
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll height updates are driven by data updates
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [inventoryQuery.data, autoScroll]);

  // Mutations
  const controlContainer = useMutation({
    ...trpc.server.controlContainer.mutationOptions(),
    onSuccess: () => {
      toast.success("Container command completed");
      setPendingRemoval(null);
      void inventoryQuery.refetch();
      void containersQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const controlResource = useMutation({
    ...trpc.server.controlResource.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker resource removed");
      setPendingRemoval(null);
      void inventoryQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadVolume = async (volumeName: string, file: File) => {
    if (!organizationId) return;
    const destination = volumeDestination || "/";
    const destinationError = validateArchiveDestination(destination);
    const fileError = validateArchiveFile(file);
    if (destinationError || fileError) {
      toast.error(destinationError || fileError);
      return;
    }
    try {
      const params = new URLSearchParams({
        organizationId,
        destination,
      });
      if (serverId !== "local") params.set("serverId", serverId);
      await uploadArchive({
        url: getServerApiUrl(
          `/api/docker/volumes/${encodeURIComponent(volumeName)}/upload?${params.toString()}`,
        ),
        file,
      });
      toast.success(`Archive uploaded to ${volumeName}`);
      void inventoryQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Volume upload failed",
      );
    }
  };

  const uploadContainer = async (cId: string, file: File) => {
    if (!organizationId) return;
    const destination = containerDestination || "/tmp";
    const destinationError = validateArchiveDestination(destination);
    const fileError = validateArchiveFile(file);
    if (destinationError || fileError) {
      toast.error(destinationError || fileError);
      return;
    }
    try {
      const params = new URLSearchParams({
        organizationId,
        destination,
      });
      if (serverId !== "local") params.set("serverId", serverId);
      await uploadArchive({
        url: getServerApiUrl(
          `/api/docker/containers/${encodeURIComponent(cId)}/upload?${params.toString()}`,
        ),
        file,
      });
      toast.success("Archive uploaded to container");
      void inventoryQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Container upload failed",
      );
    }
  };

  const activeServerName =
    serverId === "local"
      ? "Local Daemon"
      : ((serversQuery.data ?? []).find((s) => s.id === serverId)?.name ??
        "Remote Daemon");

  // Render container list helper
  const availableContainers = getInventoryItems(
    containersQuery.data,
    isDockerContainer,
  );

  return (
    <DashboardPage className="flex-1">
      <DashboardPageHeader
        title="Docker Inventory"
        icon={<Database className="size-6 text-primary" />}
        description="Inspect, monitor, and manage containers, images, volumes, services, and logs across target servers."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={serverId}
              onValueChange={(val) => {
                setServerId(val ?? "local");
                setContainerId("");
              }}
            >
              <SelectTrigger className="w-64">
                <Server className="mr-2 size-4 text-primary" />
                <SelectValue placeholder="Docker Target" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="local">Local Docker Daemon</SelectItem>
                  {(serversQuery.data ?? []).map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name} ({server.ipAddress})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void inventoryQuery.refetch();
                void containersQuery.refetch();
              }}
              disabled={inventoryQuery.isLoading}
            >
              <RefreshCw
                className={`size-4 ${inventoryQuery.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Navigation Sidebar */}
        <div className="flex flex-col gap-1">
          {kinds.map((item) => {
            const Icon = item.icon;
            const isActive = kind === item.id;
            return (
              <Button
                key={item.id}
                variant={isActive ? "secondary" : "ghost"}
                className={`h-10 justify-start gap-2 px-3 ${
                  isActive
                    ? "bg-muted/80 font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
                onClick={() => setKind(item.id)}
              >
                <Icon className={`size-4 ${isActive ? "text-primary" : ""}`} />
                {item.label}
              </Button>
            );
          })}
        </div>

        {/* Tab Detail Panel */}
        <div className="min-w-0 space-y-6">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="border-b pb-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="font-bold text-xl capitalize">
                    {kinds.find((k) => k.id === kind)?.label}
                  </CardTitle>
                  <CardDescription>
                    Docker target:{" "}
                    <span className="font-semibold text-foreground">
                      {activeServerName}
                    </span>
                  </CardDescription>
                </div>
                {inventoryQuery.isLoading && (
                  <Badge variant="outline" className="animate-pulse">
                    Loading Docker data…
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {inventoryQuery.isLoading ? (
                kind === "info" || kind === "stats" ? (
                  <CardGridSkeleton count={3} />
                ) : kind === "logs" ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-48 w-full" />
                  </div>
                ) : (
                  <TableSkeleton columns={5} rows={5} />
                )
              ) : (
                <>
                  {/* Kind: INFO / OVERVIEW */}
                  {kind === "info" && (
                    <div className="space-y-6">
                      {dockerInfo ? (
                        (() => {
                          const info = dockerInfo;
                          return (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              <Card className="bg-muted/20">
                                <CardHeader className="p-4">
                                  <CardDescription>
                                    System Hostname
                                  </CardDescription>
                                  <CardTitle className="text-lg">
                                    {String(info.name || "N/A")}
                                  </CardTitle>
                                </CardHeader>
                              </Card>
                              <Card className="bg-muted/20">
                                <CardHeader className="p-4">
                                  <CardDescription>
                                    Docker Engine Version
                                  </CardDescription>
                                  <CardTitle className="text-lg">
                                    {String(info.serverVersion || "N/A")}
                                  </CardTitle>
                                </CardHeader>
                              </Card>
                              <Card className="bg-muted/20">
                                <CardHeader className="p-4">
                                  <CardDescription>
                                    Operating System
                                  </CardDescription>
                                  <CardTitle className="overflow-hidden truncate text-ellipsis text-lg">
                                    {String(info.operatingSystem || "N/A")}
                                  </CardTitle>
                                </CardHeader>
                              </Card>
                              <Card className="bg-muted/20">
                                <CardHeader className="p-4">
                                  <CardDescription>
                                    Architecture
                                  </CardDescription>
                                  <CardTitle className="text-lg">
                                    {String(info.architecture || "N/A")}
                                  </CardTitle>
                                </CardHeader>
                              </Card>
                              <Card className="bg-muted/20">
                                <CardHeader className="p-4">
                                  <CardDescription>
                                    Swarm Status
                                  </CardDescription>
                                  <CardTitle className="text-lg capitalize">
                                    {String(info.swarmState || "N/A")}
                                  </CardTitle>
                                </CardHeader>
                              </Card>
                              <Card className="bg-muted/20">
                                <CardHeader className="p-4">
                                  <CardDescription>
                                    System Memory Limit
                                  </CardDescription>
                                  <CardTitle className="text-lg">
                                    {info.memoryBytes
                                      ? formatBytes(Number(info.memoryBytes))
                                      : "Unlimited"}
                                  </CardTitle>
                                </CardHeader>
                              </Card>
                              <Card className="bg-muted/20 sm:col-span-2 lg:col-span-3">
                                <CardContent className="flex items-center justify-around p-4">
                                  <div className="text-center">
                                    <span className="font-extrabold text-3xl text-primary">
                                      {String(info.containers || 0)}
                                    </span>
                                    <p className="mt-1 text-muted-foreground text-xs">
                                      Containers
                                    </p>
                                  </div>
                                  <div className="h-8 border-border border-l" />
                                  <div className="text-center">
                                    <span className="font-extrabold text-3xl text-primary">
                                      {String(info.images || 0)}
                                    </span>
                                    <p className="mt-1 text-muted-foreground text-xs">
                                      Images
                                    </p>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="py-8 text-center text-muted-foreground text-sm">
                          Failed to load Docker daemon info or daemon is
                          unreachable.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Kind: CONTAINERS */}
                  {kind === "containers" && (
                    <div className="space-y-4">
                      {/* Container Filters */}
                      <div className="flex flex-wrap items-center gap-3">
                        <Input
                          className="max-w-xs"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Filter by name, image, label..."
                        />
                        <Select
                          items={[
                            { value: "_all", label: "All States" },
                            ...[
                              "created",
                              "running",
                              "paused",
                              "restarting",
                              "removing",
                              "exited",
                              "dead",
                            ].map((s) => ({ value: s, label: s })),
                          ]}
                          value={state || "_all"}
                          onValueChange={(val) =>
                            setState(val === "_all" || !val ? "" : val)
                          }
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="All States" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_all">All States</SelectItem>
                            {[
                              "created",
                              "running",
                              "paused",
                              "restarting",
                              "removing",
                              "exited",
                              "dead",
                            ].map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="flex-1" />

                        <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-xs">
                          <span className="font-medium text-muted-foreground">
                            Upload path:
                          </span>
                          <Input
                            className="h-7 w-24 px-2 font-mono text-[11px]"
                            value={containerDestination}
                            onChange={(e) =>
                              setContainerDestination(e.target.value)
                            }
                            placeholder="/tmp"
                          />
                        </div>
                      </div>

                      {/* Container Grid Table */}
                      {getInventoryItems(inventoryQuery.data, isDockerContainer)
                        .length > 0 ? (
                        <div className="overflow-hidden rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow className="">
                                <TableHead className="w-[100px]">
                                  State
                                </TableHead>
                                <TableHead>Container Name</TableHead>
                                <TableHead>Image</TableHead>
                                <TableHead>Ports</TableHead>
                                <TableHead className="text-right">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {getInventoryItems(
                                inventoryQuery.data,
                                isDockerContainer,
                              ).map((c) => {
                                const isRunning = c.state === "running";
                                let badgeVariant:
                                  | "default"
                                  | "secondary"
                                  | "destructive" = "secondary";
                                if (isRunning) badgeVariant = "default";
                                else if (
                                  c.state === "dead" ||
                                  c.state === "removing"
                                )
                                  badgeVariant = "destructive";

                                return (
                                  <TableRow
                                    key={c.id}
                                    className="font-sans hover:bg-muted/5"
                                  >
                                    <TableCell>
                                      <Badge
                                        variant={badgeVariant}
                                        className={`select-none capitalize ${
                                          isRunning
                                            ? "border-success/20 bg-success/10 text-success"
                                            : ""
                                        }`}
                                      >
                                        {isRunning && (
                                          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-success" />
                                        )}
                                        {c.state}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="max-w-[160px] truncate font-semibold text-foreground">
                                      {c.name}
                                    </TableCell>
                                    <TableCell
                                      className="max-w-[180px] truncate font-mono text-muted-foreground text-xs"
                                      title={c.image}
                                    >
                                      {c.image}
                                    </TableCell>
                                    <TableCell
                                      className="max-w-[140px] truncate font-mono text-muted-foreground text-xs"
                                      title={c.ports}
                                    >
                                      {c.ports || "—"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="size-7"
                                          disabled={
                                            isRunning ||
                                            controlContainer.isPending
                                          }
                                          onClick={() => {
                                            controlContainer.mutate({
                                              organizationId,
                                              serverId,
                                              containerId: c.id,
                                              command: "start",
                                            });
                                          }}
                                          title="Start Container"
                                          aria-label={`Start container ${c.name}`}
                                        >
                                          <Play className="size-3.5 text-success" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="size-7"
                                          disabled={
                                            !isRunning ||
                                            controlContainer.isPending
                                          }
                                          onClick={() => {
                                            controlContainer.mutate({
                                              organizationId,
                                              serverId,
                                              containerId: c.id,
                                              command: "stop",
                                            });
                                          }}
                                          title="Stop Container"
                                          aria-label={`Stop container ${c.name}`}
                                        >
                                          <Square className="size-3.5 text-muted-foreground" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="size-7"
                                          disabled={controlContainer.isPending}
                                          onClick={() => {
                                            controlContainer.mutate({
                                              organizationId,
                                              serverId,
                                              containerId: c.id,
                                              command: "restart",
                                            });
                                          }}
                                          title="Restart Container"
                                          aria-label={`Restart container ${c.name}`}
                                        >
                                          <RotateCw className="size-3.5 text-warning" />
                                        </Button>
                                        <Label
                                          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                          title="Upload Tar Archive"
                                          aria-label={`Upload tar archive to container ${c.name}`}
                                        >
                                          <Upload className="size-3.5" />
                                          <input
                                            type="file"
                                            accept=".tar,application/x-tar"
                                            className="sr-only"
                                            onChange={(event) => {
                                              const file =
                                                event.target.files?.[0];
                                              if (file)
                                                void uploadContainer(
                                                  c.id,
                                                  file,
                                                );
                                              event.currentTarget.value = "";
                                            }}
                                          />
                                        </Label>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                          disabled={controlContainer.isPending}
                                          onClick={() =>
                                            setPendingRemoval({
                                              kind: "container",
                                              id: c.id,
                                              label: c.name,
                                            })
                                          }
                                          title="Force Remove"
                                          aria-label={`Force remove container ${c.name}`}
                                        >
                                          <Trash2 className="size-3.5" />
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <PageEmpty
                          icon={Server}
                          title="No containers found"
                          description="No Docker containers match the active filters or target daemon."
                        />
                      )}
                    </div>
                  )}

                  {/* Kind: IMAGES */}
                  {kind === "images" && (
                    <div className="space-y-4">
                      {getInventoryItems(inventoryQuery.data, isDockerImage)
                        .length > 0 ? (
                        <div className="overflow-hidden rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow className="">
                                <TableHead>Repository Tags</TableHead>
                                <TableHead>Image ID</TableHead>
                                <TableHead>Size</TableHead>
                                <TableHead className="w-[100px] text-right">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {getInventoryItems(
                                inventoryQuery.data,
                                isDockerImage,
                              ).map((img) => (
                                <TableRow key={img.id}>
                                  <TableCell className="font-sans font-semibold">
                                    {img.tags && img.tags.length > 0
                                      ? img.tags.join(", ")
                                      : "<none>"}
                                  </TableCell>
                                  <TableCell className="font-mono text-muted-foreground text-xs">
                                    {img.id ? img.id.substring(0, 19) : "—"}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {img.sizeBytes
                                      ? formatBytes(Number(img.sizeBytes))
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                      disabled={controlResource.isPending}
                                      onClick={() =>
                                        setPendingRemoval({
                                          kind: "resource",
                                          id: img.id,
                                          label: img.id,
                                          command: "remove-image",
                                        })
                                      }
                                      title="Remove Image"
                                      aria-label={`Remove image ${img.id}`}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <PageEmpty
                          icon={Layers}
                          title="No images found"
                          description="No Docker images are downloaded on the target daemon."
                        />
                      )}
                    </div>
                  )}

                  {/* Kind: VOLUMES */}
                  {kind === "volumes" && (
                    <div className="space-y-4">
                      {/* Volume path select */}
                      <div className="mb-2 flex max-w-lg items-center gap-2 rounded-lg border border-dashed p-3 text-xs">
                        <span className="font-medium text-muted-foreground">
                          Tar upload destination folder:
                        </span>
                        <Input
                          className="h-8 w-32 font-mono text-[11px]"
                          value={volumeDestination}
                          onChange={(event) =>
                            setVolumeDestination(event.target.value)
                          }
                          placeholder="/"
                        />
                      </div>

                      {getInventoryItems(inventoryQuery.data, isDockerVolume)
                        .length > 0 ? (
                        <div className="overflow-hidden rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow className="">
                                <TableHead>Volume Name</TableHead>
                                <TableHead>Driver</TableHead>
                                <TableHead className="text-right">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {getInventoryItems(
                                inventoryQuery.data,
                                isDockerVolume,
                              ).map((v) => (
                                <TableRow key={v.name}>
                                  <TableCell className="font-mono font-semibold text-xs">
                                    {v.name}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {v.driver}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Label
                                        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                        title="Upload Tar Archive"
                                        aria-label={`Upload tar archive to volume ${v.name}`}
                                      >
                                        <Upload className="size-3.5" />
                                        <input
                                          type="file"
                                          accept=".tar,application/x-tar"
                                          className="sr-only"
                                          onChange={(event) => {
                                            const file =
                                              event.target.files?.[0];
                                            if (file)
                                              void uploadVolume(v.name, file);
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                      </Label>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        disabled={controlResource.isPending}
                                        onClick={() =>
                                          setPendingRemoval({
                                            kind: "resource",
                                            id: v.name,
                                            label: v.name,
                                            command: "remove-volume",
                                          })
                                        }
                                        title="Remove Volume"
                                        aria-label={`Remove volume ${v.name}`}
                                      >
                                        <Trash2 className="size-3.5" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <PageEmpty
                          icon={HardDrive}
                          title="No volumes found"
                          description="No Docker volumes are configured on the target daemon."
                        />
                      )}
                    </div>
                  )}

                  {/* Kind: NETWORKS */}
                  {kind === "networks" && (
                    <div className="space-y-4">
                      {getInventoryItems(inventoryQuery.data, isDockerNetwork)
                        .length > 0 ? (
                        <div className="overflow-hidden rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow className="">
                                <TableHead>Network Name</TableHead>
                                <TableHead>Driver</TableHead>
                                <TableHead>Scope</TableHead>
                                <TableHead>Attachable</TableHead>
                                <TableHead>Internal</TableHead>
                                <TableHead className="w-[100px] text-right">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {getInventoryItems(
                                inventoryQuery.data,
                                isDockerNetwork,
                              ).map((net) => (
                                <TableRow key={net.id}>
                                  <TableCell className="font-mono font-semibold text-xs">
                                    {net.name}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {net.driver}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground capitalize">
                                    {net.scope}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        net.attachable ? "default" : "secondary"
                                      }
                                    >
                                      {net.attachable ? "yes" : "no"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        net.internal
                                          ? "destructive"
                                          : "secondary"
                                      }
                                    >
                                      {net.internal ? "yes" : "no"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                      disabled={controlResource.isPending}
                                      onClick={() =>
                                        setPendingRemoval({
                                          kind: "resource",
                                          id: net.id,
                                          label: net.name,
                                          command: "remove-network",
                                        })
                                      }
                                      title="Remove Network"
                                      aria-label={`Remove network ${net.name}`}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <PageEmpty
                          icon={Network}
                          title="No networks found"
                          description="No Docker networks are configured on the target daemon."
                        />
                      )}
                    </div>
                  )}

                  {/* Kind: SERVICES */}
                  {kind === "services" && (
                    <div className="space-y-4">
                      {getInventoryItems(inventoryQuery.data, isDockerService)
                        .length > 0 ? (
                        <div className="overflow-hidden rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow className="">
                                <TableHead>Service Name</TableHead>
                                <TableHead>Mode</TableHead>
                                <TableHead>Replicas</TableHead>
                                <TableHead>Image</TableHead>
                                <TableHead>Ports</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {getInventoryItems(
                                inventoryQuery.data,
                                isDockerService,
                              ).map((srv) => (
                                <TableRow key={srv.id}>
                                  <TableCell className="font-semibold text-foreground">
                                    {srv.name}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground capitalize">
                                    {srv.mode}
                                  </TableCell>
                                  <TableCell className="font-mono">
                                    {srv.replicas}
                                  </TableCell>
                                  <TableCell
                                    className="max-w-[200px] truncate font-mono text-muted-foreground text-xs"
                                    title={srv.image}
                                  >
                                    {srv.image}
                                  </TableCell>
                                  <TableCell className="font-mono text-muted-foreground text-xs">
                                    {srv.ports || "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <PageEmpty
                          icon={Activity}
                          title="No Swarm services active"
                          description="No Docker Swarm services are active on this target. Swarm mode might be disabled."
                        />
                      )}
                    </div>
                  )}

                  {/* Kind: LOGS */}
                  {kind === "logs" && (
                    <div className="space-y-4">
                      {/* Target Selection & Query Parameters */}
                      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                        <Label className="flex flex-col space-y-1 font-semibold text-xs">
                          <span className="mb-1 text-muted-foreground">
                            Target Container
                          </span>
                          <Select
                            items={availableContainers.map((c) => ({
                              value: c.id,
                              label: c.name,
                            }))}
                            value={containerId}
                            onValueChange={(val) => {
                              setContainerId(val ?? "");
                              setServiceName("");
                            }}
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder="Choose container" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {availableContainers.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Label>

                        <Label className="flex flex-col space-y-1 font-semibold text-xs">
                          <span className="mb-1 text-muted-foreground">
                            Service Name (Swarm)
                          </span>
                          <Input
                            value={serviceName}
                            onChange={(e) => {
                              setServiceName(e.target.value);
                              setContainerId("");
                            }}
                            placeholder="Service name"
                            className="h-9"
                          />
                        </Label>

                        <Label className="flex flex-col space-y-1 font-semibold text-xs">
                          <span className="mb-1 text-muted-foreground">
                            Lines limit (max 1000)
                          </span>
                          <Input
                            type="number"
                            min={1}
                            max={1000}
                            value={tail}
                            onChange={(e) => setTail(e.target.value)}
                            className="h-9"
                          />
                        </Label>

                        <Label className="flex flex-col space-y-1 font-semibold text-xs">
                          <span className="mb-1 text-muted-foreground">
                            Logs Since
                          </span>
                          <Input
                            type="datetime-local"
                            value={since}
                            onChange={(e) => setSince(e.target.value)}
                            className="h-9"
                          />
                        </Label>
                      </div>

                      {/* Advanced Reusable Log Viewer */}
                      <ShowDockerLogs
                        containerId={
                          containerId
                            ? (availableContainers.find(
                                (c) => c.id === containerId,
                              )?.name ?? containerId)
                            : serviceName || "docker"
                        }
                        logs={
                          typeof inventoryQuery.data === "string"
                            ? inventoryQuery.data
                            : undefined
                        }
                        isFetching={inventoryQuery.isFetching}
                        emptyMessage={
                          containerId || serviceName
                            ? "Querying logs or no logs match current target filters..."
                            : "Choose a container or input a service name above to inspect logs."
                        }
                      />
                    </div>
                  )}

                  {/* Kind: LIVE STATS */}
                  {kind === "stats" && (
                    <div className="space-y-4">
                      <div className="mb-4 flex max-w-sm items-center gap-3">
                        <Select
                          items={availableContainers.map((c) => ({
                            value: c.id,
                            label: c.name,
                          }))}
                          value={containerId}
                          onValueChange={(val) => setContainerId(val ?? "")}
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue placeholder="Select container to monitor" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {availableContainers.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {containerId && dockerStats ? (
                        (() => {
                          const stats = dockerStats;
                          const cpuVal = stats.cpuPercent;
                          const memPercentVal = stats.memoryPercent;
                          const memUsed = stats.memoryUsageBytes;
                          const memLimit = stats.memoryLimitBytes;

                          return (
                            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                              {/* CPU card */}
                              <Card className="border-border/40">
                                <CardHeader>
                                  <CardDescription className="flex items-center justify-between">
                                    <span>CPU Usage</span>
                                    <Cpu className="size-4 text-primary" />
                                  </CardDescription>
                                  <CardTitle className="mt-1 font-black text-2xl">
                                    {cpuVal.toFixed(2)}%
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full bg-success transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, cpuVal)}%`,
                                      }}
                                    />
                                  </div>
                                </CardContent>
                              </Card>

                              {/* Memory card */}
                              <Card className="border-border/40">
                                <CardHeader>
                                  <CardDescription className="flex items-center justify-between">
                                    <span>Memory Usage</span>
                                    <HardDrive className="size-4 text-primary" />
                                  </CardDescription>
                                  <CardTitle className="mt-1 font-black text-2xl">
                                    {memPercentVal.toFixed(2)}%
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full bg-info transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, memPercentVal)}%`,
                                      }}
                                    />
                                  </div>
                                  <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
                                    <span>{formatBytes(memUsed)}</span>
                                    <span>{formatBytes(memLimit)}</span>
                                  </div>
                                </CardContent>
                              </Card>

                              {/* Process IDs */}
                              <Card className="border-border/40">
                                <CardHeader>
                                  <CardDescription className="flex items-center justify-between">
                                    <span>Active Processes</span>
                                    <Activity className="size-4 text-primary" />
                                  </CardDescription>
                                  <CardTitle className="mt-1 font-black text-2xl">
                                    {String(stats.pids || 0)}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <p className="mt-3 text-[11px] text-muted-foreground">
                                    Number of thread tasks running inside
                                    container namespaces.
                                  </p>
                                </CardContent>
                              </Card>

                              {/* Network I/O */}
                              <Card className="border-border/40 sm:col-span-2 md:col-span-1">
                                <CardHeader>
                                  <CardDescription>
                                    Network I/O Traffic
                                  </CardDescription>
                                </CardHeader>
                                <CardContent className="mt-2 space-y-2 p-4 pt-0 font-mono text-xs">
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                      <ArrowDown className="size-3 text-success" />{" "}
                                      Rx (Download)
                                    </span>
                                    <span className="font-semibold">
                                      {formatBytes(
                                        Number(stats.networkRxBytes) || 0,
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between border-t pt-2">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                      <ArrowUp className="size-3 text-info" />{" "}
                                      Tx (Upload)
                                    </span>
                                    <span className="font-semibold">
                                      {formatBytes(
                                        Number(stats.networkTxBytes) || 0,
                                      )}
                                    </span>
                                  </div>
                                </CardContent>
                              </Card>

                              {/* Block I/O */}
                              <Card className="border-border/40 sm:col-span-2">
                                <CardHeader>
                                  <CardDescription>
                                    Disk Block I/O
                                  </CardDescription>
                                </CardHeader>
                                <CardContent className="mt-3 flex gap-6 p-4 pt-0 font-mono text-xs">
                                  <div className="flex-1 space-y-1">
                                    <span className="text-muted-foreground">
                                      Total Read Bytes
                                    </span>
                                    <p className="mt-1 font-bold text-base text-foreground">
                                      {formatBytes(
                                        Number(stats.blockReadBytes) || 0,
                                      )}
                                    </p>
                                  </div>
                                  <div className="h-10 border-border/60 border-l" />
                                  <div className="flex-1 space-y-1">
                                    <span className="text-muted-foreground">
                                      Total Written Bytes
                                    </span>
                                    <p className="mt-1 font-bold text-base text-foreground">
                                      {formatBytes(
                                        Number(stats.blockWriteBytes) || 0,
                                      )}
                                    </p>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
                          {containerId
                            ? "Stats streaming offline or pending container read..."
                            : "Select a running container above to inspect realtime CPU, memory, block and network statistics."}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Dev Panel: Collapsible Raw Inspection */}
          <div className="overflow-hidden rounded-lg border border-border/50">
            <button
              type="button"
              onClick={() => setShowRawJson(!showRawJson)}
              className="flex w-full items-center justify-between p-4 font-semibold text-muted-foreground text-xs transition-all hover:bg-muted/20"
            >
              <span className="flex items-center gap-1.5">
                <Code className="size-4" />
                Inspect Raw Docker API Response
              </span>
              <ChevronRight
                className={`size-4 transform transition-transform duration-200 ${showRawJson ? "rotate-90" : ""}`}
              />
            </button>
            {showRawJson && (
              <div className="border-t p-4">
                <CodeBlock
                  code={
                    typeof inventoryQuery.data === "string"
                      ? inventoryQuery.data
                      : JSON.stringify(inventoryQuery.data ?? null, null, 2)
                  }
                  language="json"
                  filename="raw-docker-response.json"
                  className="max-h-[350px]"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmActionDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        title={`Remove ${pendingRemoval?.kind === "container" ? "container" : pendingRemoval?.command === "remove-image" ? "image" : pendingRemoval?.command === "remove-volume" ? "volume" : "network"}?`}
        description={
          <>
            This will permanently remove{" "}
            <strong>{pendingRemoval?.label}</strong>
            from the selected Docker server. This action cannot be undone.
          </>
        }
        actionLabel="Remove resource"
        pending={controlContainer.isPending || controlResource.isPending}
        onConfirm={() => {
          if (!pendingRemoval) return;
          if (pendingRemoval.kind === "container") {
            controlContainer.mutate({
              organizationId,
              serverId,
              containerId: pendingRemoval.id,
              command: "remove",
            });
            return;
          }
          controlResource.mutate({
            organizationId,
            serverId,
            resourceId: pendingRemoval.id,
            command: pendingRemoval.command,
          });
        }}
      />
    </DashboardPage>
  );
}
