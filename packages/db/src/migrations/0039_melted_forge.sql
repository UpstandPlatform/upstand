CREATE TABLE "schedule_log" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"resource_id" text,
	"status" text NOT NULL,
	"status_code" integer,
	"duration_ms" integer NOT NULL,
	"response_body" text,
	"error_message" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "cron_jobs_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "service_name" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "shell_type" text DEFAULT 'bash' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "last_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "last_run_status" text;--> statement-breakpoint
ALTER TABLE "schedule_log" ADD CONSTRAINT "schedule_log_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_log" ADD CONSTRAINT "schedule_log_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_log_schedule_idx" ON "schedule_log" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_log_resource_idx" ON "schedule_log" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "schedule_log_executed_idx" ON "schedule_log" USING btree ("executed_at");