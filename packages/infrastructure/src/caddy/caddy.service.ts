import { Readable } from "node:stream";
import type { DomainMapping } from "@upstand/domain";
import {
  parseCaddyMiddlewares,
  parseDomainMappings,
  parseResourceAdvancedConfig,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import type {
  CaddyCertificate,
  CaddyResource,
  CaddySettings,
  CaddyStatus,
} from "@upstand/usecases/ports/caddy";
import {
  ensureResourceOverlayNetwork,
  ensureUpstandOverlayNetwork,
  requireActiveManager,
} from "@upstand/usecases/swarm/swarm.helpers";
import type Docker from "dockerode";
import { log } from "evlog";
import { getDockerInstance } from "../docker/docker-client";

const CADDY_CONTAINER_NAME = "upstand-caddy";
const CADDY_IMAGE = "caddy:2.8-alpine";
const CADDYFILE_PATH = "/etc/caddy/Caddyfile";
const CADDYFILE_CANDIDATE_PATH = "/etc/caddy/Caddyfile.next";
const CADDYFILE_BACKUP_PATH = "/etc/caddy/Caddyfile.previous";
const CADDY_RUNTIME_VOLUME = "upstand-caddy-runtime";
const CADDY_DATA_VOLUME = "upstand-caddy-data";
const CADDY_CONFIG_VOLUME = "upstand-caddy-config";
const CADDY_LOG_VOLUME = "upstand-caddy-logs";
export const CADDY_ACCESS_LOG_PATH = "/var/log/caddy/access.log";
const CONTROL_PLANE_PORTS_LABEL = "com.upstand.control-plane.ip-ports";

const CONTROL_PLANE_SERVICES = [
  { name: "upstand_server", targetPort: 3000 },
  { name: "upstand_web", targetPort: 3001 },
  { name: "upstand_fumadocs", targetPort: 4000 },
] as const;

type PublishedPort = {
  Protocol?: string;
  TargetPort?: number;
  PublishedPort?: number;
  PublishMode?: string;
};

function statusCodeOf(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  if (!("statusCode" in value)) return undefined;
  return typeof value.statusCode === "number" ? value.statusCode : undefined;
}

type CaddyRoute = DomainMapping & {
  resourceId: string;
  resourceName: string;
  upstream: string;
  upstreams?: string[];
  customCertificate?: CaddyCertificate;
};

type PortMapping = {
  targetPort: number;
  publishedPort: number;
  protocol: "tcp" | "udp";
};

function sanitizeServiceName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-");
}

function caddySettingsWithDefaults(settings: CaddySettings = {}) {
  const effectiveSettings = {
    letsEncryptEmail: settings.letsEncryptEmail ?? null,
    cloudflareApiToken: settings.cloudflareApiToken ?? null,
    httpPort: settings.httpPort ?? 80,
    httpsPort: settings.httpsPort ?? 443,
    enableHttp3: settings.enableHttp3 ?? true,
    globalCaddyfile: settings.globalCaddyfile ?? null,
    caddySnippets: settings.caddySnippets ?? "",
    caddyMiddlewares: settings.caddyMiddlewares ?? "[]",
    accessLogsEnabled: settings.accessLogsEnabled ?? false,
  };

  if (effectiveSettings.httpPort === effectiveSettings.httpsPort) {
    throw new Error("Caddy HTTP and HTTPS listener ports must be different");
  }
  if (
    [effectiveSettings.httpPort, effectiveSettings.httpsPort].includes(2019)
  ) {
    throw new Error(
      "Caddy HTTP and HTTPS listener ports cannot use the private admin API port 2019",
    );
  }

  return effectiveSettings;
}

function expectedCaddyPortBindings(effectiveSettings: {
  httpPort: number;
  httpsPort: number;
  enableHttp3: boolean;
}): Record<string, Array<{ HostPort: string }>> {
  const httpHostPort = "80";
  const httpsHostPort = "443";
  const bindings: Record<string, Array<{ HostPort: string }>> = {
    [`${effectiveSettings.httpPort}/tcp`]: [{ HostPort: httpHostPort }],
    [`${effectiveSettings.httpsPort}/tcp`]: [{ HostPort: httpsHostPort }],
  };
  if (effectiveSettings.enableHttp3) {
    bindings[`${effectiveSettings.httpsPort}/udp`] = [
      { HostPort: httpsHostPort },
    ];
  }
  return bindings;
}

function hasExpectedCaddyPortBindings(
  container: { HostConfig?: { PortBindings?: unknown } } | null,
  effectiveSettings: {
    httpPort: number;
    httpsPort: number;
    enableHttp3: boolean;
  },
): boolean {
  const rawBindings = container?.HostConfig?.PortBindings;
  if (!rawBindings || typeof rawBindings !== "object") return true;
  const bindings = rawBindings as Record<string, Array<{ HostPort?: string }>>;
  const expectedBindings = expectedCaddyPortBindings(effectiveSettings);
  const expected = Object.entries(expectedBindings).every(
    ([target, expected]) =>
      bindings[target]?.some(
        (binding) => binding.HostPort === expected[0]?.HostPort,
      ) ?? false,
  );
  if (!expected) return false;

  const managedTargets = [
    `${effectiveSettings.httpPort}/tcp`,
    `${effectiveSettings.httpsPort}/tcp`,
    `${effectiveSettings.httpsPort}/udp`,
  ];
  return managedTargets.every((target) =>
    target in expectedBindings ? target in bindings : !(target in bindings),
  );
}

