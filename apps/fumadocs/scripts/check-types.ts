import { spawnSync } from "node:child_process";

function run(args: string[], env = process.env): void {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const typecheckEnv = {
  ...process.env,
  SKIP_ENV_VALIDATION: "1",
  NEXT_PHASE: "phase-production-build",
};

// Generate the Fumadocs source files before any command imports them.
run(["x", "fumadocs-mdx"], typecheckEnv);

// next typegen loads next.config.mjs. Prevent its asynchronous Fumadocs
// plugin initialization from racing with the generated source above.
run(["x", "next", "typegen"], {
  ...typecheckEnv,
  _FUMADOCS_MDX: "1",
});

run(["x", "tsc", "--noEmit"], typecheckEnv);
