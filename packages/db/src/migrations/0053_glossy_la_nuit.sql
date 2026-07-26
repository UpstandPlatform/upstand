ALTER TABLE "backup_run" ADD COLUMN "verification_status" text;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "restore_tested_at" timestamp;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "recovery_point" text;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "point_in_time_recovery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "restore_verification" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "replica_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "failover_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "migration_command" text;