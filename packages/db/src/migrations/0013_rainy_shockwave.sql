CREATE TABLE "backup_run" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"file_key" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"retention_count" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"database_name" text,
	"database_engine" text,
	"service_name" text,
	"volume_name" text,
	"stop_service" boolean DEFAULT false NOT NULL,
	"encrypted_configuration" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_schedule_id_backup_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."backup_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_destination_id_s3_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."s3_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_destination_id_s3_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."s3_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_run_schedule_created_idx" ON "backup_run" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_run_resource_created_idx" ON "backup_run" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_run_status_idx" ON "backup_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backup_schedule_resource_idx" ON "backup_schedule" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_enabled_idx" ON "backup_schedule" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "deployment_created_idx" ON "deployment" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deployment_resource_created_idx" ON "deployment" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "deployment_server_status_idx" ON "deployment" USING btree ("server_id","status");