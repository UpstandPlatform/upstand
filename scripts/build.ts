import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");

async function run(command: string[], cwd = workspaceRoot): Promise<void> {
  const processRef = Bun.spawn(command, {
    cwd,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await processRef.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

// Desktop stages the server and web production payloads into its installer.
// Build those producers first so Turbo cannot start the copy step concurrently.
await run(["bunx", "turbo", "run", "build", "--filter=!desktop"]);
await run(["bun", "run", "build"], resolve(workspaceRoot, "apps", "desktop"));
