-- Reconcile the versioned migration chain with the canonical Lovable Cloud auth boundary.
--
-- The live database already enforces the single approved Google account directly
-- on auth.users, complementing the server-side allowlist. The original migration
-- remained only on an old closed development branch, so reproduce that live state
-- here without changing the rule or migration metadata.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enforce_single_google_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_email text := lower(trim(coalesce(NEW.email, '')));
  v_provider text := coalesce(NEW.raw_app_meta_data ->> 'provider', '');
BEGIN
  IF v_email <> 'kauefsantos3@gmail.com' OR v_provider <> 'google' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Account not authorized for this application';
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