function parseCaddyEnvironment(value?: string): string[] {
  if (!value) return [];

  let environment: unknown;
  try {
    environment = JSON.parse(value);
  } catch {
    throw new Error("Caddy environment variables must be valid JSON");
  }

  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new Error("Caddy environment variables must be a JSON object");
  }

  return Object.entries(environment).map(([key, rawValue]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid Caddy environment variable name: ${key}`);
    }
    if (["CADDY_ADMIN", "UPSTAND_CADDYFILE_B64"].includes(key)) {
      throw new Error(`${key} is managed by Upstand and cannot be overridden`);
    }
    if (typeof rawValue !== "string" && typeof rawValue !== "number") {
      throw new Error(
        `Caddy environment variable ${key} must be a string or number`,
      );
    }
    return `${key}=${rawValue}`;
  });
}

function validateManagedDirectives(value: string | null | undefined): void {
  if (!value) return;
  const forbidden = value.match(
    /^\s*(admin|http_port|https_port|import|storage|auto_https)\b/im,
  )?.[1];
  if (forbidden) {
    throw new Error(
      `The '${forbidden}' directive is managed by Upstand and cannot be included in custom Caddy configuration snippets`,
    );
  }
  if (/\bimport\s+["']?\//i.test(value)) {
    throw new Error(
      "File imports are forbidden in custom Caddy configuration snippets",
    );
  }
}

function parseExtraPortMappings(value?: string): PortMapping[] {
  if (!value) return [];

  let ports: unknown;
  try {
    ports = JSON.parse(value);
  } catch {
    throw new Error("Additional Caddy ports must be valid JSON");
  }

  if (!Array.isArray(ports)) {
    throw new Error("Additional Caddy ports must be a JSON array");
  }

  const seenPublishedPorts = new Set<string>();
  return ports.map((rawPort) => {
    if (!rawPort || typeof rawPort !== "object" || Array.isArray(rawPort)) {
      throw new Error("Each additional Caddy port must be an object");
    }

    const port = rawPort as Record<string, unknown>;
    const targetPort = Number(port.targetPort);
    const publishedPort = Number(port.publishedPort);
    const protocol = port.protocol === "udp" ? "udp" : "tcp";

    if (
      !Number.isInteger(targetPort) ||
      !Number.isInteger(publishedPort) ||
      targetPort < 1 ||
      targetPort > 65535 ||
      publishedPort < 1 ||
      publishedPort > 65535
    ) {
      throw new Error("Additional Caddy ports must be between 1 and 65535");
    }

    if ([80, 443, 2019].includes(publishedPort)) {
      throw new Error(
        `Port ${publishedPort} is reserved for Caddy's public listeners or private admin API`,
      );
    }

    const key = `${publishedPort}/${protocol}`;
    if (seenPublishedPorts.has(key)) {
      throw new Error(
        `Additional Caddy port ${key} is configured more than once`,
      );
    }
    seenPublishedPorts.add(key);

    return { targetPort, publishedPort, protocol };
  });
}

