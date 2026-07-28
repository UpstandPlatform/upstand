import type { DockerContainer } from "../ports/docker";

export function resourceName(resource?: {
  appName?: string | null;
  name?: string | null;
}): string {
  const rawName = resource?.appName || resource?.name || "";
  return rawName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-");
}

export function containerBelongsToResource(
  container: Pick<DockerContainer, "id" | "name" | "labels">,
  resource: {
    id: string;
    type: string;
    composeType?: string | null;
    appName?: string | null;
    name: string;
  },
): boolean {
  const containerIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
  if (!containerIdPattern.test(container.id)) return false;

  const labels = new Map(
    (container.labels || []).flatMap((label) => {
      const separator = label.indexOf("=");
      return separator > 0
        ? [[label.slice(0, separator), label.slice(separator + 1)] as const]
        : [];
    }),
  );
  const expectedName = resourceName(resource);

  const upstandResourceId =
    labels.get("upstand.resource.id") ?? labels.get("com.upstand.resource-id");
  if (upstandResourceId && upstandResourceId === resource.id) {
    return true;
  }

  if (resource.type === "compose") {
    const namespace =
      resource.composeType === "compose"
        ? labels.get("com.docker.compose.project")
        : labels.get("com.docker.stack.namespace");
    if (namespace === expectedName) return true;
  }

  const swarmService = labels.get("com.docker.swarm.service.name");
  if (swarmService !== undefined) {
    if (swarmService === expectedName) return true;
    const taskSuffix = swarmService.slice(expectedName.length + 1);
    if (
      swarmService.startsWith(`${expectedName}.`) &&
      /^\d+(?:\.|$)/.test(taskSuffix)
    ) {
      return true;
    }
    return false;
  }

  const composeService = labels.get("com.docker.compose.service");
  if (composeService !== undefined) {
    return composeService === expectedName;
  }

  const cleanContainerName = (container.name || "")
    .replace(/^\//, "")
    .toLowerCase();
  if (cleanContainerName === expectedName) return true;
  return /^[-_]\d+$/.test(cleanContainerName.slice(expectedName.length));
}

export function matchesContainerIdentifier(
  requested?: string,
  actual?: string,
): boolean {
  if (!requested || !actual) return false;
  return (
    requested === actual ||
    requested.startsWith(actual) ||
    actual.startsWith(requested)
  );
}

export function shellQuote(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}
