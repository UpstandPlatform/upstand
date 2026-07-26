import { describe, expect, test } from "bun:test";
import {
  ApplicationBuildConfigSchema,
  isSupportedDatabaseImage,
  isValidDockerImageReference,
} from "@upstand/domain";
import {
  parseResourceCredentials,
  serializeResourceCredentials,
} from "../resource/resource-credentials";

describe("Resource Types & Deployment Pipeline Configurations", () => {
  describe("Application Resource Pipelines", () => {
    test("validates Dockerfile build pipeline configuration with build args and multi-stage target", () => {
      const config = ApplicationBuildConfigSchema.parse({
        type: "dockerfile",
        buildPath: "apps/web",
        dockerfilePath: "Dockerfile.prod",
        dockerContextPath: ".",
        dockerBuildStage: "runner",
        dockerBuildArgs: {
          NODE_ENV: "production",
          API_URL: "https://api.example.com",
        },
        dockerNoCache: true,
        dockerCleanupCache: true,
      });

      expect(config.type).toBe("dockerfile");
      if (config.type === "dockerfile") {
        expect(config.dockerfilePath).toBe("Dockerfile.prod");
        expect(config.dockerBuildStage).toBe("runner");
        expect(config.dockerBuildArgs).toEqual({
          NODE_ENV: "production",
          API_URL: "https://api.example.com",
        });
        expect(config.dockerNoCache).toBe(true);
      }
    });

    test("validates Static site pipeline with SPA rewrite flag", () => {
      const config = ApplicationBuildConfigSchema.parse({
        type: "static",
        buildPath: ".",
        publishDirectory: "dist",
        spa: true,
      });

      expect(config.type).toBe("static");
      if (config.type === "static") {
        expect(config.publishDirectory).toBe("dist");
        expect(config.spa).toBe(true);
      }
    });

    test("validates Railpack pipeline version selection", () => {
      const config = ApplicationBuildConfigSchema.parse({
        type: "railpack",
        buildPath: "server",
        railpackVersion: "0.15.4",
      });

      expect(config.type).toBe("railpack");
      if (config.type === "railpack") {
        expect(config.railpackVersion).toBe("0.15.4");
      }
    });
  });

  describe("Database Resource Pipelines", () => {
    test("validates supported database images for PostgreSQL, MySQL, Redis, MongoDB, LibSQL", () => {
      expect(isSupportedDatabaseImage("postgres", "postgres:16-alpine")).toBe(
        true,
      );
      expect(isSupportedDatabaseImage("mysql", "mysql:8.0")).toBe(true);
      expect(isSupportedDatabaseImage("redis", "redis:7-alpine")).toBe(true);
      expect(isSupportedDatabaseImage("mongodb", "mongo:7.0")).toBe(true);
      expect(
        isSupportedDatabaseImage(
          "libsql",
          "ghcr.io/tursodatabase/libsql-server:latest",
        ),
      ).toBe(true);
    });

    test("rejects unsupported database images unless allowCustom is explicitly enabled", () => {
      expect(isSupportedDatabaseImage("postgres", "custom-pg:latest")).toBe(
        false,
      );
      expect(
        isSupportedDatabaseImage("postgres", "custom-pg:latest", true),
      ).toBe(true);
    });

    test("validates docker image reference syntax", () => {
      expect(isValidDockerImageReference("nginx:alpine")).toBe(true);
      expect(isValidDockerImageReference("ghcr.io/org/repo:v1.2.3")).toBe(true);
      expect(
        isValidDockerImageReference("invalid image name with spaces"),
      ).toBe(false);
    });
  });

  describe("Compose & Stack Resource Pipelines", () => {
    test("serializes and parses credentials containing composeFile content", () => {
      const rawCompose =
        "version: '3.8'\nservices:\n  app:\n    image: node:alpine\n";
      const serialized = serializeResourceCredentials({
        composeFile: rawCompose,
      });
      const parsed = parseResourceCredentials(serialized);

      expect(parsed.composeFile).toBe(rawCompose);
    });
  });
});
