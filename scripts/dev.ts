import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

const setup = Bun.spawn({
  cmd: [process.execPath, "run", "scripts/setup.ts", "--skip-install"],
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

if ((await setup.exited) !== 0) {
  process.exit(1);
}

const dev = Bun.spawn({
  cmd: [process.execPath, "x", "turbo", "run", "dev"],
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await dev.exited);
