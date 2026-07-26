export type ResourceRuntimeStatus =
  | "running"
  | "degraded"
  | "starting"
  | "stopped"
  | "errored"
  | "idle"
  | "unknown";

const RUNNING_STATES = new Set(["running"]);
const STARTING_STATES = new Set([
  "created",
  "new",
  "pending",
  "assigned",
  "accepted",
  "preparing",
  "starting",
  "ready",
]);
const STOPPED_STATES = new Set([
  "exited",
  "stopped",
  "shutdown",
  "complete",
  "remove",
  "removed",
]);
const ERROR_STATES = new Set([
  "dead",
  "failed",
  "rejected",
  "orphaned",
  "error",
]);

function stateOf(container: unknown): string {
  if (!container || typeof container !== "object") return "unknown";
  const value = container as { state?: unknown; status?: unknown };
  return String(value.state ?? value.status ?? "unknown")
    .trim()
    .toLowerCase()
    .split(/\s+/)[0];
}

/**
 * Resolve desired/persisted status against a successful live Docker read.
 * A failed live read is deliberately handled by the caller: it must not be
 * presented as a container failure because the Docker host may be unreachable.
 */
export function determineResourceRuntimeStatus(
  persistedStatus: unknown,
  containers: readonly unknown[] | undefined,
): ResourceRuntimeStatus {
  const persisted = String(persistedStatus ?? "idle").toLowerCase();
  if (!containers) return "unknown";

  const states = containers.map(stateOf);
  const running = states.filter((state) => RUNNING_STATES.has(state)).length;
  const errors = states.filter((state) => ERROR_STATES.has(state)).length;
  const starting = states.filter((state) => STARTING_STATES.has(state)).length;

  if (running > 0 && errors > 0) return "degraded";
  if (running > 0) return "running";
  if (errors > 0) return "errored";
  if (starting > 0) return "starting";
  if (states.length > 0 && states.every((state) => STOPPED_STATES.has(state))) {
    return "stopped";
  }

  // An empty successful observation is meaningful. A desired running
  // resource with no task/container is broken; idle resources are simply not
  // deployed yet.
  if (states.length === 0) {
    if (persisted === "running") return "errored";
    if (persisted === "stopped") return "stopped";
    return "idle";
  }

  return persisted === "running" ? "errored" : "unknown";
}
