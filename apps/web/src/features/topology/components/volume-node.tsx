import { cn } from "@upstand/ui/lib/utils";
import { memo } from "react";
import { HardDrive } from "@/components/huge-icons";
import type { VolumeNodeData } from "../types";
import { VOLUME_COLOR } from "../utils/colors";
import { InspectButton } from "./inspect-button";
import { NodeHandles } from "./node-handles";

export const VolumeNode = memo(function VolumeNode({
  data,
  selected,
}: {
  data: VolumeNodeData;
  selected?: boolean;
}) {
  const { dgNode, onInfoClick } = data;

  return (
    <div
      onClick={() => onInfoClick?.(dgNode.id)}
      className={cn(
        "relative flex h-10 w-48 cursor-pointer select-none items-center gap-2 overflow-hidden rounded-lg border border-border border-l-3 bg-card px-2.5 py-1.5 text-card-foreground shadow-xs transition-all hover:border-primary/60",
        selected && "border-primary shadow-md ring-2 ring-primary",
      )}
      style={{ borderLeftColor: VOLUME_COLOR }}
    >
      <NodeHandles />

      <HardDrive className="size-4 shrink-0" style={{ color: VOLUME_COLOR }} />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-center justify-between gap-1">
          <span
            className="truncate font-mono font-semibold text-foreground text-xs"
            title={dgNode.name}
          >
            {dgNode.name}
          </span>
          {onInfoClick && (
            <InspectButton
              label={`Inspect ${dgNode.name}`}
              onClick={() => onInfoClick(dgNode.id)}
            />
          )}
        </div>
        {dgNode.driver && (
          <span className="truncate font-mono text-[9px] text-muted-foreground">
            {dgNode.driver}
          </span>
        )}
      </div>
    </div>
  );
});
