DROP INDEX "audit_log_org_created_idx";--> statement-breakpoint
CREATE INDEX "audit_log_search_idx" ON "audit_log" USING gin (to_tsvector(
        'simple',
        "actor_name" || ' ' ||
        "actor_email" || ' ' ||
        coalesce("resource_name", '') || ' ' ||
        "route"
      ));--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);