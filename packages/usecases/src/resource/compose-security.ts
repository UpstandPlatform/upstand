import yaml from "yaml";
import { isUnknownRecord } from "./docker-values";

const HOST_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|[\\/~]|\.\.?[\\/])/;

function volumeSource(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (/^[a-zA-Z]:[\\/]/.test(value)) return value;
    return value.split(":", 1)[0];
  }
  if (isUnknownRecord(value) && typeof value.source === "string") {
    return value.source;
  }
  return undefined;
}

function isHostNamespace(value: unknown): boolean {
  return ["host", "container:host"].includes(String(value ?? ""));
}

function isInterpolated(value: string): boolean {
  // Compose expands environment variables before asking Docker to create
  // mounts and networks. An apparently harmless named source such as
  // `${HOST_PATH}` can therefore become `/` or another host path at runtime.
  return value.includes("$");
}

function isHostPath(value: string): boolean {
  return (
    HOST_PATH_PATTERN.test(value) ||
    value.toLowerCase().includes("docker.sock") ||
    isInterpolated(value)
  );
}

/**
 * Reject Compose features that can escape the workload's isolation boundary.
 * This applies to raw Compose resources as well as user-created templates.
 */
export function validateComposeSecurity(rawCompose: string): void {
  let parsed: unknown;
  try {
    parsed = yaml.parse(rawCompose);
  } catch (error) {
    throw new Error(
      `Compose YAML is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isUnknownRecord(parsed)) return;

  if (isUnknownRecord(parsed.volumes)) {
    for (const [volumeName, rawDefinition] of Object.entries(parsed.volumes)) {
      if (isInterpolated(volumeName)) {
        throw new Error(
          `Compose volume '${volumeName}' uses environment interpolation, which is not allowed`,
        );
      }
      if (!isUnknownRecord(rawDefinition)) continue;
      if (
        isUnknownRecord(rawDefinition.driver_opts) &&
        Object.keys(rawDefinition.driver_opts).length > 0
      ) {
        throw new Error(
          `Compose volume '${volumeName}' configures host-backed driver options, which is not allowed`,
        );
      }
      if (
        typeof rawDefinition.driver === "string" &&
        rawDefinition.driver.trim() !== "" &&
        rawDefinition.driver.trim().toLowerCase() !== "local"
      ) {
        throw new Error(
          `Compose volume '${volumeName}' uses an unsupported volume driver`,
        );
      }
      if (
        typeof rawDefinition.name === "string" &&
        isHostPath(rawDefinition.name)
      ) {
        throw new Error(
          `Compose volume '${volumeName}' resolves to an unsafe Docker volume name`,
        );
      }
    }
  }

  if (isUnknownRecord(parsed.networks)) {
    for (const [networkName, rawDefinition] of Object.entries(
      parsed.networks,
    )) {
      if (!isUnknownRecord(rawDefinition)) continue;
      if (
        isUnknownRecord(rawDefinition.driver_opts) &&
        Object.keys(rawDefinition.driver_opts).length > 0
      ) {
        throw new Error(
          `Compose network '${networkName}' configures host-backed driver options, which is not allowed`,
        );
      }
      if (
        typeof rawDefinition.driver === "string" &&
        rawDefinition.driver.trim() !== "" &&
        !["bridge", "overlay"].includes(
          rawDefinition.driver.trim().toLowerCase(),
        )
      ) {
        throw new Error(
          `Compose network '${networkName}' uses an unsupported network driver`,
        );
      }
      if (
        typeof rawDefinition.name === "string" &&
        (isInterpolated(rawDefinition.name) ||
          ["host", "none"].includes(rawDefinition.name.trim().toLowerCase()))
      ) {
        throw new Error(
          `Compose network '${networkName}' resolves to an unsafe Docker network name`,
        );
      }
    }
  }

  if (!isUnknownRecord(parsed.services)) return;

  for (const [serviceName, rawService] of Object.entries(parsed.services)) {
    if (!isUnknownRecord(rawService)) continue;
    const service = rawService;

    if (service.privileged === true) {
      throw new Error(
        `Compose service '${serviceName}' requests privileged mode, which is not allowed`,
      );
    }
    if (
      isHostNamespace(service.network_mode) ||
      isHostNamespace(service.pid) ||
      isHostNamespace(service.ipc) ||
      isHostNamespace(service.uts) ||
      isHostNamespace(service.userns_mode) ||
      isHostNamespace(service.cgroupns)
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests host-level namespace access, which is not allowed`,
      );
    }
    if (service.container_name !== undefined) {
      throw new Error(
        `Compose service '${serviceName}' sets container_name, which is not allowed for isolated deployments`,
      );
    }
    if (Array.isArray(service.cap_add) && service.cap_add.length > 0) {
      throw new Error(
        `Compose service '${serviceName}' requests added Linux capabilities, which is not allowed`,
      );
    }
    if (Array.isArray(service.devices) && service.devices.length > 0) {
      throw new Error(
        `Compose service '${serviceName}' requests host devices, which is not allowed`,
      );
    }
    if (Array.isArray(service.security_opt)) {
      const unsafeSecurityOption = service.security_opt.find(
        (option) =>
          typeof option === "string" &&
          (/=(?:unconfined|false)$/i.test(option) ||
            /^(?:apparmor|seccomp)=unconfined$/i.test(option)),
      );
      if (unsafeSecurityOption) {
        throw new Error(
          `Compose service '${serviceName}' requests unsafe security option '${unsafeSecurityOption}'`,
        );
      }
    }
    if (Array.isArray(service.volumes)) {
      for (const volume of service.volumes) {
        const source = volumeSource(volume);
        if (
          isUnknownRecord(volume) &&
          String(volume.type ?? "").toLowerCase() === "bind"
        ) {
          throw new Error(
            `Compose service '${serviceName}' contains a host bind or Docker socket mount`,
          );
        }
        if (source && isHostPath(source)) {
          throw new Error(
            `Compose service '${serviceName}' contains a host bind or Docker socket mount`,
          );
        }
      }
    }
  }
}
