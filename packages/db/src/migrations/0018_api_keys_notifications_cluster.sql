CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 3600000,
	"rate_limit_max" integer DEFAULT 1000,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "next_attempt_at" timestamp;--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_idempotency_uidx" ON "notification_delivery" USING btree ("idempotency_key");
