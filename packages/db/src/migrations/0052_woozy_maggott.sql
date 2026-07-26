CREATE TABLE "secret_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_configuration" text NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_version" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"version" integer NOT NULL,
	"credentials" text,
	"build_secrets" text,
	"env_vars" text NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_provider" ADD CONSTRAINT "secret_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_provider_organization_idx" ON "secret_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_version_scope_version_uidx" ON "secret_version" USING btree ("scope_type","scope_id","version");--> statement-breakpoint
CREATE INDEX "secret_version_scope_idx" ON "secret_version" USING btree ("scope_type","scope_id","created_at");