import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BuildDetectionError,
  detectApplicationBuildConfig,
  detectBuildConfig,
} from "./detect-build-config";

function withRepository(
  files: Record<string, string>,
  assertion: (directory: string) => void,
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const filename = path.join(directory, name);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
    }
    assertion(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("detectBuildConfig", () => {
  test("uses explicit upstand.json configuration before repository evidence", () => {
    withRepository(
      {
        "upstand.json": JSON.stringify({
          build: { type: "static", publishDirectory: "public" },
        }),
        Dockerfile: "FROM alpine\n",
        "public/index.html": "hello",
      },
      (directory) => {
        const result = detectBuildConfig(directory);
        expect(result.status).toBe("detected");
        expect(result.strategy).toBe("upstand-config");
        expect(result.config?.type).toBe("static");
        expect(result.confidence).toBe(1);
      },
    );
  });

  test("fails closed when explicit upstand.json is invalid", () => {
    withRepository(
      { "upstand.json": "{", Dockerfile: "FROM alpine\n" },
      (directory) => {
        const result = detectBuildConfig(directory);
        expect(result.status).toBe("requires-operator-input");
        expect(result.warnings[0]).toContain("upstand.json is invalid");
        expect(() => detectApplicationBuildConfig(directory)).toThrow(
          BuildDetectionError,
        );
      },
    );
  });

  test("uses repository-native builder configuration before Dockerfile", () => {
    withRepository(
      { "nixpacks.toml": "[phases.build]", Dockerfile: "FROM alpine\n" },
      (directory) => {
        const result = detectBuildConfig(directory);
        expect(result.strategy).toBe("repository-config");
        expect(result.config?.type).toBe("nixpacks");
      },
    );
  });

  test("detects Dockerfile with exact evidence", () => {
    withRepository({ Dockerfile: "FROM alpine\n" }, (directory) => {
      const result = detectBuildConfig(directory);
      expect(result.strategy).toBe("dockerfile");
      expect(result.evidence).toEqual([
        {
          file: "Dockerfile",
          reason: "Container build instructions are present",
        },
      ]);
      expect(detectApplicationBuildConfig(directory).type).toBe("dockerfile");
    });
  });

  test("explains Node framework, package manager, commands, and health defaults", () => {
    withRepository(
      {
        "package.json": JSON.stringify({
          scripts: { build: "next build", start: "next start" },
          dependencies: { next: "16.0.0" },
        }),
        "bun.lock": "",
      },
      (directory) => {
        const result = detectBuildConfig(directory);
        expect(result).toMatchObject({
          status: "detected",
          strategy: "framework",
          language: "node",
          framework: "nextjs",
          packageManager: "bun",
          commands: {
            install: "bun install --frozen-lockfile",
            build: "bun run build",
            start: "bun run start",
          },
          publishDirectory: ".next",
          port: 3000,
          healthExpectations: { path: "/", startupTimeoutSeconds: 120 },
        });
      },
    );
  });

  test.each([
    [{ "requirements.txt": "fastapi==1.0" }, "python", "fastapi"],
    [{ "go.mod": "module example.com/app" }, "go", "go"],
    [{ "Cargo.toml": "[package]\nname='app'" }, "rust", "rust"],
    [{ "pom.xml": "<project />" }, "java-kotlin", "spring-or-jvm"],
    [{ "composer.json": "{}", artisan: "" }, "php", "laravel"],
    [{ "App.csproj": "<Project />" }, "dotnet", "dotnet"],
  ])("detects supported language families", (files, language, framework) => {
    withRepository(files, (directory) => {
      const result = detectBuildConfig(directory);
      expect(result.language).toBe(language);
      expect(result.framework).toBe(framework);
      expect(result.config?.type).toBe("railpack");
    });
  });

  test("requires explicit input for conflicting top-level languages", () => {
    withRepository(
      { "package.json": "{}", "pyproject.toml": "[project]" },
      (directory) => {
        const result = detectBuildConfig(directory);
        expect(result.status).toBe("requires-operator-input");
        expect(result.warnings[0]).toContain("node, python");
        expect(result.evidence).toHaveLength(2);
      },
    );
  });

  test("supports nested build paths without scanning unrelated roots", () => {
    withRepository(
      {
        "package.json": "{}",
        "apps/site/index.html": "<h1>Hello</h1>",
      },
      (directory) => {
        const result = detectBuildConfig(directory, "apps/site");
        expect(result.strategy).toBe("static");
        expect(result.buildPath).toBe("apps/site");
      },
    );
  });

  test("rejects escaping and empty build paths rather than falling back", () => {
    withRepository({}, (directory) => {
      expect(detectBuildConfig(directory, "../outside").status).toBe(
        "requires-operator-input",
      );
      const empty = detectBuildConfig(directory);
      expect(empty.status).toBe("requires-operator-input");
      expect(() => detectApplicationBuildConfig(directory)).toThrow(
        BuildDetectionError,
      );
    });
  });
});
