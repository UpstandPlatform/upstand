CREATE TABLE "web_server_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"lets_encrypt_email" text,
	"http_port" integer DEFAULT 80 NOT NULL,
	"https_port" integer DEFAULT 443 NOT NULL,
	"enable_http3" boolean DEFAULT true NOT NULL,
	"global_caddyfile" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
