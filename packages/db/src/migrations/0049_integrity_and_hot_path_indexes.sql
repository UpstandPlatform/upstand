-- Custom SQL migration file, put your code below! --
-- Allow managed users created by organization membership provisioning while
-- keeping the single-instance owner guard for ordinary registrations.
CREATE OR REPLACE FUNCTION upstand_allow_initial_owner_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(84621735);

  IF COALESCE(NEW.managed, false) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM "user" LIMIT 1) THEN
    RAISE EXCEPTION 'Upstand has already been configured; sign in with the owner account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "member"
    GROUP BY "organization_id", "user_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add member organization/user uniqueness: duplicate memberships exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "apikey"
    GROUP BY "key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add API key uniqueness: duplicate keys exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "resource"
    WHERE "app_name" IS NOT NULL
    GROUP BY regexp_replace(lower(trim("app_name")), '[^a-z0-9_-]', '-', 'g')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add resource service-key uniqueness: duplicate normalized service keys exist';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_uidx" ON "member" USING btree ("organization_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "apikey_key_uidx" ON "apikey" USING btree ("key");
--> statement-breakpoint
CREATE INDEX "sso_provider_organization_idx" ON "sso_provider" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "notification_delivery_processing_idx" ON "notification_delivery" USING btree ("status", "processing_started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_normalized_service_key_uidx"
  ON "resource" USING btree (
    regexp_replace(lower(trim("app_name")), '[^a-z0-9_-]', '-', 'g')
  )
  WHERE "app_name" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "sso_provider"
  ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "backup_run"
  ADD CONSTRAINT "backup_run_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "backup_schedule"
  ADD CONSTRAINT "backup_schedule_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
