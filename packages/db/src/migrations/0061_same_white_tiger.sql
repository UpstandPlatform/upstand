ALTER TABLE "web_server_settings" ADD COLUMN "server_domain" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "https_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "certificate_provider" text DEFAULT 'letsencrypt' NOT NULL;