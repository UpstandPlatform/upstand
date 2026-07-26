"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { TopologyMap } from "@/features/topology/topology-map";

export default function TopologyPage() {
  return (
    <ReactFlowProvider>
      <TopologyMap />
    </ReactFlowProvider>
  );
}
