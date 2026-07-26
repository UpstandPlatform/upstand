import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const configDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(configDir, "../../apps/server/.env"),
  // A caller-provided DATABASE_URL must win. This is essential for CI,
  // migrations in containers, and a self-hosted install where no repo-local
  // development .env file exists.
  override: false,
});
dotenv.config({
  path: path.resolve(configDir, "../../.env"),
  override: false,
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before running Drizzle Kit");
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
