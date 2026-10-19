-- =============================================================================
-- Kofi Collections — 0007 expose the `kofi` schema to the Data API
--
-- THIS MIGRATION DOES NOT (AND CANNOT, ON HOSTED SUPABASE) EXPOSE THE SCHEMA.
-- It is a documented no-op apart from a schema-cache reload. Exposing `kofi`
-- is a REQUIRED MANUAL STEP, done once per project, outside SQL:
--
--   Hosted project:  Dashboard → Project Settings → API (Data API) →
--                    "Exposed schemas" → add `kofi` → Save.
--                    (Programmatic equivalent: Management API
--                    PATCH /v1/projects/{ref}/postgrest.)
--   Supabase CLI:    supabase/config.toml →
--                      [api]
--                      schemas = ["public", "graphql_public", "kofi"]
--                    then `supabase stop && supabase start`.
--   Self-hosted:     PGRST_DB_SCHEMAS=public,graphql_public,kofi (rest service).
--
-- Source: https://supabase.com/docs/guides/api/using-custom-schemas
-- ("Go to API settings and add your custom schema to 'Exposed schemas'"), and
-- https://supabase.com/docs/guides/queues/expose-self-hosted-queues for the
-- config.toml / PGRST_DB_SCHEMAS forms. Supabase does not document setting
-- the exposed schemas with `alter role authenticator set pgrst.db_schemas`,
-- so this migration deliberately does not do that: on a hosted project the
-- dashboard setting is the source of truth and could silently override it.
--
-- Keep `public` in the list: the other product on this project uses it.
--
-- Until `kofi` is exposed, every Data API request from the app fails with
-- PostgREST error PGRST106 ("Invalid schema: kofi"); the app maps that to a
-- message naming this step (src/data/supabase/errors.ts).
--
-- Privileges: the grants the Data API needs are already in place —
--   * USAGE on schema kofi for anon/authenticated/service_role (0000),
--   * the explicit per-table / per-column grants to anon/authenticated (0002),
--     identical to what the earlier `public` migrations granted,
--   * SELECT on the three redacting views (0003),
--   * EXECUTE on the RPCs (0003–0005; mutating ones authenticated-only).
-- RLS still gates every row. The Supabase guide's blanket
-- `GRANT ALL ON ALL TABLES IN SCHEMA … TO anon, authenticated` is
-- intentionally NOT used: it would undo the column-level redaction in 0002.
-- =============================================================================

-- service_role (server-side scripts such as upload-demo-vault.mjs, dashboard
-- tooling) gets everything that already exists in `kofi`; the default
-- privileges from 0000 cover objects created later.
grant all on all tables in schema kofi to service_role;
grant all on all sequences in schema kofi to service_role;
grant all on all functions in schema kofi to service_role;

-- Ask PostgREST to reload its schema cache so new kofi objects are visible as
-- soon as the schema is exposed. Harmless when PostgREST is not listening.
notify pgrst, 'reload schema';
