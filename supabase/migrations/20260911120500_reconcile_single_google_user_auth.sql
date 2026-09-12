-- Reconcile the versioned migration chain with the canonical single-user Google auth boundary.
--
-- The approved identity is derived from the first Google account already present in
-- auth.users. No e-mail address or other account identifier is embedded in source.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

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
  SELECT u.id
  INTO v_approved_user_id
  FROM auth.users u
  WHERE coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
  ORDER BY u.created_at, u.id
  LIMIT 1;

  IF v_provider <> 'google'
     OR (v_approved_user_id IS NOT NULL AND NEW.id IS DISTINCT FROM v_approved_user_id) THEN
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
