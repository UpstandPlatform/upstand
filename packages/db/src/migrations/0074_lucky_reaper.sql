ALTER TABLE "project" ADD COLUMN "is_app" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "app_catalog_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "app_verified" boolean;--> statement-breakpoint
CREATE INDEX "project_app_catalog_idx" ON "project" USING btree ("app_catalog_id");