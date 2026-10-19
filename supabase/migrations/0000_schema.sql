-- =============================================================================
-- Kofi Collections — 0000 the `kofi` schema
--
-- Kofi shares its Supabase project with another product that owns `public`
-- (public.profiles, public.consent_records, public.admin_users, is_admin-style
-- helpers, its own auth.users trigger). So EVERYTHING Kofi creates lives in
-- schema `kofi`: tables, enums, helper functions, guard/audit trigger
-- functions, views, RPCs and the demo snapshot. Nothing in `public` is
-- created, altered, granted or revoked by these migrations.
--
-- Shared, not owned by Kofi: auth.users (one trigger, kofi_on_auth_user_created,
-- is attached to it in 0001), storage.objects (nine policies named "kofi …" in
-- 0004), storage.buckets rows 'artwork-images' and 'vault' (0004), and the
-- supabase_realtime publication (Kofi tables added in 0006).
--
-- Remove the whole Kofi backend:   drop schema kofi cascade;
--   The cascade also drops the auth.users trigger and the storage policies
--   (both depend on kofi functions) and the tables' realtime publication
--   membership. It does NOT remove the two storage buckets or their files;
--   see docs/SUPABASE.md → "Remove Kofi from the project".
--
-- The schema must also be added to the project's exposed schemas before the
-- Data API can reach it — see 0007_expose_schema.sql.
-- =============================================================================

create schema if not exists kofi;

-- Same API roles Supabase uses for `public`. RLS + the explicit per-table /
-- per-column grants in 0002 and 0003 decide what each role can do.
grant usage on schema kofi to anon, authenticated, service_role;

-- Default privileges for objects the migration role creates in `kofi` later
-- in this migration set (and in seed_content.sql).
--
-- Deliberately narrower than Supabase's `public` defaults (which grant ALL on
-- every new table to anon/authenticated): here anon/authenticated get NOTHING
-- on new tables/sequences by default, so a table added without an explicit
-- grant is unreachable through the API instead of wide open. Every grant the
-- app needs is written out explicitly in 0002/0003 — exactly the grants the
-- previous `public` migrations gave — and the "revoke all, then grant back"
-- statements there still run (as harmless no-ops for tables).
--
-- Functions keep PostgreSQL's built-in EXECUTE-to-PUBLIC default, as in
-- `public`; the migrations revoke it from internal helpers (0002) and from
-- every mutating RPC for anon (0004/0005).
--
-- service_role (server-side scripts, dashboard tooling) gets everything; it
-- also bypasses RLS on Supabase.
alter default privileges in schema kofi grant all on tables to service_role;
alter default privileges in schema kofi grant all on sequences to service_role;
alter default privileges in schema kofi grant all on functions to service_role;
