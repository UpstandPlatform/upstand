import yaml from "yaml";
import { isUnknownRecord } from "./docker-values";

const HOST_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|[\\/~]|\.\.?[\\/])/;
const COMPOSE_RESOURCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PROTECTED_DOCKER_ENVIRONMENT_NAMES = [
  "DOCKER_CUSTOM_HEADERS",
  "DOCKER_CERT_PATH",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
] as const;

function validateProtectedDockerEnvironmentReferences(
  rawCompose: string,
): void {
  for (const name of PROTECTED_DOCKER_ENVIRONMENT_NAMES) {
    const referencePattern = new RegExp(
      `(?:\\$\\{${name}(?:[:?+\\-][^}]*)?\\}|\\$${name}\\b)`,
    );
    if (referencePattern.test(rawCompose)) {
      throw new Error(
        `Compose cannot interpolate protected Docker environment variable '${name}'`,
      );
    }
  }
}

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

function isUnsafeComposePath(value: string): boolean {
  if (isHostPath(value)) return true;

  // Compose resolves relative paths from the generated deployment directory.
  // Do not let a user-controlled Compose document walk back into the control
  // plane checkout or another deployment's files.
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function isRemoteBuildContext(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateComposeScopedPath(
  value: string,
  resourceKind: string,
  resourceName: string,
): void {
  if (!value || isUnsafeComposePath(value)) {
    throw new Error(
      `Compose ${resourceKind} '${resourceName}' uses an unsafe path`,
    );
  }
}

function validateComposeBuild(serviceName: string, build: unknown): void {
  if (typeof build === "string") {
    if (!isRemoteBuildContext(build)) {
      validateComposeScopedPath(build, "service build context", serviceName);
    }
    return;
  }
  if (!isUnknownRecord(build)) return;

  if (
    typeof build.context === "string" &&
    !isRemoteBuildContext(build.context)
  ) {
    validateComposeScopedPath(
      build.context,
      "service build context",
      serviceName,
    );
  }
  if (typeof build.dockerfile === "string") {
    validateComposeScopedPath(
      build.dockerfile,
      "service Dockerfile",
      serviceName,
    );
  }
  if (build.ssh !== undefined) {
    throw new Error(
      `Compose service '${serviceName}' requests SSH agent forwarding during build, which is not allowed`,
    );
  }
  if (isUnknownRecord(build.additional_contexts)) {
    for (const [contextName, rawContext] of Object.entries(
      build.additional_contexts,
    )) {
      if (typeof rawContext !== "string" || isRemoteBuildContext(rawContext)) {
        continue;
      }
      validateComposeScopedPath(
        rawContext,
        `service build context '${contextName}'`,
        serviceName,
      );
    }
  } else if (Array.isArray(build.additional_contexts)) {
    for (const rawContext of build.additional_contexts) {
      if (typeof rawContext !== "string") continue;
      const separator = rawContext.indexOf("=");
      const context =
        separator === -1 ? rawContext : rawContext.slice(separator + 1);
      if (!isRemoteBuildContext(context)) {
        validateComposeScopedPath(
          context,
          "service additional build context",
          serviceName,
        );
      }
    }
  }
}

function validateComposeEnvFile(serviceName: string, envFile: unknown): void {
  const paths = Array.isArray(envFile) ? envFile : [envFile];
  for (const entry of paths) {
    const value =
      typeof entry === "string"
        ? entry
        : isUnknownRecord(entry) && typeof entry.path === "string"
          ? entry.path
          : undefined;
    if (value === undefined) continue;
    validateComposeScopedPath(value, "env_file", serviceName);
  }
}

function isExternalResourceDefinition(value: unknown): boolean {
  return (
    value === true ||
    (isUnknownRecord(value) &&
      (value.external === true || isUnknownRecord(value.external)))
  );
}

function validateComposeFileBackedResources(
  parsed: Record<string, unknown>,
  resourceKind: "configs" | "secrets",
): void {
  const definitions = parsed[resourceKind];
  if (!isUnknownRecord(definitions)) return;

  for (const [resourceName, rawDefinition] of Object.entries(definitions)) {
    if (!COMPOSE_RESOURCE_KEY_PATTERN.test(resourceName)) {
      throw new Error(
        `Compose ${resourceKind.slice(0, -1)} '${resourceName}' has an invalid resource name`,
      );
    }
    if (isExternalResourceDefinition(rawDefinition)) {
      throw new Error(
        `Compose ${resourceKind.slice(0, -1)} '${resourceName}' cannot be external; resources must be provisioned inside the resource boundary`,
      );
    }
    if (!isUnknownRecord(rawDefinition)) continue;

    for (const field of ["name", "file"] as const) {
      const value = rawDefinition[field];
      if (typeof value !== "string") continue;
      if (
        isHostPath(value) ||
        value.includes("/../") ||
        value.includes("\\..\\")
      ) {
        throw new Error(
          `Compose ${resourceKind.slice(0, -1)} '${resourceName}' uses an unsafe ${field} path`,
        );
      }
    }
  }
}

/**
 * Reject Compose features that can escape the workload's isolation boundary.
 * This applies to raw Compose resources as well as user-created templates.
 */
export function validateComposeSecurity(rawCompose: string): void {
  validateProtectedDockerEnvironmentReferences(rawCompose);

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
      if (!COMPOSE_RESOURCE_KEY_PATTERN.test(volumeName)) {
        throw new Error(
          `Compose volume '${volumeName}' has an invalid resource name`,
        );
      }
      if (isExternalResourceDefinition(rawDefinition)) {
        throw new Error(
          `Compose volume '${volumeName}' cannot be external; resource volumes must be provisioned inside the resource boundary`,
        );
      }
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
      if (!COMPOSE_RESOURCE_KEY_PATTERN.test(networkName)) {
        throw new Error(
          `Compose network '${networkName}' has an invalid resource name`,
        );
      }
      if (isExternalResourceDefinition(rawDefinition)) {
        throw new Error(
          `Compose network '${networkName}' cannot be external; resource networks must be provisioned inside the resource boundary`,
        );
      }
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

  validateComposeFileBackedResources(parsed, "configs");
  validateComposeFileBackedResources(parsed, "secrets");

  if (parsed.include !== undefined) {
    throw new Error(
      "Compose include files are not allowed; deployments must use a self-contained Compose document",
    );
  }

  if (!isUnknownRecord(parsed.services)) return;

  for (const [serviceName, rawService] of Object.entries(parsed.services)) {
    if (!isUnknownRecord(rawService)) continue;
    const service = rawService;

    if (service.build !== undefined) {
      validateComposeBuild(serviceName, service.build);
    }
    if (service.env_file !== undefined) {
      validateComposeEnvFile(serviceName, service.env_file);
    }
    if (
      isUnknownRecord(service.extends) &&
      typeof service.extends.file === "string"
    ) {
      validateComposeScopedPath(
        service.extends.file,
        "extends file",
        serviceName,
      );
    }

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
