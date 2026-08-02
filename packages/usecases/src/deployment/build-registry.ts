export interface BuildRegistryReference {
  registryUrl?: string | null;
  imagePrefix?: string | null;
  username?: string | null;
}

function trimProtocolAndSlashes(value: string): string {
  let str = value.trim();
  if (str.startsWith("https://")) str = str.slice(8);
  else if (str.startsWith("http://")) str = str.slice(7);
  while (str.endsWith("/")) str = str.slice(0, -1);
  return str;
}

function trimSlashes(value: string): string {
  let str = value.trim();
  while (str.startsWith("/")) str = str.slice(1);
  while (str.endsWith("/")) str = str.slice(0, -1);
  return str;
}

/** Normalize a deployment-specific Docker tag without allowing tag syntax through. */
export function normalizeBuildImageTag(
  value: string | null | undefined,
): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  return normalized || "latest";
}

/** Build the deployment-specific transfer image reference used between build and target servers. */
export function buildRegistryImageTag(
  registry: BuildRegistryReference,
  serviceName: string,
  deploymentId?: string | null,
): string {
  const host = trimProtocolAndSlashes(registry.registryUrl || "");
  const prefix = trimSlashes(registry.imagePrefix || registry.username || "");
  const normalizedServiceName = serviceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  const repository = [host, prefix, normalizedServiceName]
    .filter(Boolean)
    .join("/");
  return `${repository || "upstand"}:${normalizeBuildImageTag(deploymentId)}`;
}
