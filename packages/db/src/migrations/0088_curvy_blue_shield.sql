CREATE TABLE "workload_migration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"source_server_id" text NOT NULL,
	"target_server_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"execution_token" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"cleanup_confirmed" boolean DEFAULT false NOT NULL,
	"source_retained" boolean DEFAULT true NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"heartbeat_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workload_migration" ADD CONSTRAINT "workload_migration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_migration" ADD CONSTRAINT "workload_migration_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_migration" ADD CONSTRAINT "workload_migration_deployment_id_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workload_migration_active_resource_uidx" ON "workload_migration" USING btree ("resource_id") WHERE "workload_migration"."status" NOT IN ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "workload_migration_org_created_idx" ON "workload_migration" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "workload_migration_resumable_idx" ON "workload_migration" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "workload_migration_target_idx" ON "workload_migration" USING btree ("target_server_id","status");