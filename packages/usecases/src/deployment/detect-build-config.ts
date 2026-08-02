import fs from "node:fs";
import path from "node:path";
import {
  type ApplicationBuildConfig,
  ApplicationBuildConfigSchema,
} from "@upstand/domain";

/**
 * Automatically detects the optimal ApplicationBuildConfig based on the actual source
 * files present in the given workspace repository directory.
 */
export function detectApplicationBuildConfig(
  workspacePath: string,
  relativeBuildPath = ".",
): ApplicationBuildConfig {
  const targetDir = path.resolve(workspacePath, relativeBuildPath || ".");
  const buildPath = relativeBuildPath || ".";

  if (fs.existsSync(targetDir)) {
    // 1. Dockerfile check
    const dockerfilePath = path.join(targetDir, "Dockerfile");
    const dockerfilePathLower = path.join(targetDir, "dockerfile");
    if (fs.existsSync(dockerfilePath) || fs.existsSync(dockerfilePathLower)) {
      return ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "dockerfile",
        buildPath,
        dockerfilePath: "Dockerfile",
        dockerContextPath: ".",
        dockerBuildArgs: {},
        dockerNoCache: false,
        dockerCleanupCache: false,
      });
    }

    // 2. Explicit Railpack configuration or standard code project markers
    const railpackFile = path.join(targetDir, "railpack.json");
    const codeMarkers = [
      "package.json",
      "requirements.txt",
      "Pipfile",
      "pyproject.toml",
      "setup.py",
      "go.mod",
      "Cargo.toml",
      "build.gradle",
      "build.gradle.kts",
      "pom.xml",
      "artisan",
      "composer.json",
    ];

    let hasCodeMarker =
      fs.existsSync(railpackFile) ||
      codeMarkers.some((marker) => fs.existsSync(path.join(targetDir, marker)));

    if (!hasCodeMarker) {
      try {
        const files = fs.readdirSync(targetDir);
        hasCodeMarker = files.some(
          (f) => f.endsWith(".csproj") || f.endsWith(".sln"),
        );
      } catch {
        // ignore read dir errors
      }
    }

    if (hasCodeMarker) {
      return ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "railpack",
        buildPath,
        railpackVersion: "0.15.4",
      });
    }

    // 3. Nixpacks configuration check
    if (fs.existsSync(path.join(targetDir, "nixpacks.toml"))) {
      return ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "nixpacks",
        buildPath,
      });
    }

    // 4. Heroku buildpack check
    if (
      fs.existsSync(path.join(targetDir, "Procfile")) ||
      fs.existsSync(path.join(targetDir, "app.json"))
    ) {
      return ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "heroku-buildpacks",
        buildPath,
        herokuVersion: "24",
      });
    }

    // 5. Static website check
    if (fs.existsSync(path.join(targetDir, "index.html"))) {
      return ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "static",
        buildPath,
        publishDirectory: ".",
        spa: true,
      });
    }
  }

  // Default fallback if workspace directory cannot be inspected or is empty
  return ApplicationBuildConfigSchema.parse({
    autoDetect: true,
    type: "railpack",
    buildPath,
    railpackVersion: "0.15.4",
  });
}
