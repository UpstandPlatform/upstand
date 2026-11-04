import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApplicationBuildConfig } from "@upstand/domain";
import { BuildDetectionError, detectBuildConfig } from "@upstand/usecases";

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

function detectedConfig(directory: string): ApplicationBuildConfig {
  const result = detectBuildConfig(directory);
  if (result.status !== "detected" || !result.config) {
    throw new BuildDetectionError(result);
  }
  return result.config;
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
