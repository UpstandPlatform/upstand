import { cn } from "@upstand/ui/lib/utils";
import { memo } from "react";
import type { NetworkGroupData } from "../types";
import { networkColor } from "../utils/colors";
import { InspectButton } from "./inspect-button";
import { NodeHandles } from "./node-handles";

export const NetworkGroup = memo(function NetworkGroup({
  data,
  selected,
}: {
  data: NetworkGroupData;
  selected?: boolean;
}) {
  const { dgNode, onInfoClick } = data;
  const color = networkColor(dgNode.name);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onInfoClick?.(dgNode.id);
      }}
      className={cn(
        "relative box-border h-full w-full select-none rounded-xl border border-dashed bg-muted/10 transition-all",
        selected && "border-primary ring-2 ring-primary",
      )}
      style={{
        borderColor: selected ? color : `${color}60`,
        backgroundColor: `${color}0D`,
      }}
    >
      <NodeHandles />

      {/* Hanging Legend Tab */}
      <div
        className="absolute -top-px left-3 z-10 inline-flex max-w-[calc(100%-24px)] cursor-pointer items-center gap-1.5 rounded-b-md border bg-background px-2 py-0.5 font-mono font-semibold text-[10px] text-foreground uppercase tracking-wider shadow-2xs"
        style={{ borderColor: `${color}60` }}
        onClick={(e) => {
          e.stopPropagation();
          onInfoClick?.(dgNode.id);
        }}
      >
        {onInfoClick && (
          <InspectButton
            label={`Inspect ${dgNode.name}`}
            onClick={() => onInfoClick(dgNode.id)}
          />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{dgNode.name}</span>
        {dgNode.driver && (
          <span className="font-normal text-[9px] text-muted-foreground/80 lowercase">
            ({dgNode.driver})
          </span>
        )}
      </div>
    </div>
  );
});
