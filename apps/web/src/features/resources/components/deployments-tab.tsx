"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { cn } from "@upstand/ui/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  Clock,
  Eye,
  History,
  Layers,
  RefreshCw,
  Trash2,
} from "@/components/huge-icons";
import {
  DeploymentLogDialog,
  DeploymentStatusBadge,
} from "@/components/shared/deployment-presentation";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";
import type { ResourceDetailState } from "../hooks/use-resource-detail";
import { ConfigureRollbackDialog } from "./configure-rollback-dialog";

type DeploymentItem = {
  id: string;
  status: string;
  title: string;
  logs: string;
  createdAt: string;
  sourceRevision?: string | null;
};

type PendingAction =
  | { type: "clear-history"; label: string }
  | { type: "cancel-queued"; label: string; deploymentId: string }
  | { type: "kill-build"; label: string; deploymentId: string }
  | { type: "rollback"; label: string; deploymentId: string }
  | { type: "remove-deployment"; label: string; deploymentId: string };

interface DeploymentsTabProps {
  resource: NonNullable<ResourceDetailState["resource"]>;
  deployments: DeploymentItem[];
  refetchDeployments: ResourceDetailState["refetchDeployments"];
  deployResource: ResourceDetailState["deployResource"];
  isDeployingResource: boolean;
  onNavigateToCrons?: () => void;
}

