"use client";

import "@xyflow/react/dist/style.css";

import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import { Badge } from "@upstand/ui/components/badge";
import { Button, buttonVariants } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@upstand/ui/components/context-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@upstand/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@upstand/ui/components/sheet";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@upstand/ui/components/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type MiniMapNodeProps,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import type { Route } from "next";
import Link from "next/link";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRightIcon,
  Boxes,
  CheckCircle,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  Globe,
  HardDrive,
  Layers,
  LineChart,
  Network,
  PackageIcon,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  WandSparkles,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";
import {
  getDagreLayout,
  getElkLayout,
  type LayoutAlgorithm,
  type LayoutDirection,
  resolveNodeCollisions,
} from "./topology-layout";

type TopologyKind =
  | "server"
  | "swarm"
  | "resource"
  | "service"
  | "container"
  | "network"
  | "volume"
  | "domain"
  | "registry"
  | "secret"
  | "s3"
  | "cluster";

type TopologyNodeData = {
  label: string;
  kind: TopologyKind;
  subtitle?: string;
  status?: string;
  meta?: string;
  count?: number;
  isHealthy?: boolean;
  isSelectedTarget?: boolean;
  resourceId?: string;
  resourcePath?: string;
  [key: string]: unknown;
};

type TopologyNode = Node<TopologyNodeData, "topology">;

type DockerContainer = {
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
};

type DockerService = {
  id: string;
  name: string;
  mode: string;
  replicas: string;
  image: string;
  ports: string;
};

type DockerNetwork = {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
};

type DockerVolume = { name: string; driver: string; mountpoint: string };

type DockerInfo = {
  architecture?: string;
  containers?: number;
  images?: number;
  operatingSystem?: string;
  serverVersion?: string;
  swarmState?: string;
};

type SwarmTask = {
  id: string;
  serviceName: string;
  nodeName: string;
  slot: number;
  image: string;
  desiredState: string;
  currentState: string;
  message: string;
  updatedAt: string | null;
};

type ResourceRecord = {
  id: string;
  environmentId: string;
  name: string;
  type: string;
  status: string;
  provider: string;
  appName?: string | null;
  dbType?: string | null;
  dockerImage?: string | null;
  buildRegistryId?: string | null;
  serverId?: string | null;
  domains: string;
  advancedConfig?: string;
  volumes?: unknown;
  resourcePath?: string;
};

const KIND_CONFIG: Record<
  TopologyKind,
  { label: string; icon: typeof Server; color: string; bg: string }
> = {
  server: {
    label: "Servers",
    icon: Server,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/30",
  },
  swarm: {
    label: "Swarm nodes",
    icon: Layers,
    color: "text-info",
    bg: "bg-info/10 border-info/30",
  },
  resource: {
    label: "Resources",
    icon: PackageIcon,
    color: "text-success",
    bg: "bg-success/10 border-success/30",
  },
  service: {
    label: "Services",
    icon: Activity,
    color: "text-warning",
    bg: "bg-warning/10 border-warning/30",
  },
  container: {
    label: "Containers",
    icon: Cpu,
    color: "text-info",
    bg: "bg-info/10 border-info/30",
  },
  network: {
    label: "Networks",
    icon: Network,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/30",
  },
  volume: {
    label: "Volumes",
    icon: HardDrive,
    color: "text-success",
    bg: "bg-success/10 border-success/30",
  },
  domain: {
    label: "Routes",
    icon: Globe,
    color: "text-warning",
    bg: "bg-warning/10 border-warning/30",
  },
  registry: {
    label: "Registries",
    icon: Database,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/30",
  },
  secret: {
    label: "Secret providers",
    icon: Shield,
    color: "text-destructive",
    bg: "bg-destructive/10 border-destructive/30",
  },
  s3: {
    label: "Storage destinations",
    icon: HardDrive,
    color: "text-info",
    bg: "bg-info/10 border-info/30",
  },
  cluster: {
    label: "Subgraphs / Clusters",
    icon: Boxes,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/30",
  },
};

const ALL_KINDS = Object.keys(KIND_CONFIG) as TopologyKind[];
const EMPTY_ARRAY: never[] = [];

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function labelValue(labels: string[], key: string) {
  const entry = labels.find((label) => label.startsWith(`${key}=`));
  return entry?.slice(key.length + 1);
}

function routeServiceName(resource: ResourceRecord, fallback?: string) {
  const mappings = safeJson<
    Array<{ serviceName?: string; host?: string; enabled?: boolean }>
  >(resource.domains, []).filter((mapping) => mapping.enabled !== false);
  return (
    mappings.find((mapping) => mapping.serviceName)?.serviceName || fallback
  );
}

function isolatedResourceNetworkName(resource: ResourceRecord) {
  const advancedConfig = safeJson<{ isolatedDeployment?: boolean }>(
    resource.advancedConfig,
    {},
  );
  if (!advancedConfig.isolatedDeployment) return undefined;
  return `upstand-resource-${resource.id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")}`.slice(0, 63);
}

function statusHealthy(status?: string) {
  const normalized = status?.toLowerCase().trim();
  return [
    "running",
    "ready",
    "active",
    "healthy",
    "deployed",
    "online",
    "up",
  ].some(
    (value) => normalized === value || normalized?.startsWith(`${value} `),
  );
}

function statusLabel(status?: string) {
  if (!status) return "Unknown";
  return status.replaceAll("_", " ");
}

function hasLiveStatus(status?: string) {
  return Boolean(status?.trim());
}

function statusPulseClass(status?: string) {
  if (!status) return "";
  const normalized = status.toLowerCase().trim();
  if (statusHealthy(normalized)) {
    return "topology-status-pulse bg-success";
  }
  if (
    [
      "failed",
      "error",
      "degraded",
      "unhealthy",
      "down",
      "exited",
      "dead",
      "rejected",
      "shutdown",
      "paused",
    ].some(
      (value) => normalized === value || normalized.startsWith(`${value} `),
    )
  ) {
    return "topology-status-pulse bg-destructive";
  }
  return "bg-warning";
}

function nodeStatusVariant(status?: string) {
  if (statusHealthy(status)) return "default" as const;
  if (statusPulseClass(status).includes("destructive")) {
    return "destructive" as const;
  }
  return "secondary" as const;
}

const MINIMAP_NODE_COLORS: Record<TopologyKind, string> = {
  server: "#6366f1",
  swarm: "#38bdf8",
  resource: "#22c55e",
  service: "#f59e0b",
  container: "#0ea5e9",
  network: "#818cf8",
  volume: "#4ade80",
  domain: "#fbbf24",
  registry: "#a78bfa",
  secret: "#ef4444",
  s3: "#38bdf8",
  cluster: "#a855f7",
};

function getMiniMapNodeColor(node: Node<TopologyNodeData>) {
  return MINIMAP_NODE_COLORS[node.data?.kind] ?? MINIMAP_NODE_COLORS.server;
}

function TopologyMiniMapNode({
  x,
  y,
  width,
  height,
  color,
  selected,
}: MiniMapNodeProps) {
  const radius = Math.max(3, Math.min(7, Math.min(width, height) * 0.32));
  return (
    <circle
      cx={x + width / 2}
      cy={y + height / 2}
      r={radius}
      fill={color ?? MINIMAP_NODE_COLORS.server}
      opacity={selected ? 1 : 0.9}
      stroke={selected ? "#ffffff" : "rgba(15, 23, 42, 0.45)"}
      strokeWidth={selected ? 2 : 1}
    />
  );
}

function useStableQueryData<T>(
  queries: ReadonlyArray<{ data?: readonly T[] | null }>,
) {
  const cacheRef = useRef<{
    dataRefs: ReadonlyArray<readonly T[] | null | undefined>;
    value: T[];
  }>({ dataRefs: [], value: [] });
  const dataRefs = queries.map((query) => query.data);
  const unchanged =
    cacheRef.current.dataRefs.length === dataRefs.length &&
    cacheRef.current.dataRefs.every((data, index) => data === dataRefs[index]);

  if (!unchanged) {
    cacheRef.current = {
      dataRefs,
      value: dataRefs.flatMap((data) => data ?? []),
    };
  }

  return cacheRef.current.value;
}

const TOPOLOGY_COLUMN_X = 60;
const TOPOLOGY_COLUMN_GAP = 300;
const TOPOLOGY_ROW_Y = 64;
const TOPOLOGY_ROW_GAP = 148;

function topologyPosition(column: number, row: number) {
  return {
    x: TOPOLOGY_COLUMN_X + column * TOPOLOGY_COLUMN_GAP,
    y: TOPOLOGY_ROW_Y + row * TOPOLOGY_ROW_GAP,
  };
}

