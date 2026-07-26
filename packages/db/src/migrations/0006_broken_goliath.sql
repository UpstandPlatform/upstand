CREATE TABLE "s3_destination" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_access_key" text NOT NULL,
	"bucket" text NOT NULL,
	"region" text NOT NULL,
	"endpoint" text NOT NULL,
	"additional_flags" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "s3_destination" ADD CONSTRAINT "s3_destination_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;