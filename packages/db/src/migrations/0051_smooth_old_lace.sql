ALTER TABLE "environment" ADD COLUMN "parent_environment_id" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "inherits_variables" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "environment_parent_idx" ON "environment" USING btree ("parent_environment_id");