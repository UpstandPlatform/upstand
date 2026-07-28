"use client";

import { TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ShowDockerLogs } from "@/components/shared/docker-logs";
import { TerminalEmulator } from "@/components/shared/terminal-emulator";
import { getServerApiUrl } from "@/lib/server-url";
import { cleanDockerLogs } from "@/utils/clean-logs";
import { trpc } from "@/utils/trpc";
import type { ResourceDetailState } from "../hooks/use-resource-detail";

interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  ports: string;
  node: string;
}

interface ConsoleTabProps {
  resource: {
    id: string;
    name: string;
    appName?: string | null;
    serverId?: string | null;
  };
  organizationId: string;
  containers: ContainerInfo[];
  sshKeys?: ResourceDetailState["sshKeys"];
}

export function ConsoleTab({
  resource,
  organizationId,
  containers,
}: ConsoleTabProps) {
  const [logsLimit] = useState(300);
  const logsQuery = useQuery({
    ...trpc.resource.getLogs.queryOptions({
      id: resource.id,
      containerId: undefined, // Queries all containers multiplexed
      tail: logsLimit,
    }),
    refetchInterval: 4000,
  });

  const realLogs = useMemo(() => {
    if (!logsQuery.data) return [];
    return cleanDockerLogs(logsQuery.data).trim().split("\n");
  }, [logsQuery.data]);

  const [selectedContainerId, setSelectedContainerId] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const terminalCardRef = useRef<HTMLDivElement>(null);

  // Estimate terminal cols/rows from the container pixel size
  function getTerminalDimensions(): { cols: number; rows: number } {
    const el = terminalCardRef.current;
    if (!el) return { cols: 120, rows: 30 };
    const charW = 8.4; // approximate monospace char width at 13px
    const charH = 17; // approximate line height at 13px * 1.2
    const cols = Math.max(Math.floor(el.clientWidth / charW), 10);
    const rows = Math.max(Math.floor(el.clientHeight / charH), 5);
    return { cols, rows };
  }

  // Pre-select first container when list updates
  useEffect(() => {
    if (containers.length > 0 && !selectedContainerId) {
      setSelectedContainerId(containers[0].id);
    }
  }, [containers, selectedContainerId]);

  const disconnect = () => {
    setToken(null);
  };

  const connect = async () => {
    if (!selectedContainerId) {
      toast.error("Please select a container to connect");
      return;
    }
    setConnecting(true);
    try {
      const dims = getTerminalDimensions();
      const response = await fetch(
        getServerApiUrl("/api/docker/terminal/session"),
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId,
            resourceId: resource.id,
            serverId: resource.serverId || "local",
            containerId: selectedContainerId,
            cols: dims.cols,
            rows: dims.rows,
          }),
        },
      );
      const data = (await response.json()) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !data.token) {
        throw new Error(data.error || "Unable to open Docker terminal");
      }
      setToken(data.token);
      toast.success("Terminal session established");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Docker terminal failed",
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="grid min-h-[600px] grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
      {/* Multiplexed Logs Card */}
      <Card className="flex min-w-37.5 flex-col border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-semibold text-lg">
            <HugeiconsIcon
              icon={TerminalIcon}
              className="size-5 text-primary"
            />
            Multiplexed Logs
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Live stdout/stderr stream from all containers in the stack.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col border-border/10 border-t pt-4">
          <ShowDockerLogs containerId="all" logs={realLogs} />
        </CardContent>
      </Card>

      {/* Terminal Card */}
      <Card className="flex min-w-37.5 flex-col border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-semibold text-lg">
            <HugeiconsIcon
              icon={TerminalIcon}
              className="size-5 text-emerald-400"
            />
            Interactive Shell
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Open a terminal session inside an active container.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 border-border/10 border-t">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/30 bg-muted/20 p-3">
            <div className="flex min-w-37.5 flex-1 flex-col gap-1.5">
              <Label
                htmlFor="terminal-container-select"
                className="text-muted-foreground text-xs"
              >
                Container
              </Label>
              <Select
                items={containers.map((con) => ({
                  value: con.id,
                  label: `${con.name} (${con.id.substring(0, 7)})`,
                }))}
                value={selectedContainerId}
                onValueChange={(val) => setSelectedContainerId(val ?? "")}
                disabled={token !== null || connecting}
              >
                <SelectTrigger
                  id="terminal-container-select"
                  className="h-9 w-full border border-border/40 bg-background text-xs"
                >
                  <SelectValue placeholder="Select Container" />
                </SelectTrigger>
                <SelectContent>
                  {containers.map((con) => (
                    <SelectItem key={con.id} value={con.id} className="text-xs">
                      {con.name} ({con.id.substring(0, 7)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              {token === null ? (
                <Button
                  size="sm"
                  onClick={() => void connect()}
                  disabled={connecting || containers.length === 0}
                  className="h-9 px-4 font-semibold"
                >
                  {connecting ? (
                    <>
                      <Spinner className="mr-2 size-3.5" />
                      Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={disconnect}
                  className="h-9 px-4 font-semibold"
                >
                  Disconnect
                </Button>
              )}
            </div>
          </div>

          {/* Terminal viewport */}
          <div
            ref={terminalCardRef}
            className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#080c0a] shadow-inner"
          >
            <div className="flex h-9 shrink-0 items-center gap-2 border-white/10 border-b bg-[#0d1210] px-3 text-xs">
              <HugeiconsIcon
                icon={TerminalIcon}
                className="size-4 text-emerald-400"
              />
              <span className="truncate font-mono text-slate-400">
                {selectedContainerId
                  ? containers.find((c) => c.id === selectedContainerId)
                      ?.name || "sh"
                  : "shell"}
              </span>
              <span className="ml-auto font-mono text-slate-500">
                {token !== null
                  ? "live"
                  : connecting
                    ? "connecting…"
                    : "offline"}
              </span>
            </div>
            <div className="relative min-h-[380px] flex-1 overflow-hidden">
              {token !== null ? (
                <div className="absolute inset-0">
                  <TerminalEmulator
                    token={token}
                    onReady={() => {}}
                    onClose={disconnect}
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 font-mono text-emerald-400 text-lg">
                    $_
                  </div>
                  <div className="flex max-w-sm flex-col gap-1">
                    <p className="font-medium text-slate-300 text-sm">
                      Terminal is offline
                    </p>
                    <p className="text-slate-500 text-xs leading-normal">
                      {containers.length === 0
                        ? "No running containers found in this stack."
                        : "Choose a container above and click Connect to start an interactive terminal session."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
