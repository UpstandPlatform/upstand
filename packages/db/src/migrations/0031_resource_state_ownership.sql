CREATE TABLE IF NOT EXISTS "resource_configuration" (
  "resource_id" text PRIMARY KEY NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "build_config" text NOT NULL,
  "advanced_config" text NOT NULL,
  "watch_paths" text NOT NULL,
  "domains" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "resource_configuration_resource_id_resource_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_secret" (
  "resource_id" text PRIMARY KEY NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "credentials" text,
  "build_secrets" text,
  "env_vars" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "resource_secret_resource_id_resource_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_runtime" (
  "resource_id" text PRIMARY KEY NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "containers" text NOT NULL,
  "observed_at" timestamp,
  "source" text DEFAULT 'legacy-resource-json' NOT NULL,
  CONSTRAINT "resource_runtime_resource_id_resource_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
BEGIN
  IF (
    SELECT count(*) = 8
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'resource'
      AND column_name IN (
        'credentials', 'watch_paths', 'build_config', 'build_secrets',
        'advanced_config', 'env_vars', 'domains', 'containers'
      )
  ) THEN
    INSERT INTO "resource_configuration" (
      "resource_id", "version", "build_config", "advanced_config", "watch_paths", "domains"
    )
    SELECT
      "id", 1, "build_config", "advanced_config", "watch_paths", "domains"
    FROM "resource"
    ON CONFLICT ("resource_id") DO NOTHING;

    INSERT INTO "resource_secret" (
      "resource_id", "version", "credentials", "build_secrets", "env_vars"
    )
    SELECT
      "id", 1, "credentials", "build_secrets", "env_vars"
    FROM "resource"
    ON CONFLICT ("resource_id") DO NOTHING;

    INSERT INTO "resource_runtime" ("resource_id", "version", "containers")
    SELECT "id", 1, "containers"
    FROM "resource"
    WHERE "containers" <> '[]'
    ON CONFLICT ("resource_id") DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "resource"
  DROP COLUMN IF EXISTS "credentials",
  DROP COLUMN IF EXISTS "watch_paths",
  DROP COLUMN IF EXISTS "build_config",
  DROP COLUMN IF EXISTS "build_secrets",
  DROP COLUMN IF EXISTS "advanced_config",
  DROP COLUMN IF EXISTS "env_vars",
  DROP COLUMN IF EXISTS "domains",
  DROP COLUMN IF EXISTS "deployments",
  DROP COLUMN IF EXISTS "containers";
