CREATE TABLE "control_plane_transfer_record" (
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"checksum" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "control_plane_transfer_record_session_id_sequence_pk" PRIMARY KEY("session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "control_plane_transfer_session" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"manifest" jsonb NOT NULL,
	"staged_secrets" jsonb,
	"cursor" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_transfer_record" ADD CONSTRAINT "control_plane_transfer_record_session_id_control_plane_transfer_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."control_plane_transfer_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "control_plane_transfer_record_identity_uidx" ON "control_plane_transfer_record" USING btree ("session_id","table_name","record_id");--> statement-breakpoint
CREATE INDEX "control_plane_transfer_record_table_idx" ON "control_plane_transfer_record" USING btree ("session_id","table_name","sequence");--> statement-breakpoint
CREATE INDEX "control_plane_transfer_status_idx" ON "control_plane_transfer_session" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "control_plane_transfer_actor_idx" ON "control_plane_transfer_session" USING btree ("actor_id","created_at");