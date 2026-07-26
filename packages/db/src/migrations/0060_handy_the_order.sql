CREATE TABLE "ai_tavily_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"api_key_ciphertext" text,
	"api_key_iv" text,
	"api_key_auth_tag" text,
	"api_key_version" integer,
	"search_depth" text DEFAULT 'basic' NOT NULL,
	"include_answer" integer DEFAULT 0 NOT NULL,
	"max_results" integer DEFAULT 5 NOT NULL,
	"enable_search" integer DEFAULT 1 NOT NULL,
	"enable_extract" integer DEFAULT 0 NOT NULL,
	"enable_crawl" integer DEFAULT 0 NOT NULL,
	"enable_map" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_tavily_settings" ADD CONSTRAINT "ai_tavily_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;