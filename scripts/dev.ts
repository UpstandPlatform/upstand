import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const modeArgument = process.argv
  .slice(2)
  .find((argument) => ["--cloud", "--self-hosted"].includes(argument));
const modeLabel = modeArgument === "--cloud" ? "Cloud" : "Self-Hosted";
if (modeArgument) {
  process.env.IS_CLOUD = modeArgument === "--cloud" ? "true" : "false";
}

console.log("========================================================");
console.log(`🚀 Upstand ${modeLabel} Development Environment Starting`);
console.log("========================================================\n");

const setup = Bun.spawn({
  cmd: [
    process.execPath,
    "run",
    "scripts/setup.ts",
    "--skip-install",
    ...(modeArgument ? [modeArgument] : []),
  ],
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

if ((await setup.exited) !== 0) {
  console.error("❌ Setup failed. Fix errors above and restart this dev mode.");
  process.exit(1);
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

const dev = Bun.spawn({
  cmd: [process.execPath, "x", "turbo", "run", "dev"],
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.on("SIGINT", () => {
  dev.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  dev.kill();
  process.exit(0);
});

process.exit(await dev.exited);
