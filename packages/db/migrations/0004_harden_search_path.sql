-- Hardening surfaced by Supabase's database linter on the first real deployment.
--
-- Two findings, both cheap to close and neither reachable in the local PGlite
-- setup, which is why they only appeared once the schema reached a hosted
-- project:
--
--   1. `schema_migrations` lives in `public`, and a hosted Supabase project
--      exposes that schema through PostgREST. The table holds nothing secret —
--      a version string and a checksum — but there is no reason for it to be
--      readable over the API. RLS with no policy denies `cairn_app` outright;
--      the owner role that runs migrations bypasses RLS, so `migrate()` is
--      unaffected.
--
--   2. The three functions below ran with a caller-controlled `search_path`.
--      They are SECURITY INVOKER and touch only built-ins, so this was not
--      exploitable, but pinning the path removes the question entirely.

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

ALTER FUNCTION public.cairn_current_workspace() SET search_path = pg_catalog;
ALTER FUNCTION public.cairn_current_user() SET search_path = pg_catalog;
ALTER FUNCTION public.cairn_block_update() SET search_path = pg_catalog;
