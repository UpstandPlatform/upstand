ALTER TABLE "deployment" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "max_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "resource_secret" ADD COLUMN "build_env_vars" text;--> statement-breakpoint
ALTER TABLE "secret_version" ADD COLUMN "build_env_vars" text;--> statement-breakpoint
CREATE INDEX "deployment_retry_idx" ON "deployment" USING btree ("status","retry_at");