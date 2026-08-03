import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ProjectLink } from "./types";

const DEFAULT_API_URL = "https://api.upstand.dev";

const LinkSchema = z.object({
  apiUrl: z.string().url(),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  environmentId: z.string().min(1),
  createdAt: z.string().datetime(),
});

type UserConfig = { apiUrl?: string; token?: string };

function configDirectory(): string {
  const explicit = process.env.UPSTAND_CONFIG_DIR?.trim();
  if (explicit) return resolve(explicit);
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "upstand",
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "upstand",
  );
}

function configPath(): string {
  return join(configDirectory(), "config.json");
}

export function projectLinkPath(cwd = process.cwd()): string {
  return join(cwd, ".upstand", "project.json");
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32")
    await chmod(path, 0o600).catch(() => undefined);
}

export function defaultApiUrl(): string {
  return (process.env.UPSTAND_URL?.trim() || DEFAULT_API_URL).replace(
    /\/$/,
    "",
  );
}

export async function readUserConfig(): Promise<UserConfig> {
  return (await readJson<UserConfig>(configPath())) ?? {};
}

export async function saveToken(token: string, apiUrl: string): Promise<void> {
  await writePrivateJson(configPath(), {
    token,
    apiUrl: apiUrl.replace(/\/$/, ""),
  });
}

export async function clearToken(): Promise<void> {
  const config = await readUserConfig();
  delete config.token;
  await writePrivateJson(configPath(), config);
}

export async function readProjectLink(
  cwd = process.cwd(),
): Promise<ProjectLink | undefined> {
  const value = await readJson<unknown>(projectLinkPath(cwd));
  return value ? LinkSchema.parse(value) : undefined;
}

export async function writeProjectLink(
  link: ProjectLink,
  cwd = process.cwd(),
): Promise<void> {
  await writePrivateJson(projectLinkPath(cwd), link);
}

export async function removeProjectLink(cwd = process.cwd()): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(projectLinkPath(cwd));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
