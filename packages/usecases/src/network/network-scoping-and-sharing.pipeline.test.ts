import { describe, expect, test } from "bun:test";
import { ConflictError } from "@upstand/domain";
import type Docker from "dockerode";
import {
  applyComposeIngressNetwork,
  applyComposeResourceConfig,
} from "../resource/docker-compose-config";
import {
  ensureResourceOverlayNetwork,
  ensureUpstandOverlayNetwork,
  getResourceOverlayNetworkName,
  UPSTAND_SWARM_NETWORK,
  validateSwarmAddress,
  validateSwarmAddressPools,
} from "../swarm/swarm.helpers";

describe("Network Scoping & Inter-Resource Container Sharing Tests", () => {
  describe("Resource Overlay Network Naming & Isolation", () => {
    test("generates predictable upstand-resource-<id> overlay network names", () => {
      const name1 = getResourceOverlayNetworkName("res-app-123");
      const name2 = getResourceOverlayNetworkName("RES_DB_456!");

      expect(name1).toBe("upstand-resource-res-app-123");
      expect(name2).toBe("upstand-resource-res-db-456-");
      expect(name1.startsWith("upstand-resource-")).toBe(true);
      expect(name2.startsWith("upstand-resource-")).toBe(true);
    });

    test("truncates overlay network names to 63 characters max (Docker API limit)", () => {
      const longId = "a".repeat(100);
      const networkName = getResourceOverlayNetworkName(longId);

      expect(networkName.length).toBeLessThanOrEqual(63);
      expect(networkName).toBe(`upstand-resource-${"a".repeat(46)}`);
    });

    test("keeps separate overlay network names for distinct resources in the same environment", () => {
      const appNetwork = getResourceOverlayNetworkName("resource-web-app");
      const dbNetwork = getResourceOverlayNetworkName("resource-postgres-db");

      expect(appNetwork).not.toBe(dbNetwork);
      expect(appNetwork).toBe("upstand-resource-resource-web-app");
      expect(dbNetwork).toBe("upstand-resource-resource-postgres-db");
    });
  });

  describe("Compose Ingress & Multi-Service Network Scoping", () => {
    test("attaches shared ingress network (upstand-network) to all services in an environment", () => {
      const rawCompose = `
version: '3.8'
services:
  web:
    image: nginx:alpine
  api:
    image: node:20-alpine
`;
      const result = applyComposeIngressNetwork(
        rawCompose,
        "upstand-network",
        false,
        "stack-1",
      );

      expect(result).toContain("upstand_ingress:");
      expect(result).toContain("name: upstand-network");
      expect(result).toContain("external: true");
    });

    test("preserves existing internal networks while attaching shared environment network", () => {
      const rawCompose = `
version: '3.8'
services:
  web:
    image: nginx:alpine
    networks:
      - internal-backend
networks:
  internal-backend:
    driver: overlay
`;
      const result = applyComposeIngressNetwork(
        rawCompose,
        "upstand-network",
        false,
        "stack-1",
      );

      expect(result).toContain("internal-backend");
      expect(result).toContain("upstand_ingress");
    });

    test("skips overlay network attachment for services with explicit network_mode (host/none)", () => {
      const rawCompose = `
version: '3.8'
services:
  agent:
    image: monitoring-agent:latest
    network_mode: host
  app:
    image: web-app:v1
`;
      const result = applyComposeIngressNetwork(
        rawCompose,
        "upstand-network",
        false,
        "stack-1",
      );

      expect(result).toContain("network_mode: host");
      expect(result).toContain("upstand_ingress");
    });

    test("applies no-new-privileges security option and default security policies across container networks", () => {
      const rawCompose = `
services:
  web:
    image: nginx:latest
`;
      const resource = {
        id: "res-1",
        envVars: "",
      } as never;
      const config = {
        command: [],
        args: [],
        dns: [],
        dnsSearch: [],
        extraHosts: [],
        capDrop: [],
        ports: [],
        volumes: [],
        placementConstraints: [],
        resources: {},
        restartPolicy: { condition: "any" },
      } as never;

      const result = applyComposeResourceConfig(rawCompose, resource, config);

      expect(result).toContain("no-new-privileges:true");
    });
  });

  describe("Swarm Address & Address Pool Validation", () => {
    test("accepts routable IPv4 and IPv6 addresses for Swarm cluster nodes", () => {
      expect(validateSwarmAddress("192.168.1.50", "ipAddress")).toBe(
        "192.168.1.50",
      );
      expect(validateSwarmAddress("203.0.113.10", "ipAddress")).toBe(
        "203.0.113.10",
      );
      expect(validateSwarmAddress("2001:db8::1", "ipAddress")).toBe(
        "2001:db8::1",
      );
    });

    test("rejects loopback and unroutable IP addresses (127.0.0.1, 0.0.0.0, localhost)", () => {
      expect(() => validateSwarmAddress("127.0.0.1", "ipAddress")).toThrow(
        "must be a routable address",
      );
      expect(() => validateSwarmAddress("0.0.0.0", "ipAddress")).toThrow(
        "must be a routable address",
      );
      expect(() => validateSwarmAddress("localhost", "ipAddress")).toThrow(
        "must be a routable address",
      );
    });

    test("validates overlay address pools for CIDR format and subnet sizes", () => {
      const validPools = validateSwarmAddressPools(
        ["10.0.0.0/8", "172.16.0.0/12"],
        24,
      );
      expect(validPools).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);

      // Mixing IPv4 and IPv6 in overlay pools is rejected
      expect(() =>
        validateSwarmAddressPools(["10.0.0.0/8", "fd00::/8"], 24),
      ).toThrow("Use either IPv4 or IPv6 overlay address pools");

      // Invalid CIDR mask
      expect(() => validateSwarmAddressPools(["10.0.0.0/35"], 24)).toThrow(
        "invalid for a /24 subnet size",
      );
    });
  });

  describe("Docker Overlay Network Creation & Convergence", () => {
    test("creates upstand-network attachable overlay network when missing", async () => {
      let createdNetworkSpec: Record<string, unknown> | null = null;
      const mockDocker = {
        getNetwork: () => ({
          inspect: async () => {
            const err = new Error("network not found");
            (err as unknown as { statusCode: number }).statusCode = 404;
            throw err;
          },
        }),
        createNetwork: async (spec: Record<string, unknown>) => {
          createdNetworkSpec = spec;
          return { id: "net-upstand-overlay-123" };
        },
      } as unknown as Docker;

      const result = await ensureUpstandOverlayNetwork(mockDocker);

      expect(result.id).toBe("net-upstand-overlay-123");
      expect(result.created).toBe(true);
      expect(createdNetworkSpec).toMatchObject({
        Name: UPSTAND_SWARM_NETWORK,
        Driver: "overlay",
        Attachable: true,
        Options: { encrypted: "" },
      });
    });

    test("handles race condition 409 conflict when multiple workers create overlay network simultaneously", async () => {
      const mockDocker = {
        getNetwork: () => ({
          inspect: async () => ({
            Id: "net-raced-123",
            Driver: "overlay",
            Scope: "swarm",
            Attachable: true,
            Options: { encrypted: "" },
          }),
        }),
        createNetwork: async () => {
          const err = new Error("network already exists");
          (err as unknown as { statusCode: number }).statusCode = 409;
          throw err;
        },
      } as unknown as Docker;

      const result = await ensureUpstandOverlayNetwork(mockDocker);

      expect(result.id).toBe("net-raced-123");
      expect(result.created).toBe(false);
    });

    test("throws ConflictError if existing network is not an attachable Swarm overlay network", async () => {
      const mockDocker = {
        getNetwork: () => ({
          inspect: async () => ({
            Id: "net-bridge-123",
            Driver: "bridge",
            Scope: "local",
            Attachable: false,
          }),
        }),
      } as unknown as Docker;

      await expect(ensureUpstandOverlayNetwork(mockDocker)).rejects.toThrow(
        ConflictError,
      );
    });

    test("rejects an existing unencrypted shared overlay network", async () => {
      const mockDocker = {
        getNetwork: () => ({
          inspect: async () => ({
            Id: "net-unencrypted-123",
            Driver: "overlay",
            Scope: "swarm",
            Attachable: true,
            Options: {},
          }),
        }),
      } as unknown as Docker;

      await expect(ensureUpstandOverlayNetwork(mockDocker)).rejects.toThrow(
        "encrypted",
      );
    });

    test("creates per-resource isolated overlay network (upstand-resource-<id>)", async () => {
      let createdName = "";
      const mockDocker = {
        getNetwork: () => ({
          inspect: async () => {
            const err = new Error("not found");
            (err as unknown as { statusCode: number }).statusCode = 404;
            throw err;
          },
        }),
        createNetwork: async (spec: { Name: string }) => {
          createdName = spec.Name;
          return { id: "res-net-id" };
        },
      } as unknown as Docker;

      const result = await ensureResourceOverlayNetwork(
        mockDocker,
        "res-billing-api",
      );

      expect(result.name).toBe("upstand-resource-res-billing-api");
      expect(createdName).toBe("upstand-resource-res-billing-api");
      expect(result.created).toBe(true);
    });
  });
});
