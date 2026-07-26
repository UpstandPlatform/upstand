"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@upstand/ui/components/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageSkeleton } from "@/components/dashboard/page-skeleton";
import {
  AlertTriangleIcon,
  Copy,
  Layers,
  RefreshCw,
  Server,
  Shield,
  TriangleAlert,
  UserRound,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

type SwarmNode = {
  id: string;
  hostname: string;
  role: "manager" | "worker";
  status: string;
  availability: "active" | "drain" | "pause";
  ip: string;
  engineVersion: string;
  version: number;
  leader: boolean;
  managerAddr: string;
  reachability: string;
  isLocalNode: boolean;
};

type PendingAction =
  | {
      kind: "availability";
      node: SwarmNode;
      availability: "active" | "drain" | "pause";
    }
  | { kind: "role"; node: SwarmNode; role: "manager" | "worker" }
  | { kind: "remove"; node: SwarmNode }
  | { kind: "rotate"; role: "worker" | "manager" };

const REFRESH_INTERVAL_MS = 15_000;

function nodeStatusVariant(status: string) {
  return status === "ready" ? "default" : "secondary";
}

function actionCopy(action: PendingAction): {
  title: string;
  description: string;
  submitLabel: string;
} {
  switch (action.kind) {
    case "availability":
      return {
        title: `Set ${action.node.hostname} to ${action.availability}`,
        description:
          action.availability === "drain"
            ? "Swarm will stop scheduling new tasks on this node and move eligible tasks elsewhere."
            : "This changes how Swarm schedules workload on the selected node.",
        submitLabel: "Apply scheduling change",
      };
    case "role":
      return {
        title:
          action.role === "manager"
            ? `Promote ${action.node.hostname} to manager`
            : `Demote ${action.node.hostname} to worker`,
        description:
          action.role === "manager"
            ? "Managers hold cluster state and should run on reliable hosts. Keep an odd number of managers for quorum."
            : "Demoting a manager changes the cluster quorum. The API will reject an unsafe change.",
        submitLabel: action.role === "manager" ? "Promote node" : "Demote node",
      };
    case "remove":
      return {
        title: `Remove ${action.node.hostname} from the cluster`,
        description:
          "The node is drained before removal. Running tasks may be rescheduled, but local volumes are not migrated.",
        submitLabel: "Drain and remove node",
      };
    case "rotate":
      return {
        title: `Rotate the ${action.role} join token`,
        description:
          "All unused join commands for this role stop working immediately. Copy the new command after rotation.",
        submitLabel: "Rotate token",
      };
  }
}

export default function DockerSwarmPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [advertiseAddr, setAdvertiseAddr] = useState("");
  const [dataPathAddr, setDataPathAddr] = useState("");
  const [defaultAddrPools, setDefaultAddrPools] = useState(
    "10.20.0.0/16, 10.21.0.0/16",
  );
  const [subnetSize, setSubnetSize] = useState("24");
  const [activeTab, setActiveTab] = useState<"nodes" | "tasks">("nodes");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState("");
  const [joinCommands, setJoinCommands] = useState<{
    workerCommand: string;
    managerCommand: string;
  } | null>(null);

  const swarmInfoQuery = useQuery({
    ...trpc.swarm.getInfo.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const swarmInfo = swarmInfoQuery.data;
  const swarmIsActive = swarmInfo?.localNodeState === "active";
  const canManageCluster = swarmIsActive && swarmInfo.isManager;

  const nodesQuery = useQuery({
    ...trpc.swarm.getNodes.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready" && canManageCluster,
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const nodes = (nodesQuery.data || []) as SwarmNode[];

  const tasksQuery = useQuery({
    ...trpc.swarm.getTasks.queryOptions({ organizationId }),
    enabled:
      organizationState.status === "ready" &&
      canManageCluster &&
      activeTab === "tasks",
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const joinCommandsQuery = useQuery({
    ...trpc.swarm.getJoinCommands.queryOptions({ organizationId }),
    enabled: false,
  });

  const refreshCluster = async () => {
    await Promise.all([
      swarmInfoQuery.refetch(),
      canManageCluster ? nodesQuery.refetch() : Promise.resolve(),
      canManageCluster && activeTab === "tasks"
        ? tasksQuery.refetch()
        : Promise.resolve(),
    ]);
  };

  const initSwarmMutation = useMutation({
    ...trpc.swarm.initSwarm.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        "Docker Swarm initialized with an attachable overlay network.",
      );
      await refreshCluster();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateNodeMutation = useMutation({
    ...trpc.swarm.updateNode.mutationOptions(),
    onSuccess: async () => {
      setPendingAction(null);
      toast.success("Swarm node updated.");
      await refreshCluster();
    },
    onError: (error) => toast.error(error.message),
  });
  const removeNodeMutation = useMutation({
    ...trpc.swarm.removeNode.mutationOptions(),
    onSuccess: async () => {
      setPendingAction(null);
      setConfirmation("");
      toast.success("Swarm node drained and removed.");
      await refreshCluster();
    },
    onError: (error) => toast.error(error.message),
  });
  const rotateTokenMutation = useMutation({
    ...trpc.swarm.rotateJoinToken.mutationOptions(),
    onSuccess: async (result) => {
      setJoinCommands((current) =>
        current
          ? {
              ...current,
              ...(result.role === "worker"
                ? { workerCommand: result.command }
                : { managerCommand: result.command }),
            }
          : current,
      );
      setPendingAction(null);
      toast.success(`${result.role} join token rotated.`);
      await refreshCluster();
    },
    onError: (error) => toast.error(error.message),
  });

  const submitAction = () => {
    if (!pendingAction) return;

    if (pendingAction.kind === "availability") {
      updateNodeMutation.mutate({
        organizationId,
        nodeId: pendingAction.node.id,
        version: pendingAction.node.version,
        availability: pendingAction.availability,
      });
      return;
    }

    if (pendingAction.kind === "role") {
      updateNodeMutation.mutate({
        organizationId,
        nodeId: pendingAction.node.id,
        version: pendingAction.node.version,
        role: pendingAction.role,
      });
      return;
    }

    if (pendingAction.kind === "remove") {
      removeNodeMutation.mutate({
        organizationId,
        nodeId: pendingAction.node.id,
        version: pendingAction.node.version,
        confirmation,
      });
      return;
    }

    rotateTokenMutation.mutate({ organizationId, role: pendingAction.role });
  };

  const revealJoinCommands = async () => {
    const result = await joinCommandsQuery.refetch();
    if (result.error || !result.data) {
      toast.error(result.error?.message || "Unable to load join commands.");
      return;
    }
    setJoinCommands(result.data);
    toast.success("Join commands are available for this session.");
  };

  const copyCommand = async (command: string) => {
    try {
      await copyText(command);
      toast.success("Join command copied to clipboard.");
    } catch {
      toast.error("The browser could not access the clipboard.");
    }
  };

  const mutationPending =
    initSwarmMutation.isPending ||
    updateNodeMutation.isPending ||
    removeNodeMutation.isPending ||
    rotateTokenMutation.isPending;
  const pendingCopy = pendingAction ? actionCopy(pendingAction) : null;

  if (!organizationId) {
    return (
      <DashboardPage className="gap-4">
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Select an organization</AlertTitle>
          <AlertDescription>
            Docker Swarm is a host-level capability. Select the organization
            that owns this control plane to continue.
          </AlertDescription>
        </Alert>
      </DashboardPage>
    );
  }

  if (swarmInfoQuery.isLoading) {
    return <PageSkeleton />;
  }

  return (
    <DashboardPage className="gap-6">
      <DashboardPageHeader
        title="Docker Swarm"
        icon={<Layers className="size-6 text-primary" />}
        description="Manage the manager node, workload scheduling, and joining credentials for this Docker Swarm cluster."
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={refreshCluster}
            disabled={swarmInfoQuery.isFetching}
          >
            <RefreshCw data-icon="inline-start" />
          </Button>
        }
      />

      {swarmInfo?.error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Docker engine is unavailable</AlertTitle>
          <AlertDescription>{swarmInfo.error}</AlertDescription>
        </Alert>
      ) : null}

      {!swarmIsActive ? (
        <Card>
          <CardHeader>
            <CardTitle>Initialize a production Swarm manager</CardTitle>
            <CardDescription>
              Choose a routable private or public address. Never use localhost,
              127.0.0.1, or 0.0.0.0 for a multi-node cluster.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="swarm-advertise-address">
                  Advertise address
                </FieldLabel>
                <Input
                  id="swarm-advertise-address"
                  placeholder="10.0.0.10 or swarm-manager.internal"
                  value={advertiseAddr}
                  onChange={(event) => setAdvertiseAddr(event.target.value)}
                />
                <FieldDescription>
                  Other manager and worker nodes use this address on TCP 2377.
                  Open TCP 2377, TCP/UDP 7946, and UDP 4789 between every node.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="swarm-data-path-address">
                  Data path address (optional)
                </FieldLabel>
                <Input
                  id="swarm-data-path-address"
                  placeholder="10.0.1.10"
                  value={dataPathAddr}
                  onChange={(event) => setDataPathAddr(event.target.value)}
                />
                <FieldDescription>
                  Use a dedicated private interface when overlay traffic should
                  be isolated from manager traffic.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="swarm-address-pools">
                  Overlay address pools
                </FieldLabel>
                <Input
                  id="swarm-address-pools"
                  placeholder="10.20.0.0/16, 10.21.0.0/16"
                  value={defaultAddrPools}
                  onChange={(event) => setDefaultAddrPools(event.target.value)}
                />
                <FieldDescription>
                  Comma-separated CIDR ranges for future overlay networks. They
                  must not overlap with any existing infrastructure network.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="swarm-subnet-size">
                  Overlay subnet prefix length
                </FieldLabel>
                <Input
                  id="swarm-subnet-size"
                  type="number"
                  min={16}
                  max={28}
                  value={subnetSize}
                  onChange={(event) => setSubnetSize(event.target.value)}
                />
                <FieldDescription>
                  Use `/24` unless your service density requires a different
                  address allocation size.
                </FieldDescription>
              </Field>
              <Button
                onClick={() =>
                  initSwarmMutation.mutate({
                    organizationId,
                    advertiseAddr,
                    ...(dataPathAddr ? { dataPathAddr } : {}),
                    defaultAddrPools: defaultAddrPools
                      .split(",")
                      .map((pool) => pool.trim())
                      .filter(Boolean),
                    subnetSize: Number(subnetSize),
                  })
                }
                disabled={
                  !advertiseAddr ||
                  !defaultAddrPools.trim() ||
                  !subnetSize ||
                  initSwarmMutation.isPending
                }
              >
                {initSwarmMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Initialize manager
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Cluster state" value={swarmInfo.localNodeState} />
            <StatCard
              label="Cluster members"
              value={`${swarmInfo.nodeCount}`}
              detail={`${swarmInfo.managers} manager${swarmInfo.managers === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Reachable managers"
              value={`${swarmInfo.activeManagers}`}
              detail="Maintain an odd quorum"
            />
            <StatCard
              label="Manager address"
              value={swarmInfo.nodeAddress || "Unavailable"}
              detail={`Data path UDP ${swarmInfo.dataPathPort || 4789}`}
            />
          </div>

          {!canManageCluster ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>This control plane is on a Swarm worker</AlertTitle>
              <AlertDescription>
                Node inventories, join credentials, and cluster mutations are
                only available from a reachable manager. Move Upstand to a
                manager node or connect it to a manager Docker API endpoint.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Join credentials</CardTitle>
                  <CardDescription>
                    Credentials are hidden by default and are only available to
                    an organization owner with a verified second factor.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {!joinCommands ? (
                    <Button
                      className="self-start"
                      onClick={revealJoinCommands}
                      disabled={joinCommandsQuery.isFetching}
                    >
                      {joinCommandsQuery.isFetching ? (
                        <Spinner data-icon="inline-start" />
                      ) : null}
                      Reveal join commands
                    </Button>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <JoinCommand
                        label="Worker"
                        command={joinCommands.workerCommand}
                        onCopy={copyCommand}
                        onRotate={() =>
                          setPendingAction({ kind: "rotate", role: "worker" })
                        }
                      />
                      <JoinCommand
                        label="Manager"
                        command={joinCommands.managerCommand}
                        onCopy={copyCommand}
                        onRotate={() =>
                          setPendingAction({ kind: "rotate", role: "manager" })
                        }
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  setActiveTab(value as "nodes" | "tasks")
                }
              >
                <TabsList>
                  <TabsTrigger value="nodes">Nodes</TabsTrigger>
                  <TabsTrigger value="tasks">Tasks</TabsTrigger>
                </TabsList>

                <TabsContent value="nodes">
                  <Card>
                    <CardHeader>
                      <CardTitle>Cluster nodes</CardTitle>
                      <CardDescription>
                        Changes use Docker object versions, so stale actions are
                        rejected instead of overwriting newer cluster state.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {nodesQuery.isLoading ? (
                        <div className="flex min-h-48 items-center justify-center">
                          <Spinner className="size-6" />
                        </div>
                      ) : nodes.length === 0 ? (
                        <Empty>
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <Server />
                            </EmptyMedia>
                            <EmptyTitle>No nodes reported</EmptyTitle>
                            <EmptyDescription>
                              The manager did not return any node records.
                              Refresh the cluster or verify the Docker socket
                              connection.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Node</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>State</TableHead>
                              <TableHead>Availability</TableHead>
                              <TableHead>Engine</TableHead>
                              <TableHead className="text-right">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {nodes.map((node) => (
                              <TableRow key={node.id}>
                                <TableCell>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">
                                      {node.hostname}
                                      {node.isLocalNode
                                        ? " (control plane)"
                                        : ""}
                                    </span>
                                    <span className="font-mono text-muted-foreground text-xs">
                                      {node.ip || "No address"}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      node.role === "manager"
                                        ? "default"
                                        : "secondary"
                                    }
                                  >
                                    {node.leader ? "leader" : node.role}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={nodeStatusVariant(node.status)}
                                  >
                                    {node.status}
                                  </Badge>
                                  {node.reachability ? (
                                    <p className="mt-1 text-muted-foreground text-xs">
                                      {node.reachability}
                                    </p>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    items={[
                                      { value: "active", label: "Active" },
                                      { value: "pause", label: "Pause" },
                                      { value: "drain", label: "Drain" },
                                    ]}
                                    value={node.availability}
                                    onValueChange={(value) =>
                                      setPendingAction({
                                        kind: "availability",
                                        node,
                                        availability: value as
                                          | "active"
                                          | "drain"
                                          | "pause",
                                      })
                                    }
                                    disabled={mutationPending}
                                  >
                                    <SelectTrigger size="sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        <SelectItem value="active">
                                          Active
                                        </SelectItem>
                                        <SelectItem value="pause">
                                          Pause
                                        </SelectItem>
                                        <SelectItem value="drain">
                                          Drain
                                        </SelectItem>
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {node.engineVersion}
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setPendingAction({
                                          kind: "role",
                                          node,
                                          role:
                                            node.role === "manager"
                                              ? "worker"
                                              : "manager",
                                        })
                                      }
                                      disabled={
                                        node.leader ||
                                        node.isLocalNode ||
                                        mutationPending
                                      }
                                    >
                                      {node.role === "manager" ? (
                                        <UserRound data-icon="inline-start" />
                                      ) : (
                                        <Shield data-icon="inline-start" />
                                      )}
                                      {node.role === "manager"
                                        ? "Demote"
                                        : "Promote"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() =>
                                        setPendingAction({
                                          kind: "remove",
                                          node,
                                        })
                                      }
                                      disabled={
                                        node.leader ||
                                        node.isLocalNode ||
                                        mutationPending
                                      }
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="tasks">
                  <Card>
                    <CardHeader>
                      <CardTitle>Swarm tasks</CardTitle>
                      <CardDescription>
                        Task state comes from the manager. CPU, memory, and disk
                        metrics are intentionally not shown because a manager
                        cannot truthfully inspect containers running on every
                        remote node.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <StatCard
                          label="Services"
                          value={`${tasksQuery.data?.totalServices || 0}`}
                        />
                        <StatCard
                          label="Running tasks"
                          value={`${tasksQuery.data?.runningTasks || 0}`}
                        />
                        <StatCard
                          label="Pending tasks"
                          value={`${tasksQuery.data?.pendingTasks || 0}`}
                        />
                      </div>
                      {tasksQuery.isLoading ? (
                        <div className="flex min-h-48 items-center justify-center">
                          <Spinner className="size-6" />
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Service</TableHead>
                              <TableHead>Node</TableHead>
                              <TableHead>Image</TableHead>
                              <TableHead>Desired</TableHead>
                              <TableHead>Current</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tasksQuery.data?.tasks.map((task) => (
                              <TableRow key={task.id}>
                                <TableCell>
                                  {task.serviceName}
                                  {task.slot ? `.${task.slot}` : ""}
                                </TableCell>
                                <TableCell>{task.nodeName}</TableCell>
                                <TableCell
                                  className="max-w-56 truncate font-mono text-xs"
                                  title={task.image}
                                >
                                  {task.image}
                                </TableCell>
                                <TableCell>{task.desiredState}</TableCell>
                                <TableCell>
                                  <span>{task.currentState}</span>
                                  {task.message ? (
                                    <p
                                      className="mt-1 max-w-64 truncate text-destructive text-xs"
                                      title={task.message}
                                    >
                                      {task.message}
                                    </p>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}

      <ConfirmActionDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !mutationPending) {
            setPendingAction(null);
            setConfirmation("");
          }
        }}
        title={pendingCopy?.title || "Confirm Action"}
        description={pendingCopy?.description}
        actionLabel={pendingCopy?.submitLabel || "Confirm"}
        variant={pendingAction?.kind === "remove" ? "destructive" : "default"}
        pending={mutationPending}
        onConfirm={submitAction}
      />
    </DashboardPage>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="break-all text-xl capitalize">{value}</CardTitle>
      </CardHeader>
      {detail ? (
        <CardContent className="pt-0 text-muted-foreground text-xs">
          {detail}
        </CardContent>
      ) : null}
    </Card>
  );
}

function JoinCommand({
  label,
  command,
  onCopy,
  onRotate,
}: {
  label: string;
  command: string;
  onCopy: (command: string) => Promise<void>;
  onRotate: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{label}</p>
        <Button size="sm" variant="outline" onClick={onRotate}>
          Rotate token
        </Button>
      </div>
      <code className="overflow-x-auto rounded-xl bg-muted p-3 text-xs">
        {command}
      </code>
      <Button size="sm" className="self-start" onClick={() => onCopy(command)}>
        <Copy data-icon="inline-start" />
        Copy Command
      </Button>
    </div>
  );
}
