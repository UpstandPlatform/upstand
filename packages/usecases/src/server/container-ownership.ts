import type { Resource } from "@upstand/domain";
import type { DockerContainer } from "../ports/docker";

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
  return requestedId === actualId;
}

/**
 * A container is authorized for a resource only when its managed labels or
 * exact service/container naming prove that relationship. Substring matches
 * are intentionally excluded because they allow similarly named tenants to
 * cross the resource boundary.
 */
export function containerBelongsToResource(
  container: Pick<DockerContainer, "id"> & {
    name?: string;
    labels?: string[];
  },
  resource: Pick<Resource, "id" | "type" | "composeType" | "appName" | "name">,
): boolean {
  if (!isValidContainerIdentifier(container.id)) return false;

  const labels = containerLabels(container.labels || []);
  const expectedName = resourceName(resource);

  const upstandResourceId = labels.get("com.upstand.resource-id");
  if (upstandResourceId) return upstandResourceId === resource.id;

  if (resource.type === "compose") {
    const namespace =
      resource.composeType === "compose"
        ? labels.get("com.docker.compose.project")
        : labels.get("com.docker.stack.namespace");
    return namespace === expectedName;
  }

  const swarmService = labels.get("com.docker.swarm.service.name");
  if (swarmService !== undefined) {
    return (
      swarmService === expectedName ||
      swarmService.startsWith(`${expectedName}.`)
    );
  }

  const composeService = labels.get("com.docker.compose.service");
  if (composeService !== undefined) return composeService === expectedName;

  const cleanContainerName = (container.name || "")
    .replace(/^\//, "")
    .toLowerCase();
  if (!cleanContainerName) return false;
  if (cleanContainerName === expectedName) return true;
  return /^[-_]\d+$/.test(cleanContainerName.slice(expectedName.length));
}
