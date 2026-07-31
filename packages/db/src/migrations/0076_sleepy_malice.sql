CREATE TABLE "project_migration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_server_id" text NOT NULL,
	"target_server_id" text NOT NULL,
	"status" text DEFAULT 'scanning' NOT NULL,
	"workloads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "project_migration_project_idx" ON "project_migration" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_migration_org_idx" ON "project_migration" USING btree ("organization_id","created_at");