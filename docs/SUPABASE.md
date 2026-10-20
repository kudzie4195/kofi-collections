# Kofi Collections — Supabase backend

Supabase mode replaces the in-browser mock with a real Postgres backend where **every visibility rule is enforced on the server**: row-level security, column privileges, redacting views, guard triggers, private storage buckets and an append-only audit log. The UI code does not change; it talks to the same `DataSource` interface (`src/data/DataSource.ts`).

All demo content is fictional (guide §07).

## 0. Shared project: everything lives in schema `kofi`

Kofi can share a Supabase project with another product. That product owns `public` (for example `public.profiles`, `public.consent_records`, `public.admin_users`, an `is_admin()` helper, its own `on_auth_user_created` trigger and its real users). So **every object Kofi creates is in the Postgres schema `kofi`**: tables, enums, helper functions, guard and audit trigger functions, views, RPCs, the demo snapshot (`kofi.demo_*`) and `kofi.kofi_demo_reset()`. The migrations never create, alter, grant or revoke anything in `public`. `supabase/tests/isolation_test.sql` checks this against a stand-in for the other product.

Kofi does share four things, and it names them so they cannot clash:

| Shared object | What Kofi adds |
|---|---|
| `auth.users` | One trigger, `kofi_on_auth_user_created`, which creates a `kofi.profiles` row for **every** new user on the project (other-product sign-ups get Kofi role `public`). A failure in it is logged as a warning and never blocks a sign-up. |
| `storage.buckets` | Two private buckets, `artwork-images` and `vault` |
| `storage.objects` | Nine policies, all named `kofi …` |
| `supabase_realtime` publication | Eight `kofi.*` tables |

The app reaches the schema with `supabase.schema('kofi')` for every table, view and RPC call, and subscribes to Realtime with `schema: 'kofi'` (`src/data/supabase/SupabaseDataSource.ts`). Storage calls do not involve a schema.

## 1. Apply the schema

Migrations live in `supabase/migrations/` and run in filename order:

| File | What it does |
|---|---|
| `0000_schema.sql` | Creates schema `kofi`, grants `USAGE` to `anon` / `authenticated` / `service_role`, sets default privileges (new tables: `service_role` only — the API roles get only the explicit grants in 0002/0003) |
| `0001_schema.sql` | Enums, tables, indexes, `updated_at` triggers, the `kofi_on_auth_user_created` profile trigger, append-only triggers on `audit_events` / `consents` |
| `0002_rls.sql` | Helper functions (`kofi.current_role_of`, `kofi.is_admin`, `kofi.is_verified_curator`, `kofi.my_artist_id`, `kofi.my_curator_id`, `kofi.can_see`, …), the audit writer, guard triggers, audit triggers, the inquiry status machine, column privileges, RLS policies on every table. Revokes `EXECUTE` on internal helpers (audit writer, trigger functions) from every API role |
| `0003_views.sql` | `kofi.region_label()`, field-redacting `security_invoker` views `kofi.artworks_visible`, `kofi.artists_visible`, `kofi.inquiries_visible` |
| `0004_storage.sql` | Private buckets `artwork-images` and `vault`, storage policies, `kofi.open_document()` |
| `0005_rpcs.sql` | `whoami`, `describe_access`, `log_audit`, `accept_consent`, `submit_for_review`, `save_artwork`, `export_my_data`, `request_verification`, `set_inquiry_status`, `set_artist_status`, `set_kofi_notes`, `mark_artwork_reviewed`, `set_curator_status` (all in `kofi`) |
| `0006_realtime.sql` | Adds the eight main `kofi.*` tables to the `supabase_realtime` publication |
| `0007_expose_schema.sql` | **Does not expose the schema** (see step 2). Grants everything in `kofi` to `service_role` and asks PostgREST to reload its schema cache |

**On the shared project — psql or the SQL editor (recommended).** Run each file above in order (0000 → 0007):

```bash
for f in supabase/migrations/000*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break; done
```

or open each file in the SQL editor, paste, run.

**Supabase CLI — only on a project Kofi has to itself (or a local stack).** `supabase db push` records every applied version in the project-wide `supabase_migrations.schema_migrations` table ([Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)). On a project whose other product also deploys with the CLI, Kofi's `0000`–`0007` versions would land in that product's migration history and its next `db push` would see versions it does not have locally. Do not use `db push` there, and **never** run `supabase db reset --linked` or `db push --include-seed` against the shared project — `db reset --linked` drops and rebuilds the whole remote database, including the other product.

