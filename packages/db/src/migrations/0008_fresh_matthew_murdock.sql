CREATE TABLE "deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"server_id" text,
	"server_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_build_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"ip" text NOT NULL,
	"concurrency" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "server_id" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;