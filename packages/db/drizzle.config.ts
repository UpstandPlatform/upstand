import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@upstand/env/server";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const configDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(configDir, "../../apps/server/.env"),
  override: false,
});
dotenv.config({
  path: path.resolve(configDir, "../../.env"),
  override: false,
});

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/upstand";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
