import { describe, expect, test } from "bun:test";
import {
  ApplicationBuildConfigSchema,
  DEFAULT_APPLICATION_BUILD_CONFIG,
  parseApplicationBuildConfig,
  serializeApplicationBuildConfig,
} from "@upstand/domain";

describe("Application Build Configuration Pipeline", () => {
  test("parses default Dockerfile configuration with autoDetect enabled", () => {
    const parsed = parseApplicationBuildConfig(null);
    expect(parsed).toEqual(DEFAULT_APPLICATION_BUILD_CONFIG);
    expect(parsed.type).toBe("dockerfile");
    expect(parsed.autoDetect).toBe(true);
    if (parsed.type === "dockerfile") {
      expect(parsed.dockerfilePath).toBe("Dockerfile");
      expect(parsed.buildPath).toBe(".");
    }
  });

  test("parses and serializes Static build configuration with SPA mode and autoDetect", () => {
    const staticConfig = ApplicationBuildConfigSchema.parse({
      type: "static",
      autoDetect: true,
      buildPath: "./dist",
      publishDirectory: "out",
      spa: true,
    });

    expect(staticConfig.type).toBe("static");
    expect(staticConfig.autoDetect).toBe(true);
    if (staticConfig.type === "static") {
      expect(staticConfig.publishDirectory).toBe("out");
      expect(staticConfig.spa).toBe(true);
    }

    const json = serializeApplicationBuildConfig(staticConfig);
    const reParsed = parseApplicationBuildConfig(json);
    expect(reParsed).toEqual(staticConfig);
  });

  test("parses Railpack configuration with semver version validation and explicit autoDetect false", () => {
    const railpack = parseApplicationBuildConfig(
      JSON.stringify({
        type: "railpack",
        autoDetect: false,
        buildPath: ".",
        railpackVersion: "0.15.4",
      }),
    );

    expect(railpack.type).toBe("railpack");
    expect(railpack.autoDetect).toBe(false);
    if (railpack.type === "railpack") {
      expect(railpack.railpackVersion).toBe("0.15.4");
    }
  });

  test("parses Heroku buildpack configuration with version 24 / 26", () => {
    const heroku26 = parseApplicationBuildConfig(
      JSON.stringify({
        type: "heroku-buildpacks",
        buildPath: ".",
        herokuVersion: "26",
      }),
    );

    expect(heroku26.type).toBe("heroku-buildpacks");
    if (heroku26.type === "heroku-buildpacks") {
      expect(heroku26.herokuVersion).toBe("26");
    }
  });

  test("parses Nixpacks & Paketo buildpack configurations", () => {
    const nixpacks = parseApplicationBuildConfig(
      JSON.stringify({
        type: "nixpacks",
        buildPath: "src",
        publishDirectory: "build",
      }),
    );
    expect(nixpacks.type).toBe("nixpacks");

    const paketo = parseApplicationBuildConfig(
      JSON.stringify({
        type: "paketo-buildpacks",
        buildPath: ".",
      }),
    );
    expect(paketo.type).toBe("paketo-buildpacks");
  });

  test("falls back gracefully to default Dockerfile config on invalid JSON or bad schema", () => {
    const invalidJson = parseApplicationBuildConfig("invalid-json{");
    expect(invalidJson).toEqual(DEFAULT_APPLICATION_BUILD_CONFIG);

    const badType = parseApplicationBuildConfig(
      JSON.stringify({ type: "unknown-type" }),
    );
    expect(badType).toEqual(DEFAULT_APPLICATION_BUILD_CONFIG);
  });
});
