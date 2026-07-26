ALTER TABLE "invitation" ADD COLUMN "permissions" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "email_channel_id" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "permissions" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;