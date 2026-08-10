ALTER TABLE "deployment" ADD COLUMN "deployment_plan" jsonb;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "deploy_target" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "execution_runtime" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "build_location" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "data_ownership" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "artifact_digest" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "configuration_version" text;--> statement-breakpoint
CREATE INDEX "deployment_artifact_digest_idx" ON "deployment" USING btree ("artifact_digest");