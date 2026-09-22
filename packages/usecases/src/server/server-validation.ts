import type { ServerStatus, ServerType } from "@upstand/domain";
import type { DockerInfo } from "../ports/docker";

export function isServerReadyForWorkloads(input: {
  status: ServerStatus;
  serverType: ServerType;
  docker: Pick<DockerInfo, "swarmState">;
}): boolean {
  const requiresSwarm = input.serverType !== "build";
  return (
    input.status === "ready" &&
    (!requiresSwarm || input.docker.swarmState === "active")
  );
}
