"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { PageEmpty } from "@/components/dashboard/page-empty";
import {
  CardGridSkeleton,
  TableSkeleton,
} from "@/components/dashboard/page-skeleton";
import {
  Activity,
  AlertTriangleIcon,
  Clock,
  Server,
  Settings,
  Terminal,
  Trash2,
} from "@/components/huge-icons";
import {
  type DeploymentLog,
  DeploymentLogDialog,
  DeploymentStatusBadge,
} from "@/components/shared/deployment-presentation";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { useSystemConfig } from "@/hooks/use-system-config";
import { trpc } from "@/utils/trpc";

export function DeploymentsSubpage() {
  const organizationState = useRequiredActiveOrganization();
  const { isCloud } = useSystemConfig();
  const organizationId = organizationState.organizationId as string;
  const [activeTab, setActiveTab] = useState("history");
  const [selectedDeployment, setSelectedDeployment] =
    useState<DeploymentLog | null>(null);
  const [concurrencyInputs, setConcurrencyInputs] = useState<
    Record<string, number>
  >({});
  const [dirtyConcurrency, setDirtyConcurrency] = useState<
    Record<string, boolean>
  >({});
  const [cancelTarget, setCancelTarget] = useState<{
    serverId: string;
    jobId: string;
    deploymentId: string;
    label: string;
  } | null>(null);

  // Queries
  const {
    data: deployments = [],
    isPending: loadingDeployments,
    refetch: refetchDeployments,
  } = useQuery({
    ...trpc.deployment.getDeployments.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
    refetchInterval: activeTab === "history" ? 5000 : false,
  });

  const {
    data: queueJobs = [],
    isPending: loadingQueue,
    refetch: refetchQueue,
  } = useQuery({
    ...trpc.deployment.getQueue.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
    refetchInterval: activeTab === "queue" ? 3000 : false,
  });

  const {
    data: servers = [],
    isPending: loadingServers,
    refetch: refetchServers,
  } = useQuery({
    ...trpc.deployment.getServerSettings.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready" && !isCloud,
  });

  // Listen to parent refresh event
  useEffect(() => {
    const handleRefresh = () => {
      void refetchDeployments();
      void refetchQueue();
      void refetchServers();
    };
    window.addEventListener("refresh-deployments", handleRefresh);
    return () => {
      window.removeEventListener("refresh-deployments", handleRefresh);
    };
  }, [refetchDeployments, refetchQueue, refetchServers]);

  // Sync concurrency inputs from DB settings
  useEffect(() => {
    if (servers.length > 0) {
      const inputs: Record<string, number> = {};
      for (const server of servers) {
        inputs[server.id] = server.concurrency;
      }
      setConcurrencyInputs((current) => {
        const next = { ...current };
        for (const [serverId, value] of Object.entries(inputs)) {
          if (!dirtyConcurrency[serverId]) next[serverId] = value;
        }
        return next;
      });
    }
  }, [servers, dirtyConcurrency]);

  // Live update log details if modal is open
  useEffect(() => {
    if (selectedDeployment) {
      const liveDep = deployments.find((d) => d.id === selectedDeployment.id);
      if (liveDep && liveDep.logs !== selectedDeployment.logs) {
        setSelectedDeployment(liveDep);
      }
    }
  }, [deployments, selectedDeployment]);

  // Mutations
  const updateConcurrencyMutation = useMutation({
    ...trpc.deployment.updateServerConcurrency.mutationOptions(),
    onSuccess: (data, variables) => {
      toast.success(`Concurrency updated for server ${data.hostname}`);
      setConcurrencyInputs((current) => ({
        ...current,
        [variables.serverId]: variables.concurrency,
      }));
      void refetchServers().then(() => {
        setDirtyConcurrency((current) => ({
          ...current,
          [variables.serverId]: false,
        }));
      });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update concurrency");
    },
  });

  const cancelJobMutation = useMutation({
    ...trpc.deployment.cancelDeploymentJob.mutationOptions(),
    onSuccess: () => {
      toast.success("Deployment cancelled successfully");
      setCancelTarget(null);
      refetchQueue();
      refetchDeployments();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to cancel deployment");
    },
  });

  const handleUpdateConcurrency = (serverId: string) => {
    const val = concurrencyInputs[serverId];
    if (!val || val < 1) {
      toast.error("Concurrency must be at least 1");
      return;
    }
    const serverObj = servers.find((s) => s.id === serverId);
    updateConcurrencyMutation.mutate({
      organizationId,
      serverId,
      concurrency: val,
      hostname: serverObj?.hostname,
      ip: serverObj?.ip,
    });
  };

  const handleCancelJob = (
    serverId: string,
    jobId: string,
    deploymentId: string,
    label: string,
  ) => {
    setCancelTarget({ serverId, jobId, deploymentId, label });
  };

  const getQueueStateBadge = (state: string) => {
    switch (state) {
      case "active":
        return <DeploymentStatusBadge status="running" />;
      default:
        return (
          <DeploymentStatusBadge
            status={state === "active" ? "running" : state}
          />
        );
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="pb-px">
          <TabsList>
            <TabsTrigger value="history" className="gap-2">
              <Activity className="size-4" />
              History
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-2">
              <Clock className="size-4" />
              Queue ({queueJobs.length})
            </TabsTrigger>
            {!isCloud && (
              <TabsTrigger value="concurrency" className="gap-2">
                <Settings className="size-4" />
                Build Concurrency
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Tab 1: History */}
        <TabsContent value="history" className="space-y-4">
          <Card className="border-muted/40 shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Deployment History
              </CardTitle>
              <CardDescription>
                All deployments executed across the server infrastructure.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDeployments ? (
                <TableSkeleton columns={7} rows={5} />
              ) : deployments.length === 0 ? (
                <PageEmpty
                  icon={Activity}
                  title="No deployments found"
                  description="All deployments executed across the server infrastructure will appear here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Service</TableHead>
                        <TableHead>Environment</TableHead>
                        <TableHead>Server</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Triggered</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deployments.map((dep) => (
                        <TableRow key={dep.id} className="hover:bg-muted/10">
                          <TableCell className="font-semibold text-foreground">
                            {dep.resourceName}
                            <span className="block font-normal text-muted-foreground text-xs capitalize">
                              {dep.resourceType}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {dep.projectName} /{" "}
                              <span className="text-muted-foreground">
                                {dep.environmentName}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {dep.serverName}
                          </TableCell>
                          <TableCell className="max-w-45 truncate">
                            {dep.title}
                          </TableCell>
                          <TableCell>
                            <DeploymentStatusBadge status={dep.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {new Date(dep.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedDeployment(dep)}
                              className="h-8 gap-1.5"
                            >
                              <Terminal className="size-3.5" />
                              Logs
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Queue */}
        <TabsContent value="queue" className="space-y-4">
          <Card className="border-muted/40 shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Live Job Queue
              </CardTitle>
              <CardDescription>
                Currently active or waiting deployments in BullMQ.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingQueue ? (
                <TableSkeleton columns={7} rows={5} />
              ) : queueJobs.length === 0 ? (
                <PageEmpty
                  icon={Clock}
                  title="Queue is empty"
                  description="Currently active or waiting deployments in BullMQ will appear here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Job ID</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Server Queue</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Queue State</TableHead>
                        <TableHead>Queued At</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queueJobs.map((job) => (
                        <TableRow key={job.id} className="hover:bg-muted/10">
                          <TableCell className="font-mono text-xs">
                            {job.id}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {job.resourceName}
                            <span className="block font-normal text-muted-foreground text-xs capitalize">
                              {job.type}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {job.serverName}
                          </TableCell>
                          <TableCell className="max-w-45 truncate">
                            {job.label}
                          </TableCell>
                          <TableCell>{getQueueStateBadge(job.state)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {new Date(job.addedAt).toLocaleTimeString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                handleCancelJob(
                                  job.serverId,
                                  job.id,
                                  job.deploymentId,
                                  job.label,
                                )
                              }
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={cancelJobMutation.isPending}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Concurrency */}
        {!isCloud && (
          <TabsContent value="concurrency" className="space-y-4">
            <Alert variant="warning" className="w-full">
              <AlertTriangleIcon />
              <AlertTitle>
                Running multiple builds at once increases CPU, memory and disk
                usage on each server.
              </AlertTitle>
              <AlertDescription>
                Each concurrent build runs its own builder and image build, so
                set this based on the resources the machine can handle — too
                high a value can exhaust memory and make deployments fail.
              </AlertDescription>
            </Alert>
            <Card className="border-muted/40 shadow-sm">
              <CardHeader>
                <CardTitle className="font-semibold text-lg">
                  Build Concurrency Settings
                </CardTitle>
                <CardDescription>
                  Configure the maximum number of parallel docker builds allowed
                  on each Swarm node / server.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingServers ? (
                  <CardGridSkeleton
                    count={2}
                    className="grid gap-6 md:grid-cols-2"
                  />
                ) : servers.length === 0 ? (
                  <PageEmpty
                    icon={Server}
                    title="No active servers detected"
                    description="Configure server concurrency settings once a server is connected."
                  />
                ) : (
                  <div className="grid gap-6 md:grid-cols-2">
                    {servers.map((server) => (
                      <Card
                        key={server.id}
                        className="border bg-card/50 transition-all hover:bg-card"
                      >
                        <CardContent className="space-y-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-semibold text-base text-foreground">
                                {server.hostname}
                              </h3>
                              <p className="mt-0.5 font-mono text-muted-foreground text-xs">
                                {server.ip}
                              </p>
                              <span className="mt-2 inline-block rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                                ID: {server.id}
                              </span>
                            </div>
                            <Server className="size-5 text-muted-foreground/60" />
                          </div>

                          <FieldGroup className="pt-2">
                            <Field>
                              <FieldLabel htmlFor={`concurrency-${server.id}`}>
                                Max Parallel Builds
                              </FieldLabel>
                              <InputGroup>
                                <InputGroupInput
                                  id={`concurrency-${server.id}`}
                                  type="number"
                                  min="1"
                                  max="16"
                                  value={concurrencyInputs[server.id] ?? 1}
                                  onChange={(e) => {
                                    setDirtyConcurrency((current) => ({
                                      ...current,
                                      [server.id]: true,
                                    }));
                                    setConcurrencyInputs({
                                      ...concurrencyInputs,
                                      [server.id]:
                                        Number.parseInt(e.target.value, 10) ||
                                        1,
                                    });
                                  }}
                                  className="h-9 w-24"
                                />
                                <InputGroupAddon align="inline-end">
                                  <InputGroupButton
                                    variant="default"
                                    onClick={() =>
                                      handleUpdateConcurrency(server.id)
                                    }
                                    disabled={
                                      updateConcurrencyMutation.isPending
                                    }
                                    size="xs"
                                  >
                                    Save
                                  </InputGroupButton>
                                </InputGroupAddon>
                              </InputGroup>
                              <FieldDescription>
                                Additional deployment triggers for this server
                                will queue up and wait.
                              </FieldDescription>
                            </Field>
                          </FieldGroup>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <DeploymentLogDialog
        open={selectedDeployment !== null}
        onOpenChange={(open) => !open && setSelectedDeployment(null)}
        deployment={selectedDeployment}
        follow
      />

      <ConfirmActionDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel Deployment?"
        description={
          <>
            This will cancel <strong>{cancelTarget?.label}</strong> and remove
            it from the deployment queue. This action cannot be undone.
          </>
        }
        actionLabel="Cancel Deployment"
        pending={cancelJobMutation.isPending}
        onConfirm={() => {
          if (!cancelTarget) return;
          cancelJobMutation.mutate({
            deploymentId: cancelTarget.deploymentId,
            serverId: cancelTarget.serverId,
            jobId: cancelTarget.jobId,
          });
        }}
      />
    </div>
  );
}
