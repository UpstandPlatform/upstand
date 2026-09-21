"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@upstand/ui/components/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Spinner } from "@upstand/ui/components/spinner";
import { cn } from "@upstand/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  Copy,
  Info,
  ServerIcon,
  TerminalIcon,
} from "@/components/huge-icons";
import { getSetupFailureDetails } from "./remote-server-setup.helper";

type SetupStatus = "idle" | "setting_up" | "ready" | "failed";

type SetupServer = {
  name?: string | null;
  ipAddress?: string | null;
  port?: number | null;
  username?: string | null;
};

function CopyDetailsButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!navigator.clipboard) {
      toast.error("Clipboard access is not available in this window");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Setup details copied");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy setup details");
    }
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={copy}>
      <Copy data-icon="inline-start" />
      {copied ? "Copied" : "Copy details"}
    </Button>
  );
}

export function RemoteServerSetupDialog({
  open,
  onOpenChange,
  server,
  status,
  setupStage,
  setupLogs,
  setupError,
  mutationError,
  isPending,
  isSuccess,
  onClose,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: SetupServer | undefined;
  status: SetupStatus | undefined;
  setupStage?: string | null;
  setupLogs?: string | null;
  setupError?: string | null;
  mutationError?: string | null;
  isPending: boolean;
  isSuccess: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const isRunning = status === "setting_up" || isPending;
  const isReady = status === "ready" || isSuccess;
  const isFailed = status === "failed" || Boolean(mutationError);
  const errorMessage =
    setupError || mutationError || "Server setup encountered an issue";
  const failure = getSetupFailureDetails(errorMessage);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const statusLabel = isReady
    ? "Provisioned"
    : isFailed
      ? "Failed"
      : isRunning
        ? "In progress"
        : "Ready to start";

  const statusClass = isReady
    ? "border-success/30 bg-success/10 text-success"
    : isFailed
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-primary/30 bg-primary/10 text-primary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(760px,calc(100dvh-2rem))] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        showCloseButton={true}
      >
        <DialogHeader className="shrink-0 border-border/70 border-b bg-muted/20 px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
                isFailed
                  ? "bg-destructive/10 text-destructive"
                  : isReady
                    ? "bg-success/10 text-success"
                    : "bg-primary/10 text-primary",
              )}
            >
              {isFailed ? (
                <AlertTriangleIcon className="size-5" />
              ) : isReady ? (
                <CheckCircleIcon className="size-5" />
              ) : (
                <ServerIcon className="size-5" />
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base">
                {isReady
                  ? "Server ready"
                  : isFailed
                    ? "Setup needs attention"
                    : `Setting up ${server?.name ?? "server"}`}
              </DialogTitle>
              <DialogDescription className="max-w-xl text-pretty">
                {isFailed
                  ? "Upstand paused before this server could accept workloads. Resolve the host issue, then retry setup."
                  : "Upstand verifies Docker, prepares the server's Swarm network, and starts routing and monitoring."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background p-4">
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">
                {server?.name ?? "Remote server"}
              </p>
              <p className="break-all font-mono text-muted-foreground text-xs">
                {server?.ipAddress}:{server?.port} ({server?.username})
              </p>
            </div>
            <span
              className={cn(
                "inline-flex h-6 items-center rounded-full border px-2.5 font-medium text-xs",
                statusClass,
              )}
            >
              {isRunning && <Spinner className="mr-1.5 size-3" />}
              {statusLabel}
            </span>
          </div>

          {isRunning && setupStage && (
            <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
              <Spinner className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-medium text-sm">Working on this server</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {setupStage}
                </p>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="space-y-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 space-y-1">
                  <h3 className="font-semibold text-sm">{failure.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {failure.description}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="mb-2 flex items-center gap-1.5 font-medium text-xs">
                  <Info className="size-3.5 text-primary" />
                  Next steps
                </p>
                <ol className="space-y-2 text-muted-foreground text-xs leading-relaxed">
                  {failure.steps.map((step, index) => (
                    <li key={step} className="flex items-start gap-2">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-foreground text-xs">
                        {index + 1}
                      </span>
                      <span className="min-w-0">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {(setupLogs || setupError || mutationError) && (
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <div className="rounded-xl border border-border/70 bg-muted/15">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-sm">
                    <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span>Technical details</span>
                    <span className="font-normal text-muted-foreground text-xs">
                      {detailsOpen ? "Expanded" : "Collapsed"}
                    </span>
                  </span>
                  <ChevronDownIcon
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      detailsOpen && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-border/70 border-t px-4 pt-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-muted-foreground text-xs">
                      Remote command output
                    </p>
                    <CopyDetailsButton
                      value={[setupError, mutationError, setupLogs]
                        .filter(Boolean)
                        .join("\n\n")}
                    />
                  </div>
                  <div className="mt-2 max-h-56 overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 leading-relaxed [overflow-wrap:anywhere] dark:bg-black/90">
                    <pre className="whitespace-pre-wrap break-words font-inherit">
                      {[setupError, mutationError, setupLogs]
                        .filter(Boolean)
                        .join("\n\n")}
                    </pre>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {isReady && (
            <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/5 px-4 py-3 text-sm">
              <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
              <p className="text-muted-foreground">
                Docker, the Swarm network, routing, and monitoring are ready on
                this server.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-border/70 border-t bg-muted/10 px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {isRunning ? "Run in background" : "Close"}
          </Button>
          {isFailed && (
            <Button type="button" onClick={onRetry} disabled={isPending}>
              Retry setup
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
