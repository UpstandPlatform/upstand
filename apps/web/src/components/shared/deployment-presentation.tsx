"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { AlertTriangleIcon, Terminal } from "@/components/huge-icons";
import { ShowDockerLogs } from "@/components/shared/docker-logs";
import { trpc } from "@/utils/trpc";

export type DeploymentStatus =
  | "success"
  | "running"
  | "queued"
  | "retrying"
  | "stale"
  | "waiting"
  | "failed"
  | "cancelled"
  | (string & {});

const STATUS_LABELS: Record<string, string> = {
  success: "Success",
  running: "Running",
  queued: "Queued",
  retrying: "Retrying",
  stale: "Stale",
  waiting: "Waiting",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function DeploymentStatusBadge({
  status,
}: {
  status: DeploymentStatus;
}) {
  const tone =
    status === "success"
      ? "success"
      : status === "running"
        ? "info"
        : status === "queued" || status === "retrying" || status === "waiting"
          ? "warning"
          : status === "failed" || status === "cancelled" || status === "stale"
            ? "destructive"
            : "outline";

  return <StatusBadge label={STATUS_LABELS[status] ?? status} tone={tone} />;
}

export type DeploymentLog = {
  id?: string | null;
  title?: string | null;
  resourceName?: string | null;
  createdAt?: string | Date | null;
  logs?: string | null;
};

export function DeploymentLogDialog({
  open,
  onOpenChange,
  deployment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deployment: DeploymentLog | null;
  follow?: boolean;
}) {
  const deploymentId = deployment?.id ?? "";

  const logQuery = useQuery({
    ...trpc.deployment.getLogs.queryOptions({ id: deploymentId }),
    enabled: open && Boolean(deploymentId),
    refetchInterval: (query) => {
      const status = (query.state.data?.status ?? "") as string;
      return status === "running" ||
        status === "queued" ||
        status === "waiting" ||
        status === "retrying"
        ? 1500
        : false;
    },
  });

  const logText = logQuery.data?.logs || deployment?.logs || "";
  const createdAt = deployment?.createdAt
    ? new Date(deployment.createdAt).toLocaleString()
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88svh,900px)] w-[calc(100vw-1rem)] max-w-[min(96vw,64rem)] flex-col border-muted/40 p-4 sm:min-w-[min(42rem,calc(100vw-2rem))] sm:p-6">
        <DialogHeader className="border-b pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Terminal className="size-5 text-primary" />
                Deployment Logs
                {deployment?.resourceName ? `: ${deployment.resourceName}` : ""}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {deployment?.id ? (
                  <>
                    ID:{" "}
                    <span className="font-mono text-xs">{deployment.id}</span>
                  </>
                ) : null}
                {deployment?.title ? ` · ${deployment.title}` : null}
                {createdAt ? ` · ${createdAt}` : null}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
          <ShowDockerLogs
            containerId={deploymentId || "deployment"}
            logs={logText}
            isFetching={logQuery.isFetching}
            emptyMessage="No deployment logs recorded yet."
            className="h-full"
            maxHeightClass="h-[min(55svh,480px)]"
          />
        </div>

        {(logText.includes("Deployment failed") ||
          logText.includes("Error:")) && (
          <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-foreground text-xs">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-0.5">
              <span className="font-semibold text-destructive">
                Troubleshooting Action Needed:
              </span>
              <p className="text-[11px] text-muted-foreground">
                {logText.includes("SSH key") || logText.includes("password")
                  ? "Server authentication credentials error. Go to Remote Servers and ensure your server credentials (SSH key or password) are properly configured."
                  : logText.includes("Repository") || logText.includes("Git")
                    ? "Git repository connection issue. Verify your repository URL, branch, or connected Git Provider in General settings."
                    : logText.includes("not ready")
                      ? "Target server is not ready. Complete server setup/provisioning under Remote Servers."
                      : "Review the log messages above to identify missing configuration, syntax errors, or server connectivity issues."}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
