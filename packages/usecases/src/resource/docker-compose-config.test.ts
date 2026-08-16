import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RESOURCE_ADVANCED_CONFIG,
  type Resource,
} from "@upstand/domain";
import yaml from "yaml";
import {
  applyComposeIngressNetwork,
  applyComposeResourceConfig,
} from "./docker-compose-config";
import { serializeResourceEnvironmentVariables } from "./resource-environment";

const resource = {
  envVars: serializeResourceEnvironmentVariables({
    DATABASE_URL: "postgres://db",
  }),
} as Resource;

describe("Docker Compose configuration", () => {
  test("applies resource overrides to the selected service", () => {
    const config = {
      ...DEFAULT_RESOURCE_ADVANCED_CONFIG,
      serviceName: "api",
      environment: { LOG_LEVEL: "debug" },
      labels: { "upstand.test": "true" },
      ports: [
        { publishedPort: 8080, targetPort: 80, protocol: "tcp" as const },
      ],
      volumes: [{ source: "data", target: "/var/lib/app", readOnly: true }],
      replicas: 2,
      restartPolicy: { condition: "on-failure" as const },
      healthcheck: {
        command: ["wget", "--spider", "http://localhost/"],
        intervalSeconds: 15,
        timeoutSeconds: 4,
        retries: 2,
        startPeriodSeconds: 8,
      },
    };

    const result = yaml.parse(
      applyComposeResourceConfig(
        [
          "services:",
          "  api:",
          "    environment:",
          "      EXISTING: keep",
          '    ports: ["8080:80"]',
          "  worker:",
          "    image: worker:latest",
        ].join("\n"),
        resource,
        config,
      ),
    ) as { services: Record<string, Record<string, unknown>> };

    expect(result.services.api).toMatchObject({
      environment: {
        EXISTING: "keep",
        DATABASE_URL: "postgres://db",
        LOG_LEVEL: "debug",
      },
      labels: { "upstand.test": "true" },
      ports: ["8080:80"],
      volumes: ["data:/var/lib/app:ro"],
      deploy: { replicas: 2 },
      restart: "on-failure",
      healthcheck: {
        test: ["wget", "--spider", "http://localhost/"],
        interval: "15s",
        timeout: "4s",
        retries: 2,
        start_period: "8s",
      },
    });
    const api = result.services.api;
    if (!api) throw new Error("Expected API service is missing");
    expect(api.security_opt).toContain("no-new-privileges:true");
    expect(api.cap_drop).toBeUndefined();
    expect(result.services.worker).toEqual({ image: "worker:latest" });
  });

  test("preserves explicit capability drops without imposing a blanket drop", () => {
    const result = yaml.parse(
      applyComposeResourceConfig(
        "services:\n  api:\n    image: nginx:alpine",
        resource,
        { ...DEFAULT_RESOURCE_ADVANCED_CONFIG, capDrop: ["NET_RAW"] },
      ),
    ) as { services: Record<string, Record<string, unknown>> };

    expect(result.services.api?.cap_drop).toEqual(["NET_RAW"]);
  });

  test("adds ingress routing and prefixes only internal named volumes", () => {
    const result = yaml.parse(
      applyComposeIngressNetwork(
        [
          "services:",
          "  api:",
          "    volumes: [data:/var/lib/data, external-data:/var/lib/external]",
          "  host:",
          "    network_mode: host",
          "volumes:",
          "  data: {}",
          "  external-data:",
          "    external: true",
        ].join("\n"),
        "shared-ingress",
        true,
        "stack",
      ),
    ) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
      volumes: Record<string, unknown>;
    };

    expect(result.networks.upstand_ingress).toEqual({
      name: "shared-ingress",
      external: true,
    });
    const api = result.services.api;
    const host = result.services.host;
    if (!api || !host) throw new Error("Expected Compose services are missing");

    expect(api.networks).toEqual(["upstand_ingress"]);
    expect(api.volumes).toEqual([
      "stack_data:/var/lib/data",
      "external-data:/var/lib/external",
    ]);
    expect(host.networks).toBeUndefined();
    expect(result.volumes).toEqual({
      stack_data: {},
      "external-data": { external: true },
    });
  });

  test("rejects a requested service that is not in the Compose document", () => {
    expect(() =>
      applyComposeResourceConfig(
        "services:\n  api:\n    image: nginx",
        resource,
        { ...DEFAULT_RESOURCE_ADVANCED_CONFIG, serviceName: "missing" },
      ),
    ).toThrow("Compose service 'missing' was not found");
  });

  test("rejects host escape primitives in raw Compose resources", () => {
    expect(() =>
      applyComposeResourceConfig(
        [
          "services:",
          "  api:",
          "    image: nginx:alpine",
          "    privileged: true",
          "    volumes: ['/var/run/docker.sock:/var/run/docker.sock']",
        ].join("\n"),
        resource,
        DEFAULT_RESOURCE_ADVANCED_CONFIG,
      ),
    ).toThrow("privileged mode");

    expect(() =>
      applyComposeResourceConfig(
        [
          "services:",
          "  api:",
          "    image: nginx:alpine",
          "    volumes: ['/var/run/docker.sock:/var/run/docker.sock']",
        ].join("\n"),
        resource,
        DEFAULT_RESOURCE_ADVANCED_CONFIG,
      ),
    ).toThrow("host bind or Docker socket");
  });
});
