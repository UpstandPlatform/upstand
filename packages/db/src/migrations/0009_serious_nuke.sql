CREATE TABLE "docker_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"password" text,
	"image_prefix" text,
	"registry_url" text,
	"server_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"server_type" text NOT NULL,
	"ssh_key_id" text,
	"ip_address" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text DEFAULT 'root' NOT NULL,
	"enable_docker_cleanup" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_registry" ADD CONSTRAINT "docker_registry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_ssh_key_id_ssh_key_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_key"("id") ON DELETE set null ON UPDATE no action;