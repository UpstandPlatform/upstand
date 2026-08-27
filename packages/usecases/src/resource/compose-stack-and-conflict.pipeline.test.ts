import { describe, expect, test } from "bun:test";
import yaml from "yaml";
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

    test("rejects interpolated and long-syntax bind mounts", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
    volumes:
      - \${HOST_PATH}:/data
`),
      ).toThrow("host bind or Docker socket");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
    volumes:
      - type: bind
        source: app-data
        target: /data
`),
      ).toThrow("host bind or Docker socket");
    });

    test("rejects host-backed volume and network driver options", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
volumes:
  data:
    driver: local
    driver_opts:
      device: /
`),
      ).toThrow("host-backed driver options");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
networks:
  data:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.name: host0
`),
      ).toThrow("host-backed driver options");
    });

    test("rejects external networks and volumes", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
networks:
  shared:
    external: true
`),
      ).toThrow("cannot be external");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
volumes:
  shared:
    external:
      name: shared-volume
`),
      ).toThrow("cannot be external");
    });

    test("rejects external or host-backed configs and secrets", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
secrets:
  shared:
    external: true
`),
      ).toThrow("cannot be external");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
configs:
  credentials:
    file: /etc/shadow
`),
      ).toThrow("unsafe file path");
    });

    test("rejects invalid top-level network and volume keys", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
networks:
  ../host: {}
`),
      ).toThrow("invalid resource name");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
volumes:
  \${VOLUME_NAME}: {}
`),
      ).toThrow("invalid resource name");
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

    test("rejects Compose paths that can escape the generated deployment directory", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: ../../control-plane
      dockerfile: ../Dockerfile
`),
      ).toThrow("service build context 'web' uses an unsafe path");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    env_file:
      - ../../.env
`),
      ).toThrow("env_file 'web' uses an unsafe path");

      expect(() =>
        validateComposeSecurity(`
include:
  - ../shared.yml
services:
  web:
    image: nginx
`),
      ).toThrow("Compose include files are not allowed");
    });

    test("rejects build-time host credential forwarding and interpolated paths", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: .
      ssh:
        - default
`),
      ).toThrow("requests SSH agent forwarding during build");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: $\{BUILD_CONTEXT}
`),
      ).toThrow("service build context 'web' uses an unsafe path");
    });

    test("rejects build-time secret, cache, host-network, and entitlement escapes", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: .
      secrets:
        - npm-token
`),
      ).toThrow("requests build secrets");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: .
      cache_from:
        - type=registry,ref=registry.example.invalid/web:cache
`),
      ).toThrow("configures an external build cache");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: .
      cache_to:
        - type=registry,ref=registry.example.invalid/web:cache
`),
      ).toThrow("configures an external build cache");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: .
      network: host
`),
      ).toThrow("requests host networking during build");

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    build:
      context: .
      entitlements:
        - network.host
`),
      ).toThrow("requests build entitlements");
    });

    test("rejects interpolation of Docker transport credentials", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
    environment:
      DOCKER_HEADERS: \${DOCKER_CUSTOM_HEADERS}
`),
      ).toThrow(
        "cannot interpolate protected Docker environment variable 'DOCKER_CUSTOM_HEADERS'",
      );

      expect(() =>
        validateComposeSecurity(`
services:
  web:
    image: nginx
    environment:
      DOCKER_ENDPOINT: $DOCKER_HOST
`),
      ).toThrow(
        "cannot interpolate protected Docker environment variable 'DOCKER_HOST'",
      );
    });

    test("allows only bounded local build contexts", () => {
      expect(() =>
        validateComposeSecurity(`
services:
  local:
    build:
      context: .
      dockerfile: docker/Dockerfile
`),
      ).not.toThrow();

      expect(() =>
        validateComposeSecurity(`
services:
  remote:
    build: https://github.com/example/project.git
`),
      ).toThrow("cannot use a remote build context");

      expect(() =>
        validateComposeSecurity(`
services:
  remote:
    build:
      context: https://example.invalid/context.tar.gz
`),
      ).toThrow("cannot use a remote build context");

      expect(() =>
        validateComposeSecurity(`
services:
  remote:
    build: git://example.invalid/repository.git
`),
      ).toThrow("cannot use a remote build context");

      expect(() =>
        validateComposeSecurity(`
services:
  remote:
    build: git@example.invalid:repository.git
`),
      ).toThrow("cannot use a remote build context");

      expect(() =>
        validateComposeSecurity(`
services:
  remote:
    build:
      context: .
      additional_contexts:
        dependencies: https://example.invalid/dependencies.git
`),
      ).toThrow("cannot use a remote build context");
    });
  });

  describe("Port Publishing & Resource Config Conversion", () => {
    test("revalidates environment values injected by resource configuration", () => {
      const resource = { id: "res-env", envVars: "" } as never;
      const config = {
        command: [],
        args: [],
        dns: [],
        dnsSearch: [],
        extraHosts: [],
        capDrop: [],
        environment: { LEAKED_HEADER: "${" + "DOCKER_CUSTOM_HEADERS}" },
        ports: [],
        volumes: [],
        placementConstraints: [],
        resources: {},
        restartPolicy: { condition: "any" },
      } as never;

      expect(() =>
        applyComposeResourceConfig(
          "services:\n  api:\n    image: nginx\n",
          resource,
          config,
        ),
      ).toThrow(
        "cannot interpolate protected Docker environment variable 'DOCKER_CUSTOM_HEADERS'",
      );
    });

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

    test("adds immutable ownership labels to Compose networks and volumes", () => {
      const result = applyComposeResourceConfig(
        `
services:
  api:
    image: nginx
networks:
  private:
    labels:
      com.upstand.resource-id: other-resource
volumes:
  data:
    labels:
      com.upstand.resource-id: other-resource
`,
        { id: "resource-1", envVars: "" } as never,
        {
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
        } as never,
      );
      const parsed = yaml.parse(result) as {
        networks: Record<string, { labels: Record<string, string> }>;
        volumes: Record<string, { labels: Record<string, string> }>;
      };
      const privateNetwork = parsed.networks.private;
      const dataVolume = parsed.volumes.data;
      if (!privateNetwork || !dataVolume) {
        throw new Error("Expected Compose network and volume definitions");
      }

      expect(privateNetwork.labels["com.upstand.resource-id"]).toBe(
        "resource-1",
      );
      expect(dataVolume.labels["com.upstand.resource-id"]).toBe("resource-1");
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

    test("scopes explicit network and volume names to the Compose project", () => {
      const result = yaml.parse(
        applyComposeIngressNetwork(
          `
services:
  api:
    image: nginx
    networks: [private]
    volumes: [data:/var/lib/data]
networks:
  private:
    name: shared-network
volumes:
  data:
    name: shared-volume
`,
          "upstand-network",
          false,
          "resource-1",
        ),
      ) as {
        networks: Record<string, Record<string, unknown>>;
        volumes: Record<string, Record<string, unknown>>;
      };
      const privateNetwork = result.networks.private;
      const dataVolume = result.volumes.data;
      if (!privateNetwork || !dataVolume) {
        throw new Error("Expected scoped Compose network and volume");
      }

      expect(privateNetwork.name).toBe("resource-1_private");
      expect(dataVolume.name).toBe("resource-1_data");
    });

    test("reserves the shared ingress network name", () => {
      expect(() =>
        applyComposeIngressNetwork(
          "services:\n  api:\n    image: nginx\nnetworks:\n  upstand_ingress: {}\n",
          "upstand-network",
          false,
          "resource-1",
        ),
      ).toThrow("reserved by Upstand");
    });
  });
});
