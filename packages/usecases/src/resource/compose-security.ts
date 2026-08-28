import yaml from "yaml";
import { COMPOSE_DOCUMENT_MAX_BYTES } from "./compose-document.schema";
import { isUnknownRecord } from "./docker-values";

const HOST_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|[\\/~]|\.\.?[\\/])/;
const COMPOSE_RESOURCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PROTECTED_DOCKER_ENVIRONMENT_NAMES = [
  "DOCKER_CUSTOM_HEADERS",
  "DOCKER_CERT_PATH",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
] as const;
const REMOTE_BUILD_CONTEXT_PATTERN =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|[^/\\\s:@]+@[^/\\\s:]+:)/i;
const COMPOSE_BUILD_ARGUMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SENSITIVE_BUILD_ARGUMENT_MARKERS = [
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "private_key",
  "privatekey",
  "credential",
  "client_secret",
  "clientsecret",
  "access_token",
  "access_key",
  "accesskey",
] as const;

// Compose is an extensible format, but unknown fields are not safe to pass
// through a host-control boundary: a newer CLI can assign new meaning to a
// field after this policy was reviewed. Keep the supported surface explicit
// and allow only the standard x-* extension namespace for anchor fragments.
const COMPOSE_TOP_LEVEL_FIELDS = new Set([
  "version",
  "name",
  "services",
  "networks",
  "volumes",
  "configs",
  "secrets",
]);
const COMPOSE_SERVICE_FIELDS = new Set([
  "annotations",
  "attach",
  "blkio_config",
  "build",
  "cap_add",
  "cap_drop",
  "cgroup",
  "cgroup_parent",
  "cgroupns",
  "command",
  "configs",
  "container_name",
  "cpu_count",
  "cpu_percent",
  "cpu_period",
  "cpu_quota",
  "cpu_rt_period",
  "cpu_rt_runtime",
  "cpu_shares",
  "cpus",
  "cpuset",
  "depends_on",
  "deploy",
  "device_cgroup_rules",
  "devices",
  "dns",
  "dns_opt",
  "dns_search",
  "domainname",
  "entrypoint",
  "env_file",
  "environment",
  "expose",
  "extends",
  "external_links",
  "extra_hosts",
  "gpus",
  "group_add",
  "healthcheck",
  "hostname",
  "image",
  "init",
  "ipc",
  "isolation",
  "labels",
  "links",
  "logging",
  "mac_address",
  "mem_limit",
  "mem_reservation",
  "mem_swappiness",
  "memswap_limit",
  "memswap_reservation",
  "network_mode",
  "networks",
  "oom_kill_disable",
  "oom_score_adj",
  "pid",
  "pids_limit",
  "platform",
  "ports",
  "post_start",
  "pre_stop",
  "privileged",
  "profiles",
  "pull_policy",
  "read_only",
  "restart",
  "runtime",
  "scale",
  "security_opt",
  "secrets",
  "shm_size",
  "stdin_open",
  "stop_grace_period",
  "stop_signal",
  "storage_opt",
  "sysctls",
  "tmpfs",
  "tty",
  "ulimits",
  "user",
  "uts",
  "userns_mode",
  "volumes",
  "volumes_from",
  "working_dir",
]);
const COMPOSE_BUILD_FIELDS = new Set([
  "additional_contexts",
  "args",
  "cache_from",
  "cache_to",
  "context",
  "dockerfile",
  "dockerfile_inline",
  "entitlements",
  "network",
  "platforms",
  "privileged",
  "provenance",
  "sbom",
  "secrets",
  "ssh",
  "target",
]);
const COMPOSE_DEPLOY_FIELDS = new Set([
  "cap_add",
  "cap_drop",
  "devices",
  "device_cgroup_rules",
  "endpoint_mode",
  "labels",
  "mode",
  "placement",
  "privileged",
  "replicas",
  "replicas_max_per_node",
  "resources",
  "restart_policy",
  "rollback_config",
  "security_opt",
  "sysctls",
  "update_config",
]);
const COMPOSE_RESOURCE_LIMIT_FIELDS = new Set(["cpus", "memory", "pids"]);
const COMPOSE_RESOURCE_RESERVATION_FIELDS = new Set([
  "cpus",
  "devices",
  "generic_resources",
  "memory",
]);
const COMPOSE_RESTART_FIELDS = new Set([
  "condition",
  "delay",
  "max_attempts",
  "window",
]);
const COMPOSE_PLACEMENT_FIELDS = new Set([
  "constraints",
  "max_replicas_per_node",
  "platforms",
  "preferences",
]);
const COMPOSE_UPDATE_FIELDS = new Set([
  "delay",
  "failure_action",
  "max_failure_ratio",
  "monitor",
  "order",
  "parallelism",
]);
const COMPOSE_NETWORK_FIELDS = new Set([
  "attachable",
  "driver",
  "driver_opts",
  "enable_ipv4",
  "enable_ipv6",
  "external",
  "ipam",
  "internal",
  "labels",
  "name",
]);
const COMPOSE_VOLUME_FIELDS = new Set([
  "driver",
  "driver_opts",
  "external",
  "labels",
  "name",
]);
const COMPOSE_FILE_RESOURCE_FIELDS = new Set([
  "content",
  "environment",
  "external",
  "file",
  "name",
  "template_driver",
]);

