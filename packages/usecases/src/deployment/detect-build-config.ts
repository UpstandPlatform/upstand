import fs from "node:fs";
import path from "node:path";
import {
  type ApplicationBuildConfig,
  ApplicationBuildConfigSchema,
  parseUpstandConfig,
  type UpstandBuildConfig,
} from "@upstand/domain";
import { z } from "zod";

export const BUILD_DETECTOR_VERSION = "1.0.0";

export const BuildDetectionEvidenceSchema = z.object({
  file: z.string().min(1),
  reason: z.string().min(1),
});

export const BuildDetectionResultSchema = z.object({
  status: z.enum(["detected", "requires-operator-input"]),
  strategy: z.enum([
    "upstand-config",
    "repository-config",
    "dockerfile",
    "framework",
    "static",
    "none",
  ]),
  framework: z.string().nullable(),
  language: z.string().nullable(),
  packageManager: z.string().nullable(),
  commands: z.object({
    install: z.string().nullable(),
    build: z.string().nullable(),
    start: z.string().nullable(),
  }),
  publishDirectory: z.string().nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  healthExpectations: z.object({
    path: z.string().startsWith("/").nullable(),
    startupTimeoutSeconds: z.number().int().positive(),
  }),
  confidence: z.number().min(0).max(1),
  evidence: z.array(BuildDetectionEvidenceSchema),
  warnings: z.array(z.string()),
  detectorVersion: z.literal(BUILD_DETECTOR_VERSION),
  buildPath: z.string().min(1),
  config: ApplicationBuildConfigSchema.nullable(),
});

export type BuildDetectionResult = z.infer<typeof BuildDetectionResultSchema>;

type Commands = BuildDetectionResult["commands"];

const EMPTY_COMMANDS: Commands = {
  install: null,
  build: null,
  start: null,
};

const LANGUAGE_MARKERS = [
  {
    language: "node",
    files: ["package.json"],
  },
  {
    language: "python",
    files: ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"],
  },
  { language: "go", files: ["go.mod"] },
  { language: "rust", files: ["Cargo.toml"] },
  {
    language: "java-kotlin",
    files: ["pom.xml", "build.gradle", "build.gradle.kts"],
  },
  { language: "php", files: ["composer.json", "artisan"] },
] as const;

export class BuildDetectionError extends Error {
  constructor(public readonly result: BuildDetectionResult) {
    super(result.warnings.join(" ") || "Build configuration requires input");
    this.name = "BuildDetectionError";
  }
}

function hasFile(targetDir: string, filename: string): boolean {
  return fs.existsSync(path.join(targetDir, filename));
}

function evidence(file: string, reason: string) {
  return { file, reason };
}

function detected(
  input: Omit<BuildDetectionResult, "status" | "detectorVersion">,
): BuildDetectionResult {
  return BuildDetectionResultSchema.parse({
    ...input,
    status: "detected",
    detectorVersion: BUILD_DETECTOR_VERSION,
  });
}

function operatorInput(
  buildPath: string,
  warnings: string[],
  detectedEvidence: BuildDetectionResult["evidence"] = [],
): BuildDetectionResult {
  return BuildDetectionResultSchema.parse({
    status: "requires-operator-input",
    strategy: "none",
    framework: null,
    language: null,
    packageManager: null,
    commands: EMPTY_COMMANDS,
    publishDirectory: null,
    port: null,
    healthExpectations: { path: null, startupTimeoutSeconds: 120 },
    confidence: 0,
    evidence: detectedEvidence,
    warnings,
    detectorVersion: BUILD_DETECTOR_VERSION,
    buildPath,
    config: null,
  });
}

