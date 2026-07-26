ALTER TABLE "web_server_settings" ADD COLUMN "server_ip" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "daily_docker_cleanup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "caddy_environment" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "caddy_ports" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "caddy_dashboard_enabled" boolean DEFAULT false NOT NULL;