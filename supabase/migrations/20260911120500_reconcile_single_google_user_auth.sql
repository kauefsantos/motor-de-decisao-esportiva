-- Reconcile the versioned migration chain with the canonical single-user Google auth boundary.
-- The approved identity is stored only inside the private database schema; no account
-- identifier is embedded in application source.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.app_security_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  approved_user_id uuid UNIQUE
);
REVOKE ALL ON TABLE private.app_security_config FROM PUBLIC, anon, authenticated;

INSERT INTO private.app_security_config (singleton, approved_user_id)
VALUES (true, NULL)
ON CONFLICT (singleton) DO NOTHING;

UPDATE private.app_security_config c
SET approved_user_id = candidate.id
FROM (
  SELECT u.id
  FROM auth.users u
  WHERE coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
  ORDER BY u.created_at, u.id
  LIMIT 1
) candidate
WHERE c.singleton = true
  AND c.approved_user_id IS NULL;

CREATE OR REPLACE FUNCTION private.approved_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT c.approved_user_id
  FROM private.app_security_config c
  WHERE c.singleton = true;
$function$;

REVOKE ALL ON FUNCTION private.approved_app_user_id()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.approved_app_user_id() TO service_role;

CREATE OR REPLACE FUNCTION private.enforce_single_google_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_provider text := coalesce(NEW.raw_app_meta_data ->> 'provider', '');
  v_approved_user_id uuid;
BEGIN
  IF v_provider <> 'google' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account not authorized for this application';
  END IF;

  UPDATE private.app_security_config
  SET approved_user_id = NEW.id
  WHERE singleton = true AND approved_user_id IS NULL;

  SELECT private.approved_app_user_id() INTO v_approved_user_id;

  IF NEW.id IS DISTINCT FROM v_approved_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account not authorized for this application';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_single_google_user()
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.enforce_single_google_user()
  TO supabase_auth_admin;

DROP TRIGGER IF EXISTS enforce_single_google_user ON auth.users;
CREATE TRIGGER enforce_single_google_user
BEFORE INSERT OR UPDATE OF email, raw_app_meta_data
ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.enforce_single_google_user();
