ALTER TABLE "deployment" ADD COLUMN "execution_token" text;--> statement-breakpoint
CREATE INDEX "deployment_execution_lease_idx" ON "deployment" USING btree ("status","updated_at");