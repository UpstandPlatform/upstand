CREATE TABLE "ai_feature_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"feature" text NOT NULL,
	"provider_config_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "ai_provider_config_org_uidx";--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "name" text DEFAULT 'Default' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_feature_assignment" ADD CONSTRAINT "ai_feature_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feature_assignment" ADD CONSTRAINT "ai_feature_assignment_provider_config_id_ai_provider_config_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."ai_provider_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_feature_assignment_org_feature_uidx" ON "ai_feature_assignment" USING btree ("organization_id","feature");--> statement-breakpoint
CREATE INDEX "ai_feature_assignment_org_idx" ON "ai_feature_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_provider_config_org_idx" ON "ai_provider_config" USING btree ("organization_id","created_at");