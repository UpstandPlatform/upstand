ALTER TABLE "server" ADD COLUMN "auth_type" text DEFAULT 'ssh_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "password_ciphertext" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "password_iv" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "password_auth_tag" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "password_version" integer;