const TopologyCanvasNode = memo(function TopologyCanvasNode({
  data,
  selected,
}: NodeProps<TopologyNode>) {
  const config = KIND_CONFIG[data.kind] ?? KIND_CONFIG.server;
  const Icon = config.icon;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={cn(
              "group relative min-w-55 select-none rounded-2xl border bg-card/95 px-3.5 py-3 text-card-foreground shadow-black/5 shadow-lg backdrop-blur transition duration-150",
              "hover:-translate-y-0.5 hover:shadow-black/10 hover:shadow-xl",
              selected && "border-primary ring-2 ring-primary/20",
              Boolean(data.isSelectedTarget) && "ring-2 ring-primary/15",
              Boolean(data.isCluster) &&
                "border-primary/50 border-dashed bg-primary/5",
              data.kind === "cluster" &&
                "border-primary/60 bg-gradient-to-br from-primary/10 via-card to-primary/5",
            )}
            role="group"
            aria-label={`${config.label.slice(0, -1)}: ${data.label}`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (typeof data.onToggleCluster === "function") {
                (data.onToggleCluster as () => void)();
              }
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              className="!size-2 !border-0 !bg-muted-foreground/50"
            />
            <Handle
              type="source"
              position={Position.Right}
              className="!size-2 !border-0 !bg-muted-foreground/50"
            />
            {data.isCluster && !data.isCollapsed && data.clusterLabel ? (
              <div className="mb-2 flex items-center justify-between border-b pb-1 text-[10px] text-muted-foreground">
                <span className="truncate font-semibold text-primary">
                  {String(data.clusterLabel)}
                </span>
                <button
                  type="button"
                  className="flex size-4 items-center justify-center rounded text-primary hover:bg-primary/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof data.onToggleCluster === "function") {
                      (data.onToggleCluster as () => void)();
                    }
                  }}
                  title="Collapse Cluster Subgraph"
                >
                  <Boxes className="size-3" />
                </button>
              </div>
            ) : null}
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl border",
                  config.bg || "",
                )}
              >
                <Icon className={cn("size-4", config.color)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-sm">{data.label}</p>
                  {hasLiveStatus(data.status) ? (
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        statusPulseClass(data.status),
                      )}
                      title={`Live status: ${statusLabel(data.status)}`}
                    />
                  ) : (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                      title="Status unavailable"
                    />
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {data.subtitle || config.label.slice(0, -1)}
                </p>
              </div>
              {data.count !== undefined ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {data.count}
                </Badge>
              ) : null}
            </div>
            {data.kind === "cluster" &&
            typeof data.onToggleCluster === "function" ? (
              <button
                type="button"
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-medium text-primary text-xs transition hover:bg-primary/20 active:scale-[0.98]"
                onClick={(e) => {
                  e.stopPropagation();
                  (data.onToggleCluster as () => void)();
                }}
              >
                <Boxes className="size-3.5" />
                Expand Subgraph ({data.count ?? 0})
              </button>
            ) : null}
            {data.meta ? (
              <p className="mt-2 truncate border-t pt-2 font-mono text-[10px] text-muted-foreground">
                {data.meta}
              </p>
            ) : null}
            {data.replicas !== undefined &&
            typeof data.onScale === "function" ? (
              <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Replicas
                </span>
                <div className="flex items-center gap-1 rounded-lg border bg-background/80 px-1 py-0.5">
                  <button
                    type="button"
                    className="flex size-4 items-center justify-center rounded font-bold text-xs hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      (data.onScale as (delta: number) => void)(-1);
                    }}
                    title="Scale Down (-1)"
                  >
                    -
                  </button>
                  <span className="px-1 font-medium font-mono text-xs tabular-nums">
                    {String(data.replicas)}
                  </span>
                  <button
                    type="button"
                    className="flex size-4 items-center justify-center rounded font-bold text-xs hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      (data.onScale as (delta: number) => void)(1);
                    }}
                    title="Scale Up (+1)"
                  >
                    +
                  </button>
                </div>
              </div>
            ) : null}
            {hasLiveStatus(data.status) ? (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    statusPulseClass(data.status),
                  )}
                />
                <span className="font-medium text-foreground/80">
                  {statusLabel(data.status)}
                </span>
                <span className="ml-auto uppercase tracking-wider opacity-60">
                  live
                </span>
              </div>
            ) : null}
          </div>
        }
      />
      <ContextMenuContent className="w-52">
        <ContextMenuLabel>{data.label}</ContextMenuLabel>
        <ContextMenuSeparator />
        {data.kind === "container" ? (
          <>
            <ContextMenuItem
              onClick={() => {
                if (typeof data.onControl === "function") {
                  (
                    data.onControl as (
                      command: "start" | "stop" | "restart",
                    ) => void
                  )(data.status === "running" ? "restart" : "start");
                }
              }}
            >
              <RefreshCw className="mr-2 size-4" />
              {data.status === "running"
                ? "Restart Container"
                : "Start Container"}
            </ContextMenuItem>
            {data.status === "running" ? (
              <ContextMenuItem
                variant="destructive"
                onClick={() => {
                  if (typeof data.onControl === "function") {
                    (
                      data.onControl as (
                        command: "start" | "stop" | "restart",
                      ) => void
                    )("stop");
                  }
                }}
              >
                <AlertCircle className="mr-2 size-4" />
                Stop Container
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
          </>
        ) : null}
        {data.kind === "service" && typeof data.onScale === "function" ? (
          <>
            <ContextMenuItem
              onClick={() => (data.onScale as (delta: number) => void)(1)}
            >
              <Plus className="mr-2 size-4" /> Scale Up (+1 Replica)
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => (data.onScale as (delta: number) => void)(-1)}
            >
              <Plus className="mr-2 size-4 rotate-45" /> Scale Down (-1 Replica)
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {data.isCluster && typeof data.onToggleCluster === "function" ? (
          <ContextMenuItem
            onClick={() => (data.onToggleCluster as () => void)()}
          >
            <Boxes className="mr-2 size-4" />
            {data.isCollapsed ? "Expand Subgraph" : "Collapse Cluster"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onClick={() => {
            if (typeof data.onInspect === "function") {
              (data.onInspect as () => void)();
            }
          }}
        >
          <Settings className="mr-2 size-4" /> Inspect Node & Logs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

TopologyCanvasNode.displayName = "TopologyCanvasNode";

function makeNode(
  id: string,
  kind: TopologyKind,
  data: Omit<TopologyNodeData, "kind">,
  x: number,
  y: number,
): TopologyNode {
  return {
    id,
    type: "topology",
    position: { x, y },
    data: { label: "", ...data, kind },
  };
}

type RelationInfo = {
  label: string;
  color: string;
  speed?: string;
};

function getRelationInfo(id: string): RelationInfo {
  if (id.includes("domain-resource") || id.includes("domain-service")) {
    return { label: "routes to", color: "var(--warning)", speed: "0.7s" };
  }
  if (id.includes("registry-resource")) {
    return { label: "builds", color: "var(--primary)", speed: "2.8s" };
  }
  if (id.includes("server-resource")) {
    return { label: "hosts", color: "var(--primary)", speed: "2.0s" };
  }
  if (id.includes("resource-service")) {
    return { label: "deploys", color: "var(--success)", speed: "1.4s" };
  }
  if (id.includes("task-service")) {
    return { label: "schedules", color: "var(--info)", speed: "1.2s" };
  }
  if (id.includes("service-container")) {
    return { label: "runs", color: "var(--success)", speed: "1.4s" };
  }
  if (
    id.includes("resource-network") ||
    id.includes("service-network") ||
    id.includes("container-network")
  ) {
    return { label: "attaches", color: "var(--info)", speed: "1.6s" };
  }
  if (id.includes("container-volume") || id.includes("inventory-volume")) {
    return { label: "mounts", color: "var(--success)", speed: "3.2s" };
  }
  if (id.includes("s3-resource") || id.includes("s3-server")) {
    return { label: "backs up to", color: "var(--info)", speed: "3.0s" };
  }
  if (id.includes("swarm-mesh") || id.includes("cross-host")) {
    return { label: "swarm mesh", color: "var(--primary)", speed: "1.0s" };
  }
  if (
    id.includes("inventory-swarm") ||
    id.includes("inventory-service") ||
    id.includes("inventory-container") ||
    id.includes("inventory-network")
  ) {
    return {
      label: "manages",
      color: "var(--muted-foreground)",
      speed: "2.5s",
    };
  }
  return { label: "connects", color: "var(--border)", speed: "2.0s" };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  muted = false,
): Edge {
  const relation = getRelationInfo(id);
  const strokeColor = muted ? "var(--border)" : relation.color;

  return {
    id,
    source,
    target,
    type: "smoothstep",
    animated:
      !muted &&
      (id.includes("task-service") ||
        id.includes("service-container") ||
        id.includes("domain-service")),
    label: relation.label,
    labelBgPadding: [5, 2] as [number, number],
    labelBgBorderRadius: 4,
    labelStyle: {
      fill: "var(--foreground)",
      fontSize: 9.5,
      fontWeight: 500,
    },
    labelBgStyle: {
      fill: "var(--card)",
      fillOpacity: 0.92,
      stroke: strokeColor,
      strokeWidth: 1,
    },
    style: {
      stroke: strokeColor,
      strokeWidth: muted ? 1 : 1.75,
      opacity: muted ? 0.35 : 0.8,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: strokeColor,
      width: 14,
      height: 14,
    },
  };
}

function _edgeRelationLabel(id: string) {
  return getRelationInfo(id).label;
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn(
          "max-w-[60%] break-words text-right text-xs",
          mono && "font-mono",
        )}
      >
        {String(value || "—")}
      </span>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-xl border bg-background/60 px-3 py-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-semibold text-lg tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function TopologyLegend({
  counts,
}: {
  counts: Partial<Record<TopologyKind, number>>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        {ALL_KINDS.map((kind) => {
          const config = KIND_CONFIG[kind];
          const Icon = config.icon;
          return (
            <span key={kind} className="flex items-center gap-1.5">
              <Icon className={cn("size-3", config.color)} />
              {config.label}
              <span className="font-mono text-foreground/70">
                {counts[kind] ?? 0}
              </span>
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
        <span className="font-medium text-foreground/70">Relations:</span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-warning" /> routes to
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-primary" /> hosts / builds
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-success" /> deploys / runs
          / mounts
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-info" /> attaches /
          schedules
        </span>
      </div>
    </div>
  );
}

export function TopologyMap() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const ready = organizationState.status === "ready";
  const [targetId, setTargetId] = useState("local");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedKinds, setSelectedKinds] = useState<TopologyKind[]>(ALL_KINDS);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [groupBy, setGroupBy] = useState<
    "none" | "environment" | "network" | "server"
  >("none");
  const [collapsedClusterIds, setCollapsedClusterIds] = useState<Set<string>>(
    new Set(),
  );
  const [serviceReplicas, setServiceReplicas] = useState<
    Record<string, number>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "logs" | "metrics">(
    "overview",
  );
  const [pendingAction, setPendingAction] = useState<{
    containerId: string;
    label: string;
    command: "start" | "stop" | "restart";
  } | null>(null);
  const { fitView } = useReactFlow();
  const nodeTypes = useMemo(() => ({ topology: TopologyCanvasNode }), []);

  const serversQuery = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: ready,
    staleTime: 30_000,
  });
  const registriesQuery = useQuery({
    ...trpc.dockerRegistry.list.queryOptions({ organizationId }),
    enabled: ready,
    staleTime: 60_000,
  });
  const s3Query = useQuery({
    ...trpc.s3Destination.list.queryOptions({ organizationId }),
    enabled: ready,
    staleTime: 60_000,
  });
  const swarmInfoQuery = useQuery({
    ...trpc.swarm.getInfo.queryOptions({ organizationId }),
    enabled: ready && targetId === "local",
    refetchInterval: 15_000,
  });
  const swarmNodesQuery = useQuery({
    ...trpc.swarm.getNodes.queryOptions({ organizationId }),
    enabled:
      ready &&
      targetId === "local" &&
      Boolean(swarmInfoQuery.data?.controlAvailable),
    refetchInterval: 15_000,
  });
  const swarmTasksQuery = useQuery({
    ...trpc.swarm.getTasks.queryOptions({ organizationId }),
    enabled:
      ready &&
      targetId === "local" &&
      Boolean(swarmInfoQuery.data?.controlAvailable),
    refetchInterval: 10_000,
  });

  const inventoryInput =
    targetId === "local"
      ? { organizationId }
      : { organizationId, serverId: targetId };
  const localInfoQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      organizationId,
      kind: "info",
      tail: 100,
    }),
    enabled: ready,
    refetchInterval: 15_000,
  });
  const infoQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "info",
      tail: 100,
    }),
    enabled: ready,
    refetchInterval: 15_000,
  });
  const containersQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "containers",
      tail: 100,
    }),
    enabled: ready,
    refetchInterval: 10_000,
  });
  const servicesQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "services",
      tail: 100,
    }),
    enabled: ready,
    refetchInterval: 15_000,
  });
  const networksQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "networks",
      tail: 100,
    }),
    enabled: ready,
    staleTime: 30_000,
  });
  const volumesQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "volumes",
      tail: 100,
    }),
    enabled: ready,
    staleTime: 30_000,
  });
  const projectsQuery = useQuery({
    ...trpc.project.list.queryOptions({ organizationId }),
    enabled: ready,
    staleTime: 60_000,
  });

  const environmentQueries = useQueries({
    queries: (projectsQuery.data ?? []).map((project) => ({
      ...trpc.environment.list.queryOptions({ projectId: project.id }),
      enabled: ready,
      staleTime: 60_000,
    })),
  });
  const environments = useStableQueryData(environmentQueries);
  const resourceQueries = useQueries({
    queries: environments.map((environment) => ({
      ...trpc.resource.list.queryOptions({ environmentId: environment.id }),
      enabled: ready,
      staleTime: 30_000,
    })),
  });
  const resources = useStableQueryData<ResourceRecord>(resourceQueries);

  const containers = (
    Array.isArray(containersQuery.data) ? containersQuery.data : EMPTY_ARRAY
  ) as DockerContainer[];
  const services = (
    Array.isArray(servicesQuery.data) ? servicesQuery.data : EMPTY_ARRAY
  ) as DockerService[];
  const networks = (
    Array.isArray(networksQuery.data) ? networksQuery.data : EMPTY_ARRAY
  ) as DockerNetwork[];
  const volumes = (
    Array.isArray(volumesQuery.data) ? volumesQuery.data : EMPTY_ARRAY
  ) as DockerVolume[];
  const swarmTasks = (swarmTasksQuery.data?.tasks ??
    EMPTY_ARRAY) as SwarmTask[];
  const swarmNodes = swarmNodesQuery.data ?? EMPTY_ARRAY;
  const servers = serversQuery.data ?? EMPTY_ARRAY;
  const registries = registriesQuery.data ?? EMPTY_ARRAY;
  const s3Destinations = s3Query.data ?? EMPTY_ARRAY;
  const dockerInfo =
    infoQuery.data &&
    typeof infoQuery.data === "object" &&
    "serverVersion" in infoQuery.data
      ? (infoQuery.data as DockerInfo)
      : undefined;
  const remoteInfoByServerId = useMemo(
    () =>
      targetId === "local"
        ? new Map()
        : new Map([
            [targetId, { info: dockerInfo, isError: infoQuery.isError }],
          ]),
    [dockerInfo, infoQuery.isError, targetId],
  );
  const localDockerInfo =
    localInfoQuery.data &&
    typeof localInfoQuery.data === "object" &&
    "serverVersion" in localInfoQuery.data
      ? (localInfoQuery.data as DockerInfo)
      : undefined;

  const topology = useMemo(() => {
    const nodes: TopologyNode[] = [];
    const pendingEdges: Array<{
      id: string;
      source: string;
      target: string;
      muted?: boolean;
    }> = [];
    const counts: Partial<Record<TopologyKind, number>> = {};
    const visible = (kind: TopologyKind) => selectedKinds.includes(kind);
    const add = (node: TopologyNode) => {
      counts[node.data.kind] = (counts[node.data.kind] ?? 0) + 1;
      if (visible(node.data.kind)) nodes.push(node);
    };
    const addEdge = (
      source: string,
      target: string,
      id: string,
      muted = false,
    ) => {
      pendingEdges.push({ id, source, target, muted });
    };
    const matchesSearch = (data: TopologyNodeData) => {
      const query = deferredSearch.trim().toLowerCase();
      return (
        !query ||
        [data.label, data.subtitle, data.meta]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    };

    const scopedResources = resources.filter((resource) => {
      const resourceServerId =
        resource.serverId && resource.serverId !== "manager"
          ? resource.serverId
          : "local";
      return resourceServerId === targetId;
    });
    const scopedRegistryIds = new Set(
      scopedResources
        .map((resource) => resource.buildRegistryId)
        .filter((id): id is string => Boolean(id)),
    );
    const scopedRegistries = registries.filter(
      (registry: { id: string; serverId?: string | null }) => {
        const registryServerId =
          registry.serverId && registry.serverId !== "manager"
            ? registry.serverId
            : "local";
        return (
          scopedRegistryIds.has(registry.id) || registryServerId === targetId
        );
      },
    );
    const routeNodeCount = scopedResources.reduce((count, resource) => {
      const mappings = safeJson<Array<{ host?: string; enabled?: boolean }>>(
        resource.domains,
        [],
      ).filter((mapping) => mapping.enabled !== false);
      return count + mappings.filter((mapping) => Boolean(mapping.host)).length;
    }, 0);

    const localServerId = "server:local";
    const inspectionServerNodeId =
      targetId === "local" ? localServerId : `server:${targetId}`;
    if (visible("server") && targetId === "local") {
      add(
        makeNode(
          localServerId,
          "server",
          {
            label: "Local Docker daemon",
            subtitle:
              targetId === "local"
                ? "Active inspection target"
                : "Control plane",
            meta: localDockerInfo?.serverVersion || "Local engine",
            status: localDockerInfo ? "online" : "checking",
            isHealthy: Boolean(localInfoQuery.data),
            isSelectedTarget: targetId === "local",
          },
          topologyPosition(1, 0).x,
          topologyPosition(1, 0).y,
        ),
      );
    } else if (visible("server")) {
      const server = servers.find((item) => item.id === targetId);
      if (server) {
        const remoteProbe = remoteInfoByServerId.get(server.id);
        const remoteInfo = remoteProbe?.info;
        const remoteStatus = remoteProbe?.isError
          ? "unreachable"
          : remoteInfo
            ? "online"
            : "checking";
        add(
          makeNode(
            `server:${server.id}`,
            "server",
            {
              label: server.name,
              subtitle: `Active inspection target · ${server.serverType} · ${remoteStatus}`,
              meta: `${server.ipAddress}:${server.port}${remoteInfo?.serverVersion ? ` · Docker ${remoteInfo.serverVersion}` : ""}`,
              status: remoteStatus,
              count: remoteInfo?.containers,
              isHealthy: Boolean(remoteInfo) && !remoteProbe?.isError,
              isSelectedTarget: true,
            },
            topologyPosition(1, 0).x,
            topologyPosition(1, 0).y,
          ),
        );
      }
    }

    if (visible("swarm") && targetId === "local") {
      swarmNodes.forEach((node, index) => {
        add(
          makeNode(
            `swarm:${node.id}`,
            "swarm",
            {
              label: node.hostname,
              subtitle: `${node.leader ? "Leader · " : ""}${node.role}`,
              meta: `${node.ip || "No address"} · ${node.engineVersion}`,
              count: swarmTasks.filter(
                (task) =>
                  task.nodeName === node.hostname &&
                  task.currentState === "running",
              ).length,
              status: node.status,
              isHealthy:
                node.status === "ready" && node.availability === "active",
            },
            topologyPosition(2, index).x,
            topologyPosition(2, index).y,
          ),
        );
        addEdge(
          inspectionServerNodeId,
          `swarm:${node.id}`,
          `inventory-swarm:${node.id}`,
          true,
        );
      });
    }

    const resourceContext = new Map(
      scopedResources.map((resource) => {
        const environment = environments.find(
          (item) => item.id === resource.environmentId,
        );
        const project = projectsQuery.data?.find(
          (item) => item.id === environment?.projectId,
        );
        return [resource.id, { resource, environment, project }];
      }),
    );

    scopedResources.forEach((resource, index) => {
      const context = resourceContext.get(resource.id);
      const label = resource.appName || resource.name;
      const path =
        context?.project && context.environment
          ? `/projects/${context.project.id}/${context.environment.id}/${resource.id}`
          : undefined;
      if (
        matchesSearch({
          label,
          kind: "resource",
          subtitle: resource.type,
          meta: resource.status,
        })
      ) {
        add(
          makeNode(
            `resource:${resource.id}`,
            "resource",
            {
              label,
              subtitle: `${resource.type}${resource.dbType ? ` · ${resource.dbType}` : ""}`,
              meta: `${context?.project?.name || "Project"} / ${context?.environment?.name || "Environment"}`,
              status: resource.status,
              isHealthy: statusHealthy(resource.status),
              resourceId: resource.id,
              resourcePath: path,
            },
            topologyPosition(3, index).x,
            topologyPosition(3, index).y,
          ),
        );
      }
      const resourceServerId =
        resource.serverId && resource.serverId !== "manager"
          ? resource.serverId
          : "local";
      const serverNode =
        resourceServerId === "local"
          ? localServerId
          : `server:${resourceServerId}`;
      addEdge(
        serverNode,
        `resource:${resource.id}`,
        `server-resource:${serverNode}:${resource.id}`,
      );
      if (resource.buildRegistryId)
        addEdge(
          `registry:${resource.buildRegistryId}`,
          `resource:${resource.id}`,
          `registry-resource:${resource.id}`,
        );
    });

    const serviceNames = new Set(services.map((service) => service.name));
    const inventoryNetworkNames = new Set(
      networks.map((network) => network.name),
    );
    const serviceNetworks = new Map<string, Set<string>>();
    const networkAttachmentCounts = new Map<string, number>();
    const volumeAttachmentCounts = new Map<string, number>();
    containers.forEach((container) => {
      const serviceName =
        labelValue(container.labels, "com.docker.swarm.service.name") ||
        services.find((service) => container.name.includes(service.name))?.name;
      for (const network of container.networks) {
        networkAttachmentCounts.set(
          network,
          (networkAttachmentCounts.get(network) ?? 0) + 1,
        );
      }
      for (const mount of container.mounts) {
        const volumeName = mount.split(":")[0];
        volumeAttachmentCounts.set(
          volumeName,
          (volumeAttachmentCounts.get(volumeName) ?? 0) + 1,
        );
      }
      if (!serviceName) return;
      const networkNames =
        serviceNetworks.get(serviceName) ?? new Set<string>();
      for (const network of container.networks) networkNames.add(network);
      serviceNetworks.set(serviceName, networkNames);
    });
    scopedResources.forEach((resource) => {
      const serviceName = routeServiceName(
        resource,
        resource.appName || resource.name,
      );
      const resourceNetworks = new Set(
        serviceName ? serviceNetworks.get(serviceName) : undefined,
      );
      if (inventoryNetworkNames.has("upstand-network")) {
        resourceNetworks.add("upstand-network");
      }
      const isolatedNetwork = isolatedResourceNetworkName(resource);
      if (isolatedNetwork && inventoryNetworkNames.has(isolatedNetwork)) {
        resourceNetworks.add(isolatedNetwork);
      }
      if (serviceName && serviceNames.has(serviceName))
        addEdge(
          `resource:${resource.id}`,
          `service:${serviceName}`,
          `resource-service:${resource.id}:${serviceName}`,
        );
      for (const network of resourceNetworks) {
        addEdge(
          `resource:${resource.id}`,
          `network:${network}`,
          `resource-network:${resource.id}:${network}`,
        );
      }
    });

    services.forEach((service, index) => {
      const tasks = swarmTasks.filter(
        (task) => task.serviceName === service.name,
      );
      const activeDesiredTasks = tasks.filter(
        (task) => task.desiredState === "running",
      );
      const hasFailure =
        activeDesiredTasks.length === 0
          ? tasks.some((task) =>
              ["failed", "rejected"].includes(task.currentState),
            )
          : activeDesiredTasks.some(
              (task) =>
                ["failed", "rejected"].includes(task.currentState) ||
                (task.currentState !== "running" &&
                  task.currentState !== "starting"),
            );
      const running = tasks.filter(
        (task) => task.currentState === "running",
      ).length;
      const desiredCount =
        activeDesiredTasks.length ||
        (typeof service.replicas === "number" ? service.replicas : 1);
      const replicaText = `${running}/${desiredCount} running`;
      const isHealthy = !hasFailure && running >= desiredCount;
      const data = {
        label: service.name,
        subtitle: `${service.mode} · ${replicaText}`,
        meta: service.image,
        status: isHealthy ? "running" : "degraded",
        isHealthy,
      };
      if (matchesSearch({ ...data, kind: "service" }))
        add(
          makeNode(
            `service:${service.name}`,
            "service",
            data,
            topologyPosition(4, index).x,
            topologyPosition(4, index).y,
          ),
        );
      addEdge(
        inspectionServerNodeId,
        `service:${service.name}`,
        `inventory-service:${service.name}`,
        true,
      );
      tasks.forEach((task) => {
        const node = swarmNodes.find((item) => item.hostname === task.nodeName);
        if (node)
          addEdge(
            `swarm:${node.id}`,
            `service:${service.name}`,
            `task-service:${task.id}`,
          );
      });
      for (const network of serviceNetworks.get(service.name) ?? []) {
        addEdge(
          `service:${service.name}`,
          `network:${network}`,
          `service-network:${service.name}:${network}`,
        );
      }
      if (inventoryNetworkNames.has("upstand-network")) {
        addEdge(
          `service:${service.name}`,
          "network:upstand-network",
          `service-network:${service.name}:upstand-network`,
        );
      }
    });

    containers.forEach((container, index) => {
      const serviceName =
        labelValue(container.labels, "com.docker.swarm.service.name") ||
        services.find((service) => container.name.includes(service.name))?.name;
      const data = {
        label: container.name,
        subtitle: `${container.state} · ${serviceName || "standalone"}`,
        meta: container.image,
        status: container.state,
        isHealthy: container.state === "running",
      };
      if (matchesSearch({ ...data, kind: "container" }))
        add(
          makeNode(
            `container:${container.id}`,
            "container",
            data,
            topologyPosition(5, index).x,
            topologyPosition(5, index).y,
          ),
        );
      addEdge(
        inspectionServerNodeId,
        `container:${container.id}`,
        `inventory-container:${container.id}`,
        true,
      );
      if (serviceName)
        addEdge(
          `service:${serviceName}`,
          `container:${container.id}`,
          `service-container:${serviceName}:${container.id}`,
        );
      container.networks.forEach((network) => {
        addEdge(
          `container:${container.id}`,
          `network:${network}`,
          `container-network:${container.id}:${network}`,
        );
      });
      container.mounts.forEach((mount) => {
        const name = mount.split(":")[0];
        addEdge(
          `container:${container.id}`,
          `volume:${name}`,
          `container-volume:${container.id}:${name}`,
        );
      });
    });

    networks.forEach((network, index) => {
      if (
        matchesSearch({
          label: network.name,
          kind: "network",
          subtitle: network.driver,
          meta: network.scope,
        })
      )
        add(
          makeNode(
            `network:${network.name}`,
            "network",
            {
              label: network.name,
              subtitle: `${network.driver} · ${network.scope}`,
              meta: `${networkAttachmentCounts.get(network.name) ?? 0} attached container${networkAttachmentCounts.get(network.name) === 1 ? "" : "s"} · ${network.attachable ? "Attachable" : "Managed"}${network.internal ? " · Internal" : ""}`,
              count: networkAttachmentCounts.get(network.name) ?? 0,
              isHealthy: true,
            },
            topologyPosition(6, index).x,
            topologyPosition(6, index).y,
          ),
        );
      addEdge(
        inspectionServerNodeId,
        `network:${network.name}`,
        `inventory-network:${network.name}`,
        true,
      );
    });
    volumes.forEach((volume, index) => {
      if (
        matchesSearch({
          label: volume.name,
          kind: "volume",
          subtitle: volume.driver,
          meta: volume.mountpoint,
        })
      )
        add(
          makeNode(
            `volume:${volume.name}`,
            "volume",
            {
              label: volume.name,
              subtitle: `${volume.driver} · ${volumeAttachmentCounts.get(volume.name) ?? 0} attachment${volumeAttachmentCounts.get(volume.name) === 1 ? "" : "s"}`,
              meta: volume.mountpoint,
              count: volumeAttachmentCounts.get(volume.name) ?? 0,
              isHealthy: true,
            },
            topologyPosition(7, index).x,
            topologyPosition(7, index).y,
          ),
        );
      addEdge(
        inspectionServerNodeId,
        `volume:${volume.name}`,
        `inventory-volume:${volume.name}`,
        true,
      );
    });

    let domainIndex = 0;
    scopedResources.forEach((resource) => {
      const mappings = safeJson<
        Array<{
          host?: string;
          serviceName?: string;
          port?: number;
          https?: boolean;
          enabled?: boolean;
        }>
      >(resource.domains, []).filter((mapping) => mapping.enabled !== false);
      mappings.forEach((mapping, mappingIndex) => {
        if (!mapping.host) return;
        const id = `domain:${resource.id}:${mappingIndex}`;
        const position = topologyPosition(0, domainIndex);
        domainIndex += 1;
        if (
          matchesSearch({
            label: mapping.host,
            kind: "domain",
            subtitle: resource.name,
            meta: `${mapping.https === false ? "HTTP" : "HTTPS"} → :${mapping.port || 80}`,
          })
        )
          add(
            makeNode(
              id,
              "domain",
              {
                label: mapping.host,
                subtitle: `${mapping.https === false ? "HTTP" : "HTTPS"} · Caddy route`,
                meta: `${mapping.serviceName || resource.appName || resource.name}:${mapping.port || 80}`,
                status: "active",
                isHealthy: true,
                resourceId: resource.id,
              },
              position.x,
              position.y,
            ),
          );
        addEdge(id, `resource:${resource.id}`, `domain-resource:${id}`);
        const serviceName =
          mapping.serviceName || resource.appName || resource.name;
        addEdge(id, `service:${serviceName}`, `domain-service:${id}`);
      });
    });
    scopedRegistries.forEach(
      (
        registry: {
          id: string;
          name: string;
          registryUrl?: string | null;
          imagePrefix?: string | null;
        },
        index: number,
      ) => {
        if (
          matchesSearch({
            label: registry.name,
            kind: "registry",
            subtitle: registry.registryUrl || "Docker Hub",
            meta: registry.imagePrefix || "No image prefix",
          })
        )
          add(
            makeNode(
              `registry:${registry.id}`,
              "registry",
              {
                label: registry.name,
                subtitle: registry.registryUrl || "Docker Hub",
                meta: registry.imagePrefix || "No image prefix",
                isHealthy: true,
              },
              topologyPosition(0, routeNodeCount + index).x,
              topologyPosition(0, routeNodeCount + index).y,
            ),
          );
      },
    );

    // Node action handlers
    const handleScale = (serviceName: string, delta: number) => {
      setServiceReplicas((prev) => {
        const current = prev[serviceName] ?? 1;
        const next = Math.max(0, current + delta);
        toast.success(`Updated ${serviceName} target replicas to ${next}`);
        return { ...prev, [serviceName]: next };
      });
    };

    const handleInspectNode = (id: string) => {
      setSelectedNodeId(id);
      setDetailTab("overview");
    };

    const handleToggleCluster = (clusterId: string) => {
      setCollapsedClusterIds((prev) => {
        const next = new Set(prev);
        if (next.has(clusterId)) {
          next.delete(clusterId);
          toast.success("Expanded cluster view");
        } else {
          next.add(clusterId);
          toast.success("Collapsed cluster view");
        }
        return next;
      });
    };

    s3Destinations.forEach((s3, index) => {
      if (
        matchesSearch({
          label: s3.name,
          kind: "s3",
          subtitle: s3.bucket,
          meta: s3.endpoint || "AWS S3 / Compatible",
        })
      ) {
        add(
          makeNode(
            `s3:${s3.id}`,
            "s3",
            {
              label: s3.name,
              subtitle: `S3 Storage · ${s3.bucket}`,
              meta: s3.endpoint || "Object Storage",
              isHealthy: true,
              onInspect: () => handleInspectNode(`s3:${s3.id}`),
            },
            topologyPosition(
              0,
              routeNodeCount + scopedRegistries.length + index,
            ).x,
            topologyPosition(
              0,
              routeNodeCount + scopedRegistries.length + index,
            ).y,
          ),
        );
        addEdge(
          inspectionServerNodeId,
          `s3:${s3.id}`,
          `s3-server:${s3.id}`,
          true,
        );
      }
    });

    scopedResources.forEach((resource) => {
      const advConfig = safeJson<{
        s3DestinationId?: string;
        backupS3DestinationId?: string;
      }>(resource.advancedConfig, {});
      const targetS3Id =
        advConfig.s3DestinationId || advConfig.backupS3DestinationId;
      if (targetS3Id) {
        addEdge(
          `resource:${resource.id}`,
          `s3:${targetS3Id}`,
          `s3-resource:${resource.id}:${targetS3Id}`,
        );
      }
    });

    // Add inter-server Swarm mesh links across distributed Swarm nodes
    if (visible("swarm") && swarmNodes.length > 1) {
      swarmNodes.forEach((node, idx) => {
        const nextNode = swarmNodes[(idx + 1) % swarmNodes.length];
        if (node.id !== nextNode.id) {
          addEdge(
            `swarm:${node.id}`,
            `swarm:${nextNode.id}`,
            `swarm-mesh:${node.id}:${nextNode.id}`,
            false,
          );
        }
      });
    }

    // Attach callbacks to nodes
    nodes.forEach((node) => {
      if (node.data.kind === "service") {
        const serviceName = node.data.label;
        const count = serviceReplicas[serviceName] ?? 1;
        node.data.replicas = count;
        node.data.onScale = (delta: number) => handleScale(serviceName, delta);
      }
      if (node.data.kind === "container") {
        const containerId = node.id.replace("container:", "");
        node.data.onControl = (command: "start" | "stop" | "restart") => {
          setPendingAction({
            containerId,
            label: node.data.label,
            command,
          });
        };
      }
      node.data.onInspect = () => handleInspectNode(node.id);
    });

    // Subgraph & Collapsible Cluster Engine
    if (groupBy !== "none") {
      const groups = new Map<
        string,
        { label: string; nodes: TopologyNode[] }
      >();
      nodes.forEach((node) => {
        let groupKey = "default";
        let groupLabel = "Cluster";
        if (groupBy === "environment") {
          groupKey = String(node.data.meta || "Global Environment");
          groupLabel = `Env: ${groupKey}`;
        } else if (groupBy === "network") {
          groupKey = String(node.data.subtitle || "Network Subnet");
          groupLabel = `Net: ${groupKey}`;
        } else if (groupBy === "server") {
          groupKey = String(node.data.subtitle || "Host Server");
          groupLabel = `Host: ${groupKey}`;
        }

        const group = groups.get(groupKey) ?? { label: groupLabel, nodes: [] };
        group.nodes.push(node);
        groups.set(groupKey, group);
      });

      const processedNodes: TopologyNode[] = [];
      const hiddenNodeIds = new Set<string>();

      groups.forEach((group, key) => {
        const clusterId = `cluster:${key.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`;
        const isCollapsed = collapsedClusterIds.has(clusterId);

        const memberList = group.nodes.map((n) => ({
          id: n.id,
          label: n.data.label,
          kind: n.data.kind,
          status: n.data.status,
          subtitle: n.data.subtitle,
        }));

        if (isCollapsed && group.nodes.length > 1) {
          group.nodes.forEach((n) => {
            hiddenNodeIds.add(n.id);
          });
          const healthyCount = group.nodes.filter(
            (n) => n.data.isHealthy !== false,
          ).length;
          const firstNode = group.nodes[0];
          processedNodes.push(
            makeNode(
              clusterId,
              "cluster",
              {
                label: group.label,
                subtitle: `${group.nodes.length} objects · ${healthyCount}/${group.nodes.length} healthy`,
                meta: `Collapsed subgraph (${group.nodes
                  .map((n) => n.data.label)
                  .slice(0, 4)
                  .join(", ")})`,
                count: group.nodes.length,
                isHealthy: healthyCount === group.nodes.length,
                isCluster: true,
                isCollapsed: true,
                memberNodes: memberList,
                onToggleCluster: () => handleToggleCluster(clusterId),
                onInspect: () => handleInspectNode(clusterId),
              },
              firstNode.position.x,
              firstNode.position.y,
            ),
          );
        } else {
          group.nodes.forEach((n) => {
            n.data.isCluster = true;
            n.data.isCollapsed = false;
            n.data.clusterLabel = group.label;
            n.data.onToggleCluster = () => handleToggleCluster(clusterId);
            processedNodes.push(n);
          });
        }
      });

      const finalNodes = processedNodes.length > 0 ? processedNodes : nodes;
      const nodeIds = new Set(finalNodes.map((node) => node.id));

      const reroutedEdges = pendingEdges
        .map((edge) => {
          let source = edge.source;
          let target = edge.target;

          if (hiddenNodeIds.has(source)) {
            for (const [key, group] of groups.entries()) {
              if (group.nodes.some((n) => n.id === source)) {
                source = `cluster:${key.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`;
                break;
              }
            }
          }

          if (hiddenNodeIds.has(target)) {
            for (const [key, group] of groups.entries()) {
              if (group.nodes.some((n) => n.id === target)) {
                target = `cluster:${key.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`;
                break;
              }
            }
          }

          return { ...edge, source, target };
        })
        .filter(
          (edge) =>
            edge.source !== edge.target &&
            nodeIds.has(edge.source) &&
            nodeIds.has(edge.target),
        )
        .map((edge) =>
          makeEdge(edge.id, edge.source, edge.target, edge.muted ?? false),
        );

      const uniqueEdges = [
        ...new Map(reroutedEdges.map((edge) => [edge.id, edge])).values(),
      ];

      const clusterIds = Array.from(groups.keys()).map(
        (key) => `cluster:${key.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`,
      );

      return { nodes: finalNodes, edges: uniqueEdges, counts, clusterIds };
    }

    // Standard un-grouped layout
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = pendingEdges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) =>
        makeEdge(edge.id, edge.source, edge.target, edge.muted ?? false),
      );

    const uniqueEdges = [
      ...new Map(edges.map((edge) => [edge.id, edge])).values(),
    ];
    return { nodes, edges: uniqueEdges, counts, clusterIds: [] };
  }, [
    containers,
    environments,
    localDockerInfo,
    localInfoQuery.data,
    networks,
    projectsQuery.data,
    remoteInfoByServerId,
    registries,
    resources,
    s3Destinations,
    deferredSearch,
    selectedKinds,
    servers,
    services,
    swarmNodes,
    swarmTasks,
    targetId,
    volumes,
    groupBy,
    collapsedClusterIds,
    serviceReplicas,
  ]);

  const nodePositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [canvasNodes, setCanvasNodes] = useState<TopologyNode[]>(
    () => topology.nodes,
  );
  useEffect(() => {
    setCanvasNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return topology.nodes.map((node) => {
        const previous = currentById.get(node.id);
        return previous
          ? {
              ...node,
              position: nodePositionsRef.current[node.id] ?? previous.position,
              measured: previous.measured,
            }
          : {
              ...node,
              position: nodePositionsRef.current[node.id] ?? node.position,
            };
      });
    });
  }, [topology.nodes]);
  const nodes = useMemo(
    () =>
      canvasNodes.map((node) => {
        const selected = node.id === selectedNodeId;
        if (Boolean(node.selected) === selected) {
          return node;
        }
        return { ...node, selected };
      }),
    [canvasNodes, selectedNodeId],
  );
  const edges = useMemo(() => {
    return topology.edges.map((edge) => {
      const relation = getRelationInfo(edge.id);
      const strokeColor = edge.style?.stroke || relation.color;
      const connected = selectedNodeId
        ? edge.source === selectedNodeId || edge.target === selectedNodeId
        : false;

      return {
        ...edge,
        animated: selectedNodeId ? connected && edge.animated : edge.animated,
        label: showEdgeLabels || connected ? relation.label : undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        labelStyle: {
          fill: connected ? "var(--foreground)" : "var(--muted-foreground)",
          fontSize: connected ? 10 : 9.5,
          fontWeight: connected ? 600 : 500,
        },
        labelBgStyle: {
          fill: "var(--card)",
          fillOpacity: connected ? 0.98 : 0.9,
          stroke: connected ? "var(--primary)" : strokeColor,
          strokeWidth: connected ? 1.5 : 1,
        },
        style: {
          ...edge.style,
          stroke: strokeColor,
          opacity: selectedNodeId
            ? connected
              ? 1
              : 0.12
            : (edge.style?.opacity ?? 0.8),
          strokeWidth: selectedNodeId
            ? connected
              ? 2.5
              : 1.25
            : (edge.style?.strokeWidth ?? 1.75),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: connected ? 16 : 14,
          height: connected ? 16 : 14,
        },
      };
    });
  }, [selectedNodeId, showEdgeLabels, topology.edges]);
  const onNodesChange = useCallback((changes: NodeChange<TopologyNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        nodePositionsRef.current[change.id] = change.position;
      }
    }
    setCanvasNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const selectedGraphNode =
    topology.nodes.find((node) => node.id === selectedNodeId) ??
    canvasNodes.find((node) => node.id === selectedNodeId) ??
    null;
  const selectedContainer =
    selectedGraphNode?.data.kind === "container"
      ? containers.find(
          (container) => `container:${container.id}` === selectedGraphNode.id,
        )
      : undefined;
  const selectedService =
    selectedGraphNode?.data.kind === "service"
      ? services.find(
          (service) => `service:${service.name}` === selectedGraphNode.id,
        )
      : undefined;
  const selectedResource =
    selectedGraphNode?.data.kind === "resource"
      ? resources.find(
          (resource) => `resource:${resource.id}` === selectedGraphNode.id,
        )
      : undefined;
  const selectedConfig = selectedGraphNode
    ? KIND_CONFIG[selectedGraphNode.data.kind]
    : KIND_CONFIG.server;
  const SelectedIcon = selectedConfig.icon;
  const canInspectLogs = Boolean(
    selectedContainer || selectedService || selectedResource,
  );
  const canInspectMetrics = Boolean(selectedContainer || selectedResource);

  const logsQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "logs",
      containerId: selectedContainer?.id,
      serviceName: selectedService?.name,
      tail: 160,
    }),
    enabled:
      ready &&
      detailTab === "logs" &&
      Boolean(selectedContainer || selectedService),
    refetchInterval: 5_000,
  });
  const metricsQuery = useQuery({
    ...trpc.server.inventory.queryOptions({
      ...inventoryInput,
      kind: "stats",
      containerId: selectedContainer?.id,
      tail: 100,
    }),
    enabled: ready && detailTab === "metrics" && Boolean(selectedContainer),
    refetchInterval: 5_000,
  });
  const resourceLogsQuery = useQuery({
    ...trpc.resource.getLogs.queryOptions({ id: selectedResource?.id || "" }),
    enabled: ready && detailTab === "logs" && Boolean(selectedResource),
    refetchInterval: 5_000,
  });
  const resourceStatsQuery = useQuery({
    ...trpc.resource.getStats.queryOptions({ id: selectedResource?.id || "" }),
    enabled: ready && detailTab === "metrics" && Boolean(selectedResource),
    refetchInterval: 5_000,
  });

  const isLogsLoading = selectedResource
    ? resourceLogsQuery.isLoading
    : selectedContainer || selectedService
      ? logsQuery.isLoading
      : false;

  const isMetricsLoading = selectedResource
    ? resourceStatsQuery.isLoading
    : selectedContainer
      ? metricsQuery.isLoading
      : false;

  const [layoutAlgo, setLayoutAlgo] = useState<LayoutAlgorithm>("dagre");
  const [layoutDir, setLayoutDir] = useState<LayoutDirection>("vertical");

  const handleApplyLayout = useCallback(
    async (
      algo: LayoutAlgorithm = layoutAlgo,
      dir: LayoutDirection = layoutDir,
      targetNodes: TopologyNode[] = topology.nodes,
      targetEdges: Edge[] = topology.edges,
      silent = false,
    ) => {
      if (targetNodes.length === 0) return;
      try {
        let result: { nodes: TopologyNode[]; edges: Edge[] };
        if (algo === "elk") {
          result = await getElkLayout(targetNodes, targetEdges, dir);
        } else {
          result = getDagreLayout(targetNodes, targetEdges, dir);
        }
        const resolvedNodes = resolveNodeCollisions(result.nodes);
        nodePositionsRef.current = {};
        for (const n of resolvedNodes) {
          nodePositionsRef.current[n.id] = n.position;
        }
        setCanvasNodes(resolvedNodes);
        setTimeout(() => {
          fitView({ padding: 0.22, duration: 350 });
        }, 50);
        if (!silent) {
          toast.success(`Applied ${algo.toUpperCase()} (${dir}) layout`);
        }
      } catch (error: unknown) {
        if (!silent) {
          toast.error(
            `Layout failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
    [fitView, layoutAlgo, layoutDir, topology.edges, topology.nodes],
  );

  // Auto-run layout engine whenever grouping or cluster collapse state changes
  useEffect(() => {
    if (ready && topology.nodes.length > 0 && groupBy !== "none") {
      let isSubscribed = true;
      const run = async () => {
        let result: { nodes: TopologyNode[]; edges: Edge[] };
        if (layoutAlgo === "elk") {
          result = await getElkLayout(
            topology.nodes,
            topology.edges,
            layoutDir,
          );
        } else {
          result = getDagreLayout(topology.nodes, topology.edges, layoutDir);
        }
        if (!isSubscribed) return;
        const resolvedNodes = resolveNodeCollisions(result.nodes);
        nodePositionsRef.current = {};
        for (const n of resolvedNodes) {
          nodePositionsRef.current[n.id] = n.position;
        }
        setCanvasNodes(resolvedNodes);
      };
      void run();
      return () => {
        isSubscribed = false;
      };
    }
  }, [groupBy, layoutAlgo, layoutDir, ready, topology.edges, topology.nodes]);

  const handleResolveCollisionsOnly = useCallback(() => {
    if (canvasNodes.length === 0) return;
    const resolvedNodes = resolveNodeCollisions(canvasNodes);
    nodePositionsRef.current = {};
    for (const n of resolvedNodes) {
      nodePositionsRef.current[n.id] = n.position;
    }
    setCanvasNodes(resolvedNodes);
    setTimeout(() => {
      fitView({ padding: 0.22, duration: 350 });
    }, 50);
    toast.success("Resolved node collisions");
  }, [canvasNodes, fitView]);
  const controlContainerMutation = useMutation({
    ...trpc.server.controlContainer.mutationOptions(),
    onSuccess: () => {
      toast.success("Container command dispatched");
      setPendingAction(null);
      void containersQuery.refetch();
      void servicesQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const refreshAll = useCallback(() => {
    void Promise.all([
      serversQuery.refetch(),
      registriesQuery.refetch(),
      s3Query.refetch(),
      localInfoQuery.refetch(),
      infoQuery.refetch(),
      containersQuery.refetch(),
      servicesQuery.refetch(),
      networksQuery.refetch(),
      volumesQuery.refetch(),
      projectsQuery.refetch(),
      swarmInfoQuery.refetch(),
      swarmNodesQuery.refetch(),
      swarmTasksQuery.refetch(),
    ]);
  }, [
    containersQuery,
    infoQuery,
    networksQuery,
    projectsQuery,
    registriesQuery,
    s3Query,
    serversQuery,
    servicesQuery,
    swarmInfoQuery,
    swarmNodesQuery,
    swarmTasksQuery,
    volumesQuery,
    localInfoQuery.refetch,
  ]);

  const graphLoading =
    ready &&
    (infoQuery.isPending ||
      containersQuery.isPending ||
      servicesQuery.isPending ||
      serversQuery.isPending);
  const targetInventoryError = [
    infoQuery,
    localInfoQuery,
    containersQuery,
    servicesQuery,
    networksQuery,
    volumesQuery,
  ].find((query) => query.isError)?.error;
  const targetInventoryErrorMessage = targetInventoryError
    ? targetInventoryError instanceof Error
      ? targetInventoryError.message
      : "The selected Docker target did not return its inventory."
    : undefined;
  const counts = topology.counts;
  const visibleCount = nodes.length;
  const runningContainers = containers.filter(
    (container) => container.state === "running",
  ).length;
  const unhealthyCount =
    containers.filter((container) => container.state !== "running").length +
    swarmTasks.filter((task) =>
      ["failed", "rejected"].includes(task.currentState),
    ).length;
  const onNodeClick = useCallback<NodeMouseHandler<TopologyNode>>((_, node) => {
    setSelectedNodeId(node.id);
    setDetailTab("overview");
  }, []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  return (
    <DashboardPage className="max-w-[1600px] gap-5 pb-4">
      <DashboardPageHeader
        title="Infrastructure topology"
        description="A live relationship map of your Docker estate, deployment resources, services, routes, and storage. Select any node to inspect it without leaving the map."
        icon={<Network className="size-6 text-primary" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={graphLoading}
            >
              {infoQuery.isFetching ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-medium text-muted-foreground text-xs">
              Visible objects
            </CardTitle>
            <Layers className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="font-semibold text-2xl tabular-nums">
              {visibleCount}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-medium text-muted-foreground text-xs">
              Running containers
            </CardTitle>
            <CheckCircle className="size-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="font-semibold text-2xl text-success tabular-nums">
              {runningContainers}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-medium text-muted-foreground text-xs">
              Attention needed
            </CardTitle>
            <AlertCircle className="size-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="font-semibold text-2xl text-warning tabular-nums">
              {unhealthyCount}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-medium text-muted-foreground text-xs">
              Swarm quorum
            </CardTitle>
            <Server className="size-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="font-semibold text-2xl tabular-nums">
              {swarmInfoQuery.data?.activeManagers ?? "—"}
              <span className="font-normal text-muted-foreground text-sm">
                {" "}
                / {swarmInfoQuery.data?.managers ?? "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/60">
        <CardHeader className="gap-4 border-b bg-card/70 pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" /> Explore your
                infrastructure
              </CardTitle>
              <CardDescription className="mt-1">
                Drag the canvas, scroll to zoom, and click a node to open its
                live operator panel.
              </CardDescription>
            </div>
            <div className="flex w-full items-center gap-2">
              <InputGroup className="min-w-60 flex-1">
                <InputGroupAddon align="inline-start">
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search topology"
                  placeholder="Search objects…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </InputGroup>
              <Select
                value={targetId}
                onValueChange={(value) => {
                  if (!value) return;
                  setTargetId(value);
                  setSelectedNodeId(null);
                  setDetailTab("overview");
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-60">
                  <SelectValue placeholder="Inspection target" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="local">Local Docker daemon</SelectItem>
                    {servers.map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <ToggleGroup
              multiple
              value={selectedKinds}
              onValueChange={(value) =>
                setSelectedKinds(value as TopologyKind[])
              }
              className="flex flex-wrap justify-start"
            >
              {ALL_KINDS.map((kind) => {
                const Icon = KIND_CONFIG[kind].icon;
                return (
                  <ToggleGroupItem
                    key={kind}
                    value={kind}
                    size="sm"
                    aria-label={`Toggle ${KIND_CONFIG[kind].label}`}
                    className="gap-1.5 text-[11px]"
                  >
                    <Icon className="size-3" />
                    {KIND_CONFIG[kind].label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <TopologyLegend counts={counts} />
          </div>
        </CardHeader>
        {targetInventoryErrorMessage ? (
          <div className="border-b px-4 py-3">
            <Alert variant="destructive">
              <AlertTitle>
                Unable to read {targetId === "local" ? "local" : "remote"}{" "}
                Docker inventory
              </AlertTitle>
              <AlertDescription>
                {targetInventoryErrorMessage}. The target node remains visible
                so you can verify the selected host and retry the connection.
              </AlertDescription>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={refreshAll}
              >
                Retry inventory
              </Button>
            </Alert>
          </div>
        ) : null}
        <CardContent className="p-0">
          {!ready ? (
            <div className="flex h-[620px] items-center justify-center p-8">
              <Spinner />
            </div>
          ) : graphLoading ? (
            <div className="grid h-[620px] grid-cols-4 gap-6 bg-muted/10 p-8">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
              <Skeleton className="h-56" />
              <Skeleton className="h-72" />
            </div>
          ) : visibleCount === 0 ? (
            <div className="flex h-[620px] items-center justify-center p-8">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Network />
                  </EmptyMedia>
                  <EmptyTitle>No matching infrastructure</EmptyTitle>
                  <EmptyDescription>
                    Try clearing the search or enabling more object types. If
                    the canvas is empty after that, the selected Docker target
                    has not reported any objects.
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedKinds(ALL_KINDS)}
                >
                  Show all types
                </Button>
              </Empty>
            </div>
          ) : (
            <div className="h-155 w-full bg-muted/5">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.22, maxZoom: 1.05 }}
                minZoom={0.2}
                maxZoom={1.6}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                nodesFocusable
                edgesFocusable
                onNodesChange={onNodesChange}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                proOptions={{ hideAttribution: true }}
                aria-label="Infrastructure topology map"
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1}
                  color="var(--border)"
                />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap
                  pannable
                  zoomable
                  bgColor="rgba(15, 23, 42, 0.04)"
                  nodeColor={getMiniMapNodeColor}
                  nodeComponent={TopologyMiniMapNode}
                  nodeStrokeColor="#0f172a"
                  nodeStrokeWidth={1}
                  nodeBorderRadius={8}
                  maskColor="rgba(15, 23, 42, 0.12)"
                  position="bottom-right"
                  ariaLabel="Topology overview minimap"
                />
                <Panel
                  position="top-left"
                  className="rounded-xl border bg-background/90 px-3 py-2 text-[11px] text-muted-foreground shadow-sm backdrop-blur"
                >
                  <span className="font-medium text-foreground">Live map</span>
                  <span className="mx-1.5">·</span>
                  {dockerInfo?.serverVersion || "Docker target"}
                  <span className="mx-1.5">·</span>
                  {new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Panel>
                <Panel
                  position="top-right"
                  className="flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-md backdrop-blur"
                >
                  <TooltipProvider>
                    <Select
                      value={groupBy}
                      onValueChange={(val) => setGroupBy(val as typeof groupBy)}
                    >
                      <SelectTrigger className="h-7 w-[95px] px-2 text-xs">
                        <SelectValue placeholder="Group by" />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectGroup>
                          <SelectItem value="none">Flat View</SelectItem>
                          <SelectItem value="environment">
                            Environment
                          </SelectItem>
                          <SelectItem value="network">Network</SelectItem>
                          <SelectItem value="server">Host Server</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>

                    {groupBy !== "none" ? (
                      <>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => {
                                  setCollapsedClusterIds(
                                    new Set(topology.clusterIds ?? []),
                                  );
                                  toast.success(
                                    "Collapsed all cluster subgraphs",
                                  );
                                }}
                                aria-label="Collapse all clusters"
                              >
                                <Boxes className="size-4 text-warning" />
                              </Button>
                            }
                          />
                          <TooltipContent>
                            Collapse all subgraphs
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => {
                                  setCollapsedClusterIds(new Set());
                                  toast.success(
                                    "Expanded all cluster subgraphs",
                                  );
                                }}
                                aria-label="Expand all clusters"
                              >
                                <Sparkles className="size-4 text-primary" />
                              </Button>
                            }
                          />
                          <TooltipContent>Expand all subgraphs</TooltipContent>
                        </Tooltip>
                      </>
                    ) : null}

                    <div className="my-auto h-4 w-px bg-border" />

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 font-mono font-semibold text-xs uppercase tracking-wider"
                            onClick={() => {
                              const nextAlgo =
                                layoutAlgo === "dagre" ? "elk" : "dagre";
                              setLayoutAlgo(nextAlgo);
                              void handleApplyLayout(nextAlgo, layoutDir);
                            }}
                          >
                            {layoutAlgo}
                          </Button>
                        }
                      />
                      <TooltipContent>
                        Algorithm:{" "}
                        {layoutAlgo === "dagre"
                          ? "Dagre (DAG)"
                          : "ELK.js (Layered)"}{" "}
                        (click to toggle)
                      </TooltipContent>
                    </Tooltip>

                    <div className="my-auto h-4 w-px bg-border" />

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              const nextDir =
                                layoutDir === "vertical"
                                  ? "horizontal"
                                  : "vertical";
                              setLayoutDir(nextDir);
                              void handleApplyLayout(layoutAlgo, nextDir);
                            }}
                            aria-label="Toggle layout direction"
                          >
                            {layoutDir === "vertical" ? (
                              <ArrowDown className="size-4" />
                            ) : (
                              <ArrowRightIcon className="size-4" />
                            )}
                          </Button>
                        }
                      />
                      <TooltipContent>
                        Direction:{" "}
                        {layoutDir === "vertical"
                          ? "Vertical (Top-Down)"
                          : "Horizontal (Left-Right)"}{" "}
                        (click to toggle)
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              void handleApplyLayout(layoutAlgo, layoutDir)
                            }
                            aria-label="Run auto-layout"
                          >
                            <WandSparkles className="size-4 text-primary" />
                          </Button>
                        }
                      />
                      <TooltipContent>Run auto-layout engine</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={handleResolveCollisionsOnly}
                            aria-label="Fix overlapping nodes"
                          >
                            <Boxes className="size-4 text-info" />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        Fix overlapping node positions
                      </TooltipContent>
                    </Tooltip>

                    <div className="my-auto h-4 w-px bg-border" />

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant={showEdgeLabels ? "secondary" : "ghost"}
                            onClick={() => setShowEdgeLabels((prev) => !prev)}
                            aria-label="Toggle edge labels"
                          >
                            <FileText className="size-4" />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        {showEdgeLabels
                          ? "Hide edge relation labels"
                          : "Show edge relation labels"}
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              fitView({ padding: 0.22, duration: 350 })
                            }
                            aria-label="Fit map to screen"
                          >
                            <LineChart className="size-4" />
                          </Button>
                        }
                      />
                      <TooltipContent>Fit map to screen</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setSelectedKinds(ALL_KINDS)}
                            aria-label="Show all object types"
                          >
                            <Layers className="size-4" />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        Reset type filters (show all)
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Panel>
              </ReactFlow>
            </div>
          )}
        </CardContent>
        <div className="flex flex-col gap-2 border-t bg-card/50 px-4 py-3 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="font-medium text-foreground">Tip:</span> Use search
            to isolate a service, host, domain, or volume; use the type chips to
            simplify large estates.
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />{" "}
            Auto-refreshing live state
          </span>
        </div>
      </Card>

      <Sheet
        open={selectedNodeId !== null}
        onOpenChange={(open) => !open && setSelectedNodeId(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedGraphNode ? (
            <Tabs
              value={detailTab}
              onValueChange={(value) => setDetailTab(value as typeof detailTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <SheetHeader className="border-b px-6 pb-5">
                <div className="flex items-start gap-3 pr-8">
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                      selectedConfig.bg,
                    )}
                  >
                    <SelectedIcon
                      className={cn("size-5", selectedConfig.color)}
                    />
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="truncate">
                      {selectedGraphNode.data.label}
                    </SheetTitle>
                    <SheetDescription className="mt-1">
                      {selectedGraphNode.data.subtitle ||
                        KIND_CONFIG[selectedGraphNode.data.kind].label.slice(
                          0,
                          -1,
                        )}
                      {selectedGraphNode.data.status ? (
                        <Badge
                          variant={nodeStatusVariant(
                            selectedGraphNode.data.status,
                          )}
                          className="ml-2 align-middle"
                        >
                          {statusLabel(selectedGraphNode.data.status)}
                        </Badge>
                      ) : null}
                    </SheetDescription>
                    <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          statusPulseClass(selectedGraphNode.data.status) ||
                            "bg-muted-foreground/50",
                        )}
                      />
                      <span>
                        {hasLiveStatus(selectedGraphNode.data.status)
                          ? "Live status"
                          : "Status not reported"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {KIND_CONFIG[selectedGraphNode.data.kind].label.slice(
                          0,
                          -1,
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <TabsList className="mt-2 grid w-full grid-cols-3">
                  <TabsTrigger value="overview" className="gap-1.5">
                    <Settings className="size-3" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger
                    value="logs"
                    className="gap-1.5"
                    disabled={!canInspectLogs}
                  >
                    <FileText className="size-3" />
                    Logs
                  </TabsTrigger>
                  <TabsTrigger
                    value="metrics"
                    className="gap-1.5"
                    disabled={!canInspectMetrics}
                  >
                    <LineChart className="size-3" />
                    Metrics
                  </TabsTrigger>
                </TabsList>
              </SheetHeader>
              <div className="flex flex-col gap-5 px-6 py-5">
                <TabsContent
                  value="overview"
                  className="mt-0 flex flex-col gap-5"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <StatPill
                      label="Type"
                      value={KIND_CONFIG[
                        selectedGraphNode.data.kind
                      ].label.slice(0, -1)}
                    />
                    <StatPill
                      label="Status"
                      value={statusLabel(selectedGraphNode.data.status)}
                      tone={
                        selectedGraphNode.data.isHealthy === false
                          ? "danger"
                          : selectedGraphNode.data.isHealthy
                            ? "success"
                            : "default"
                      }
                    />
                  </div>
                  {selectedGraphNode.data.isCluster ||
                  selectedGraphNode.data.kind === "cluster" ? (
                    <Card className="border-primary/30 bg-primary/5">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">
                            Subgraph Cluster
                          </CardTitle>
                          <Badge variant="outline">
                            {selectedGraphNode.data.isCollapsed
                              ? "Collapsed"
                              : "Expanded"}
                          </Badge>
                        </div>
                        <CardDescription>
                          {selectedGraphNode.data.isCollapsed
                            ? "This cluster consolidates related objects into a single summary node to simplify the map."
                            : "This node belongs to an active subgraph group on the topology map."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3 pt-0">
                        {Array.isArray(selectedGraphNode.data.memberNodes) &&
                        selectedGraphNode.data.memberNodes.length > 0 ? (
                          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
                            <p className="mb-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                              Member Objects (
                              {selectedGraphNode.data.memberNodes.length})
                            </p>
                            {(
                              selectedGraphNode.data.memberNodes as Array<{
                                id: string;
                                label: string;
                                kind: TopologyKind;
                                status?: string;
                                subtitle?: string;
                              }>
                            ).map((member) => {
                              const mConfig =
                                KIND_CONFIG[member.kind] ?? KIND_CONFIG.server;
                              const MIcon = mConfig.icon;
                              return (
                                <button
                                  type="button"
                                  key={member.id}
                                  className="flex cursor-pointer items-center justify-between rounded-xl border bg-background px-3 py-2 text-left text-xs transition hover:border-primary hover:bg-accent/5"
                                  onClick={() => setSelectedNodeId(member.id)}
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <div
                                      className={cn(
                                        "flex size-6 shrink-0 items-center justify-center rounded-lg border",
                                        mConfig.bg || "",
                                      )}
                                    >
                                      <MIcon
                                        className={cn("size-3", mConfig.color)}
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold text-xs">
                                        {member.label}
                                      </p>
                                      <p className="truncate text-[10px] text-muted-foreground">
                                        {member.subtitle ||
                                          mConfig.label.slice(0, -1)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="ml-2 flex shrink-0 items-center gap-1.5">
                                    {member.status ? (
                                      <Badge
                                        variant={nodeStatusVariant(
                                          member.status,
                                        )}
                                        className="text-[10px]"
                                      >
                                        {statusLabel(member.status)}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        {typeof selectedGraphNode.data.onToggleCluster ===
                        "function" ? (
                          <Button
                            size="sm"
                            className="mt-1 w-full"
                            onClick={() => {
                              (
                                selectedGraphNode.data
                                  .onToggleCluster as () => void
                              )();
                            }}
                          >
                            <Boxes data-icon="inline-start" />
                            {selectedGraphNode.data.isCollapsed
                              ? "Expand Cluster Subgraph"
                              : "Collapse Cluster Subgraph"}
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  ) : null}

                  <Card className="bg-muted/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Configuration</CardTitle>
                      <CardDescription>
                        Safe operational metadata. Secrets and credentials are
                        intentionally excluded.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <DetailRow
                        label="Name"
                        value={selectedGraphNode.data.label}
                      />
                      <DetailRow
                        label="Role"
                        value={selectedGraphNode.data.subtitle}
                      />
                      <DetailRow
                        label="Details"
                        value={selectedGraphNode.data.meta}
                        mono={
                          selectedGraphNode.data.kind === "container" ||
                          selectedGraphNode.data.kind === "network"
                        }
                      />
                      {selectedContainer ? (
                        <>
                          <DetailRow
                            label="Container ID"
                            value={selectedContainer.id.slice(0, 12)}
                            mono
                          />
                          <DetailRow
                            label="Ports"
                            value={selectedContainer.ports}
                            mono
                          />
                          <DetailRow
                            label="Networks"
                            value={selectedContainer.networks.join(", ")}
                          />
                        </>
                      ) : null}
                      {selectedService ? (
                        <>
                          <DetailRow
                            label="Image"
                            value={selectedService.image}
                            mono
                          />
                          <DetailRow
                            label="Replicas"
                            value={selectedService.replicas}
                          />
                        </>
                      ) : null}
                      {selectedResource ? (
                        <>
                          <DetailRow
                            label="Provider"
                            value={selectedResource.provider}
                          />
                          <DetailRow
                            label="Image"
                            value={selectedResource.dockerImage}
                            mono
                          />
                          <DetailRow
                            label="Database"
                            value={selectedResource.dbType}
                          />
                        </>
                      ) : null}
                    </CardContent>
                  </Card>
                  <div className="flex flex-wrap gap-2">
                    {selectedGraphNode.data.resourcePath ? (
                      <Link
                        className={buttonVariants({ size: "sm" })}
                        href={selectedGraphNode.data.resourcePath as Route}
                      >
                        Open resource <ExternalLink data-icon="inline-end" />
                      </Link>
                    ) : null}
                    {selectedContainer ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPendingAction({
                              containerId: selectedContainer.id,
                              label: selectedContainer.name,
                              command:
                                selectedContainer.state === "running"
                                  ? "restart"
                                  : "start",
                            })
                          }
                        >
                          {selectedContainer.state === "running"
                            ? "Restart"
                            : "Start"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPendingAction({
                              containerId: selectedContainer.id,
                              label: selectedContainer.name,
                              command: "stop",
                            })
                          }
                          disabled={selectedContainer.state !== "running"}
                        >
                          Stop
                        </Button>
                      </>
                    ) : null}
                    {selectedGraphNode.data.kind === "container" ||
                    selectedGraphNode.data.kind === "service" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDetailTab("logs")}
                      >
                        <Terminal data-icon="inline-start" />
                        Inspect logs
                      </Button>
                    ) : null}
                  </div>
                  {selectedGraphNode.data.kind === "domain" ? (
                    <Alert
                      variant="warning"
                      className="border-warning/30 bg-warning/5 text-warning-foreground"
                    >
                      <Globe className="size-4 text-warning" />
                      <AlertTitle className="font-medium text-warning">
                        Route Mapping
                      </AlertTitle>
                      <AlertDescription className="text-xs">
                        This route is represented from the resource’s Caddy
                        mapping. Open the resource to edit routing,
                        certificates, middleware, and upstream service settings.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {selectedGraphNode.data.kind === "registry" ? (
                    <Alert className="border-info/30 bg-info/5 text-info-foreground">
                      <Database className="size-4 text-info" />
                      <AlertTitle className="font-medium text-info">
                        Registry Credentials
                      </AlertTitle>
                      <AlertDescription className="text-xs">
                        Registry credentials are never exposed in the topology.
                        Use the Docker Registry page to test or update this
                        connection.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </TabsContent>
                <TabsContent value="logs" className="mt-0">
                  <Card className="overflow-hidden bg-muted/20">
                    <CardHeader className="border-b pb-3">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Terminal className="size-4 text-success" />
                        Live logs
                      </CardTitle>
                      <CardDescription>
                        Last 160 lines, refreshed every five seconds.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {isLogsLoading ? (
                        <div className="flex min-h-56 items-center justify-center">
                          <Spinner />
                        </div>
                      ) : (
                        <pre className="max-h-[520px] min-h-56 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-5">
                          {String(
                            selectedResource
                              ? resourceLogsQuery.data ||
                                  "No logs reported by this resource."
                              : logsQuery.data ||
                                  "No logs reported by this object.",
                          )}
                        </pre>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="metrics" className="mt-0">
                  <Card className="overflow-hidden bg-muted/20">
                    <CardHeader className="border-b pb-3">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <LineChart className="size-4 text-info" />
                        Live metrics
                      </CardTitle>
                      <CardDescription>
                        Point-in-time Docker runtime metrics, refreshed every
                        five seconds.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {isMetricsLoading ? (
                        <div className="flex min-h-56 items-center justify-center">
                          <Spinner />
                        </div>
                      ) : (
                        <pre className="max-h-130 min-h-56 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-5">
                          {JSON.stringify(
                            (selectedResource
                              ? resourceStatsQuery.data
                              : metricsQuery.data) || {
                              message:
                                "Select a running container or resource to inspect runtime metrics.",
                            },
                            null,
                            2,
                          )}
                        </pre>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmActionDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={`${pendingAction?.command === "restart" ? "Restart" : pendingAction?.command === "stop" ? "Stop" : "Start"} ${pendingAction?.label ?? "container"}?`}
        description="This sends a command to the selected Docker target. The action is scoped to this container and is recorded by the existing server authorization and audit paths."
        actionLabel={`${pendingAction?.command === "restart" ? "Restart" : pendingAction?.command === "stop" ? "Stop" : "Start"} container`}
        pending={controlContainerMutation.isPending}
        onConfirm={() => {
          if (pendingAction)
            controlContainerMutation.mutate({
              ...inventoryInput,
              containerId: pendingAction.containerId,
              command: pendingAction.command,
            });
        }}
      />
    </DashboardPage>
  );
}
