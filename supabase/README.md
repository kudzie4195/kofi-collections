# supabase/

Backend for Kofi Collections' Supabase mode. Full guide: [`docs/SUPABASE.md`](../docs/SUPABASE.md).

| Path | Purpose |
|---|---|
| `migrations/0000_schema.sql` | Creates schema `kofi` (everything Kofi owns lives there), usage grants, default privileges |
| `migrations/0001_schema.sql` | Enums, tables, indexes, `updated_at` + append-only triggers, `kofi_on_auth_user_created` |
| `migrations/0002_rls.sql` | Identity/visibility helpers, guard + audit triggers, inquiry state machine, column privileges, RLS policies |
| `migrations/0003_views.sql` | Field-redacting views `kofi.artworks_visible`, `kofi.artists_visible`, `kofi.inquiries_visible` (the client reads discovery data only from these) |
| `migrations/0004_storage.sql` | Private `artwork-images` and `vault` buckets, storage policies, `kofi.open_document()` |
| `migrations/0005_rpcs.sql` | RPCs: consent, review, save artwork, export, verification, status changes, audit |
| `migrations/0006_realtime.sql` | Realtime publication for the main `kofi.*` tables |
| `migrations/0007_expose_schema.sql` | No-op for exposure (exposing `kofi` is a **manual dashboard step**, see docs/SUPABASE.md §2); `service_role` grants; schema-cache reload |
| `migrations/0008_programme.sql` | The programme: exhibitions, open calls, events, stories, applications, collector inquiries; their views, RPCs, RLS, the public `kofi-programme` image bucket; recorded in `kofi.applied_migrations` (docs/SUPABASE.md §9) |
| `migrations/0009_sales.sql` | Partners, auctions, payouts, reports: `open_calls.kind / organizer_institution_id / terms`, `lots`, `payouts`, their views, RPCs (`save_lot`, `set_lot_status`, `record_sale`, `delete_lot`, `set_payout_status`, `kofi_report`), partner RLS; recorded as `0009_sales` (docs/SUPABASE.md §10). **Do not re-run 0008 after it** |
| `apply/0008_part1..4.sql` | **Generated** (`scripts/split-0008.mjs`) from 0008: the same migration in four ≤ 25 KB pieces for pasting into a live project, one transaction each |
| `apply/0009_part1..5.sql` | **Generated** (`scripts/split-0009.mjs`) from 0009: five ≤ 25 KB pieces, one transaction each |
| `apply/0009_live_patch.sql` | **Generated.** Sets the sample calls' `kind` (and organiser / terms where empty) by fixed id on the live project |
| `seed_sales.sql` | **Generated.** Additive lots + payouts only (insert-only, fixed ids) — after `seed_programme.sql` |
| `apply/0008_live_patch.sql` | **Generated.** Updates the 13 existing works' `rights_note` to the current seed, by fixed id (live project, which must not be reset) |
| `seed_auth.sql` | **Generated.** 8 demo auth users (password `kofi-demo-2026`). **Creates real auth accounts in the shared `auth.users`** |
| `seed_content.sql` | **Generated.** Fictional demo content in `kofi`, the `kofi.demo_*` snapshot and `kofi.kofi_demo_reset()`. Run after `seed_auth.sql` |
| `seed_programme.sql` | **Generated.** Additive programme rows only (`on conflict do nothing`, never deletes) — for a project whose content was loaded without the reset snapshot. Needs 0009 (call kind / terms columns) |
| `scripts/generate-seed.mjs` | Regenerates the seed files and live patches from `src/data/mock/seed.ts` |
| `scripts/upload-demo-vault.mjs` | Uploads the two fictional vault files (service-role key; `--dry-run` to preview) |
| `scripts/load-seed.mjs` | Loads the TS seed in Node via Vite's bundled esbuild |
| `tests/shim.sql` | Minimal `auth` / `storage` / roles stand-in, plus a stand-in for the other product that owns `public`. **Never load into Supabase.** |
| `tests/rls_test.sql` | Visibility / RLS assertions per demo identity |
| `tests/rpc_test.sql` | RPC, audit-trigger, cascade and reset assertions |
| `tests/programme_test.sql` | Programme visibility, admin writes, application + collector-inquiry RPCs (every rule), storage and isolation of the 0008 objects |
| `tests/sales_test.sql` | Partners, lots, sales, payouts, reports (every rule), visibility per identity, storage and isolation of the 0009 objects |
| `tests/isolation_test.sql` | Proves nothing lands in or changes `public`, and that `drop schema kofi cascade` removes Kofi cleanly |
| `tests/run-local.sh` | Recreates a throwaway database, loads shim + migrations (0008 and 0009 twice each) + seeds (content twice, then the additive programme + sales seeds) + all five test files, then repeats on a "live path" database built from the apply/ parts; writes `tests/LAST_RUN.log` |

```bash
# local verification against a throwaway Postgres 15+ (drops/recreates the database)
PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres supabase/tests/run-local.sh

# remove Kofi from a project entirely (see docs/SUPABASE.md §5 for buckets / demo users)
psql "$DATABASE_URL" -c 'drop schema kofi cascade;'
```
