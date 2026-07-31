"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Refresh01Icon,
  SecurityIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { EdgeStatus, ProxyScanResult } from "@upstand/domain";

interface ProxyTakeoverResult {
  ok: boolean;
  registeredSites: string[];
  journalId: string;
  warnings: string[];
  error?: string;
}

import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

export function ProxyDetectionPanel({ serverId }: { serverId?: string }) {
  const organizationState = useRequiredActiveOrganization();
  const organizationId =
    organizationState.status === "ready"
      ? organizationState.organizationId
      : "";

  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const edgeStatusQuery = useQuery({
    ...trpc.proxy.detect.queryOptions({
      organizationId,
      serverId,
    }),
    enabled: Boolean(organizationId),
  });

  const scanResultQuery = useQuery({
    ...trpc.proxy.scanImportable.queryOptions({
      organizationId,
      serverId,
    }),
    enabled: Boolean(organizationId && importDialogOpen),
  });

  const takeover = useMutation({
    ...trpc.proxy.takeover.mutationOptions(),
    onSuccess: (data) => {
      const result = data as ProxyTakeoverResult;
      if (result.ok) {
        toast.success(
          `Proxy takeover completed! Registered ${result.registeredSites.length} site(s).`,
        );
        void edgeStatusQuery.refetch();
        setImportDialogOpen(false);
      } else {
        toast.error(result.error || "Takeover failed");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  if (edgeStatusQuery.isPending)
    return <Skeleton className="h-40 rounded-2xl" />;

  const status = edgeStatusQuery.data as EdgeStatus | undefined;
  const scanResult = scanResultQuery.data as ProxyScanResult | undefined;

  const classification = status?.classification ?? "free";
  const occupants = status?.occupants ?? [];

  return (
    <Card className="rounded-2xl border-border/70 bg-card/70">
      <CardHeader className="flex-row items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HugeiconsIcon icon={SecurityIcon} className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">
              Web Server &amp; Edge Proxy
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Detects running proxies (Caddy, Traefik, Nginx, Apache), imports
              site configs, and manages takeover.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              classification === "ours" || classification === "free"
                ? "secondary"
                : "outline"
            }
          >
            {classification === "ours"
              ? "Managed by Upstand"
              : classification === "free"
                ? "Ports 80/443 Available"
                : classification === "known"
                  ? "Foreign Proxy Detected"
                  : "Occupied"}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void edgeStatusQuery.refetch()}
          >
            <HugeiconsIcon icon={Refresh01Icon} className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {occupants.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No active web server proxies detected on ports 80/443. Managed Caddy
            is ready to handle custom domain SSL certificates.
          </p>
        ) : (
          <div className="grid gap-3">
            {occupants.map((occ, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl border bg-muted/30 p-3 text-xs"
              >
                <div>
                  <p className="font-semibold text-sm">
                    {occ.proxy
                      ? occ.proxy.toUpperCase()
                      : occ.command || "Process"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Port :{occ.port}{" "}
                    {occ.containerName ? `· Docker: ${occ.containerName}` : ""}{" "}
                    {occ.systemdUnit ? `· Service: ${occ.systemdUnit}` : ""}
                  </p>
                </div>
                {occ.managedByUpstand ? (
                  <Badge variant="secondary" className="gap-1">
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="size-3"
                    />{" "}
                    Managed
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImportDialogOpen(true)}
                  >
                    Import &amp; Take Over{" "}
                    <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="max-w-xl rounded-2xl">
            <DialogHeader>
              <DialogTitle>Import &amp; Take Over Edge Proxy</DialogTitle>
              <DialogDescription>
                Scan parsed server routes (Caddy, Traefik, Nginx, Apache),
                import SSL certificate paths, and transition ports 80/443
                zero-downtime.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-3">
              {scanResultQuery.isPending ? (
                <div className="flex items-center justify-center p-8">
                  <Spinner className="size-6" />
                </div>
              ) : (
                <>
                  <div>
                    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                      Detected Sites ({scanResult?.sites.length ?? 0})
                    </h4>
                    {scanResult?.sites.length === 0 ? (
                      <p className="mt-2 text-muted-foreground text-xs">
                        No custom site configurations parsed from server config
                        files.
                      </p>
                    ) : (
                      <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto pr-1">
                        {scanResult?.sites.map((site, index) => (
                          <div
                            key={index}
                            className="rounded-lg border bg-muted/20 p-2.5 text-xs"
                          >
                            <span className="font-medium">
                              {site.serverNames.join(", ")}
                            </span>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Target:{" "}
                              {site.target.kind === "proxy"
                                ? site.target.url
                                : site.target.root}{" "}
                              · {site.ssl ? "HTTPS (TLS)" : "HTTP"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {scanResult?.warnings.length ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-600 text-xs dark:text-amber-400">
                      <p className="mb-1 font-semibold">Import Warnings:</p>
                      <ul className="list-disc space-y-1 pl-4">
                        {scanResult.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setImportDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={takeover.isPending}
                      onClick={() =>
                        takeover.mutate({
                          organizationId,
                          serverId: serverId ?? "",
                        })
                      }
                    >
                      {takeover.isPending ? (
                        <Spinner />
                      ) : (
                        "Start Zero-Downtime Takeover"
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
