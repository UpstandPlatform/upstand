CREATE INDEX "docker_registry_organization_idx" ON "docker_registry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "docker_registry_server_idx" ON "docker_registry" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "environment_project_idx" ON "environment" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_project_slug_uidx" ON "environment" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "project_organization_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "server_organization_idx" ON "server" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "server_ssh_key_idx" ON "server" USING btree ("ssh_key_id");