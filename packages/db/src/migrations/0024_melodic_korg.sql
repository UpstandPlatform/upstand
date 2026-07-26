DROP INDEX "ai_message_conversation_idx";--> statement-breakpoint
CREATE INDEX "ai_message_conversation_idx" ON "ai_message" USING btree ("conversation_id","created_at","id");