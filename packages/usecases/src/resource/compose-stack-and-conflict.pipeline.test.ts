import { describe, expect, test } from "bun:test";
import { randomizeComposeFile } from "./compose-randomization";
import {
  applyComposeIngressNetwork,
  applyComposeResourceConfig,
  validateComposeSecurity,
} from "./docker-compose-config";

describe("Compose Stack Conversion, Security & Port Conflict Tests", () => {
  describe("Compose Security & Isolation Escapes", () => {
    test("rejects privileged container mode", () => {
      const compose = `
services:
  web:
    image: nginx
    privileged: true
`;
      expect(() => validateComposeSecurity(compose)).toThrow(
        "requests privileged mode, which is not allowed",
      );
    });

    test("rejects host-level namespace escapes (pid: host, ipc: host, network_mode: host)", () => {
      const composePid = `
services:
  web:
    image: nginx
    pid: host
`;
      const composeIpc = `
services:
  web:
    image: nginx
    ipc: host
`;

      expect(() => validateComposeSecurity(composePid)).toThrow(
        "requests host-level namespace access",
      );
      expect(() => validateComposeSecurity(composeIpc)).toThrow(
        "requests host-level namespace access",
      );
    });

    test("rejects container_name definitions to prevent global container naming collisions", () => {
      const compose = `
services:
  web:
    image: nginx
    container_name: global-static-name
`;
      expect(() => validateComposeSecurity(compose)).toThrow(
        "sets container_name, which is not allowed for isolated deployments",
      );
    });

    test("rejects Docker socket mounts and host filesystem bind mounts", () => {
      const composeSocket = `
services:
  web:
    image: nginx
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`;
      const composeHostPath = `
services:
  web:
    image: nginx
    volumes:
      - /etc/shadow:/etc/shadow:ro
`;

      expect(() => validateComposeSecurity(composeSocket)).toThrow(
        "contains a host bind or Docker socket mount",
      );
      expect(() => validateComposeSecurity(composeHostPath)).toThrow(
        "contains a host bind or Docker socket mount",
      );
    });

    test("rejects added Linux capabilities (cap_add)", () => {
      const compose = `
services:
  web:
    image: nginx
    cap_add:
      - SYS_ADMIN
`;
      expect(() => validateComposeSecurity(compose)).toThrow(
        "requests added Linux capabilities, which is not allowed",
      );
    });

    test("rejects unsafe security options (seccomp:unconfined, apparmor:unconfined)", () => {
      const compose = `
services:
  web:
    image: nginx
    security_opt:
      - seccomp=unconfined
`;
      expect(() => validateComposeSecurity(compose)).toThrow(
        "requests unsafe security option 'seccomp=unconfined'",
      );
    });
  });

  describe("Port Publishing & Resource Config Conversion", () => {
    test("formats TCP and UDP port bindings correctly", () => {
      const rawCompose = `
services:
  dns:
    image: coredns/coredns
`;
      const resource = { id: "res-dns", envVars: "" } as never;
      const config = {
        command: [],
        args: [],
        dns: [],
        dnsSearch: [],
        extraHosts: [],
        capDrop: [],
        ports: [
          { publishedPort: 53, targetPort: 53, protocol: "udp" },
          { publishedPort: 8080, targetPort: 80, protocol: "tcp" },
        ],
        volumes: [],
        placementConstraints: [],
        resources: {},
        restartPolicy: { condition: "any" },
      } as never;

      const result = applyComposeResourceConfig(rawCompose, resource, config);

      expect(result).toContain("53:53/udp");
      expect(result).toContain("8080:80");
    });

    test("applies stop_grace_period and resource limits to compose deploy spec", () => {
      const rawCompose = `
services:
  api:
    image: node:20
`;
      const resource = { id: "res-api", envVars: "" } as never;
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
        resources: { cpuLimit: 1.5, memoryLimitMb: 512 },
        restartPolicy: { condition: "any" },
        stopGracePeriodSeconds: 30,
      } as never;

      const result = applyComposeResourceConfig(rawCompose, resource, config);

      expect(result).toContain("stop_grace_period: 30s");
      expect(result).toContain('cpus: "1.5"');
      expect(result).toContain("memory: 512M");
    });
  });

  describe("Compose Stack Randomization & Isolation", () => {
    test("suffixes top-level services, networks, volumes, and updates cross-references", () => {
      const rawCompose = `
version: '3.8'
services:
  web:
    image: nginx
    depends_on:
      - db
    networks:
      - app-net
    volumes:
      - db-data:/var/lib/mysql
  db:
    image: postgres
    networks:
      - app-net
networks:
  app-net:
    driver: overlay
volumes:
  db-data:
`;
      const suffix = "abc12345";
      const result = randomizeComposeFile(rawCompose, suffix);

      expect(result).toContain("web-abc12345:");
      expect(result).toContain("db-abc12345:");
      expect(result).toContain("app-net-abc12345:");
      expect(result).toContain("db-data-abc12345:");
      expect(result).toContain("- db-abc12345");
      expect(result).toContain("- app-net-abc12345");
      expect(result).toContain("- db-data-abc12345:/var/lib/mysql");
    });

    test("prefixes named volumes when converting Compose stacks for isolated deployments", () => {
      const rawCompose = `
version: '3.8'
services:
  web:
    image: nginx
    volumes:
      - app-cache:/var/cache
volumes:
  app-cache:
`;
      const result = applyComposeIngressNetwork(
        rawCompose,
        "upstand-network",
        true,
        "my-stack",
      );

      expect(result).toContain("my-stack_app-cache:");
      expect(result).toContain("- my-stack_app-cache:/var/cache");
    });

    test("fails volume prefixing if stackName is empty", () => {
      const rawCompose = `
version: '3.8'
services:
  web:
    image: nginx
`;
      expect(() =>
        applyComposeIngressNetwork(rawCompose, "upstand-network", true, ""),
      ).toThrow("An isolated Compose deployment needs a valid name");
    });
  });
});
