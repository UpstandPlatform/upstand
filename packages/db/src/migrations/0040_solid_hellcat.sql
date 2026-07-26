CREATE INDEX "backup_run_organization_idx" ON "backup_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "backup_run_destination_idx" ON "backup_run" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_organization_idx" ON "backup_schedule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_destination_idx" ON "backup_schedule" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "resource_environment_idx" ON "resource" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "resource_server_idx" ON "resource" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "resource_build_server_idx" ON "resource" USING btree ("build_server_id");--> statement-breakpoint
CREATE INDEX "resource_build_registry_idx" ON "resource" USING btree ("build_registry_id");--> statement-breakpoint
CREATE INDEX "resource_rollback_registry_idx" ON "resource" USING btree ("rollback_registry_id");--> statement-breakpoint
CREATE INDEX "schedule_backup_schedule_idx" ON "schedule" USING btree ("backup_schedule_id");