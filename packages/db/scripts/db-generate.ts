import path from "node:path";
import { env, getInheritedEnv } from "@upstand/env/server";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(import.meta.dir, "../../../apps/server/.env"),
});

const required = [
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
] as const;

const requiredValues = {
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
  CORS_ORIGIN: env.CORS_ORIGIN,
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  DATABASE_URL: env.DATABASE_URL,
};
for (const name of required) {
  if (!requiredValues[name]) {
    throw new Error(
      `${name} must be set before generating the database schema`,
    );
  }
}

const generatorEnv = {
  ...getInheritedEnv(),
  SKIP_ENV_VALIDATION: "1",
};
const cwd = path.resolve(import.meta.dir, "..");
const generatorOptions = process.argv.slice(2);

function run(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "x", ...args],
    cwd,
    env: generatorEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!result.success) {
    throw new Error(`Database generation command failed: ${args.join(" ")}`);
  }
}

// Generate Better Auth's core and plugin tables from the composition root so
// the checked-in Drizzle schema cannot silently drift from the runtime auth
// configuration. The CLI output is then consumed by Drizzle Kit below along
// with Upstand-owned tables.
run([
  "@better-auth/cli@1.4.21",
  "generate",
  "--cwd",
  cwd,
  "--config",
  "../api/src/auth.ts",
  "--output",
  "src/schema/auth.ts",
  "--yes",
]);
run(["biome", "check", "--write", "src/schema/auth.ts"]);

run(["drizzle-kit", "generate", ...generatorOptions]);

// Keep generated metadata aligned with the repository formatter so the CI
// migration check is reproducible after a clean checkout.
run(["biome", "format", "--write", "src/migrations/meta"]);
