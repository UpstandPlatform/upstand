import { isIP } from "node:net";
import { ConflictError, ValidationError } from "@upstand/domain";
import { env } from "@upstand/env/server";
import type Docker from "dockerode";

export const UPSTAND_SWARM_NETWORK = env.DOCKER_NETWORK || "upstand-network";

const RESOURCE_NETWORK_PREFIX = "upstand-resource-";

export function getResourceOverlayNetworkName(resourceId: string): string {
  const suffix = resourceId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${RESOURCE_NETWORK_PREFIX}${suffix}`.slice(0, 63);
}

export interface DockerSwarmInfo {
  Swarm?: {
    LocalNodeState?: string;
    ControlAvailable?: boolean;
    NodeID?: string;
    NodeAddr?: string;
    Nodes?: number;
  };
}

export interface DockerSwarmNode {
  ID: string;
  Description?: {
    Hostname?: string;
    Engine?: { EngineVersion?: string };
  };
  Spec?: {
    Name?: string;
    Labels?: Record<string, string>;
    Role?: string;
    Availability?: string;
  };
  Status?: { State?: string; Addr?: string };
  Version?: { Index?: number };
  ManagerStatus?: {
    Leader?: boolean;
    Addr?: string;
    Reachability?: string;
  };
}

export interface DockerOverlayNetwork {
  Id: string;
  Driver: string;
  Scope: string;
  Attachable: boolean;
}

export interface DockerNetworkCreateResult {
  id?: string;
  Id?: string;
}

const LOOPBACK_OR_UNSPECIFIED_ADDRESSES = new Set([
  "0.0.0.0",
  "::",
  "::1",
  "localhost",
]);

export function validateSwarmAddress(value: string, field: string): string {
  const address = value.trim();

  if (!address) {
    throw new ValidationError(`${field} is required.`);
  }

  if (
    LOOPBACK_OR_UNSPECIFIED_ADDRESSES.has(address.toLowerCase()) ||
    address.startsWith("127.")
  ) {
    throw new ValidationError(
      `${field} must be a routable address. Loopback and unspecified addresses cannot form a production Swarm.`,
    );
  }

  if (isIP(address)) {
    return address;
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(address)) {
    throw new ValidationError(
      `${field} must be an IP address, network interface, or DNS hostname without a port.`,
    );
  }

  return address;
}

export function validateSwarmAddressPools(
  pools: string[],
  subnetSize: number,
): string[] {
  const normalized = pools.map((pool) => pool.trim()).filter(Boolean);
  if (!normalized.length) {
    throw new ValidationError("At least one overlay address pool is required.");
  }

  const families = new Set<number>();
  for (const pool of normalized) {
    const [address, prefix, ...rest] = pool.split("/");
    const family = address ? isIP(address) : 0;
    const prefixLength = Number(prefix);
    const maxPrefix = family === 6 ? 128 : 32;

    if (
      rest.length ||
      !family ||
      !Number.isInteger(prefixLength) ||
      prefixLength < 0 ||
      prefixLength >= subnetSize ||
      subnetSize > maxPrefix
    ) {
      throw new ValidationError(
        `Overlay address pool '${pool}' is invalid for a /${subnetSize} subnet size.`,
      );
    }

    families.add(family);
  }

  if (families.size > 1) {
    throw new ValidationError(
      "Use either IPv4 or IPv6 overlay address pools, not a mixture of both.",
    );
  }

  return [...new Set(normalized)];
}

export function formatSwarmEndpoint(address: string): string {
  return isIP(address) === 6 ? `[${address}]:2377` : `${address}:2377`;
}

export function isSwarmActive(info: DockerSwarmInfo): boolean {
  return info?.Swarm?.LocalNodeState === "active";
}

export function isManager(info: DockerSwarmInfo): boolean {
  return isSwarmActive(info) && info.Swarm?.ControlAvailable === true;
}

export async function requireActiveManager(
  docker: Docker,
): Promise<DockerSwarmInfo> {
  let info = (await docker.info()) as DockerSwarmInfo;

  if (!isSwarmActive(info)) {
    if (env.NODE_ENV === "development") {
      try {
        await docker.swarmInit({
          AdvertiseAddr: "127.0.0.1",
          ListenAddr: "0.0.0.0:2377",
        });
        info = (await docker.info()) as DockerSwarmInfo;
      } catch (error) {
        throw new ConflictError(
          `Docker Swarm is inactive and auto-initialization failed: ${
            error instanceof Error ? error.message : String(error)
          }. Initialize a cluster before managing it.`,
        );
      }
    } else {
      throw new ConflictError(
        "Docker Swarm is inactive. Initialize a cluster before managing it.",
      );
    }
  }

  if (!isManager(info)) {
    throw new ConflictError(
      "This Upstand instance is attached to a Swarm worker. Connect the control plane to a manager node to manage the cluster.",
    );
  }

  return info;
}

export async function ensureUpstandOverlayNetwork(
  docker: Docker,
): Promise<{ id: string; created: boolean }> {
  return ensureManagedOverlayNetwork(
    docker,
    UPSTAND_SWARM_NETWORK,
    "application-routing",
  );
}

export async function ensureResourceOverlayNetwork(
  docker: Docker,
  resourceId: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const name = getResourceOverlayNetworkName(resourceId);
  const network = await ensureManagedOverlayNetwork(
    docker,
    name,
    "resource-isolation",
  );
  return { ...network, name };
}

async function ensureManagedOverlayNetwork(
  docker: Docker,
  name: string,
  purpose: string,
): Promise<{ id: string; created: boolean }> {
  const network = docker.getNetwork(name);

  try {
    const existing = (await network.inspect()) as DockerOverlayNetwork;
    if (
      existing.Driver !== "overlay" ||
      existing.Scope !== "swarm" ||
      existing.Attachable !== true
    ) {
      throw new ConflictError(
        `Network '${name}' exists but is not an attachable Swarm overlay network. Rename or remove it before continuing.`,
      );
    }

    return { id: existing.Id, created: false };
  } catch (error: unknown) {
    if (error instanceof ConflictError) {
      throw error;
    }

    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }

  let created: DockerNetworkCreateResult;
  try {
    created = (await docker.createNetwork({
      Name: name,
      Driver: "overlay",
      Attachable: true,
      CheckDuplicate: true,
      Labels: {
        "com.upstand.managed": "true",
        "com.upstand.purpose": purpose,
      },
    })) as DockerNetworkCreateResult;
  } catch (error: unknown) {
    // Multiple deployment workers can converge on the same network at once.
    // Docker may report the loser as a conflict even though the desired
    // network is now available; inspect it again before failing the deploy.
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (statusCode !== 409) throw error;

    const racedNetwork = (await network.inspect()) as DockerOverlayNetwork;
    if (
      racedNetwork.Driver !== "overlay" ||
      racedNetwork.Scope !== "swarm" ||
      racedNetwork.Attachable !== true
    ) {
      throw new ConflictError(
        `Network '${name}' exists but is not an attachable Swarm overlay network.`,
      );
    }
    return { id: racedNetwork.Id, created: false };
  }

  return {
    id: created.id || created.Id || UPSTAND_SWARM_NETWORK,
    created: true,
  };
}

export function isDockerNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

export function managerNodeCount(nodes: DockerSwarmNode[]): number {
  return nodes.filter((node) => node.Spec?.Role === "manager").length;
}

export function activeManagerNodeCount(nodes: DockerSwarmNode[]): number {
  return nodes.filter(
    (node) =>
      node.Spec?.Role === "manager" &&
      node.Spec?.Availability === "active" &&
      node.Status?.State === "ready" &&
      node.ManagerStatus?.Reachability !== "unreachable",
  ).length;
}

export function assertSafeManagerRemoval(
  target: DockerSwarmNode,
  nodes: DockerSwarmNode[],
  localNodeId?: string,
): void {
  if (target.ID === localNodeId) {
    throw new ConflictError(
      "The manager running Upstand cannot be changed from this control plane. Perform this operation from another reachable manager.",
    );
  }

  if (target.ManagerStatus?.Leader) {
    throw new ConflictError(
      "The current Swarm leader cannot be demoted or removed. Elect another leader first.",
    );
  }

  if (target.Spec?.Role === "manager" && managerNodeCount(nodes) <= 1) {
    throw new ConflictError(
      "Refusing to remove the cluster's last manager. Promote a reachable worker first.",
    );
  }
}

export function dockerErrorMessage(
  action: string,
  error: unknown,
): ValidationError | ConflictError {
  const message = error instanceof Error ? error.message : String(error);

  if (/out of sequence|update out of sequence|version/i.test(message)) {
    return new ConflictError(
      `${action} could not be applied because the cluster changed. Refresh and try again.`,
    );
  }

  return new ValidationError(`${action} failed: ${message}`);
}
