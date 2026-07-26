ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
ALTER TABLE "resource_secret" ADD COLUMN IF NOT EXISTS "build_env_vars" text;--> statement-breakpoint
ALTER TABLE "secret_version" ADD COLUMN IF NOT EXISTS "build_env_vars" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployment_retry_idx" ON "deployment" USING btree ("status","retry_at");
