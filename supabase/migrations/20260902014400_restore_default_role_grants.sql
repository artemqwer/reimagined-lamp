-- The prod project (created 2026-05) did not carry the default privileges a
-- current Supabase project ships with. anon, authenticated and service_role had
-- only REFERENCES/TRIGGER/TRUNCATE on `public` — no SELECT/INSERT/UPDATE/DELETE
-- — so every table created by the preceding migrations came out unusable.
-- PostgREST answered:
--
--   42501  permission denied for table prompts
--   hint:  GRANT SELECT ON public.prompts TO service_role;
--
-- It was not just the admin routes: anon and authenticated were missing the
-- same four privileges, so the user-facing tables would have failed identically.
-- The sibling project metricforge-dev, created 2026-09, already had the full set;
-- this brings both to the same grants and, crucially, fixes the DEFAULT so the
-- next migration cannot reintroduce it.
--
-- Granting DML to anon/authenticated on every table is Supabase's own default
-- and does NOT widen access: RLS is the gate, not the grant. Verified on the
-- live project — service_role reads and writes, while anon gets [] on the
-- policy-less tables and its INSERT is refused with "new row violates
-- row-level security policy". service_role has rolbypassrls = true; anon and
-- authenticated are false.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
grant execute on all functions in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