function isComposeExtensionField(field: string): boolean {
  return /^x-[a-z0-9][a-z0-9_.-]{0,63}$/i.test(field);
}

function validateComposeFieldSet(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field) && !isComposeExtensionField(field)) {
      throw new Error(`${location} contains unsupported field '${field}'`);
    }
  }
}

function validateComposeNestedFieldSet(
  value: unknown,
  allowed: ReadonlySet<string>,
  location: string,
  shape: "mapping" | "mapping-or-string" | "mapping-or-array" = "mapping",
): void {
  if (value === undefined) return;

  if (isUnknownRecord(value)) {
    validateComposeFieldSet(value, allowed, location);
    return;
  }

  const acceptsString = shape === "mapping-or-string";
  const acceptsArray = shape === "mapping-or-array";
  if (
    (acceptsString && typeof value === "string") ||
    (acceptsArray && Array.isArray(value))
  ) {
    return;
  }

  throw new Error(
    `${location} must be a mapping${
      acceptsString ? " or string" : acceptsArray ? " or array" : ""
    }`,
  );
}

function requireComposeArray(
  value: unknown,
  location: string,
): asserts value is unknown[] | undefined {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`${location} must be an array`);
  }
}

function requireComposeMapping(
  value: unknown,
  location: string,
): asserts value is Record<string, unknown> | undefined {
  if (value !== undefined && !isUnknownRecord(value)) {
    throw new Error(`${location} must be a mapping`);
  }
}

