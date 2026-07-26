-- A self-hosted Upstand installation is bootstrapped by one local owner.
-- Serialize competing first registrations so two concurrent requests cannot
-- create separate owner accounts under PostgreSQL's default isolation level.
CREATE OR REPLACE FUNCTION upstand_allow_initial_owner_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(84621735);

  IF EXISTS (SELECT 1 FROM "user" LIMIT 1) THEN
    RAISE EXCEPTION 'Upstand has already been configured; sign in with the owner account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS upstand_single_instance_owner ON "user";
CREATE TRIGGER upstand_single_instance_owner
BEFORE INSERT ON "user"
FOR EACH ROW
EXECUTE FUNCTION upstand_allow_initial_owner_only();
