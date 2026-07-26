ALTER TABLE "resource_secret" ADD COLUMN IF NOT EXISTS "build_env_vars" text;
--> statement-breakpoint
ALTER TABLE "secret_version" ADD COLUMN IF NOT EXISTS "build_env_vars" text;