function requireComposeString(value: unknown, location: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${location} must be a string`);
  }
}

function requireComposeBoolean(value: unknown, location: string): void {
  if (
    value !== undefined &&
    typeof value !== "boolean" &&
    !(typeof value === "string" && /^(?:true|false)$/i.test(value.trim()))
  ) {
    throw new Error(`${location} must be a boolean`);
  }
}

function validateComposeServiceSecurityShapes(
  serviceName: string,
  service: Record<string, unknown>,
): void {
  for (const field of [
    "cap_add",
    "devices",
    "device_cgroup_rules",
    "external_links",
    "security_opt",
    "volumes",
    "volumes_from",
  ]) {
    requireComposeArray(
      service[field],
      `Compose service '${serviceName}' ${field}`,
    );
  }
  for (const field of ["blkio_config", "storage_opt"]) {
    requireComposeMapping(
      service[field],
      `Compose service '${serviceName}' ${field}`,
    );
  }
  requireComposeArrayOrMappingOrString(
    service.extra_hosts,
    `Compose service '${serviceName}' extra_hosts`,
  );
  requireComposeArrayOrMapping(
    service.sysctls,
    `Compose service '${serviceName}' sysctls`,
  );
  requireComposeBoolean(
    service.privileged,
    `Compose service '${serviceName}' privileged`,
  );
  for (const field of [
    "cgroup",
    "cgroup_parent",
    "cgroupns",
    "ipc",
    "network_mode",
    "pid",
    "userns_mode",
    "uts",
  ]) {
    requireComposeString(
      service[field],
      `Compose service '${serviceName}' ${field}`,
    );
  }
}

function requireComposeArrayOrMapping(value: unknown, location: string): void {
  if (value !== undefined && !Array.isArray(value) && !isUnknownRecord(value)) {
    throw new Error(`${location} must be a mapping or array`);
  }
}

function requireComposeArrayOrMappingOrString(
  value: unknown,
  location: string,
): void {
  if (
    value !== undefined &&
    !Array.isArray(value) &&
    !isUnknownRecord(value) &&
    typeof value !== "string"
  ) {
    throw new Error(`${location} must be a mapping, array, or string`);
  }
}

function validateComposeShape(parsed: Record<string, unknown>): void {
  validateComposeFieldSet(parsed, COMPOSE_TOP_LEVEL_FIELDS, "Compose document");

  if (parsed.services !== undefined && !isUnknownRecord(parsed.services)) {
    throw new Error("Compose services must be a mapping");
  }
  if (isUnknownRecord(parsed.services)) {
    for (const [serviceName, rawService] of Object.entries(parsed.services)) {
      if (!isUnknownRecord(rawService)) {
        throw new Error(`Compose service '${serviceName}' must be a mapping`);
      }
      validateComposeFieldSet(
        rawService,
        COMPOSE_SERVICE_FIELDS,
        `Compose service '${serviceName}'`,
      );
      validateComposeServiceSecurityShapes(serviceName, rawService);
      validateComposeNestedFieldSet(
        rawService.build,
        COMPOSE_BUILD_FIELDS,
        `Compose service '${serviceName}' build`,
        "mapping-or-string",
      );
      validateComposeNestedFieldSet(
        rawService.deploy,
        COMPOSE_DEPLOY_FIELDS,
        `Compose service '${serviceName}' deploy`,
      );
      if (isUnknownRecord(rawService.deploy)) {
        validateComposeNestedFieldSet(
          rawService.deploy.resources,
          new Set(["limits", "reservations"]),
          `Compose service '${serviceName}' deploy.resources`,
        );
        if (isUnknownRecord(rawService.deploy.resources)) {
          validateComposeNestedFieldSet(
            rawService.deploy.resources.limits,
            COMPOSE_RESOURCE_LIMIT_FIELDS,
            `Compose service '${serviceName}' deploy.resources.limits`,
          );
          validateComposeNestedFieldSet(
            rawService.deploy.resources.reservations,
            COMPOSE_RESOURCE_RESERVATION_FIELDS,
            `Compose service '${serviceName}' deploy.resources.reservations`,
          );
        }
        validateComposeNestedFieldSet(
          rawService.deploy.restart_policy,
          COMPOSE_RESTART_FIELDS,
          `Compose service '${serviceName}' deploy.restart_policy`,
        );
        validateComposeNestedFieldSet(
          rawService.deploy.placement,
          COMPOSE_PLACEMENT_FIELDS,
          `Compose service '${serviceName}' deploy.placement`,
        );
        validateComposeNestedFieldSet(
          rawService.deploy.update_config,
          COMPOSE_UPDATE_FIELDS,
          `Compose service '${serviceName}' deploy.update_config`,
        );
        validateComposeNestedFieldSet(
          rawService.deploy.rollback_config,
          COMPOSE_UPDATE_FIELDS,
          `Compose service '${serviceName}' deploy.rollback_config`,
        );
      }
      validateComposeNestedFieldSet(
        rawService.healthcheck,
        new Set([
          "disable",
          "interval",
          "retries",
          "start_period",
          "test",
          "timeout",
        ]),
        `Compose service '${serviceName}' healthcheck`,
        "mapping-or-array",
      );
      validateComposeNestedFieldSet(
        rawService.logging,
        new Set(["driver", "options"]),
        `Compose service '${serviceName}' logging`,
      );
    }
  }

  for (const [kind, allowed] of [
    ["networks", COMPOSE_NETWORK_FIELDS],
    ["volumes", COMPOSE_VOLUME_FIELDS],
    ["configs", COMPOSE_FILE_RESOURCE_FIELDS],
    ["secrets", COMPOSE_FILE_RESOURCE_FIELDS],
  ] as const) {
    const definitions = parsed[kind];
    if (definitions !== undefined && !isUnknownRecord(definitions)) {
      throw new Error(`Compose ${kind} must be a mapping`);
    }
    if (!isUnknownRecord(definitions)) continue;
    for (const [name, definition] of Object.entries(definitions)) {
      if (isUnknownRecord(definition)) {
        validateComposeFieldSet(
          definition,
          allowed,
          `Compose ${kind.slice(0, -1)} '${name}'`,
        );
        if (kind === "networks") {
          validateComposeNestedFieldSet(
            definition.ipam,
            new Set(["config", "driver", "options"]),
            `Compose network '${name}' ipam`,
          );
        }
      }
    }
  }
}

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
  return ["host", "container:host", "service:host"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function isSharedContainerNamespace(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    isHostNamespace(value) ||
    normalized.startsWith("container:") ||
    normalized.startsWith("service:")
  );
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

function isHostGatewayExtraHost(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  const separator = normalized.search(/[:=]/);
  if (separator === -1) {
    return (
      normalized === "host.docker.internal" ||
      normalized === "gateway.docker.internal"
    );
  }
  const host = normalized.slice(0, separator).trim();
  const address = normalized.slice(separator + 1).trim();
  return (
    host === "host.docker.internal" ||
    host === "gateway.docker.internal" ||
    address === "host-gateway"
  );
}

function validateComposeExtraHosts(
  serviceName: string,
  extraHosts: unknown,
): void {
  const entries: unknown[] = [];
  if (Array.isArray(extraHosts)) entries.push(...extraHosts);
  else if (isUnknownRecord(extraHosts)) {
    for (const [host, address] of Object.entries(extraHosts)) {
      entries.push(`${host}=${String(address)}`);
    }
  } else if (typeof extraHosts === "string") {
    entries.push(extraHosts);
  }

  if (entries.some(isHostGatewayExtraHost)) {
    throw new Error(
      `Compose service '${serviceName}' requests host-gateway access through extra_hosts, which is not allowed`,
    );
  }
}

function isRemoteBuildContext(value: string): boolean {
  return REMOTE_BUILD_CONTEXT_PATTERN.test(value.trim());
}

function validateComposeBuildContext(
  value: string,
  resourceKind: string,
  resourceName: string,
): void {
  if (isRemoteBuildContext(value)) {
    throw new Error(
      `Compose ${resourceKind} '${resourceName}' cannot use a remote build context`,
    );
  }
  validateComposeScopedPath(value, resourceKind, resourceName);
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

function isSensitiveComposeBuildArgument(name: string): boolean {
  const normalized = name.trim().toLowerCase().replaceAll("-", "_");
  return SENSITIVE_BUILD_ARGUMENT_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

function validateComposeBuildArguments(
  serviceName: string,
  args: unknown,
): void {
  const names: string[] = [];
  if (isUnknownRecord(args)) {
    names.push(...Object.keys(args));
  } else if (Array.isArray(args)) {
    for (const entry of args) {
      if (typeof entry !== "string") {
        throw new Error(
          `Compose service '${serviceName}' has an invalid build argument`,
        );
      }
      const separator = entry.indexOf("=");
      if (separator === -1 || entry.slice(separator + 1).includes("$")) {
        throw new Error(
          `Compose service '${serviceName}' build arguments must use literal values`,
        );
      }
      names.push(entry.slice(0, separator).trim());
    }
  } else {
    throw new Error(
      `Compose service '${serviceName}' has invalid build arguments`,
    );
  }

  if (names.length > 64) {
    throw new Error(
      `Compose service '${serviceName}' has too many build arguments`,
    );
  }
  for (const name of names) {
    if (!COMPOSE_BUILD_ARGUMENT_NAME_PATTERN.test(name)) {
      throw new Error(
        `Compose service '${serviceName}' has an invalid build argument name`,
      );
    }
    // Docker records ARG values in image metadata/history; never accept a
    // secret-like name through a path intended for public build data.
    if (isSensitiveComposeBuildArgument(name)) {
      throw new Error(
        `Compose service '${serviceName}' uses secret-like build argument '${name}', which is not allowed`,
      );
    }
  }

  if (isUnknownRecord(args)) {
    for (const [name, value] of Object.entries(args)) {
      if (
        value === null ||
        (typeof value === "object" && !Array.isArray(value)) ||
        Array.isArray(value) ||
        (typeof value === "string" && value.includes("$"))
      ) {
        throw new Error(
          `Compose service '${serviceName}' build argument '${name}' must use a literal value`,
        );
      }
    }
  }
}

function validateComposeBuild(serviceName: string, build: unknown): void {
  if (typeof build === "string") {
    validateComposeBuildContext(build, "service build context", serviceName);
    return;
  }
  if (!isUnknownRecord(build)) return;

  if (typeof build.context === "string") {
    validateComposeBuildContext(
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
  if (build.args !== undefined) {
    validateComposeBuildArguments(serviceName, build.args);
  }
  if (build.ssh !== undefined) {
    throw new Error(
      `Compose service '${serviceName}' requests SSH agent forwarding during build, which is not allowed`,
    );
  }
  if (build.secrets !== undefined) {
    throw new Error(
      `Compose service '${serviceName}' requests build secrets, which are not allowed; use Upstand-managed build secrets instead`,
    );
  }
  if (build.cache_from !== undefined || build.cache_to !== undefined) {
    throw new Error(
      `Compose service '${serviceName}' configures an external build cache, which is not allowed`,
    );
  }
  if (
    typeof build.network === "string" &&
    build.network.trim().toLowerCase() === "host"
  ) {
    throw new Error(
      `Compose service '${serviceName}' requests host networking during build, which is not allowed`,
    );
  }
  if (Array.isArray(build.entitlements) && build.entitlements.length > 0) {
    throw new Error(
      `Compose service '${serviceName}' requests build entitlements, which is not allowed`,
    );
  }
  if (isUnknownRecord(build.additional_contexts)) {
    for (const [contextName, rawContext] of Object.entries(
      build.additional_contexts,
    )) {
      if (typeof rawContext === "string") {
        validateComposeBuildContext(
          rawContext,
          `service build context '${contextName}'`,
          serviceName,
        );
      }
    }
  } else if (Array.isArray(build.additional_contexts)) {
    for (const rawContext of build.additional_contexts) {
      if (typeof rawContext !== "string") continue;
      const separator = rawContext.indexOf("=");
      const context =
        separator === -1 ? rawContext : rawContext.slice(separator + 1);
      validateComposeBuildContext(
        context,
        "service additional build context",
        serviceName,
      );
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

function validateComposeDeploySecurity(
  serviceName: string,
  deploy: unknown,
): void {
  if (!isUnknownRecord(deploy)) return;

  if (deploy.privileged === true || deploy.privileged === "true") {
    throw new Error(
      `Compose service '${serviceName}' requests privileged deployment mode, which is not allowed`,
    );
  }

  for (const field of [
    "cap_add",
    "devices",
    "device_cgroup_rules",
    "security_opt",
    "sysctls",
  ]) {
    const value = deploy[field];
    if (
      (Array.isArray(value) && value.length > 0) ||
      (isUnknownRecord(value) && Object.keys(value).length > 0)
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests unsafe deploy.${field}, which is not allowed`,
      );
    }
  }

  const resources = isUnknownRecord(deploy.resources)
    ? deploy.resources
    : undefined;
  const reservations =
    resources && isUnknownRecord(resources.reservations)
      ? resources.reservations
      : undefined;
  if (reservations?.devices !== undefined) {
    throw new Error(
      `Compose service '${serviceName}' requests reserved host devices, which is not allowed`,
    );
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
      if (isUnsafeComposePath(value)) {
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
  if (
    new TextEncoder().encode(rawCompose).byteLength > COMPOSE_DOCUMENT_MAX_BYTES
  ) {
    throw new Error("Compose files must not exceed 1 MB when encoded as UTF-8");
  }
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

  validateComposeShape(parsed);

  if (!isUnknownRecord(parsed.services)) return;

  for (const [serviceName, rawService] of Object.entries(parsed.services)) {
    if (!isUnknownRecord(rawService)) continue;
    const service = rawService;

    if (service.build !== undefined) {
      validateComposeBuild(serviceName, service.build);
    }
    if (service.runtime !== undefined) {
      throw new Error(
        `Compose service '${serviceName}' requests a custom container runtime, which is not allowed`,
      );
    }
    if (service.gpus !== undefined) {
      throw new Error(
        `Compose service '${serviceName}' requests host GPU devices, which is not allowed`,
      );
    }
    if (
      (Array.isArray(service.device_cgroup_rules) &&
        service.device_cgroup_rules.length > 0) ||
      (Array.isArray(service.devices) && service.devices.length > 0)
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests host devices, which is not allowed`,
      );
    }
    if (service.env_file !== undefined) {
      validateComposeEnvFile(serviceName, service.env_file);
    }
    if (service.extra_hosts !== undefined) {
      validateComposeExtraHosts(serviceName, service.extra_hosts);
    }
    validateComposeDeploySecurity(serviceName, service.deploy);
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

    if (
      service.privileged === true ||
      String(service.privileged ?? "")
        .trim()
        .toLowerCase() === "true"
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests privileged mode, which is not allowed`,
      );
    }
    if (
      isSharedContainerNamespace(service.network_mode) ||
      isSharedContainerNamespace(service.pid) ||
      isSharedContainerNamespace(service.ipc) ||
      isSharedContainerNamespace(service.uts) ||
      isSharedContainerNamespace(service.userns_mode) ||
      isSharedContainerNamespace(service.cgroup) ||
      isSharedContainerNamespace(service.cgroupns)
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests shared or host-level namespace access, which is not allowed`,
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
    if (
      (Array.isArray(service.volumes_from) &&
        service.volumes_from.length > 0) ||
      (typeof service.volumes_from === "string" && service.volumes_from.trim())
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests volumes_from, which is not allowed for isolated deployments`,
      );
    }
    if (
      (Array.isArray(service.external_links) &&
        service.external_links.length > 0) ||
      (typeof service.external_links === "string" &&
        service.external_links.trim())
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests external_links, which is not allowed for isolated deployments`,
      );
    }
    if (Array.isArray(service.security_opt)) {
      const unsafeSecurityOption = service.security_opt.find(
        (option) =>
          typeof option === "string" &&
          (/=(?:unconfined|false)$/i.test(option) ||
            /^(?:apparmor|seccomp)=unconfined$/i.test(option) ||
            /^(?:label=disable|systempaths=unconfined)$/i.test(option)),
      );
      if (unsafeSecurityOption) {
        throw new Error(
          `Compose service '${serviceName}' requests unsafe security option '${unsafeSecurityOption}'`,
        );
      }
    }
    if (
      (isUnknownRecord(service.sysctls) &&
        Object.keys(service.sysctls).length > 0) ||
      (Array.isArray(service.sysctls) && service.sysctls.length > 0)
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests service sysctls, which is not allowed`,
      );
    }
    if (
      (typeof service.cgroup_parent === "string" &&
        service.cgroup_parent.trim() !== "") ||
      (isUnknownRecord(service.storage_opt) &&
        Object.keys(service.storage_opt).length > 0) ||
      (isUnknownRecord(service.blkio_config) &&
        Object.keys(service.blkio_config).length > 0)
    ) {
      throw new Error(
        `Compose service '${serviceName}' requests host resource controls, which is not allowed`,
      );
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