```bash
npx supabase init            # once, creates supabase/config.toml; keep the existing migrations
npx supabase link --project-ref <kofi-only-project-ref>
npx supabase db push         # applies supabase/migrations/* in filename order
```

## 2. Expose `kofi` to the Data API (required manual step)

Supabase only serves the schemas listed in the project's **exposed schemas**, and that list is not set from SQL. Until `kofi` is in it, every app request fails with PostgREST error `PGRST106` ("Invalid schema: kofi"); the app shows *"This Supabase project does not expose the "kofi" schema yet…"*.

- **Hosted project:** Dashboard → Project Settings → API (Data API) → **Exposed schemas** → add `kofi` → Save. Keep `public` (and `graphql_public`) in the list — the other product uses them. The Management API equivalent is `PATCH /v1/projects/{ref}/postgrest`.
- **Supabase CLI local stack:** in `supabase/config.toml`, `[api] schemas = ["public", "graphql_public", "kofi"]`, then `npx supabase stop && npx supabase start`.
- **Self-hosted (Docker):** `PGRST_DB_SCHEMAS=public,graphql_public,kofi`, then restart the `rest` service.

Sources: Supabase docs, [Using custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas) and [Expose Queues for local and self-hosted Supabase](https://supabase.com/docs/guides/queues/expose-self-hosted-queues) (the `config.toml` / `PGRST_DB_SCHEMAS` forms). `0007_expose_schema.sql` deliberately does not run `alter role authenticator set pgrst.db_schemas …`: Supabase does not document that as the way to expose schemas, and on a hosted project the dashboard setting is the source of truth.

The table grants the API needs are already in the migrations: the same per-table and per-column grants the earlier `public` version used (0002), `SELECT` on the three views (0003) and `EXECUTE` on the RPCs (mutating ones for `authenticated` only). The Supabase guide's blanket `GRANT ALL ON ALL TABLES … TO anon, authenticated` is **not** used — it would undo the column-level redaction.

## 3. Load the demo seed

The seed is **generated** from the TypeScript seed so both modes hold the same records, and is split in two:

| File | Contents |
|---|---|
| `supabase/seed_auth.sql` | The 8 demo `auth.users` + `auth.identities` rows. **Creates real, sign-in-able accounts** with a published password in the shared `auth.users` table — do not run it on a project with real users unless you mean to. Inserting them also fires the other product's `auth.users` triggers (for example, it may create 8 `public.profiles` rows). The file header has the `delete from auth.users …` line that removes them again. |
| `supabase/seed_content.sql` | Everything else, all in `kofi`: the snapshot tables `kofi.demo_*` (RLS on, no API grants), `kofi.kofi_demo_reset()`, then the reset itself, then the append-only consent / audit seed rows. Stops with an error if the demo auth users are missing. |

```bash
node supabase/scripts/generate-seed.mjs   # rewrites both files from src/data/mock/seed.ts
```

Run them **after the migrations, in this order**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed_auth.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed_content.sql
```

(or paste them into the SQL editor in that order). For a local CLI stack, point `[db.seed] sql_paths` in `supabase/config.toml` at `./seed_auth.sql` and `./seed_content.sql`, in that order, so `npx supabase db reset` loads both.

Both files are safe to re-run. `seed_auth.sql` leaves existing ids alone. `seed_content.sql` calls `kofi.kofi_demo_reset()`, which **wipes every row in the Kofi content tables** (artists, artworks, images, institutions, curators, shortlists, inquiries, documents — Kofi's only, never `public`) and restores them from `kofi.demo_*`. Audit events and consents are append-only and are never deleted.

Then upload the two fictional vault files (they are Storage objects, not rows):

```bash
node supabase/scripts/upload-demo-vault.mjs --dry-run      # shows the two paths
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node supabase/scripts/upload-demo-vault.mjs
```

The service-role key bypasses Storage policies. Run that script from your own machine only; never put the key in `.env` for the app.

## 4. Point the app at it

Create `.env.local` in the project root:

```bash
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
# Optional, demo projects only: let the identity switcher sign in as the demo users automatically.
# Never on a shared project with real users.
VITE_SUPABASE_DEMO_LOGIN=true
```

There is no schema variable: the schema name `kofi` is fixed in `src/data/supabase/mapping.ts` (`DB_SCHEMA`) and in the migrations. If `VITE_DATA_MODE=supabase` is set but the URL or key is missing, `src/data/index.ts` falls back to mock data and logs a warning.

## 5. Remove Kofi from the project

```sql
drop schema kofi cascade;
```

That one statement removes every Kofi table, view, function, enum and the demo snapshot, and — because they depend on Kofi functions — the `kofi_on_auth_user_created` trigger on `auth.users`, the nine `kofi …` storage policies and the tables' realtime publication membership. It leaves `public`, the other product's triggers and all of `auth.users` untouched (`supabase/tests/isolation_test.sql` runs it inside a savepoint and checks a fingerprint of `public` before and after).

It does **not** remove, because they are rows rather than schema objects: the demo auth accounts (see the `delete` line in the `seed_auth.sql` header), the two storage buckets and their files (empty the buckets, then delete them in the dashboard or with `storage.deleteBucket('artwork-images')` / `('vault')`), and `kofi` in the exposed-schemas list (remove it in the dashboard).

### Signing in (follow-up for the shell)

`DataSource` has no sign-in method. Supabase mode handles identities like this:

- `listDemoIdentities()` returns the same seven demo identities (same ids, labels, captions) as mock mode, with UUID-keyed viewers.
- `signInDemo(ds, identityId)` (exported from `src/data/supabase/SupabaseDataSource.ts`) signs in with email + password and returns the `Viewer` the **server** resolved. `'visitor'` signs out.
- Every call re-checks the session: the visitor always uses a session-less client; any other `Viewer` must match the Supabase session, otherwise the call fails with *"Your session has ended. Sign in again from Account."*
- **Follow-up:** `src/app/AccountScreen.tsx` should call `await signInDemo(data, identity.id)` before `signInAs(identity)` when `data.mode === 'supabase'` (and pass the returned viewer). Until then, set `VITE_SUPABASE_DEMO_LOGIN=true` on a demo project: the data source then signs in as the chosen demo user automatically on the first call.
- "Reset demo data" in Supabase mode calls `kofi_demo_reset()`, which only Kofi staff (Quincy) may run. Other identities get a clear error. Consider hiding the button for non-staff in Supabase mode.

## 6. Demo users

Password for every demo account: **`kofi-demo-2026`** (fictional accounts on a demo project only; emails use the reserved `example.com` domain).

| Identity | Email | Role | Auth user id |
|---|---|---|---|
| Mara Oyelaran | `demo+mara@example.com` | artist (approved) | `10000000-0000-4000-8000-000000000001` |
| Tobias Reinholt | `demo+tobias@example.com` | artist (approved, not in the switcher) | `…0002` |
| June Takahashi-Bell | `demo+june@example.com` | artist (approved) | `…0003` |
| DeShawn Ferris | `demo+deshawn@example.com` | artist (approved, not in the switcher) | `…0004` |
| Priya Venkataraman | `demo+priya@example.com` | artist (pending review) | `…0005` |
| Lena Marchetti | `demo+lena@example.com` | curator (verified) | `…0006` |
| Owen Blackwood | `demo+owen@example.com` | curator (pending) | `…0007` |
| Quincy | `demo+quincy@example.com` | Kofi admin | `…0008` |

The full mock-id → UUID table is at the top of `supabase/seed_content.sql` and in `src/data/supabase/demo.ts`.

## 7. What is enforced where

"Client" = the app; everything else runs in Postgres / Supabase Storage and holds even if someone calls the API directly with the anon key.

| Rule (guide §04 / `src/domain/visibility.ts`) | Enforced by |
|---|---|
| `canSee(level, viewer, owner)` | `kofi.can_see(visibility, uuid)` — same truth table; owner = artist role + own artist id; admin always; verified curator for `institutions`; never anyone else for `kofi`/`private` |
| Verified flag comes from the record, never the client | `is_verified_curator()` reads `curators.status`; `whoami()` gives the client the server's view |
| Artist profile visible only when approved and visible (or owner/admin) | RLS `artists_select` |
| Artwork visible only if its artist is visible and `can_see(visibility)` (or owner/admin) | RLS `artworks_select` → `artist_visible()` |
| Price is field-specific | `artworks.price_amount/price_currency` are **not selectable** by `anon`/`authenticated` (column privileges). `artworks_visible` returns them through `artwork_price()`, which nulls them and sets `price_withheld` when `NOT can_see(price_visibility)` |
| Contact, legal name, full region, consent: owner/admin only; Kofi notes admin only | Those columns are not selectable by API roles; `artists_visible` gets them from `artist_extras()`, which re-checks per row |
| Region shown only at the artist's chosen precision | `region_label()` in `artist_extras()` |
| Owners edit their own profile, not status / Kofi notes / consent | RLS `artists_update_owner` + trigger `artists_guard` (raises *"Only Kofi staff can change review status."*) |
| Kofi changes status / notes only | RLS `artists_update_admin` + `artists_guard`; RPCs `set_artist_status`, `set_kofi_notes` |
| Owners CRUD their own artworks; never `reviewed_at` | RLS `artworks_*_owner` + trigger `artworks_guard` |
| Kofi marks work reviewed, nothing else | RLS `artworks_update_admin` + `artworks_guard`; RPC `mark_artwork_reviewed` |
| Images follow their artwork; stored refs must be in the owner's own folder | RLS on `artwork_images` (`artwork_visible`, `owns_artwork`, `starts_with(src, 'storage:artwork-images/<my id>/')`) |
| Curators verify through Kofi; cannot verify themselves | RLS `curators_*` + trigger `curators_guard`; RPCs `request_verification`, `set_curator_status` |
| Shortlists belong to the curator; only work they may see, never drafts / Kofi-only | RLS `shortlists_owner`, `shortlist_items_insert` → `artwork_shortlistable()` |
| Only verified curators send inquiries, only to approved public artists, only about public work they can see; no contact fields | RLS `inquiries_insert_verified_curator` → `inquiry_target_ok()`; insert column privileges; `inquiries_visible` adds names via `inquiry_labels()` (no email/purpose) |
| Artists see only forwarded inquiries | RLS `inquiries_select` (`status <> 'pending'`) |
| Kofi: pending → forwarded/declined. Artist: forwarded → accepted/declined | Trigger `inquiries_transition` (keys off the JWT, so the RPC and direct updates follow the same rules) |
| Private vault: owner only; admin opens are audited | RLS `documents_owner`, `documents_admin_select`; `open_document()` logs `document.open` before returning the path; Storage policy *"kofi vault admin read after audit"* lets an admin sign a vault URL only within 2 minutes of their own logged open |
| No permanent or guessable public file links | Both buckets are private. Images and vault files are served only via short-lived signed URLs (1 h images, 60 s vault); Storage checks the SELECT policy before signing |
| Image read follows artwork visibility | Storage policy *"kofi artwork images read"* → `storage_image_readable()` |
| Audit is append-only | No INSERT/UPDATE/DELETE privileges for API roles; `audit_events_append_only` + `audit_events_no_truncate` triggers raise for everyone, including the table owner. Same for `consents` |
| Sensitive actions are audited by the server | AFTER triggers on artists, artworks, shortlists, shortlist_items, documents, curators, inquiries; RPCs log `artist.export` and `document.open`. Actor is always taken from the JWT |
| Client-reported audit (`private.view` when staff open a private record) | `log_audit()` — only accepts `private.view`; actor from the JWT |
| Discovery hides drafts, Kofi-only records (except staff) and unapproved artists | RLS (rows) + client filter in `listArtworks` mirroring `MockDataSource` |
| Form validation messages | Client mirrors `MockDataSource` exactly (reuses `validateArtwork`); the server re-validates with CHECK constraints and RPC checks, mapped back to the same message + field in `src/data/supabase/errors.ts` |

All functions, views and tables named above are in schema `kofi`. Every Kofi function pins `search_path = kofi, public` and every RLS policy calls the `kofi.`-qualified helpers.

Error mapping (`mapPgError`): `42501` → `ForbiddenError`; `P0002`, `PGRST116`, `23503`, bad uuid → `NotFoundError`; `22023` (HINT = field), `23514` (known constraints → mock message), `23502`, `23505` → `ValidationError`; expired JWT → `ForbiddenError("Your session has ended…")`; `PGRST106` (schema not exposed) → an error naming step 2.

## 8. Verification status

**Verified** (real PostgreSQL 16.15, local throwaway cluster, `supabase/tests/LAST_RUN.log`):

- All eight migrations (0000–0007) load cleanly on top of `supabase/tests/shim.sql`, a stand-in for Supabase's `auth`, `storage`, `extensions` schemas, the `anon`/`authenticated`/`service_role` roles (with Supabase's default grants in `public`) **and the other product**: a pre-existing `public.profiles`, `public.consent_records`, `public.admin_users`, `public.is_admin()`, an `on_auth_user_created` trigger on `auth.users` and two existing users.
- `seed_auth.sql` + `seed_content.sql` load, and load again (idempotent).
- `supabase/tests/rls_test.sql` + `supabase/tests/rpc_test.sql`: 100 assertions executed as each demo identity the way PostgREST does it (`set local role …; set local request.jwt.claims = …`), all passing, against `kofi.*`. These include the policies, column privileges, views, guard and audit triggers, the inquiry state machine, every RPC, the storage policies on `storage.objects`, the vault "audited open first" gate, cascades, and `kofi_demo_reset()`.
- `supabase/tests/isolation_test.sql`: 16 assertions — no Kofi tables in `public`; a fingerprint of `public` (objects, ACLs, policies, triggers, the other product's rows and its auth trigger) is identical before the migrations and after migrations + seed; every Kofi function pins `search_path = kofi, public`, every view is `security_invoker`, every table has RLS; realtime publishes only `kofi.*`; both auth triggers coexist and a failing Kofi profile insert does not block a sign-up; internal helpers and the snapshot are not reachable by API roles; `drop schema kofi cascade` (in a savepoint, rolled back) leaves `public` identical and removes Kofi's auth trigger, storage policies and realtime tables.
- Run it yourself: `PGHOST=… PGPORT=… PGUSER=postgres supabase/tests/run-local.sh` (it drops and recreates a database — never point it at a Supabase project).

**Not verified against a live Supabase project** (no project or Docker daemon was available):

1. The migrations on Supabase's real platform schemas (real `auth.users` columns, `storage` schema ownership, `supabase_realtime`), on Postgres 15/17, via `supabase db push`, including that the CLI accepts the `0000_…`-style file names.
2. PostgREST actually serving `kofi` once it is added to the exposed schemas (the `Accept-Profile` / `Content-Profile: kofi` headers the client sends are unit-tested; the server side is not), and Realtime delivering `postgres_changes` for `schema: 'kofi'`.
3. Seeded `auth.users` / `auth.identities` rows actually signing in through GoTrue with the demo password.
4. Supabase Storage honouring the `storage.objects` policies when signing URLs (`createSignedUrl(s)`), uploading and removing — the policies were only exercised with direct SQL against the shim table. Bucket size / MIME limits were not exercised.
5. Realtime delivering `postgres_changes` events under these RLS policies, and Realtime omitting columns the subscriber cannot select (e.g. `artworks.price_amount`). The client only uses events as a refetch signal and never reads payloads.
6. `src/data/supabase/SupabaseDataSource.ts` was never run against a server. It typechecks and its pure parts are unit-tested (`src/data/supabase/supabase.test.ts`: error mapping, row mappers, storage-ref round-trip, data URL helpers, demo identity mapping, offline session check). Every network path — queries, RPC argument names, embedded selects (`curators → institution:institutions(*)`, `shortlists → shortlist_items(*)`), uploads, signed URLs — is unexercised.
7. `supabase/scripts/upload-demo-vault.mjs` was run only with `--dry-run`.
8. Supabase's security advisor / linter output.

### Known differences from mock mode

- Re-setting an artist's or curator's status to the value it already has is a no-op and writes no audit row (mock logs it again). Removing an item that is not in a shortlist writes no audit row.
- `private.view` events (staff opening a private record or a work's documents) are reported by the client through `log_audit()`; a modified client could skip them. Vault file access is server-enforced and always audited.
- Seeded images stay inline SVG `data:` URLs; uploaded images go to Storage and come back as signed URLs. `saveArtwork` converts signed URLs back to `storage:` refs, so editing a work round-trips its images.
- `exportMyData` inlines stored images as `data:` URLs when it can fetch them; if a fetch fails, that image keeps its `storage:artwork-images/…` reference.
- `resetDemoData()` is staff-only and does not delete audit events or consents.
- Two Supabase clients exist (session + session-less visitor), so supabase-js prints a one-time "Multiple GoTrueClient instances" console warning. They use different storage keys.


## Demo artwork photographs

`public/art/*.jpg` are bundled for mock mode. For Supabase mode run `SUPABASE_URL=… SUPABASE_ANON_KEY=… supabase/scripts/upload-art.sh` once after `seed_auth.sql`: it signs in as each demo artist and uploads their files to `artwork-images/<artist uuid>/<name>.jpg` (the storage policy only lets an artist write inside their own folder, so this doubles as a policy check). `seed_content.sql` then references them as `storage:artwork-images/…` refs; the app signs URLs at read time and `artwork_visible()` decides who may read each object. Works without a photograph keep an inline SVG placeholder.
