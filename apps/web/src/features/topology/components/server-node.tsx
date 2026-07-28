import { Badge } from "@upstand/ui/components/badge";
import { cn } from "@upstand/ui/lib/utils";
import { memo } from "react";
import { ServerIcon } from "@/components/huge-icons";
import type { ServerNodeData } from "../types";
import { getStatusColor } from "../utils/colors";
import { InspectButton } from "./inspect-button";
import { NodeHandles } from "./node-handles";

export const ServerNode = memo(function ServerNode({
  data,
  selected,
}: {
  data: ServerNodeData;
  selected?: boolean;
}) {
  const { dgNode, onInfoClick } = data;
  const statusInfo = getStatusColor(dgNode.status);

  return (
    <div
      onClick={() => onInfoClick?.(dgNode.id)}
      className={cn(
        "relative flex h-[85px] w-60 cursor-pointer select-none flex-col justify-between overflow-hidden rounded-lg border border-border border-l-3 border-l-primary bg-card p-3 text-card-foreground shadow-xs transition-all hover:border-primary/60",
        selected && "border-primary shadow-md ring-2 ring-primary",
      )}
    >
      <NodeHandles />

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ServerIcon className="size-4 shrink-0 text-primary" />
          <span className="truncate font-semibold text-foreground text-xs">
            {dgNode.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onInfoClick && (
            <InspectButton
              label={`Inspect ${dgNode.name}`}
              onClick={() => onInfoClick(dgNode.id)}
            />
          )}
          <Badge
            variant="outline"
            className="h-4 border-border bg-muted/40 px-1.5 py-0 font-semibold text-[10px] uppercase"
            style={{ color: statusInfo.text }}
          >
            {dgNode.type === "swarm_node"
              ? (dgNode.role ?? "swarm")
              : (dgNode.status ?? "online")}
          </Badge>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>IP: {dgNode.ipAddress ?? "127.0.0.1"}</span>
        <span className="rounded-xs border border-border bg-muted px-1.5 py-0.5 text-[10px]">
          {dgNode.type === "swarm_node" ? "Swarm Node" : "Server Host"}
        </span>
      </div>
    </div>
  );
});
