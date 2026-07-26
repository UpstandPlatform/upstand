CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "certificate" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"certificate_pem" text NOT NULL,
	"private_key_pem" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_tag" (
	"resource_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tags" text DEFAULT '[]' NOT NULL,
	"compose_file" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_run" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "scim_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "source_revision" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "build_registry_id" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "rollback_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "rollback_registry_id" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "external_port" integer;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "libsql_grpc_port" integer;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "libsql_admin_port" integer;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "trigger_type" text DEFAULT 'push' NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "watch_paths" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "webhook_token_hash" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "webhook_token_prefix" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "build_secrets" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "caddy_middlewares" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "app_name" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "app_description" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "favicon_url" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "custom_css" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "login_logo_url" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "support_url" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "docs_url" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "meta_title" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "footer_text" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "job_type" text DEFAULT 'command' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "backup_schedule_id" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role" ADD CONSTRAINT "custom_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_provider" ADD CONSTRAINT "scim_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tag" ADD CONSTRAINT "resource_tag_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tag" ADD CONSTRAINT "resource_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_role_organization_name_idx" ON "custom_role" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "custom_role_organization_idx" ON "custom_role" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_provider_organization_provider_uidx" ON "scim_provider" USING btree ("organization_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_provider_token_hash_uidx" ON "scim_provider" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_provider_organization_idx" ON "scim_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_tag_uidx" ON "resource_tag" USING btree ("resource_id","tag_id");--> statement-breakpoint
CREATE INDEX "resource_tag_resource_idx" ON "resource_tag" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_tag_tag_idx" ON "resource_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_organization_name_uidx" ON "tag" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "tag_organization_idx" ON "tag" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_organization_name_uidx" ON "template" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "template_organization_idx" ON "template" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_build_registry_id_docker_registry_id_fk" FOREIGN KEY ("build_registry_id") REFERENCES "public"."docker_registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_rollback_registry_id_docker_registry_id_fk" FOREIGN KEY ("rollback_registry_id") REFERENCES "public"."docker_registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_backup_schedule_id_backup_schedule_id_fk" FOREIGN KEY ("backup_schedule_id") REFERENCES "public"."backup_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_webhook_token_hash_unique" UNIQUE("webhook_token_hash");