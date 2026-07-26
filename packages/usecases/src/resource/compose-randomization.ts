import { randomBytes } from "node:crypto";
import yaml from "yaml";

const TOP_LEVEL_RESOURCES = [
  "services",
  "networks",
  "volumes",
  "configs",
  "secrets",
] as const;

function resourceSuffix(value?: string): string {
  return value?.trim() || randomBytes(4).toString("hex");
}

function renameReference(value: unknown, names: Map<string, string>): unknown {
  if (typeof value !== "string") return value;
  const [first, ...rest] = value.split(":");
  const name = first || "";
  const renamed = names.get(name) || name;
  return [renamed, ...rest].join(":");
}

/**
 * Adds one stable suffix to Compose services and named resources while
 * preserving the references that make the file deployable.
 */
export function randomizeComposeFile(
  rawCompose: string,
  suffix?: string,
): string {
  const parsed = yaml.parse(rawCompose) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || !parsed.services) {
    throw new Error("Compose file must define services");
  }

  const suffixValue = resourceSuffix(suffix);
  const maps = new Map<
    (typeof TOP_LEVEL_RESOURCES)[number],
    Map<string, string>
  >();
  for (const resource of TOP_LEVEL_RESOURCES) {
    const value = parsed[resource];
    const names = new Map<string, string>();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const name of Object.keys(value)) {
        names.set(name, `${name}-${suffixValue}`);
      }
    }
    maps.set(resource, names);
    if (names.size) {
      parsed[resource] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([name, definition]) => [names.get(name), definition],
        ),
      );
    }
  }

  const services = parsed.services as Record<string, Record<string, unknown>>;
  const serviceNames = maps.get("services") || new Map<string, string>();
  const networkNames = maps.get("networks") || new Map<string, string>();
  const volumeNames = maps.get("volumes") || new Map<string, string>();
  const configNames = maps.get("configs") || new Map<string, string>();
  const secretNames = maps.get("secrets") || new Map<string, string>();

  for (const service of Object.values(services)) {
    if (!service || typeof service !== "object") continue;
    if (Array.isArray(service.depends_on)) {
      service.depends_on = service.depends_on.map((name) =>
        typeof name === "string" ? serviceNames.get(name) || name : name,
      );
    } else if (service.depends_on && typeof service.depends_on === "object") {
      service.depends_on = Object.fromEntries(
        Object.entries(service.depends_on as Record<string, unknown>).map(
          ([name, definition]) => [serviceNames.get(name) || name, definition],
        ),
      );
    }
    if (Array.isArray(service.links)) {
      service.links = service.links.map((item) =>
        renameReference(item, serviceNames),
      );
    }
    if (Array.isArray(service.networks)) {
      service.networks = service.networks.map((name) =>
        typeof name === "string" ? networkNames.get(name) || name : name,
      );
    } else if (service.networks && typeof service.networks === "object") {
      service.networks = Object.fromEntries(
        Object.entries(service.networks as Record<string, unknown>).map(
          ([name, definition]) => [networkNames.get(name) || name, definition],
        ),
      );
    }
    if (Array.isArray(service.volumes)) {
      service.volumes = service.volumes.map((item) =>
        typeof item === "string" ? renameReference(item, volumeNames) : item,
      );
    }
    for (const key of ["configs", "secrets"] as const) {
      const names = key === "configs" ? configNames : secretNames;
      if (Array.isArray(service[key])) {
        service[key] = service[key].map((item) =>
          typeof item === "string"
            ? names.get(item) || item
            : item && typeof item === "object" && "source" in item
              ? {
                  ...(item as Record<string, unknown>),
                  source:
                    names.get(
                      String((item as Record<string, unknown>).source),
                    ) || (item as Record<string, unknown>).source,
                }
              : item,
        );
      }
    }
  }

  return yaml.stringify(parsed);
}
