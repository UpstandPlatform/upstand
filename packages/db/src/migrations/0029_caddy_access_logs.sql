ALTER TABLE "web_server_settings" ADD COLUMN "access_logs_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "access_log_cleanup_cron" text DEFAULT '0 3 * * *' NOT NULL;
