CREATE TABLE "proxy_takeover_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"previous_proxy" text NOT NULL,
	"occupied_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_sites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "proxy_takeover_journal_server_idx" ON "proxy_takeover_journal" USING btree ("server_id","created_at");