CREATE TABLE "control_plane_identity" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"instance_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "control_plane_identity_instance_id_unique" UNIQUE("instance_id")
);
