import { describe, expect, it } from "bun:test";
import { parseUpstandConfig } from "./upstand-config";

describe("parseUpstandConfig", () => {
  it("should parse standard HTTP cron configuration", () => {
    const json = JSON.stringify({
      crons: [
        {
          path: "/api/cron",
          schedule: "0 10 * * *",
        },
      ],
    });

    const result = parseUpstandConfig(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crons).toHaveLength(1);
      expect(result.data.crons?.[0]).toEqual({
        path: "/api/cron",
        schedule: "0 10 * * *",
        method: "GET",
        shellType: "bash",
        timezone: "UTC",
      });
    }
  });

  it("should parse Dokploy style script/command schedule", () => {
    const json = JSON.stringify({
      crons: [
        {
          name: "Database Backup",
          command: "npm run backup",
          schedule: "0 0 * * *",
          timezone: "America/New_York",
          shellType: "sh",
          serviceName: "db",
        },
      ],
    });

    const result = parseUpstandConfig(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crons).toHaveLength(1);
      expect(result.data.crons?.[0]).toEqual({
        name: "Database Backup",
        command: "npm run backup",
        schedule: "0 0 * * *",
        timezone: "America/New_York",
        shellType: "sh",
        serviceName: "db",
        method: "GET",
      });
    }
  });

  it("should parse build and runtime configuration sections", () => {
    const json = JSON.stringify({
      $schema: "https://upstand.dev/upstand.schema.json",
      build: {
        type: "dockerfile",
        buildPath: "./app",
        dockerfilePath: "Dockerfile.prod",
        dockerBuildStage: "runner",
        dockerBuildArgs: { NODE_ENV: "production" },
        dockerNoCache: true,
        watchPaths: ["apps/web/**", "packages/**"],
      },
      runtime: {
        command: ["npm", "run", "start"],
        cpuLimit: 2,
        memoryLimitMb: 1024,
        replicas: 3,
        restartPolicy: {
          condition: "on-failure",
          maxAttempts: 5,
        },
      },
    });

    const result = parseUpstandConfig(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.build?.type).toBe("dockerfile");
      expect(result.data.build?.dockerfilePath).toBe("Dockerfile.prod");
      expect(result.data.build?.watchPaths).toEqual([
        "apps/web/**",
        "packages/**",
      ]);
      expect(result.data.runtime?.cpuLimit).toBe(2);
      expect(result.data.runtime?.memoryLimitMb).toBe(1024);
      expect(result.data.runtime?.replicas).toBe(3);
      expect(result.data.runtime?.restartPolicy?.condition).toBe("on-failure");
    }
  });

  it("should return empty crons array for empty json object", () => {
    const result = parseUpstandConfig("{}");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crons).toBeUndefined();
    }
  });

  it("should return failure for invalid json syntax", () => {
    const result = parseUpstandConfig("invalid json");
    expect(result.success).toBe(false);
  });

  it("rejects plaintext cron secrets and ambiguous cron targets", () => {
    const plaintextSecret = parseUpstandConfig(
      JSON.stringify({
        crons: [
          {
            path: "/api/cron",
            schedule: "0 * * * *",
            secret: "do-not-store-me",
          },
        ],
      }),
    );
    expect(plaintextSecret.success).toBe(false);

    const ambiguous = parseUpstandConfig({
      crons: [
        {
          path: "/api/cron",
          command: "echo nope",
          schedule: "0 * * * *",
        },
      ],
    });
    expect(ambiguous.success).toBe(false);
  });

  it("rejects unsafe repository paths and conflicting runtime aliases", () => {
    expect(
      parseUpstandConfig({
        build: { buildPath: "../outside" },
      }).success,
    ).toBe(false);
    expect(
      parseUpstandConfig({
        runtime: { replicas: 2 },
        resources: { replicas: 3 },
      }).success,
    ).toBe(false);
  });
});
