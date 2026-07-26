import type { Resource, ResourceAdvancedConfig } from "@upstand/domain";
import yaml from "yaml";
import { isUnknownRecord } from "./docker-values";
import { parseResourceEnvironmentVariables } from "./resource-environment";

function composeMap(value: unknown): Record<string, string> {
  if (isUnknownRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([, item]) => typeof item === "string" || typeof item === "number",
        )
        .map(([key, item]) => [key, String(item)]),
    );
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.flatMap((item) => {
        if (typeof item !== "string") return [];
        const separator = item.indexOf("=");
        return separator === -1
          ? [[item, ""]]
          : [[item.slice(0, separator), item.slice(separator + 1)]];
      }),
    );
  }
  return {};
}

export function applyComposeResourceConfig(
  rawCompose: string,
  resource: Resource,
  config: ResourceAdvancedConfig,
): string {
  const parsed = yaml.parse(rawCompose) as {
    services?: Record<string, Record<string, unknown>>;
  };
  if (!parsed?.services || typeof parsed.services !== "object")
    return rawCompose;
  const services = parsed.services;

  const resourceEnvironment = composeMap(
    parseResourceEnvironmentVariables(resource.envVars),
  );
  const serviceNames = config.serviceName
    ? [config.serviceName]
    : Object.keys(parsed.services);
  const missingService = serviceNames.find((name) => !services[name]);
  if (missingService) {
    throw new Error(`Compose service '${missingService}' was not found`);
  }

  for (const serviceName of serviceNames) {
    const service = services[serviceName];
    if (!service) {
      throw new Error(`Compose service '${serviceName}' was not found`);
    }
    const environment = {
      ...composeMap(service.environment),
      ...resourceEnvironment,
      ...config.environment,
    };
    if (Object.keys(environment).length) service.environment = environment;

    const labels = { ...composeMap(service.labels), ...config.labels };
    if (Object.keys(labels).length) service.labels = labels;

    if (config.command.length) service.entrypoint = config.command;
    if (config.args.length) service.command = config.args;
    if (config.workingDir) service.working_dir = config.workingDir;
    if (config.user) service.user = config.user;
    if (config.hostname) service.hostname = config.hostname;
    if (config.dns.length) service.dns = config.dns;
    if (config.dnsSearch.length) service.dns_search = config.dnsSearch;
    if (config.extraHosts.length) service.extra_hosts = config.extraHosts;
    if (config.capAdd.length) service.cap_add = config.capAdd;
    if (config.capDrop.length) service.cap_drop = config.capDrop;
    if (config.init) service.init = true;
    if (config.readOnlyRootFilesystem) service.read_only = true;
    if (config.privileged) service.privileged = true;
    if (config.tty) service.tty = true;
    if (config.stopGracePeriodSeconds !== undefined) {
      service.stop_grace_period = `${config.stopGracePeriodSeconds}s`;
    }

    if (config.ports.length) {
      const currentPorts = Array.isArray(service.ports) ? service.ports : [];
      const additionalPorts = config.ports.map(
        (port) =>
          `${port.publishedPort}:${port.targetPort}${port.protocol === "udp" ? "/udp" : ""}`,
      );
      service.ports = [...new Set([...currentPorts, ...additionalPorts])];
    }
    if (config.volumes.length) {
      const currentVolumes = Array.isArray(service.volumes)
        ? service.volumes
        : [];
      const additionalVolumes = config.volumes.map(
        (volume) =>
          `${volume.source}:${volume.target}${volume.readOnly ? ":ro" : ""}`,
      );
      service.volumes = [...new Set([...currentVolumes, ...additionalVolumes])];
    }

    const deploy = isUnknownRecord(service.deploy) ? service.deploy : {};
    if (config.replicas !== undefined) deploy.replicas = config.replicas;
    if (config.placementConstraints.length) {
      deploy.placement = {
        ...(isUnknownRecord(deploy.placement) ? deploy.placement : {}),
        constraints: config.placementConstraints,
      };
    }
    if (config.resources.cpuLimit || config.resources.memoryLimitMb) {
      const existingResources = isUnknownRecord(deploy.resources)
        ? deploy.resources
        : {};
      deploy.resources = {
        ...existingResources,
        limits: {
          ...(isUnknownRecord(existingResources.limits)
            ? existingResources.limits
            : {}),
          ...(config.resources.cpuLimit
            ? { cpus: String(config.resources.cpuLimit) }
            : {}),
          ...(config.resources.memoryLimitMb
            ? { memory: `${config.resources.memoryLimitMb}M` }
            : {}),
        },
      };
    }
    if (Object.keys(deploy).length) service.deploy = deploy;
    if (config.restartPolicy.condition !== "any") {
      service.restart =
        config.restartPolicy.condition === "on-failure" ? "on-failure" : "no";
    }
    if (config.healthcheck) {
      service.healthcheck = {
        test: config.healthcheck.command,
        interval: `${config.healthcheck.intervalSeconds}s`,
        timeout: `${config.healthcheck.timeoutSeconds}s`,
        retries: config.healthcheck.retries,
        start_period: `${config.healthcheck.startPeriodSeconds}s`,
      };
    }
  }

  return yaml.stringify(parsed);
}

