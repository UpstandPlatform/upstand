CREATE TABLE "edge_migration" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "edge_migration_status_idx" ON "edge_migration" USING btree ("status","updated_at");