function toApplicationBuildConfig(
  build: UpstandBuildConfig,
  fallbackBuildPath: string,
): ApplicationBuildConfig | null {
  if (!build.type) return null;
  const common = {
    autoDetect: false,
    buildPath: build.buildPath ?? fallbackBuildPath,
  };
  switch (build.type) {
    case "dockerfile":
      return ApplicationBuildConfigSchema.parse({
        ...common,
        type: build.type,
        dockerfilePath: build.dockerfilePath ?? "Dockerfile",
        dockerContextPath: build.dockerContextPath ?? ".",
        dockerBuildStage: build.dockerBuildStage,
        dockerBuildArgs: build.dockerBuildArgs ?? {},
        dockerNoCache: build.dockerNoCache ?? false,
        dockerCleanupCache: false,
      });
    case "static":
      return ApplicationBuildConfigSchema.parse({
        ...common,
        type: build.type,
        publishDirectory: build.publishDirectory ?? ".",
        spa: true,
      });
    case "nixpacks":
      return ApplicationBuildConfigSchema.parse({
        ...common,
        type: build.type,
        publishDirectory: build.publishDirectory,
      });
    case "railpack":
      return ApplicationBuildConfigSchema.parse({
        ...common,
        type: build.type,
        railpackVersion: "0.15.4",
      });
    case "heroku-buildpacks":
      return ApplicationBuildConfigSchema.parse({
        ...common,
        type: build.type,
        herokuVersion: "24",
      });
    case "paketo-buildpacks":
      return ApplicationBuildConfigSchema.parse({
        ...common,
        type: build.type,
      });
  }
}

function packageManager(targetDir: string): string | null {
  if (hasFile(targetDir, "bun.lock") || hasFile(targetDir, "bun.lockb"))
    return "bun";
  if (hasFile(targetDir, "pnpm-lock.yaml")) return "pnpm";
  if (hasFile(targetDir, "yarn.lock")) return "yarn";
  if (hasFile(targetDir, "package-lock.json")) return "npm";
  return hasFile(targetDir, "package.json") ? "npm" : null;
}

function nodeCommands(manager: string | null, scripts: Set<string>): Commands {
  const run = manager === "npm" ? "npm run" : `${manager ?? "npm"} run`;
  const install =
    manager === "bun"
      ? "bun install --frozen-lockfile"
      : manager === "pnpm"
        ? "pnpm install --frozen-lockfile"
        : manager === "yarn"
          ? "yarn install --immutable"
          : "npm ci";
  return {
    install,
    build: scripts.has("build") ? `${run} build` : null,
    start: scripts.has("start") ? `${run} start` : null,
  };
}

