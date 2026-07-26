import path from "node:path";
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

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(
      `${name} must be set before generating the database schema`,
    );
  }
}

const env = {
  ...process.env,
  SKIP_ENV_VALIDATION: "1",
};
const cwd = path.resolve(import.meta.dir, "..");
const generatorOptions = process.argv.slice(2);

function run(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "x", ...args],
    cwd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!result.success) {
    throw new Error(`Database generation command failed: ${args.join(" ")}`);
  }
}

// Better Auth's CLI must match the Better Auth runtime exactly. The
// workspace intentionally keeps migration generation in Drizzle so schema
// changes are generated from the checked-in TypeScript schema without
// rewriting the auth tables through a separately versioned CLI.
run(["drizzle-kit", "generate", ...generatorOptions]);

// Keep generated metadata aligned with the repository formatter so the CI
// migration check is reproducible after a clean checkout.
run(["biome", "format", "--write", "src/migrations/meta"]);
