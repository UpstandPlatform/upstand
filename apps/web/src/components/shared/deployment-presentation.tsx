"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Copy, Terminal } from "@/components/huge-icons";
import { copyText } from "@/lib/browser";

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
        : status === "queued" || status === "waiting" || status === "retrying"
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
  follow = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deployment: DeploymentLog | null;
  follow?: boolean;
}) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logText = deployment?.logs;

  // biome-ignore lint/correctness/useExhaustiveDependencies: live log content intentionally retriggers follow mode.
  useEffect(() => {
    if (open && follow) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [follow, logText, open]);

  const logs = logText || "No logs available.";
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void copyText(logs)
                  .then(() => toast.success("Logs copied to clipboard"))
                  .catch(() => toast.error("Failed to copy logs"));
              }}
              className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Copy className="size-3.5" />
              Copy Logs
            </Button>
          </div>
        </DialogHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-muted/20 bg-[#0c0d12] p-4 font-mono text-xs text-zinc-300 leading-relaxed shadow-inner">
          <pre className="whitespace-pre-wrap">{logs}</pre>
          <div ref={logsEndRef} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
