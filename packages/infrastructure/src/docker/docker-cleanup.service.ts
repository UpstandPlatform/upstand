import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export const DockerCleanupActionSchema = z.enum([
  "images",
  "volumes",
  "containers",
  "builder",
  "networks",
  "system",
  "all",
]);
export type DockerCleanupAction = z.infer<typeof DockerCleanupActionSchema>;

export const DockerCleanupOptionsSchema = z.object({
  preserveRollbackImages: z.boolean().default(true),
  pruneNetworks: z.boolean().default(false),
});
export type DockerCleanupOptions = z.infer<typeof DockerCleanupOptionsSchema>;

const ACTION_ARGS: Record<
  Exclude<DockerCleanupAction, "all" | "images" | "system">,
  string[]
> = {
  volumes: ["volume", "prune", "--all", "--force"],
  containers: ["container", "prune", "--force"],
  builder: ["builder", "prune", "--all", "--force"],
  networks: ["network", "prune", "--force"],
};

const ALL_ACTIONS: Array<Exclude<DockerCleanupAction, "all">> = [
  "containers",
  "images",
  "volumes",
  "builder",
  "system",
  "networks",
];

type CommandResult = { stdout: string; stderr: string };
type CommandExecutor = (
  args: string[],
  environment: Record<string, string | undefined>,
  signal?: AbortSignal,
) => Promise<CommandResult>;

async function executeDocker(
  args: string[],
  environment: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return execFileAsync("docker", args, {
    env: { ...process.env, ...environment },
    maxBuffer: 2 * 1024 * 1024,
    signal,
  });
}

export class DockerCleanupService {
  constructor(private readonly execute: CommandExecutor = executeDocker) {}

  async run(
    action: DockerCleanupAction,
    environment: Record<string, string | undefined> = {},
    options: Partial<DockerCleanupOptions> = {},
    signal?: AbortSignal,
  ): Promise<{ action: DockerCleanupAction; output: string[] }> {
    const parsed = DockerCleanupActionSchema.parse(action);
    const cleanupOptions = DockerCleanupOptionsSchema.parse(options);
    const actions =
      parsed === "all"
        ? ALL_ACTIONS.filter(
            (current) => current !== "networks" || cleanupOptions.pruneNetworks,
          )
        : [parsed];
    const output: string[] = [];
    for (const current of actions) {
      const args =
        current === "images"
          ? [
              "image",
              "prune",
              "--all",
              "--force",
              ...(cleanupOptions.preserveRollbackImages
                ? ["--filter", "label!=com.upstand.rollback.keep=true"]
                : []),
            ]
          : current === "system"
            ? [
                "system",
                "prune",
                "--all",
                "--force",
                ...(cleanupOptions.preserveRollbackImages
                  ? ["--filter", "label!=com.upstand.rollback.keep=true"]
                  : []),
              ]
            : ACTION_ARGS[current];
      const result = await this.execute(args, environment, signal);
      output.push(
        `${current}: ${[result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n")
          .trim()}`,
      );
    }
    return { action: parsed, output };
  }
}
