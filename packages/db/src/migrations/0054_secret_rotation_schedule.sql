CREATE TABLE "secret_rotation_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"keys" text NOT NULL,
	"interval_hours" integer NOT NULL,
	"value_length" integer DEFAULT 32 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_rotated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_rotation_schedule" ADD CONSTRAINT "secret_rotation_schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_rotation_schedule_org_idx" ON "secret_rotation_schedule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "secret_rotation_schedule_due_idx" ON "secret_rotation_schedule" USING btree ("enabled","last_rotated_at");--> statement-breakpoint
CREATE INDEX "secret_rotation_schedule_scope_idx" ON "secret_rotation_schedule" USING btree ("scope_type","scope_id");