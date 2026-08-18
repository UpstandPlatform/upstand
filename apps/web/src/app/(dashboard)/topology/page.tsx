"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@upstand/ui/components/tabs";
import { useState } from "react";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import {
  Activity,
  Layers,
  Network,
  RefreshCw,
  Server,
} from "@/components/huge-icons";
import { FlowCanvas } from "@/features/topology/components/flow-canvas";
import { useTopology } from "@/features/topology/hooks/use-topology";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { useSystemConfig } from "@/hooks/use-system-config";
import { trpc } from "@/utils/trpc";

export default function InfrastructureTopologyPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const { isCloud, isInstanceOwner } = useSystemConfig();

  const [selectedServerId, setSelectedServerId] = useState<string>("all");
  const [isLive, setIsLive] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"graph" | "table" | "overview">(
    "graph",
  );

  // Query server list for server filter dropdown
  const serversQuery = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const servers = serversQuery.data ?? [];

  // Query topology graph
  const { nodes, edges, isLoading, isRefetching, refetch } = useTopology({
    organizationId,
    serverId: selectedServerId,
    isLive,
  });

  return (
    <DashboardPage className="flex flex-col gap-6">
      <DashboardPageHeader
        title="Infrastructure Topology"
        icon={<Network className="size-6 text-primary" />}
        description="Interactive real-time flowchart diagram of your servers, swarm nodes, containers, networks, volumes, and their relationships."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedServerId}
              onValueChange={(val) => val && setSelectedServerId(val)}
            >
              <SelectTrigger className="h-9 w-52 text-xs">
                <Server className="mr-1 size-3.5 text-muted-foreground" />
                <SelectValue placeholder="All Infrastructure" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Infrastructure</SelectItem>
                {(!isCloud || isInstanceOwner) && (
                  <SelectItem value="local">
                    Local Server (127.0.0.1)
                  </SelectItem>
                )}
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.ipAddress ?? "Remote"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={isLive ? "outline" : "secondary"}
              size="sm"
              onClick={() => setIsLive((prev) => !prev)}
              className="h-9 border-border font-medium text-xs"
            >
              <Activity
                className={`mr-1.5 size-3.5 ${
                  isLive
                    ? "animate-pulse text-emerald-500"
                    : "text-muted-foreground"
                }`}
              />
              {isLive ? "Live Sync ON" : "Paused"}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="h-9 w-9 border-border"
              title="Refresh topology snapshot"
            >
              <RefreshCw
                className={`size-4 ${isRefetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        }
      />

      {/* Tabs & Metrics Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-border/40 border-b pb-4">
        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(v as "graph" | "table" | "overview")
          }
          className="w-auto"
        >
          <TabsList className="h-9 bg-muted/60 p-1">
            <TabsTrigger value="graph" className="gap-1.5 font-medium text-xs">
              <Network className="size-3.5" /> Graph View
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-1.5 font-medium text-xs">
              <Layers className="size-3.5" /> Table View
            </TabsTrigger>
            <TabsTrigger
              value="overview"
              className="gap-1.5 font-medium text-xs"
            >
              <Activity className="size-3.5" /> Summary
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-border bg-muted/40 px-2.5 py-1 text-xs"
          >
            {nodes.length} Elements
          </Badge>
          <Badge
            variant="outline"
            className="border-border bg-muted/40 px-2.5 py-1 text-xs"
          >
            {edges.length} Wires
          </Badge>
        </div>
      </div>

      {/* Flow Canvas & Subviews Container */}
      <div className="relative h-[calc(100vh-18rem)] min-h-[500px] w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <FlowCanvas
          dgNodes={nodes}
          dgEdges={edges}
          isLoading={isLoading}
          activeView={activeTab}
        />
      </div>
    </DashboardPage>
  );
}
