ALTER TABLE "deployment" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "max_attempts" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "heartbeat_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "retry_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "last_error" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployment_retry_idx" ON "deployment" USING btree ("status","retry_at");
