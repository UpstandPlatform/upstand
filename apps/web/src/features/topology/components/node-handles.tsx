import { Handle, Position } from "@xyflow/react";
import { memo } from "react";

const hiddenStyle = { visibility: "hidden" as const };

export const NodeHandles = memo(function NodeHandles() {
  return (
    <>
      <Handle
        id="t"
        type="target"
        position={Position.Top}
        style={hiddenStyle}
      />
      <Handle
        id="s"
        type="source"
        position={Position.Bottom}
        style={hiddenStyle}
      />
    </>
  );
});
