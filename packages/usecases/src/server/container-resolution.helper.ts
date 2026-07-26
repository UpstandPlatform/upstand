import type { DockerContainer } from "../ports/docker";

export function resourceName(resource: {
  appName?: string | null;
  name: string;
}): string {
  return (resource.appName || resource.name)
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
  const labels = new Map(
    (container.labels || []).flatMap((label) => {
      const separator = label.indexOf("=");
      return separator > 0
        ? [[label.slice(0, separator), label.slice(separator + 1)] as const]
        : [];
    }),
  );
  const expectedName = resourceName(resource);

  const upstandResourceId = labels.get("upstand.resource.id");
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
  if (
    swarmService &&
    (swarmService === expectedName || swarmService.includes(expectedName))
  ) {
    return true;
  }

  const composeService = labels.get("com.docker.compose.service");
  if (
    composeService &&
    (composeService === expectedName || composeService.includes(expectedName))
  ) {
    return true;
  }

  const cleanContainerName = (container.name || "")
    .replace(/^\//, "")
    .toLowerCase();
  if (
    cleanContainerName === expectedName ||
    cleanContainerName.includes(expectedName) ||
    cleanContainerName.includes(resource.id) ||
    (resource.appName &&
      cleanContainerName.includes(resource.appName.toLowerCase()))
  ) {
    return true;
  }

  return false;
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