export function DeploymentsTab({
  resource,
  deployments,
  refetchDeployments,
  deployResource,
  isDeployingResource,
  onNavigateToCrons,
}: DeploymentsTabProps) {
  const organizationState = useRequiredActiveOrganization();
  const [configureRollbackDialogOpen, setConfigureRollbackDialogOpen] =
    useState(false);
  const [deployList, setDeployList] = useState<DeploymentItem[]>([]);
  const [selectedDeployment, setSelectedDeployment] =
    useState<DeploymentItem | null>(null);
  const [viewDeploymentLogsOpen, setViewDeploymentLogsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const _runScheduleMutation = useMutation({
    ...trpc.schedule.runNow.mutationOptions(),
    onSuccess: () => toast.success("Schedule started"),
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    setDeployList(deployments);
  }, [deployments]);

  const isBuilding = deployList.some((d) => d.status === "running");
  const hasPendingDeployment = deployList.some((d) =>
    ["queued", "waiting", "retrying"].includes(d.status),
  );
  const isGitBackedApplication =
    resource.type === "application" &&
    ["github", "gitlab", "bitbucket", "gitea", "git"].includes(
      resource.provider,
    );
  const supportsHistoricalRollback =
    (resource.type === "compose" && resource.provider !== "raw") ||
    isGitBackedApplication;
  const canRollback =
    resource.type !== "compose" || resource.provider !== "raw";
  const queuedDeployment = deployList.find((deployment) =>
    ["queued", "waiting", "retrying"].includes(deployment.status),
  );
  const cancelDeploymentMutation = useMutation({
    ...trpc.deployment.cancelDeploymentJob.mutationOptions(),
    onSuccess: () => {
      void refetchDeployments();
      toast.success("Queued deployment cancelled");
      setPendingAction(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const killBuildMutation = useMutation({
    ...trpc.deployment.killBuild.mutationOptions(),
    onSuccess: () => {
      toast.success("Build cancellation requested");
      setPendingAction(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const removeDeploymentMutation = useMutation({
    ...trpc.deployment.removeDeployment.mutationOptions(),
    onSuccess: (_, variables) => {
      void variables;
      void refetchDeployments();
      toast.success("Deployment removed from history");
      setPendingAction(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const retryDeploymentMutation = useMutation({
    ...trpc.deployment.retryDeployment.mutationOptions(),
    onSuccess: () => {
      void refetchDeployments();
      toast.success("Deployment retry queued");
    },
    onError: (error) => toast.error(error.message),
  });
  const clearHistoryMutation = useMutation({
    ...trpc.deployment.clearHistory.mutationOptions(),
    onSuccess: () => {
      void refetchDeployments();
      toast.success("Completed deployment history cleared");
      setPendingAction(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const rollbackMutation = useMutation({
    ...trpc.resource.rollback.mutationOptions(),
    onSuccess: () => {
      void refetchDeployments();
      toast.success(
        supportsHistoricalRollback
          ? "Historical revision queued for redeployment"
          : "Swarm service rolled back",
      );
      setPendingAction(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const triggerDeployment = () => {
    toast.info("Building and deploying resource...");
    deployResource({ id: resource.id });
  };

  return (
    <>
      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-semibold text-lg">
            Deployment Triggers
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Manually build or setup external CI trigger pipelines.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 border-border/20 border-t pt-4">
          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 text-muted-foreground text-xs">
            External webhook tokens are managed in the General tab. Rotate a
            token there and copy its one-time URL; the stored token prefix (
            {resource.webhookTokenPrefix ?? "not configured"}) is not itself
            accepted for deployments.
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={triggerDeployment}
              disabled={isBuilding || isDeployingResource}
              className="gap-2 font-medium"
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  (isBuilding || isDeployingResource) && "animate-spin",
                )}
              />
              Deploy Now
            </Button>
            <Button
              onClick={() =>
                setPendingAction({
                  type: "clear-history",
                  label: "completed deployment history",
                })
              }
              variant="outline"
              className="gap-2 border-border/40"
            >
              <Trash2 className="size-4" /> Clear Deployments
            </Button>
            <Button
              onClick={() => setConfigureRollbackDialogOpen(true)}
              variant="outline"
              className="gap-2 border-border/40"
            >
              <Layers className="size-4" /> Configure Rollback
            </Button>
            <Button
              onClick={() => {
                if (!queuedDeployment) return;
                setPendingAction({
                  type: "cancel-queued",
                  label: queuedDeployment.title,
                  deploymentId: queuedDeployment.id,
                });
              }}
              variant="destructive"
              disabled={
                !hasPendingDeployment || cancelDeploymentMutation.isPending
              }
            >
              {cancelDeploymentMutation.isPending
                ? "Cancelling..."
                : "Cancel Queued Deployment"}
            </Button>
            <Button
              onClick={() => {
                const active = deployList.find(
                  (deployment) => deployment.status === "running",
                );
                if (active) {
                  setPendingAction({
                    type: "kill-build",
                    label: active.title,
                    deploymentId: active.id,
                  });
                }
              }}
              variant="destructive"
              disabled={!isBuilding || killBuildMutation.isPending}
            >
              {killBuildMutation.isPending
                ? "Stopping build..."
                : "Kill Active Build"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/40 bg-card/20">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="size-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">
                Scheduled Resource Jobs & Crons
              </p>
              <p className="text-muted-foreground text-xs">
                Manage recurring deployment schedules, container commands,
                backups, and HTTP crons centrally in the Cron Jobs tab.
              </p>
            </div>
          </div>
          {onNavigateToCrons && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateToCrons}
              className="shrink-0 gap-2 border-border/40 text-xs"
            >
              <Clock className="size-3.5" /> Go to Cron Jobs Tab
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-semibold text-lg">
            Deployment History (Max 10)
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Audit trail of recent project builds.
          </CardDescription>
        </CardHeader>
        <CardContent className="border-border/20 border-t pt-4">
          {deployList.length > 0 ? (
            <div className="overflow-hidden border border-border/20 bg-card/10">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-border/20 border-b bg-muted/10 text-muted-foreground text-xs uppercase">
                    <th className="p-3">Deployment ID</th>
                    <th className="p-3">Source revision</th>
                    <th className="p-3">Pipeline Status</th>
                    <th className="p-3">Trigger Time</th>
                    <th className="p-3 text-center">Action</th>
                    <th className="p-3 text-center">Logs</th>
                  </tr>
                </thead>
                <tbody>
                  {deployList.map((dep) => (
                    <tr
                      key={dep.id}
                      className="border-border/10 border-b hover:bg-muted/5"
                    >
                      <td className="p-3 font-mono font-semibold text-foreground text-xs">
                        {dep.id}
                      </td>
                      <td className="p-3 font-mono text-muted-foreground text-xs">
                        {dep.sourceRevision?.slice(0, 12) || "—"}
                      </td>
                      <td className="p-3">
                        <DeploymentStatusBadge status={dep.status} />
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {new Date(dep.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3 text-center">
                        {dep.status === "success" && canRollback ? (
                          <Button
                            onClick={() =>
                              setPendingAction({
                                type: "rollback",
                                label: dep.id,
                                deploymentId: dep.id,
                              })
                            }
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            disabled={rollbackMutation.isPending}
                          >
                            <History className="size-3.5" />
                            {supportsHistoricalRollback
                              ? "Redeploy revision"
                              : "Rollback"}
                          </Button>
                        ) : ["failed", "stale", "cancelled"].includes(
                            dep.status,
                          ) ? (
                          <div className="flex justify-center gap-1">
                            <Button
                              onClick={() =>
                                retryDeploymentMutation.mutate({
                                  deploymentId: dep.id,
                                })
                              }
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              disabled={retryDeploymentMutation.isPending}
                            >
                              <RefreshCw className="size-3.5" /> Retry
                            </Button>
                            <Button
                              onClick={() =>
                                setPendingAction({
                                  type: "remove-deployment",
                                  label: dep.id,
                                  deploymentId: dep.id,
                                })
                              }
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-destructive text-xs"
                              disabled={removeDeploymentMutation.isPending}
                            >
                              <Trash2 className="size-3.5" /> Remove
                            </Button>
                          </div>
                        ) : dep.status === "success" ? (
                          <Button
                            onClick={() =>
                              setPendingAction({
                                type: "remove-deployment",
                                label: dep.id,
                                deploymentId: dep.id,
                              })
                            }
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-destructive text-xs"
                            disabled={removeDeploymentMutation.isPending}
                          >
                            <Trash2 className="size-3.5" /> Remove
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          onClick={() => {
                            setSelectedDeployment(dep);
                            setViewDeploymentLogsOpen(true);
                          }}
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 font-medium text-xs hover:bg-accent"
                        >
                          <Eye className="size-3.5" /> Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No deployment history found.
            </div>
          )}
        </CardContent>
      </Card>

      <DeploymentLogDialog
        open={viewDeploymentLogsOpen}
        onOpenChange={setViewDeploymentLogsOpen}
        deployment={selectedDeployment}
      />

      <ConfirmActionDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={
          pendingAction?.type === "clear-history"
            ? "Clear deployment history?"
            : pendingAction?.type === "cancel-queued"
              ? "Cancel queued deployment?"
              : pendingAction?.type === "kill-build"
                ? "Stop active build?"
                : pendingAction?.type === "rollback"
                  ? supportsHistoricalRollback
                    ? "Redeploy historical revision?"
                    : "Roll back service?"
                  : "Remove deployment from history?"
        }
        description={
          <>
            This action affects <strong>{pendingAction?.label}</strong>. Please
            confirm that you want to continue.
          </>
        }
        actionLabel={
          pendingAction?.type === "clear-history"
            ? "Clear history"
            : pendingAction?.type === "cancel-queued"
              ? "Cancel deployment"
              : pendingAction?.type === "kill-build"
                ? "Stop build"
                : pendingAction?.type === "rollback"
                  ? supportsHistoricalRollback
                    ? "Redeploy revision"
                    : "Roll back service"
                  : "Remove deployment"
        }
        pending={
          clearHistoryMutation.isPending ||
          cancelDeploymentMutation.isPending ||
          killBuildMutation.isPending ||
          rollbackMutation.isPending ||
          removeDeploymentMutation.isPending
        }
        onConfirm={() => {
          if (!pendingAction) return;
          switch (pendingAction.type) {
            case "clear-history":
              clearHistoryMutation.mutate({ resourceId: resource.id });
              break;
            case "cancel-queued":
              cancelDeploymentMutation.mutate({
                deploymentId: pendingAction.deploymentId,
              });
              break;
            case "kill-build":
              killBuildMutation.mutate({
                deploymentId: pendingAction.deploymentId,
              });
              break;
            case "rollback":
              rollbackMutation.mutate({
                id: resource.id,
                deploymentId: pendingAction.deploymentId,
              });
              break;
            case "remove-deployment":
              removeDeploymentMutation.mutate({
                deploymentId: pendingAction.deploymentId,
              });
              break;
          }
        }}
      />

      <ConfigureRollbackDialog
        open={configureRollbackDialogOpen}
        onOpenChange={setConfigureRollbackDialogOpen}
        resource={resource}
        organizationId={organizationState.organizationId as string}
        onSuccess={() => void refetchDeployments()}
      />
    </>
  );
}
