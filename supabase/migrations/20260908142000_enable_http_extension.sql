-- Required before the Elo 5Dollar functions declare extensions.http_response
-- and call extensions.http(). Lovable Cloud already has this extension; this
-- makes the versioned migration chain reproducible on a fresh Supabase database.
create extension if not exists http with schema extensions;
