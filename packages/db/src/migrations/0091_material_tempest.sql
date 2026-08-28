ALTER TABLE "ai_run" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "total_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane_identity" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversation_org_id_uidx" ON "ai_conversation" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_config_org_id_uidx" ON "ai_provider_config" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_run_org_id_uidx" ON "ai_run" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_organization_id_uidx" ON "certificate" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_channel_organization_id_uidx" ON "notification_channel" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_organization_id_uidx" ON "server" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_organization_id_uidx" ON "ssh_key" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_organization_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "s3_destination" ADD CONSTRAINT "s3_destination_organization_id_unique" UNIQUE("organization_id","id");