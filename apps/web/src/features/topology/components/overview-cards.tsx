import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  HardDrive,
  Network,
  Server,
  ServerIcon,
} from "@/components/huge-icons";
import type { DGNode } from "../types";

export interface OverviewCardsProps {
  nodes: DGNode[];
}

export function OverviewCards({ nodes }: OverviewCardsProps) {
  const containers = nodes.filter((n) => n.type === "container");
  const runningContainers = containers.filter((n) =>
    ["running", "healthy", "up"].includes((n.status ?? "").toLowerCase()),
  );
  const servers = nodes.filter(
    (n) => n.type === "server" || n.type === "swarm_node",
  );
  const networks = nodes.filter((n) => n.type === "network");
  const volumes = nodes.filter((n) => n.type === "volume");

  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="font-medium text-sm">Servers & Nodes</CardTitle>
          <ServerIcon className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{servers.length}</div>
          <p className="text-muted-foreground text-xs">
            Active servers & cluster nodes
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="font-medium text-sm">Containers</CardTitle>
          <Server className="h-4 w-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{containers.length}</div>
          <p className="font-medium text-emerald-500 text-xs">
            {runningContainers.length} running
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="font-medium text-sm">Docker Networks</CardTitle>
          <Network className="h-4 w-4 text-cyan-500" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{networks.length}</div>
          <p className="text-muted-foreground text-xs">
            Bridge & overlay networks
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="font-medium text-sm">Docker Volumes</CardTitle>
          <HardDrive className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{volumes.length}</div>
          <p className="text-muted-foreground text-xs">Persisted volumes</p>
        </CardContent>
      </Card>
    </div>
  );
}
