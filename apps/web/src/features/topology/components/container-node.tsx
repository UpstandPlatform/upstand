import { Badge } from "@upstand/ui/components/badge";
import { cn } from "@upstand/ui/lib/utils";
import { memo } from "react";
import type { ContainerNodeData } from "../types";
import { getStatusColor } from "../utils/colors";
import { InspectButton } from "./inspect-button";
import { NodeHandles } from "./node-handles";

export const ContainerNode = memo(function ContainerNode({
  data,
  selected,
}: {
  data: ContainerNodeData;
  selected?: boolean;
}) {
  const { dgNode, onInfoClick } = data;
  const statusInfo = getStatusColor(dgNode.status);
  const isRunning = ["running", "healthy", "up"].includes(
    (dgNode.status ?? "").toLowerCase(),
  );

  return (
    <div
      onClick={() => onInfoClick?.(dgNode.id)}
      className={cn(
        "relative flex h-[90px] w-56 cursor-pointer select-none flex-col justify-between overflow-hidden rounded-lg border border-border bg-card p-2.5 text-card-foreground shadow-xs transition-all hover:border-primary/50",
        selected && "border-primary shadow-md ring-2 ring-primary",
      )}
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: statusInfo.dot,
      }}
    >
      <NodeHandles />

      {/* Header Row */}
      <div className="flex items-center justify-between gap-1.5">
        <span
          className="truncate font-mono font-semibold text-foreground text-xs"
          title={dgNode.name}
        >
          {dgNode.name}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {onInfoClick && (
            <InspectButton
              label={`Inspect ${dgNode.name}`}
              onClick={() => onInfoClick(dgNode.id)}
            />
          )}
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{
              backgroundColor: statusInfo.dot,
              boxShadow: isRunning ? `0 0 6px ${statusInfo.dot}` : "none",
            }}
            title={dgNode.status ?? "unknown"}
          />
        </div>
      </div>

      {/* Image Tag */}
      {dgNode.image && (
        <div
          className="truncate font-mono text-[10px] text-muted-foreground"
          title={dgNode.image}
        >
          {dgNode.image}
        </div>
      )}

      {/* Exposed Ports */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {dgNode.ports && dgNode.ports.length > 0 ? (
          dgNode.ports.slice(0, 2).map((p, idx) => (
            <Badge
              key={idx}
              variant="secondary"
              className="h-4 border border-border/60 bg-muted/60 px-1 py-0 font-mono text-[9px] text-muted-foreground"
            >
              :{p.host}→{p.container}
            </Badge>
          ))
        ) : (
          <span className="font-mono text-[9px] text-muted-foreground/60">
            No ports bound
          </span>
        )}
        {dgNode.ports && dgNode.ports.length > 2 && (
          <span className="font-mono text-[9px] text-muted-foreground">
            +{dgNode.ports.length - 2}
          </span>
        )}
      </div>
    </div>
  );
});
