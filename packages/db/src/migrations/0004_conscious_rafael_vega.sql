CREATE TABLE "git_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"config" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource" ALTER COLUMN "status" SET DEFAULT 'idle';--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "algorithm" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "private_key_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "private_key_iv" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "private_key_auth_tag" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "private_key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key" DROP COLUMN "private_key";--> statement-breakpoint
ALTER TABLE "ssh_key" DROP COLUMN "updated_at";