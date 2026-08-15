import { defaultApiUrl, readUserConfig } from "./config";
import type { CommandContext, GlobalOptions, OutputMode } from "./types";

export async function parseArgs(argv: string[]): Promise<CommandContext> {
  const config = await readUserConfig();
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  const booleanFlags = new Set([
    "help",
    "include-archived",
    "include-secrets",
    "force",
    "json",
    "silent",
    "version",
    "yes",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      positionals.push(arg ?? "");
      continue;
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      flags.set(raw.slice(0, equals), raw.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (!booleanFlags.has(raw) && next && !next.startsWith("--")) {
      flags.set(raw, next);
      index += 1;
    } else flags.set(raw, true);
  }
  const output: OutputMode = flags.has("json")
    ? "json"
    : flags.has("silent")
      ? "silent"
      : "human";
  const value = (name: string): string | undefined => {
    const item = flags.get(name);
    return typeof item === "string" ? item : undefined;
  };
  const options: GlobalOptions = {
    apiUrl: (
      value("url") ||
      process.env.UPSTAND_URL ||
      config.apiUrl ||
      defaultApiUrl()
    ).replace(/\/$/, ""),
    token: value("token") || process.env.UPSTAND_TOKEN || config.token,
    sessionCookie: process.env.UPSTAND_SESSION_COOKIE,
    output,
    yes: flags.has("yes"),
    organizationId:
      value("organization") || value("org") || config.organizationId,
    projectId: value("project"),
    environmentId: value("environment") || value("env"),
  };
  return { options, positionals, flags };
}

export function flag(
  context: CommandContext,
  name: string,
): string | undefined {
  const item = context.flags.get(name);
  return typeof item === "string" ? item : undefined;
}
