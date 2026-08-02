import {
  type ApplicationBuildConfig,
  ApplicationBuildConfigSchema,
} from "@upstand/domain";
import { z } from "zod";

export const RAILPACK_VERSIONS = [
  "0.15.4",
  "0.16.0",
  "0.17.0",
  "0.18.0",
  "0.19.0",
  "0.20.0",
  "0.21.0",
  "0.22.0",
  "0.23.0",
] as const;

export type ResourceProvider =
  | "docker"
  | "github"
  | "gitlab"
  | "bitbucket"
  | "gitea"
  | "git"
  | "raw"
  | "drop";

export type DatabaseCredentials = Record<string, string>;

const ResourceCredentialsSchema = z
  .object({
    provider: z.string().optional(),
    registryId: z.string().optional(),
    buildRegistryId: z.string().optional(),
    rollbackActive: z.boolean().optional(),
    rollbackRegistryId: z.string().optional(),
    autoDeploy: z.boolean().optional(),
    githubAccount: z.string().optional(),
    repository: z.string().optional(),
    branch: z.string().optional(),
    composePath: z.string().optional(),
    triggerType: z.string().optional(),
    watchPaths: z.array(z.string()).optional(),
    enableSubmodules: z.boolean().optional(),
    repositoryUrl: z.string().optional(),
    sshKeyId: z.string().optional(),
    sshHostKeyFingerprint: z.string().optional(),
    composeFile: z.string().optional(),
  })
  .catchall(z.unknown());
export type ResourceCredentials = z.infer<typeof ResourceCredentialsSchema>;

export function toStringRecord(
  value: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function parseJsonObject(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return z.record(z.string(), z.unknown()).parse(parsed);
  } catch {
    return {};
  }
}

const defaultDockerfileBuildConfig = (): ApplicationBuildConfig => ({
  autoDetect: true,
  type: "dockerfile",
  buildPath: ".",
  dockerfilePath: "Dockerfile",
  dockerContextPath: ".",
  dockerBuildArgs: {},
  dockerNoCache: false,
  dockerCleanupCache: false,
});

export function parseApplicationBuildConfig(
  value: string | null | undefined,
): ApplicationBuildConfig {
  if (!value) return defaultDockerfileBuildConfig();
  try {
    return ApplicationBuildConfigSchema.parse(JSON.parse(value));
  } catch {
    return defaultDockerfileBuildConfig();
  }
}

export function parseResourceCredentials(
  value: string | null | undefined,
): ResourceCredentials | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return ResourceCredentialsSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function createBuildConfig(
  type: ApplicationBuildConfig["type"],
  autoDetect = true,
): ApplicationBuildConfig {
  switch (type) {
    case "dockerfile":
      return { ...defaultDockerfileBuildConfig(), autoDetect };
    case "railpack":
      return { autoDetect, type, buildPath: ".", railpackVersion: "0.15.4" };
    case "nixpacks":
      return { autoDetect, type, buildPath: "." };
    case "heroku-buildpacks":
      return { autoDetect, type, buildPath: ".", herokuVersion: "24" };
    case "paketo-buildpacks":
      return { autoDetect, type, buildPath: "." };
    case "static":
      return {
        autoDetect,
        type,
        buildPath: ".",
        publishDirectory: "dist",
        spa: true,
      };
  }
}
