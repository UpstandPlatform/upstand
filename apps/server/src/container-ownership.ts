import type { Resource } from "@upstand/domain";
import type { DockerContainer } from "@upstand/usecases/ports/docker";

const CONTAINER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function resourceName(resource: Pick<Resource, "appName" | "name">): string {
  return (resource.appName || resource.name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-");
}

function containerLabels(labels: string[]): Map<string, string> {
  return new Map(
    labels.flatMap((label) => {
      const separator = label.indexOf("=");
      return separator > 0
        ? [[label.slice(0, separator), label.slice(separator + 1)] as const]
        : [];
    }),
  );
}

export function isValidContainerIdentifier(value: string): boolean {
  return CONTAINER_ID_PATTERN.test(value);
}

export function matchesContainerIdentifier(
  requestedId: string,
  actualId: string,
): boolean {
  return (
    requestedId === actualId ||
    requestedId.startsWith(actualId) ||
    actualId.startsWith(requestedId)
  );
}

/**
 * Docker inventory is the authorization boundary for resource terminals. A
 * container must be both present on the selected target and labeled as part
 * of the requested resource; a caller-provided container id alone is not
 * sufficient to authorize `docker exec`.
 *
 * Authorization precedence (strongest first):
 * 1. Upstand-managed `upstand.resource.id` label — exact match.
 * 2. Compose project / Swarm stack namespace label — exact match.
 * 3. Swarm service name label — exact match or `<name>.<replica>` prefix.
 * 4. Compose service label — exact match.
 * 5. Container name — exact match or `<name>_<replica>` / `<name>-<replica>` pattern.
 *
 * substring `includes()` checks are intentionally NOT used here because they
 * would allow a container named "my-evil-api" to pass the check for a
 * resource whose expected name is "api" (privilege escalation).
 */
export function containerBelongsToResource(
  container: Pick<DockerContainer, "id"> & { name?: string; labels?: string[] },
  resource: Pick<Resource, "id" | "type" | "composeType" | "appName" | "name">,
): boolean {
  if (!isValidContainerIdentifier(container.id)) return false;

  const labels = containerLabels(container.labels || []);
  const expectedName = resourceName(resource);

  // 1. Strongest signal: Upstand-managed resource-id label (set at deploy time).
  const upstandResourceId = labels.get("upstand.resource.id");
  if (upstandResourceId) {
    return upstandResourceId === resource.id;
  }

  // 2. Compose / Stack namespace label (exact match only).
  if (resource.type === "compose") {
    const namespace =
      resource.composeType === "compose"
        ? labels.get("com.docker.compose.project")
        : labels.get("com.docker.stack.namespace");
    return namespace === expectedName;
  }

  // 3. Swarm service name: exact match, or "<service>.<taskSlot>" suffix pattern
  //    used by Docker Swarm tasks (e.g. "checkout-api.1").
  const swarmService = labels.get("com.docker.swarm.service.name");
  if (swarmService !== undefined) {
    if (swarmService === expectedName) return true;
    if (swarmService.startsWith(`${expectedName}.`)) return true;
    return false;
  }

  // 4. Compose service label — exact match only.
  const composeService = labels.get("com.docker.compose.service");
  if (composeService !== undefined) {
    return composeService === expectedName;
  }

  // 5. Container name fallback: exact match, or Docker-appended replica
  //    suffixes like "<name>_1" or "<name>-1".
  const cleanContainerName = (container.name || "")
    .replace(/^\//, "")
    .toLowerCase();
  if (!cleanContainerName) return false;
  if (cleanContainerName === expectedName) return true;
  if (/^[-_]\d+$/.test(cleanContainerName.slice(expectedName.length)))
    return true;

  return false;
}
