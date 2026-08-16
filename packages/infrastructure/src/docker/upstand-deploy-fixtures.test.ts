import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApplicationBuildConfig } from "@upstand/domain";
import { BuildDetectionError, detectBuildConfig } from "@upstand/usecases";
import { DockerService } from "./docker.service";

/**
 * First-party Upstand fixtures representing every stack family we promise
 * deployments can receive without a hand-written Dockerfile.
 */
const fixtureRoot = path.resolve(
  import.meta.dir,
  "../../../../fixtures/deploy",
);

const fixtures = [
  ["node", "package.json"],
  ["python-fastapi", "requirements.txt"],
  ["go", "go.mod"],
  ["rust-axum", "Cargo.toml"],
  ["dotnet", "HelloApi.csproj"],
  ["kotlin", "build.gradle.kts"],
  ["springboot", "pom.xml"],
  ["laravel", "artisan"],
] as const;

type BuildCall = {
  command: string;
  args: string[];
  environment?: NodeJS.ProcessEnv;
};

function detectedConfig(directory: string): ApplicationBuildConfig {
  const result = detectBuildConfig(directory);
  if (result.status !== "detected" || !result.config) {
    throw new BuildDetectionError(result);
  }
  return result.config;
}

function createBuildHarness(): {
  build(config: ApplicationBuildConfig, fixturePath: string): Promise<void>;
  calls: BuildCall[];
} {
  const service = new DockerService({} as never);
  const privateService = service as unknown as {
    ensureRailpack(
      version: string,
      onLog: (line: string) => void,
    ): Promise<string>;
    runCommandAsync(
      command: string,
      args: string[],
      onLog: (line: string) => void,
      environment?: NodeJS.ProcessEnv,
    ): Promise<void>;
    buildApplicationImage(
      clonePath: string,
      imageName: string,
      config: ApplicationBuildConfig,
      envVars: Record<string, string>,
      onLog: (line: string) => void,
      buildSecrets: Record<string, string>,
      preserveForRollback: boolean,
    ): Promise<void>;
  };
  const calls: BuildCall[] = [];
  privateService.ensureRailpack = async () => "/tools/railpack";
  privateService.runCommandAsync = async (
    command,
    args,
    _onLog,
    environment,
  ) => {
    calls.push({ command, args, environment });
  };
  return {
    calls,
    build: (config, fixturePath) =>
      privateService.buildApplicationImage(
        fixturePath,
        "upstand-fixture:test",
        config,
        { PORT: "3000" },
        () => {},
        {},
        false,
      ),
  };
}

describe("Upstand deployment fixtures & auto build-configuration detection", () => {
  test("keeps the complete first-party stack-fixture matrix", () => {
    for (const [fixture, marker] of fixtures) {
      expect(fs.existsSync(path.join(fixtureRoot, fixture, marker))).toBe(true);
    }
  });

  for (const [fixture] of fixtures) {
    test(`detects best build-configuration for ${fixture} fixture actual source`, () => {
      const fixturePath = path.join(fixtureRoot, fixture);
      const detected = detectedConfig(fixturePath);
      expect(detected.autoDetect).toBe(true);
      expect(detected.type).toBe("railpack");
      if (detected.type === "railpack") {
        expect(detected.railpackVersion).toBe("0.15.4");
      }
    });

    test(`sends the ${fixture} fixture through the Railpack build pipeline`, async () => {
      const harness = createBuildHarness();
      await harness.build(
        {
          autoDetect: true,
          type: "railpack",
          buildPath: ".",
          railpackVersion: "0.15.4",
        },
        path.join(fixtureRoot, fixture),
      );

      expect(harness.calls).toHaveLength(6);
      const [
        prepare,
        buildxVersion,
        createBuilder,
        inspectBuilder,
        build,
        cleanup,
      ] = harness.calls;
      expect(prepare).toMatchObject({
        command: "/tools/railpack",
        args: expect.arrayContaining([
          "prepare",
          path.join(fixtureRoot, fixture),
          "--env",
          "PORT",
        ]),
      });
      expect(prepare?.environment?.PORT).toBe("3000");
      expect(buildxVersion).toMatchObject({
        command: "docker",
        args: ["buildx", "version"],
      });
      expect(createBuilder?.args.slice(0, 3)).toEqual([
        "buildx",
        "create",
        "--name",
      ]);
      expect(inspectBuilder?.args.slice(0, 2)).toEqual(["buildx", "inspect"]);
      expect(build).toMatchObject({
        command: "docker",
        args: expect.arrayContaining([
          "buildx",
          "build",
          "--build-arg",
          "BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v0.15.4",
          "--secret",
          "type=env,id=PORT",
          path.join(fixtureRoot, fixture),
        ]),
      });
      expect(cleanup).toMatchObject({
        command: "docker",
        args: ["buildx", "rm", "--force", expect.any(String)],
      });
    });
  }

  test("auto-detects Dockerfile when actual source contains a Dockerfile", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dockerfile-fixture-"),
    );
    try {
      fs.writeFileSync(
        path.join(tmpDir, "Dockerfile"),
        "FROM alpine:latest\nCMD echo hello\n",
      );
      const detected = detectedConfig(tmpDir);
      expect(detected.autoDetect).toBe(true);
      expect(detected.type).toBe("dockerfile");
      if (detected.type === "dockerfile") {
        expect(detected.dockerfilePath).toBe("Dockerfile");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("auto-detects static site when actual source contains index.html only", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-fixture-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        "<!DOCTYPE html><html></html>",
      );
      const detected = detectedConfig(tmpDir);
      expect(detected.autoDetect).toBe(true);
      expect(detected.type).toBe("static");
      if (detected.type === "static") {
        expect(detected.publishDirectory).toBe(".");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