export function applyComposeIngressNetwork(
  rawCompose: string,
  networkName: string,
  prefixVolumes: boolean,
  stackName: string,
): string {
  const parsed = yaml.parse(rawCompose) as {
    services?: Record<string, Record<string, unknown>>;
    networks?: Record<string, unknown>;
    volumes?: unknown;
  };
  if (!parsed?.services || typeof parsed.services !== "object") {
    throw new Error("Compose file must define services");
  }

  const ingressNetwork = "upstand_ingress";
  parsed.networks = {
    ...(isUnknownRecord(parsed.networks) ? parsed.networks : {}),
    [ingressNetwork]: {
      name: networkName,
      external: true,
    },
  };

  for (const service of Object.values(parsed.services)) {
    // Docker Compose forbids networks alongside network_mode. Preserve an
    // explicit host/none/container mode and let routing validation surface
    // that it cannot be reached through the shared ingress network.
    if (service.network_mode) continue;

    const networks = service.networks;
    if (!networks) {
      service.networks = [ingressNetwork];
    } else if (Array.isArray(networks)) {
      if (!networks.includes(ingressNetwork)) networks.push(ingressNetwork);
    } else if (isUnknownRecord(networks)) {
      service.networks = { ...networks, [ingressNetwork]: {} };
    } else {
      service.networks = [ingressNetwork];
    }
  }

  if (prefixVolumes) {
    if (stackName.length === 0) {
      throw new Error("An isolated Compose deployment needs a valid name");
    }

    const volumePrefix = `${stackName}_`;
    if (parsed.volumes && typeof parsed.volumes === "object") {
      const volumes = parsed.volumes as Record<string, unknown>;
      const isNamedVolume = (source: unknown): source is string =>
        typeof source === "string" &&
        source.length > 0 &&
        !source.startsWith(".") &&
        !source.startsWith("/") &&
        !source.startsWith("~") &&
        !source.includes("/");
      const volumeNames = new Map<string, string>();
      const externalVolumeNames = new Set<string>();
      const renameVolume = (source: unknown) => {
        if (!isNamedVolume(source)) return source;
        if (externalVolumeNames.has(source)) return source;
        const renamed = volumeNames.get(source) || `${volumePrefix}${source}`;
        volumeNames.set(source, renamed);
        return renamed;
      };
      const renamedVolumes: Record<string, unknown> = {};
      for (const [name, definition] of Object.entries(volumes)) {
        if (
          isUnknownRecord(definition) &&
          (definition.external === true || isUnknownRecord(definition.external))
        ) {
          externalVolumeNames.add(name);
          renamedVolumes[name] = definition;
          continue;
        }
        const renamed = renameVolume(name) as string;
        if (isUnknownRecord(definition)) {
          const nextDefinition = { ...definition };
          if (typeof nextDefinition.name === "string") {
            nextDefinition.name = renameVolume(nextDefinition.name);
          }
          renamedVolumes[renamed] = nextDefinition;
        } else {
          renamedVolumes[renamed] = definition;
        }
      }
      parsed.volumes = renamedVolumes;

      for (const service of Object.values(parsed.services)) {
        if (!Array.isArray(service.volumes)) continue;
        service.volumes = service.volumes.map((volume) => {
          if (typeof volume === "string") {
            const [source, ...rest] = volume.split(":");
            return [renameVolume(source), ...rest].join(":");
          }
          if (isUnknownRecord(volume) && typeof volume.source === "string") {
            return { ...volume, source: renameVolume(volume.source) };
          }
          return volume;
        });
      }
    }
  }

  return yaml.stringify(parsed);
}