function readPackageJson(targetDir: string): {
  dependencies: Set<string>;
  scripts: Set<string>;
} {
  try {
    const value: unknown = JSON.parse(
      fs.readFileSync(path.join(targetDir, "package.json"), "utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("package.json must contain an object");
    }
    const record = value as Record<string, unknown>;
    const dependencyNames = [
      record.dependencies,
      record.devDependencies,
      record.peerDependencies,
    ].flatMap((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.keys(entry)
        : [],
    );
    const scripts =
      record.scripts &&
      typeof record.scripts === "object" &&
      !Array.isArray(record.scripts)
        ? Object.keys(record.scripts)
        : [];
    return {
      dependencies: new Set(dependencyNames),
      scripts: new Set(scripts),
    };
  } catch (error) {
    throw new Error(
      `package.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function nodeFramework(dependencies: Set<string>): {
  framework: string;
  port: number;
  publishDirectory: string | null;
} {
  const candidates = [
    ["next", "nextjs", 3000, ".next"],
    ["nuxt", "nuxt", 3000, ".output/public"],
    ["@sveltejs/kit", "sveltekit", 3000, "build"],
    ["@angular/core", "angular", 4200, "dist"],
    ["@remix-run/node", "remix", 3000, "build"],
    ["@nestjs/core", "nestjs", 3000, null],
    ["vite", "vite", 4173, "dist"],
    ["express", "express", 3000, null],
  ] as const;
  const match = candidates.find(([dependency]) => dependencies.has(dependency));
  return match
    ? { framework: match[1], port: match[2], publishDirectory: match[3] }
    : { framework: "node", port: 3000, publishDirectory: null };
}

interface LanguageEvidence {
  language: string;
  files: string[];
}

function languageEvidence(targetDir: string): LanguageEvidence[] {
  return LANGUAGE_MARKERS.flatMap((candidate) => {
    const files = candidate.files.filter((file) => hasFile(targetDir, file));
    return files.length > 0 ? [{ language: candidate.language, files }] : [];
  });
}

/**
 * Detect a build configuration with inspectable evidence. Ambiguous and empty
 * repositories deliberately require operator input instead of choosing a
 * plausible but potentially destructive build strategy.
 */
export function detectBuildConfig(
  workspacePath: string,
  relativeBuildPath = ".",
): BuildDetectionResult {
  const workspaceRoot = path.resolve(workspacePath);
  const buildPath = relativeBuildPath.trim() || ".";
  const targetDir = path.resolve(workspaceRoot, buildPath);
  if (
    targetDir !== workspaceRoot &&
    !targetDir.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    return operatorInput(buildPath, [
      "Build path escapes the repository root. Choose a repository-relative path.",
    ]);
  }
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return operatorInput(buildPath, [
      `Build path '${buildPath}' does not exist or is not a directory.`,
    ]);
  }

  const upstandPath = path.join(targetDir, "upstand.json");
  if (fs.existsSync(upstandPath)) {
    const parsed = parseUpstandConfig(fs.readFileSync(upstandPath, "utf8"));
    if (!parsed.success) {
      return operatorInput(
        buildPath,
        [`upstand.json is invalid: ${parsed.error}`],
        [evidence("upstand.json", "Explicit Upstand configuration is present")],
      );
    }
    if (parsed.data.build) {
      const config = toApplicationBuildConfig(parsed.data.build, buildPath);
      if (config) {
        return detected({
          strategy: "upstand-config",
          framework: null,
          language: null,
          packageManager: null,
          commands: EMPTY_COMMANDS,
          publishDirectory:
            "publishDirectory" in config
              ? (config.publishDirectory ?? null)
              : null,
          port: null,
          healthExpectations: { path: null, startupTimeoutSeconds: 120 },
          confidence: 1,
          evidence: [
            evidence("upstand.json", "Explicit build strategy selected"),
          ],
          warnings: [],
          buildPath: config.buildPath,
          config,
        });
      }
    }
  }

  const repositoryStrategies = [
    ["railpack.json", "railpack"],
    ["nixpacks.toml", "nixpacks"],
    ["project.toml", "paketo-buildpacks"],
    ["Procfile", "heroku-buildpacks"],
    ["app.json", "heroku-buildpacks"],
  ] as const;
  const repositoryConfig = repositoryStrategies.find(([file]) =>
    hasFile(targetDir, file),
  );
  if (repositoryConfig) {
    const [file, type] = repositoryConfig;
    const config = ApplicationBuildConfigSchema.parse(
      type === "railpack"
        ? { type, autoDetect: true, buildPath, railpackVersion: "0.15.4" }
        : type === "heroku-buildpacks"
          ? { type, autoDetect: true, buildPath, herokuVersion: "24" }
          : { type, autoDetect: true, buildPath },
    );
    return detected({
      strategy: "repository-config",
      framework: null,
      language: null,
      packageManager: null,
      commands: EMPTY_COMMANDS,
      publishDirectory: null,
      port: null,
      healthExpectations: { path: null, startupTimeoutSeconds: 120 },
      confidence: 0.98,
      evidence: [evidence(file, `Repository config selects ${type}`)],
      warnings: [],
      buildPath,
      config,
    });
  }

  const dockerfile = hasFile(targetDir, "Dockerfile")
    ? "Dockerfile"
    : hasFile(targetDir, "dockerfile")
      ? "dockerfile"
      : null;
  if (dockerfile) {
    return detected({
      strategy: "dockerfile",
      framework: null,
      language: null,
      packageManager: null,
      commands: EMPTY_COMMANDS,
      publishDirectory: null,
      port: null,
      healthExpectations: { path: null, startupTimeoutSeconds: 120 },
      confidence: 0.97,
      evidence: [
        evidence(dockerfile, "Container build instructions are present"),
      ],
      warnings: [],
      buildPath,
      config: ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "dockerfile",
        buildPath,
        dockerfilePath: dockerfile,
        dockerContextPath: ".",
        dockerBuildArgs: {},
        dockerNoCache: false,
        dockerCleanupCache: false,
      }),
    });
  }

  const languages: LanguageEvidence[] = languageEvidence(targetDir);
  const dotnetFiles = fs
    .readdirSync(targetDir)
    .filter((file) => file.endsWith(".csproj") || file.endsWith(".sln"));
  if (dotnetFiles.length > 0) {
    languages.push({ language: "dotnet", files: dotnetFiles });
  }
  if (languages.length > 1) {
    return operatorInput(
      buildPath,
      [
        `Conflicting top-level language signals (${languages.map((item) => item.language).join(", ")}). Set build.type/buildPath in upstand.json.`,
      ],
      languages.flatMap((item) =>
        item.files.map((file) =>
          evidence(file, `${item.language} project marker is present`),
        ),
      ),
    );
  }

  const language = languages[0];
  if (language) {
    let framework: string = language.language;
    let manager: string | null = null;
    let commands = EMPTY_COMMANDS;
    let port = 3000;
    let publishDirectory: string | null = null;
    if (language.language === "node") {
      try {
        const packageJson = readPackageJson(targetDir);
        manager = packageManager(targetDir);
        commands = nodeCommands(manager, packageJson.scripts);
        const detectedFramework = nodeFramework(packageJson.dependencies);
        framework = detectedFramework.framework;
        port = detectedFramework.port;
        publishDirectory = detectedFramework.publishDirectory;
      } catch (error) {
        return operatorInput(
          buildPath,
          [error instanceof Error ? error.message : String(error)],
          [evidence("package.json", "Node project marker is present")],
        );
      }
    } else if (language.language === "python") {
      const requirements = ["requirements.txt", "pyproject.toml"]
        .filter((file) => hasFile(targetDir, file))
        .map((file) => fs.readFileSync(path.join(targetDir, file), "utf8"))
        .join("\n")
        .toLowerCase();
      framework = requirements.includes("django")
        ? "django"
        : requirements.includes("fastapi")
          ? "fastapi"
          : requirements.includes("flask")
            ? "flask"
            : "python";
      port = 8000;
      commands = {
        install: hasFile(targetDir, "requirements.txt")
          ? "pip install -r requirements.txt"
          : "pip install .",
        build: null,
        start: null,
      };
    } else if (language.language === "go") {
      port = 8080;
      commands = {
        install: "go mod download",
        build: "go build ./...",
        start: null,
      };
    } else if (language.language === "rust") {
      port = 8080;
      commands = {
        install: "cargo fetch --locked",
        build: "cargo build --release --locked",
        start: null,
      };
    } else if (language.language === "java-kotlin") {
      framework =
        hasFile(targetDir, "pom.xml") ||
        hasFile(targetDir, "build.gradle") ||
        hasFile(targetDir, "build.gradle.kts")
          ? "spring-or-jvm"
          : language.language;
      port = 8080;
    } else if (language.language === "php") {
      framework = hasFile(targetDir, "artisan") ? "laravel" : "php";
      port = 8080;
      commands = {
        install: "composer install --no-dev --prefer-dist --no-interaction",
        build: null,
        start: null,
      };
    } else if (language.language === "dotnet") {
      framework = "dotnet";
      port = 8080;
      commands = {
        install: "dotnet restore",
        build: "dotnet publish -c Release",
        start: null,
      };
    }
    return detected({
      strategy: "framework",
      framework,
      language: language.language,
      packageManager: manager,
      commands,
      publishDirectory,
      port,
      healthExpectations: { path: "/", startupTimeoutSeconds: 120 },
      confidence: 0.85,
      evidence: language.files.map((file) =>
        evidence(file, `${language.language} project marker is present`),
      ),
      warnings:
        commands.start === null
          ? [
              "No explicit start command was found; verify runtime launch settings.",
            ]
          : [],
      buildPath,
      config: ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "railpack",
        buildPath,
        railpackVersion: "0.15.4",
      }),
    });
  }

  if (hasFile(targetDir, "index.html")) {
    return detected({
      strategy: "static",
      framework: "static",
      language: "html",
      packageManager: null,
      commands: EMPTY_COMMANDS,
      publishDirectory: ".",
      port: 80,
      healthExpectations: { path: "/", startupTimeoutSeconds: 30 },
      confidence: 0.9,
      evidence: [evidence("index.html", "Static site entry point is present")],
      warnings: [],
      buildPath,
      config: ApplicationBuildConfigSchema.parse({
        autoDetect: true,
        type: "static",
        buildPath,
        publishDirectory: ".",
        spa: true,
      }),
    });
  }

  return operatorInput(buildPath, [
    "No supported build evidence was found. Configure build.type and buildPath in upstand.json.",
  ]);
}
