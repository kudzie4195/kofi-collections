# supabase/

Backend for Kofi Collections' Supabase mode. Full guide: [`docs/SUPABASE.md`](../docs/SUPABASE.md).

| Path | Purpose |
|---|---|
| `migrations/0001_schema.sql` | Enums, tables, indexes, `updated_at` + append-only triggers |
| `migrations/0002_rls.sql` | Identity/visibility helpers, guard + audit triggers, inquiry state machine, column privileges, RLS policies |
| `migrations/0003_views.sql` | Field-redacting views `artworks_visible`, `artists_visible`, `inquiries_visible` (the client reads discovery data only from these) |
| `migrations/0004_storage.sql` | Private `artwork-images` and `vault` buckets, storage policies, `open_document()` |
| `migrations/0005_rpcs.sql` | RPCs: consent, review, save artwork, export, verification, status changes, audit |
| `migrations/0006_realtime.sql` | Realtime publication for the main tables |
| `seed.sql` | **Generated** fictional demo data + 8 demo auth users (password `kofi-demo-2026`) + `kofi_demo_reset()` |
| `scripts/generate-seed.mjs` | Regenerates `seed.sql` from `src/data/mock/seed.ts` |
| `scripts/upload-demo-vault.mjs` | Uploads the two fictional vault files (service-role key; `--dry-run` to preview) |
| `scripts/load-seed.mjs` | Loads the TS seed in Node via Vite's bundled esbuild |
| `tests/shim.sql` | Minimal `auth` / `storage` / roles stand-in so the migrations run on plain Postgres. **Never load into Supabase.** |
| `tests/rls_test.sql` | Visibility / RLS assertions per demo identity |
| `tests/rpc_test.sql` | RPC, audit-trigger, cascade and reset assertions |
| `tests/run-local.sh` | Recreates a throwaway database, loads shim + migrations + seed (twice) + both test files; writes `tests/LAST_RUN.log` |

```bash
# local verification against a throwaway Postgres 15+ (drops/recreates the database)
PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres supabase/tests/run-local.sh
```
