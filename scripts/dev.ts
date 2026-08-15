import path from "node:path";
import {
  claimDevRuntime,
  type DevMode,
  releaseDevRuntime,
  stopProcessTree,
} from "./dev-runtime";

const root = path.resolve(import.meta.dir, "..");
const modeArgument = process.argv
  .slice(2)
  .find((argument) => ["--cloud", "--self-hosted"].includes(argument));
const mode: DevMode = modeArgument === "--cloud" ? "cloud" : "self-hosted";
const effectiveModeArgument = mode === "cloud" ? "--cloud" : "--self-hosted";
const modeLabel = mode === "cloud" ? "Cloud" : "Self-Hosted";

process.env.IS_CLOUD = mode === "cloud" ? "true" : "false";
process.env.LOCAL_EXPECTED_MODE = mode;

let devProcess: Bun.Subprocess | undefined;
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (devProcess) {
    await stopProcessTree(devProcess.pid).catch(() => devProcess?.kill());
  }
}

const runtimeState = await claimDevRuntime(mode, root);
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

let exitCode = 0;
try {
  console.log("========================================================");
  console.log(`🚀 Upstand ${modeLabel} Development Environment Starting`);
  console.log("========================================================\n");

  const setup = Bun.spawn({
    cmd: [
      process.execPath,
      "run",
      "scripts/setup.ts",
      "--skip-install",
      effectiveModeArgument,
    ],
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  if ((await setup.exited) !== 0) {
    throw new Error(
      "Setup failed. Fix the errors above and restart this dev mode.",
    );
  }

  console.log("========================================================");
  console.log(`🌐 Local ${modeLabel} Development Endpoints Ready:`);
  console.log("   • Web Dashboard:  http://localhost:3001");
  console.log("   • API Server:     http://localhost:3000");
  console.log("   • API OpenAPI:    http://localhost:3000/api/docs/");
  console.log("   • Docs Site:      http://localhost:4000");
  console.log("========================================================\n");
  console.log(
    "📡 Streaming live Turbo workspace logs (Press Ctrl+C to stop)...\n",
  );

  devProcess = Bun.spawn({
    cmd: [process.execPath, "x", "turbo", "run", "dev"],
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  const verification = Bun.spawn({
    cmd: [process.execPath, "run", "scripts/verify-dev.ts"],
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      LOCAL_RUNTIME: "host",
      LOCAL_EXPECTED_MODE: mode,
    },
  });

  if ((await verification.exited) !== 0) {
    throw new Error("The local development runtime did not become ready.");
  }

  exitCode = await devProcess.exited;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await shutdown();
  releaseDevRuntime(runtimeState.pid);
}

process.exit(exitCode);
