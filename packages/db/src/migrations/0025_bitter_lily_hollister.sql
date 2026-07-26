CREATE TABLE "preview_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"pull_request_id" integer NOT NULL,
	"branch_name" text NOT NULL,
	"app_name" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "preview_deployment_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"command" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_settings" (
	"server_id" text PRIMARY KEY NOT NULL,
	"cpu_threshold" integer DEFAULT 90 NOT NULL,
	"memory_threshold" integer DEFAULT 90 NOT NULL,
	"alert_email" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "build_server_id" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "is_preview_deployments_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "preview_limit" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "preview_wildcard" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "preview_https" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "preview_port" integer DEFAULT 3000 NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_settings" ADD CONSTRAINT "monitoring_settings_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_deployment_resource_idx" ON "preview_deployment" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "preview_deployment_status_idx" ON "preview_deployment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedule_resource_idx" ON "schedule" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "schedule_enabled_idx" ON "schedule" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_build_server_id_server_id_fk" FOREIGN KEY ("build_server_id") REFERENCES "public"."server"("id") ON DELETE set null ON UPDATE no action;