function createTarArchive(fileName: string, content: string): Readable {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  const writeOctal = (offset: number, size: number, value: number) => {
    const encoded = value.toString(8).padStart(size - 1, "0");
    header.write(`${encoded}\0`, offset, size, "ascii");
  };

  header.write(fileName, 0, 100, "utf8");
  writeOctal(100, 8, 0o644);
  writeOctal(108, 8, 0);
  writeOctal(116, 8, 0);
  writeOctal(124, 12, body.length);
  writeOctal(136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeOctal(148, 8, checksum);

  const padding = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Readable.from([header, body, padding, Buffer.alloc(1024, 0)]);
}

function getRoutes(
  resources: CaddyResource[],
  certificates: CaddyCertificate[] = [],
): CaddyRoute[] {
  const routes: CaddyRoute[] = [];
  const certificateById = new Map(
    certificates.map((certificate) => [certificate.id, certificate]),
  );
  const routeOwners = new Map<string, string>();
  const hostHttps = new Map<string, boolean>();
  const hostCertificate = new Map<string, string>();

  for (const resource of resources) {
    let mappings: DomainMapping[];
    try {
      mappings = parseDomainMappings(resource.domains);
    } catch (error) {
      throw new Error(
        `Resource ${resource.name} (${resource.id}) has invalid domain mappings: ${error instanceof Error ? error.message : "unknown validation error"}`,
      );
    }

    for (const mapping of mappings.filter((candidate) => candidate.enabled)) {
      const routeKey = `${mapping.host}${mapping.path}`;
      const owner = routeOwners.get(routeKey);
      if (owner) {
        throw new Error(
          `The route ${mapping.host}${mapping.path} is already assigned to ${owner}; a hostname and path can only be owned by one resource`,
        );
      }
      routeOwners.set(routeKey, resource.name);

      const httpsEnabled = hostHttps.get(mapping.host);
      if (httpsEnabled !== undefined && httpsEnabled !== mapping.https) {
        throw new Error(
          `All routes for ${mapping.host} must use the same HTTPS setting`,
        );
      }
      hostHttps.set(mapping.host, mapping.https);

      const certificateType = hostCertificate.get(mapping.host);
      const certificateKey = `${mapping.certificateType}:${mapping.certificateId ?? ""}`;
      if (certificateType !== undefined && certificateType !== certificateKey) {
        throw new Error(
          `All HTTPS routes for ${mapping.host} must use the same certificate strategy`,
        );
      }
      hostCertificate.set(mapping.host, certificateKey);

      const customCertificate =
        mapping.certificateType === "custom"
          ? certificateById.get(mapping.certificateId ?? "")
          : undefined;
      if (mapping.certificateType === "custom" && !customCertificate) {
        throw new Error(
          `Custom certificate '${mapping.certificateId ?? ""}' for ${mapping.host} was not found`,
        );
      }

      if (resource.type === "compose" && !mapping.serviceName) {
        throw new Error(
          `Domain ${mapping.host}${mapping.path} on compose resource ${resource.name} needs an explicit service name`,
        );
      }

      const serviceName =
        mapping.serviceName ||
        sanitizeServiceName(resource.appName || resource.name);
      const upstreamServiceName =
        resource.type === "compose" &&
        resource.composeType !== "compose" &&
        mapping.serviceName
          ? `${sanitizeServiceName(resource.appName || resource.name)}_${sanitizeServiceName(mapping.serviceName)}`
          : serviceName;
      const trafficSplits = parseResourceAdvancedConfig(
        resource.advancedConfig,
      ).trafficSplits;
      const upstreams =
        trafficSplits.length > 0
          ? trafficSplits.flatMap((split) =>
              Array.from(
                { length: split.weight },
                () =>
                  `${sanitizeServiceName(split.serviceName)}:${mapping.port}`,
              ),
            )
          : undefined;
      routes.push({
        ...mapping,
        resourceId: resource.id,
        resourceName: resource.name,
        upstream: `${upstreamServiceName}:${mapping.port}`,
        upstreams,
        customCertificate,
      });
    }
  }

  return routes;
}

function routeBlock(route: CaddyRoute, index: number): string[] {
  const matcher = `@upstand_route_${index}`;
  const isRoot = route.path === "/";
  const lines = isRoot
    ? ["\thandle {"]
    : [
        `\t${matcher} path ${route.path} ${route.path}/*`,
        `\thandle ${matcher} {`,
      ];

  lines.push("\t\troute {");
  for (const middleware of route.middlewares) {
    lines.push(`\t\t\timport ${middleware}`);
  }

  if (route.forwardAuth) {
    lines.push(
      `\t\t\tforward_auth ${JSON.stringify(route.forwardAuth.address)} {`,
    );
    lines.push(`\t\t\t\turi ${JSON.stringify(route.forwardAuth.uri)}`);
    for (const header of route.forwardAuth.copyHeaders) {
      lines.push(`\t\t\t\tcopy_headers ${header}`);
    }
    lines.push("\t\t\t}");
  }
  if (route.basicAuth) {
    lines.push("\t\t\tbasic_auth {");
    lines.push(
      `\t\t\t\t${route.basicAuth.username} ${route.basicAuth.passwordHash}`,
    );
    lines.push("\t\t\t}");
  }

  const securityHeaders = route.securityHeaders ?? {
    hsts: false,
    nosniff: false,
    frameDeny: false,
    referrerPolicy: null,
  };
  if (
    securityHeaders.hsts ||
    securityHeaders.nosniff ||
    securityHeaders.frameDeny ||
    securityHeaders.referrerPolicy
  ) {
    lines.push("\t\t\theader {");
    if (securityHeaders.hsts && route.https) {
      lines.push(
        '\t\t\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains"',
      );
    }
    if (securityHeaders.nosniff) {
      lines.push('\t\t\t\tX-Content-Type-Options "nosniff"');
    }
    if (securityHeaders.frameDeny) {
      lines.push('\t\t\t\tX-Frame-Options "DENY"');
    }
    if (securityHeaders.referrerPolicy) {
      lines.push(`\t\t\t\tReferrer-Policy "${securityHeaders.referrerPolicy}"`);
    }
    lines.push("\t\t\t}");
  }

  if (route.redirectTo) {
    lines.push(
      `\t\t\tredir ${JSON.stringify(route.redirectTo)} ${route.redirectStatus ?? "302"}`,
    );
    lines.push("\t\t}");
    lines.push("\t}");
    return lines;
  }

  if (route.stripPath && !isRoot) {
    lines.push(`\t\t\turi strip_prefix ${route.path}`);
    if (route.internalPath !== "/") {
      lines.push(`\t\t\trewrite ${route.internalPath}{uri}`);
    }
  } else if (!isRoot && route.internalPath !== route.path) {
    lines.push(`\t\t\turi replace ${route.path} ${route.internalPath}`);
  } else if (isRoot && route.internalPath !== "/") {
    lines.push(`\t\t\trewrite ${route.internalPath}{uri}`);
  }

  if (route.upstreams?.length) {
    lines.push("\t\t\treverse_proxy {");
    lines.push(`\t\t\tto ${route.upstreams.join(" ")}`);
    lines.push("\t\t\tlb_policy random");
  } else {
    lines.push(`\t\t\treverse_proxy ${route.upstream} {`);
  }
  // Swarm tasks can briefly disappear during a rolling update. Retry the
  // upstream while Docker's service DNS converges instead of returning an
  // avoidable 502 to the browser.
  lines.push("\t\t\tlb_try_duration 30s");
  lines.push("\t\t\tlb_try_interval 250ms");
  lines.push("\t\t}");
  lines.push("\t\t}");
  lines.push("\t}");
  return lines;
}

export function generateCaddyfileContent(
  settings: CaddySettings = {},
  resources: CaddyResource[] = [],
  certificates: CaddyCertificate[] = [],
): string {
  const effectiveSettings = caddySettingsWithDefaults(settings);
  validateManagedDirectives(effectiveSettings.globalCaddyfile);
  validateManagedDirectives(effectiveSettings.caddySnippets);
  for (const middleware of parseCaddyMiddlewares(
    effectiveSettings.caddyMiddlewares,
  )) {
    validateManagedDirectives(middleware.body);
  }
  const routes = getRoutes(resources, certificates);
  const groupedRoutes = new Map<string, CaddyRoute[]>();

  for (const route of routes) {
    const key = `${route.https ? "https" : "http"}:${route.host}`;
    const group = groupedRoutes.get(key) || [];
    group.push(route);
    groupedRoutes.set(key, group);
  }

  const globalOptions = [
    effectiveSettings.letsEncryptEmail
      ? `\temail ${effectiveSettings.letsEncryptEmail}`
      : "",
    effectiveSettings.httpPort !== 80
      ? `\thttp_port ${effectiveSettings.httpPort}`
      : "",
    effectiveSettings.httpsPort !== 443
      ? `\thttps_port ${effectiveSettings.httpsPort}`
      : "",
    effectiveSettings.globalCaddyfile?.trim() || "",
  ]
    .filter(Boolean)
    .join("\n");

  const sites: string[] = [];
  const managedMiddlewares = parseCaddyMiddlewares(
    effectiveSettings.caddyMiddlewares,
  )
    .map((middleware) => `(${middleware.name}) {\n${middleware.body}\n}`)
    .join("\n\n");
  for (const [key, routesForHost] of groupedRoutes) {
    const [protocol, host] = key.split(":", 2);
    const address = protocol === "https" ? host : `http://${host}`;
    const orderedRoutes = routesForHost.toSorted(
      (a, b) => b.path.length - a.path.length,
    );

    sites.push(`# upstand-domain ${host}`);
    sites.push(`${address} {`);
    sites.push("\tencode zstd gzip");
    if (effectiveSettings.accessLogsEnabled) {
      sites.push("\tlog {");
      sites.push(`\t\toutput file ${CADDY_ACCESS_LOG_PATH} {`);
      sites.push("\t\t\troll_size 100MiB");
      sites.push("\t\t\troll_keep 7");
      sites.push("\t\t}");
      sites.push("\t\tformat json");
      sites.push("\t}");
    }
    const certificateType = routesForHost[0]?.certificateType;
    if (protocol === "https" && certificateType === "internal") {
      sites.push("\ttls internal");
    } else if (protocol === "https" && certificateType === "zerossl") {
      const email = effectiveSettings.letsEncryptEmail?.trim();
      if (email) {
        sites.push(`\ttls ${email} {`);
        sites.push("\t\tca https://acme.zerossl.com/v2/DV90");
        sites.push("\t}");
      } else {
        sites.push("\ttls {");
        sites.push("\t\tca https://acme.zerossl.com/v2/DV90");
        sites.push("\t}");
      }
    } else if (protocol === "https" && certificateType === "cloudflare") {
      const token = effectiveSettings.cloudflareApiToken
        ? effectiveSettings.cloudflareApiToken
        : "{env.CLOUDFLARE_API_TOKEN}";
      sites.push("\ttls {");
      sites.push(`\t\tdns cloudflare ${token}`);
      sites.push("\t}");
    } else if (protocol === "https" && certificateType === "custom") {
      const certificate = routesForHost[0]?.customCertificate;
      if (!certificate) {
        throw new Error(`Custom certificate for ${host} is not available`);
      }
      sites.push(
        `\ttls /etc/caddy/certificates/${certificate.id}.crt /etc/caddy/certificates/${certificate.id}.key`,
      );
    } else if (protocol === "https") {
      const email = effectiveSettings.letsEncryptEmail?.trim();
      if (email) {
        sites.push(`\ttls ${email}`);
      }
    }
    orderedRoutes.forEach((route, index) => {
      sites.push(`# Resource: ${route.resourceName} (${route.resourceId})`);
      sites.push(...routeBlock(route, index));
    });
    if (!orderedRoutes.some((route) => route.path === "/")) {
      sites.push("\thandle {");
      sites.push('\t\trespond "Not found" 404');
      sites.push("\t}");
    }
    sites.push("}", "");
  }

  return [
    "{",
    globalOptions,
    "}",
    "",
    effectiveSettings.caddySnippets.trim(),
    managedMiddlewares,
    "",
    "# Managed by Upstand. Do not edit this file directly.",
    "",
    ...sites,
  ]
    .filter(
      (line, index, lines) =>
        line || index === 0 || index === 2 || lines[index - 1] !== "",
    )
    .join("\n")
    .trimEnd()
    .concat("\n");
}

export class CaddyService {
  // Caddy configuration is file-backed. Remote operations construct a fresh
  // service instance, so an instance lock cannot prevent concurrent writers.
  // The control plane is the single configuration authority; serialize every
  // mutation process-wide to retain the last complete, validated configuration.
  private static configurationTail: Promise<void> = Promise.resolve();
  private readonly docker: Docker;
  private readonly networkName = env.DOCKER_NETWORK;

  constructor(docker: Docker = getDockerInstance()) {
    this.docker = docker;
  }

  private async serializeConfiguration<T>(work: () => Promise<T>): Promise<T> {
    const previous = CaddyService.configurationTail;
    let release: () => void = () => undefined;
    CaddyService.configurationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async initializeSwarm(): Promise<void> {
    await requireActiveManager(this.docker);
  }

  private async ensureNetwork(): Promise<void> {
    await this.initializeSwarm();
    await ensureUpstandOverlayNetwork(this.docker);
  }

  async setControlPlaneIpAccess(enabled: boolean): Promise<void> {
    await this.serializeConfiguration(async () => {
      await this.initializeSwarm();

      for (const serviceConfig of CONTROL_PLANE_SERVICES) {
        const service = this.docker.getService(serviceConfig.name);
        let inspect: Docker.Service;
        try {
          inspect = await service.inspect();
        } catch (error: unknown) {
          if (statusCodeOf(error) === 404) {
            log.warn({
              message: `Control-plane service '${serviceConfig.name}' is not deployed yet; skipping IP access update.`,
            });
            continue;
          }
          throw error;
        }

        if (!inspect.Spec) continue;
        const serviceSpec = inspect.Spec;
        const endpointSpec = {
          ...(serviceSpec.EndpointSpec ?? {}),
        } as {
          Ports?: PublishedPort[];
          [key: string]: unknown;
        };
        const labels = { ...(serviceSpec.Labels ?? {}) };
        const currentPorts = endpointSpec.Ports ?? [];

        if (enabled) {
          if (currentPorts.length > 0) continue;

          let savedPorts: PublishedPort[] | undefined;
          try {
            const parsed = JSON.parse(labels[CONTROL_PLANE_PORTS_LABEL] ?? "");
            if (Array.isArray(parsed)) {
              savedPorts = parsed.filter(
                (port): port is PublishedPort =>
                  Boolean(port) &&
                  typeof port === "object" &&
                  typeof port.TargetPort === "number" &&
                  typeof port.PublishedPort === "number",
              );
            }
          } catch {
            savedPorts = undefined;
          }

          endpointSpec.Ports =
            savedPorts && savedPorts.length > 0
              ? savedPorts
              : [
                  {
                    Protocol: "tcp",
                    TargetPort: serviceConfig.targetPort,
                    PublishedPort: serviceConfig.targetPort,
                    PublishMode: "host",
                  },
                ];
        } else {
          if (currentPorts.length === 0) continue;
          labels[CONTROL_PLANE_PORTS_LABEL] = JSON.stringify(currentPorts);
          delete endpointSpec.Ports;
        }

        await service.update({
          version: inspect.Version?.Index,
          Name: serviceSpec.Name ?? serviceConfig.name,
          Labels: labels,
          Mode: serviceSpec.Mode,
          TaskTemplate: serviceSpec.TaskTemplate,
          EndpointSpec: endpointSpec,
          UpdateConfig: serviceSpec.UpdateConfig,
          RollbackConfig: serviceSpec.RollbackConfig,
        });
      }
    });
  }

  private async reconcileResourceNetworks(
    resources: CaddyResource[],
    certificates: CaddyCertificate[] = [],
  ): Promise<Set<string>> {
    const routes = getRoutes(resources, certificates);
    if (routes.length === 0) return new Set();

    const sharedNetwork = await ensureUpstandOverlayNetwork(this.docker);
    const resourcesById = new Map(
      resources.map((resource) => [resource.id, resource]),
    );
    const networksByResource = new Map<string, { id: string; name: string }>();
    const desiredNetworkNames = new Set<string>();

    for (const route of routes) {
      const resource = resourcesById.get(route.resourceId);
      if (!resource) continue;

      let network = networksByResource.get(resource.id);
      if (!network) {
        const isolated = parseResourceAdvancedConfig(
          resource.advancedConfig,
        ).isolatedDeployment;
        network = isolated
          ? await ensureResourceOverlayNetwork(this.docker, resource.id)
          : { id: sharedNetwork.id, name: this.networkName };
        networksByResource.set(resource.id, network);
        desiredNetworkNames.add(network.name);

        try {
          await this.docker.getNetwork(network.name).connect({
            Container: CADDY_CONTAINER_NAME,
          });
        } catch (error: unknown) {
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? error.statusCode
              : undefined;
          if (statusCode !== 403 && statusCode !== 409) throw error;
        }
      }

      const serviceName = route.upstream.slice(
        0,
        route.upstream.lastIndexOf(":"),
      );
      const service = this.docker.getService(serviceName);
      let inspect: Docker.Service;
      try {
        inspect = await service.inspect();
      } catch (error: unknown) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;
        if (statusCode === 404) {
          log.warn({
            message: `Caddy upstream service '${serviceName}' does not exist yet.`,
          });
          continue;
        }
        throw error;
      }

      const serviceSpec = inspect.Spec;
      if (!serviceSpec) continue;
      const networks =
        serviceSpec.TaskTemplate?.Networks || serviceSpec.Networks || [];
      if (
        networks.some(
          (entry: { Target?: string }) => entry.Target === network.id,
        )
      ) {
        continue;
      }

      log.warn({
        message: `Repairing Caddy upstream service '${serviceName}' network attachment.`,
        networkId: network.id,
      });
      await service.update({
        version: inspect.Version?.Index,
        Name: serviceName,
        Mode: serviceSpec.Mode,
        TaskTemplate: {
          ...serviceSpec.TaskTemplate,
          Networks: [...networks, { Target: network.id }],
        },
        EndpointSpec: serviceSpec.EndpointSpec,
        UpdateConfig: serviceSpec.UpdateConfig,
        RollbackConfig: serviceSpec.RollbackConfig,
      });
    }

    return desiredNetworkNames;
  }

  private async detachStaleResourceNetworks(
    desiredNetworkNames: Set<string>,
  ): Promise<void> {
    const managedNetworks = await this.docker.listNetworks({
      filters: JSON.stringify({
        label: ["com.upstand.purpose=resource-isolation"],
      }),
    });

    for (const network of managedNetworks) {
      if (!network.Name || desiredNetworkNames.has(network.Name)) continue;
      try {
        await this.docker.getNetwork(network.Id).disconnect({
          Container: CADDY_CONTAINER_NAME,
          Force: true,
        });
        log.info({
          message: `Detached Caddy from stale resource network '${network.Name}'.`,
        });
      } catch (error: unknown) {
        const statusCode = statusCodeOf(error);
        if (statusCode !== 404 && statusCode !== 409) {
          log.warn({
            message: `Unable to detach Caddy from stale resource network '${network.Name}'.`,
            err: error,
          });
        }
      }
    }
  }

  private async ensureVolume(name: string): Promise<void> {
    const volumes = await this.docker.listVolumes();
    if (volumes.Volumes?.some((volume) => volume.Name === name)) return;
    await this.docker.createVolume({ Name: name });
  }

  private async ensureImage(): Promise<void> {
    const images = await this.docker.listImages();
    const hasImage = images.some((image) =>
      image.RepoTags?.some(
        (tag) =>
          tag === CADDY_IMAGE ||
          tag === `docker.io/library/${CADDY_IMAGE}` ||
          tag.endsWith(`/${CADDY_IMAGE}`),
      ),
    );
    if (hasImage) {
      return;
    }

    log.info({ message: `Pulling ${CADDY_IMAGE} image...` });
    const stream = await this.docker.pull(CADDY_IMAGE);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  private async findContainer() {
    const container = this.docker.getContainer(CADDY_CONTAINER_NAME);
    try {
      await container.inspect();
      return container;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async initializeCaddy(
    settings: CaddySettings = {},
    forceRecreate = false,
  ): Promise<void> {
    await this.serializeConfiguration(async () => {
      await this.ensureNetwork();
      await Promise.all([
        this.ensureVolume(CADDY_RUNTIME_VOLUME),
        this.ensureVolume(CADDY_DATA_VOLUME),
        this.ensureVolume(CADDY_CONFIG_VOLUME),
        this.ensureVolume(CADDY_LOG_VOLUME),
      ]);
      await this.ensureImage();

      let container = await this.findContainer();
      const existingContainer = container ? await container.inspect() : null;
      const effectiveSettings = caddySettingsWithDefaults(settings);
      const hasManagedVolumes = [
        ["/etc/caddy", CADDY_RUNTIME_VOLUME],
        ["/data", CADDY_DATA_VOLUME],
        ["/config", CADDY_CONFIG_VOLUME],
        ["/var/log/caddy", CADDY_LOG_VOLUME],
      ].every(([destination, volume]) =>
        existingContainer?.Mounts?.some(
          (mount) =>
            mount.Destination === destination &&
            mount.Type === "volume" &&
            mount.Name === volume,
        ),
      );
      const shouldRecreate =
        forceRecreate ||
        (container && !hasManagedVolumes) ||
        (container &&
          !hasExpectedCaddyPortBindings(existingContainer, effectiveSettings));

      if (container && shouldRecreate) {
        if (existingContainer?.State.Running) await container.stop();
        await container.remove();
        container = null;
      }

      if (container) {
        const details = await container.inspect();
        if (!details.State.Running) await container.start();
        try {
          await this.docker.getNetwork(this.networkName).connect({
            Container: container.id,
          });
        } catch (error: unknown) {
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? error.statusCode
              : undefined;
          if (statusCode !== 403 && statusCode !== 409) throw error;
        }
        return;
      }

      const extraPorts = parseExtraPortMappings(settings.caddyPorts);
      const publicPorts = expectedCaddyPortBindings(effectiveSettings);
      const exposedPorts: Record<string, Record<string, never>> = {
        [`${effectiveSettings.httpPort}/tcp`]: {},
        [`${effectiveSettings.httpsPort}/tcp`]: {},
      };

      if (effectiveSettings.enableHttp3) {
        exposedPorts[`${effectiveSettings.httpsPort}/udp`] = {};
      }
      for (const port of extraPorts) {
        const key = `${port.targetPort}/${port.protocol}`;
        exposedPorts[key] = {};
        publicPorts[key] = [{ HostPort: String(port.publishedPort) }];
      }

      const bootstrapConfig = Buffer.from(
        generateCaddyfileContent(effectiveSettings),
      ).toString("base64");
      const env = [
        ...parseCaddyEnvironment(settings.caddyEnvironment),
        `UPSTAND_CADDYFILE_B64=${bootstrapConfig}`,
      ];
      const created = await this.docker.createContainer({
        name: CADDY_CONTAINER_NAME,
        Labels: {
          "com.upstand.component": "caddy",
          "com.upstand.platform": "true",
        },
        Image: CADDY_IMAGE,
        Env: env,
        Entrypoint: ["/bin/sh", "-ec"],
        Cmd: [
          `if [ ! -s ${CADDYFILE_PATH} ]; then printf '%s' "$UPSTAND_CADDYFILE_B64" | base64 -d > ${CADDYFILE_PATH}; fi; exec caddy run --config ${CADDYFILE_PATH} --adapter caddyfile`,
        ],
        ExposedPorts: exposedPorts,
        HostConfig: {
          RestartPolicy: { Name: "always" },
          PortBindings: publicPorts,
          Mounts: [
            {
              Type: "volume",
              Source: CADDY_RUNTIME_VOLUME,
              Target: "/etc/caddy",
            },
            { Type: "volume", Source: CADDY_DATA_VOLUME, Target: "/data" },
            { Type: "volume", Source: CADDY_CONFIG_VOLUME, Target: "/config" },
            {
              Type: "volume",
              Source: CADDY_LOG_VOLUME,
              Target: "/var/log/caddy",
            },
          ],
        },
      });

      const network = this.docker.getNetwork(this.networkName);
      await network.connect({ Container: created.id });
      await created.start();
      log.info({ message: "Caddy container created and started." });
    });
  }

  private async exec(
    container: ReturnType<Docker["getContainer"]>,
    command: string[],
  ): Promise<string> {
    const execution = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      // Non-TTY Docker exec streams are multiplexed with an 8-byte header. Keep
      // the bytes intact and decode them once through cleanDockerLogs; treating
      // the stream as text produces the control characters visible in the UI.
      Tty: false,
    });
    const stream = await execution.start({});
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const result = await execution.inspect();
    const output = this.cleanDockerLogs(Buffer.concat(chunks));
    if (result.ExitCode !== 0) {
      throw new Error(
        output.trim() || `Command failed with exit code ${result.ExitCode}`,
      );
    }
    return this.cleanDockerLogs(Buffer.concat(chunks));
  }

  private async writeFile(
    container: ReturnType<Docker["getContainer"]>,
    fileName: string,
    content: string,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      container.putArchive(
        createTarArchive(fileName, content),
        { path: "/etc/caddy" },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  private async writeCertificates(
    container: ReturnType<Docker["getContainer"]>,
    certificates: CaddyCertificate[],
  ): Promise<void> {
    for (const certificate of certificates) {
      if (!/^[a-zA-Z0-9_-]+$/.test(certificate.id)) {
        throw new Error("Certificate id contains unsafe path characters");
      }
      await this.writeFile(
        container,
        `certificates/${certificate.id}.crt`,
        certificate.certificatePem,
      );
      await this.writeFile(
        container,
        `certificates/${certificate.id}.key`,
        certificate.privateKeyPem,
      );
    }
  }

  async syncResourceConfigs(
    resources: CaddyResource[],
    settings: CaddySettings = {},
    certificates: CaddyCertificate[] = [],
  ): Promise<{ success: true; domains: string[]; changed: boolean }> {
    const caddyfile = generateCaddyfileContent(
      settings,
      resources,
      certificates,
    );
    const domains = getRoutes(resources, certificates).map(
      (route) => route.host,
    );
    let changed = false;
    let stage = "initialize Caddy";
    const startedAt = Date.now();
    let desiredNetworkNames = new Set<string>();

    try {
      await this.initializeCaddy(settings);
      await this.serializeConfiguration(async () => {
        stage = "reconcile resource networks";
        desiredNetworkNames = await this.reconcileResourceNetworks(
          resources,
          certificates,
        );
        stage = "locate Caddy container";
        const container = await this.findContainer();
        if (!container) throw new Error("Caddy container is not available");

        stage = "write certificates";
        await this.writeCertificates(container, certificates);

        stage = "write candidate Caddyfile";
        await this.writeFile(container, "Caddyfile.next", caddyfile);

        try {
          stage = "format candidate Caddyfile";
          await this.exec(container, [
            "caddy",
            "fmt",
            "--overwrite",
            CADDYFILE_CANDIDATE_PATH,
          ]);
          stage = "compare active and candidate Caddyfiles";
          const [activeConfig, candidateConfig] = await Promise.all([
            this.exec(container, ["cat", CADDYFILE_PATH]),
            this.exec(container, ["cat", CADDYFILE_CANDIDATE_PATH]),
          ]);
          if (activeConfig === candidateConfig) {
            await this.exec(container, [
              "/bin/sh",
              "-ec",
              `rm -f ${CADDYFILE_CANDIDATE_PATH}`,
            ]);
            return;
          }

          changed = true;
          stage = "back up active Caddyfile";
          await this.exec(container, [
            "/bin/sh",
            "-ec",
            `cp ${CADDYFILE_PATH} ${CADDYFILE_BACKUP_PATH}`,
          ]);
          stage = "validate candidate Caddyfile";
          await this.exec(container, [
            "caddy",
            "validate",
            "--config",
            CADDYFILE_CANDIDATE_PATH,
            "--adapter",
            "caddyfile",
          ]);
          stage = "activate candidate Caddyfile";
          await this.exec(container, [
            "/bin/sh",
            "-ec",
            `mv ${CADDYFILE_CANDIDATE_PATH} ${CADDYFILE_PATH}`,
          ]);
          stage = "reload Caddy";
          await this.exec(container, [
            "caddy",
            "reload",
            "--config",
            CADDYFILE_PATH,
            "--adapter",
            "caddyfile",
          ]);
          stage = "remove Caddyfile backup";
          await this.exec(container, [
            "/bin/sh",
            "-ec",
            `rm -f ${CADDYFILE_BACKUP_PATH}`,
          ]);
        } catch (error) {
          try {
            await this.exec(container, [
              "/bin/sh",
              "-ec",
              `if [ -f ${CADDYFILE_BACKUP_PATH} ]; then mv ${CADDYFILE_BACKUP_PATH} ${CADDYFILE_PATH}; fi; rm -f ${CADDYFILE_CANDIDATE_PATH}`,
            ]);
          } catch (rollbackError) {
            log.error({
              message:
                "Failed to restore the last valid Caddyfile after an unsuccessful reload",
              err:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : rollbackError,
            });
          }
          throw error;
        }
      });
      stage = "detach stale resource networks";
      await this.detachStaleResourceNetworks(desiredNetworkNames);
    } catch (error) {
      log.error({
        message: "Caddy configuration synchronization failed",
        stage,
        durationMs: Date.now() - startedAt,
        domainCount: new Set(domains).size,
        resourceCount: resources.length,
        err: error,
      });
      throw error;
    }

    log.info({
      message: "Caddy configuration synchronized successfully.",
      domainCount: new Set(domains).size,
      changed,
      durationMs: Date.now() - startedAt,
    });
    return { success: true, domains: [...new Set(domains)].sort(), changed };
  }

  async reloadCaddy(): Promise<{ success: boolean; error?: string }> {
    try {
      const container = await this.findContainer();
      if (!container) throw new Error("Caddy container is not available");
      await this.exec(container, [
        "caddy",
        "reload",
        "--config",
        CADDYFILE_PATH,
        "--adapter",
        "caddyfile",
      ]);
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reload Caddy";
      log.error({ message: "Error reloading Caddy", err: message });
      return { success: false, error: message };
    }
  }

  async getStatus(): Promise<CaddyStatus> {
    const container = await this.findContainer();
    if (!container) {
      return {
        running: false,
        status: "not-created",
        uptime: "0s",
        ports: [],
        activeDomainsCount: 0,
        activeDomains: [],
        mainCaddyfile: "# Caddy has not been initialized.",
      };
    }

    const inspect = await container.inspect();
    const startedAt = inspect.State.StartedAt
      ? new Date(inspect.State.StartedAt).getTime()
      : Date.now();
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000),
    );
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const uptime =
      hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m ${elapsedSeconds % 60}s`;
    const ports = Object.entries(inspect.NetworkSettings?.Ports || {})
      .flatMap(
        ([port, bindings]) =>
          bindings?.map((binding) => `${binding.HostPort} (${port})`) || [],
      )
      .sort();

    let mainCaddyfile = "# Caddyfile unavailable.";
    let activeDomains: string[] = [];
    try {
      mainCaddyfile = await this.exec(container, ["cat", CADDYFILE_PATH]);
      activeDomains = [
        ...new Set(
          [...mainCaddyfile.matchAll(/^# upstand-domain ([^\s]+)$/gm)]
            .map((match) => match[1])
            .filter((domain): domain is string => Boolean(domain)),
        ),
      ].sort();
    } catch (error) {
      log.warn({
        message: "Unable to read active Caddy configuration",
        err: error instanceof Error ? error.message : error,
      });
    }

    return {
      running: inspect.State.Running,
      status: inspect.State.Status,
      uptime,
      ports,
      activeDomainsCount: activeDomains.length,
      activeDomains,
      mainCaddyfile,
    };
  }

  async getLogs(tail = 100): Promise<string> {
    try {
      const container = await this.findContainer();
      if (!container) return "Caddy container has not been initialized.";
      const logs = await container.logs({ stdout: true, stderr: true, tail });
      return this.cleanDockerLogs(logs);
    } catch (error) {
      return `Failed to fetch Caddy logs: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  async getAccessLogs(tail = 20_000): Promise<string> {
    const container = await this.findContainer();
    if (!container) return "";
    try {
      const safeTail = Math.max(1, Math.min(Math.trunc(tail), 50_000));
      return await this.exec(container, [
        "sh",
        "-ec",
        `if [ -f ${CADDY_ACCESS_LOG_PATH} ]; then tail -n ${safeTail} ${CADDY_ACCESS_LOG_PATH}; fi`,
      ]);
    } catch (error) {
      log.warn({
        message: "Unable to read Caddy access logs",
        err: error instanceof Error ? error.message : error,
      });
      return "";
    }
  }

  async cleanupAccessLogs(): Promise<void> {
    const container = await this.findContainer();
    if (!container) return;
    await this.exec(container, [
      "sh",
      "-ec",
      "find /var/log/caddy -type f -name 'access.log-*' -mtime +7 -delete",
    ]);
  }

  private cleanDockerLogs(buffer: Buffer): string {
    let output = "";
    let offset = 0;

    while (offset + 8 <= buffer.length) {
      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buffer.length) return buffer.toString("utf8");
      output += buffer.toString("utf8", offset, offset + size);
      offset += size;
    }

    return output || buffer.toString("utf8");
  }

  async restartCaddy(): Promise<{ success: boolean; error?: string }> {
    try {
      const container = await this.findContainer();
      if (!container) throw new Error("Caddy container is not available");
      await container.restart();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to restart Caddy",
      };
    }
  }
}
