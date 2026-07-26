ALTER TABLE "ai_provider_config" ADD COLUMN "temperature" real;--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "reasoning_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "max_output_tokens" integer;