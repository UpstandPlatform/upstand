CREATE TABLE "notification_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"events" text[] NOT NULL,
	"encrypted_configuration" text NOT NULL,
	"configuration_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"event" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_channel_id_notification_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_channel_organization_idx" ON "notification_channel" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_channel_events_idx" ON "notification_channel" USING gin ("events");--> statement-breakpoint
CREATE INDEX "notification_delivery_channel_idx" ON "notification_delivery" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_organization_created_idx" ON "notification_delivery" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_status_idx" ON "notification_delivery" USING btree ("status");