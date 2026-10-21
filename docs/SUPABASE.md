# Kofi Collections — Supabase backend

Supabase mode replaces the in-browser mock with a real Postgres backend where **every visibility rule is enforced on the server**: row-level security, column privileges, redacting views, guard triggers, private storage buckets and an append-only audit log. The UI code does not change; it talks to the same `DataSource` interface (`src/data/DataSource.ts`).

All demo content is fictional (guide §07).

## 0. Shared project: everything lives in schema `kofi`

Kofi can share a Supabase project with another product. That product owns `public` (for example `public.profiles`, `public.consent_records`, `public.admin_users`, an `is_admin()` helper, its own `on_auth_user_created` trigger and its real users). So **every object Kofi creates is in the Postgres schema `kofi`**: tables, enums, helper functions, guard and audit trigger functions, views, RPCs, the demo snapshot (`kofi.demo_*`) and `kofi.kofi_demo_reset()`. The migrations never create, alter, grant or revoke anything in `public`. `supabase/tests/isolation_test.sql` checks this against a stand-in for the other product.

Kofi does share four things, and it names them so they cannot clash:

| Shared object | What Kofi adds |
|---|---|
| `auth.users` | One trigger, `kofi_on_auth_user_created`, which creates a `kofi.profiles` row for **every** new user on the project (other-product sign-ups get Kofi role `public`). A failure in it is logged as a warning and never blocks a sign-up. |
| `storage.buckets` | Two private buckets, `artwork-images` and `vault`, and one public bucket, `kofi-programme` (programme images, 0008) |
| `storage.objects` | Thirteen policies, all named `kofi …` (nine from 0004, four `kofi programme …` from 0008) |
| `supabase_realtime` publication | Fourteen `kofi.*` tables (eight from 0006, six programme tables from 0008) |

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
| `0008_programme.sql` | The programme (§9): six tables, five enums, six views, five RPCs, RLS, the public `kofi-programme` bucket + four storage policies, six realtime tables. Idempotent, one transaction, recorded in `kofi.applied_migrations` |

**On the shared project — psql or the SQL editor (recommended).** Run each file above in order (0000 → 0008):

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
| `supabase/seed_content.sql` | Everything else, all in `kofi`: the snapshot tables `kofi.demo_*` (RLS on, no API grants), `kofi.kofi_demo_reset()`, then the reset itself, then the append-only consent / audit seed rows. Includes the programme (§9). Stops with an error if the demo auth users are missing. |
| `supabase/seed_programme.sql` | **Additive** programme rows only — `insert … on conflict (id) do nothing`, never updates or deletes. For a project whose content was loaded without the snapshot / `kofi_demo_reset()` (the shared production project), where `seed_content.sql` must not run. Stops if 0008 or the referenced demo artists / artworks are missing. |

```bash
node supabase/scripts/generate-seed.mjs   # rewrites the three seed files from src/data/mock/seed.ts
```

Run them **after the migrations, in this order**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed_auth.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed_content.sql
```

(or paste them into the SQL editor in that order). For a local CLI stack, point `[db.seed] sql_paths` in `supabase/config.toml` at `./seed_auth.sql` and `./seed_content.sql`, in that order, so `npx supabase db reset` loads both.

All three files are safe to re-run. `seed_auth.sql` leaves existing ids alone. `seed_content.sql` calls `kofi.kofi_demo_reset()`, which **wipes every row in the Kofi content tables** (artists, artworks, images, institutions, curators, shortlists, inquiries, documents and the programme tables — Kofi's only, never `public`) and restores them from `kofi.demo_*`. Audit events and consents are append-only and are never deleted. `seed_programme.sql` only adds missing programme rows.

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

It does **not** remove, because they are rows rather than schema objects: the demo auth accounts (see the `delete` line in the `seed_auth.sql` header), the three storage buckets and their files (empty the buckets, then delete them in the dashboard or with `storage.deleteBucket('artwork-images')` / `('vault')` / `('kofi-programme')`), and `kofi` in the exposed-schemas list (remove it in the dashboard).

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

- All ten migrations (0000–0009) load cleanly (0008 and 0009 twice each, to prove they are idempotent) on top of `supabase/tests/shim.sql`, a stand-in for Supabase's `auth`, `storage`, `extensions` schemas, the `anon`/`authenticated`/`service_role` roles (with Supabase's default grants in `public`) **and the other product**: a pre-existing `public.profiles`, `public.consent_records`, `public.admin_users`, `public.is_admin()`, an `on_auth_user_created` trigger on `auth.users` and two existing users.
- `seed_auth.sql` + `seed_content.sql` load, and load again (idempotent).
- `supabase/tests/rls_test.sql` + `supabase/tests/rpc_test.sql`: 100 assertions executed as each demo identity the way PostgREST does it (`set local role …; set local request.jwt.claims = …`), all passing, against `kofi.*`. These include the policies, column privileges, views, guard and audit triggers, the inquiry state machine, every RPC, the storage policies on `storage.objects`, the vault "audited open first" gate, cascades, and `kofi_demo_reset()`.
- `supabase/tests/programme_test.sql`: 58 assertions for 0008 — see §9. `supabase/tests/sales_test.sql`: 53 assertions for 0009 — see §10.
- `supabase/tests/isolation_test.sql`: 16 assertions — no Kofi tables in `public`; a fingerprint of `public` (objects, ACLs, policies, triggers, the other product's rows and its auth trigger) is identical before the migrations and after migrations + seed; every Kofi function pins `search_path = kofi, public`, every view is `security_invoker`, every table has RLS; realtime publishes only `kofi.*` (16 tables); both auth triggers coexist and a failing Kofi profile insert does not block a sign-up; internal helpers and the snapshot are not reachable by API roles; `drop schema kofi cascade` (in a savepoint, rolled back) leaves `public` identical and removes Kofi's auth trigger, storage policies and realtime tables.
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

## 9. The programme (0008)

Exhibitions, open calls, events and journal stories that Kofi authors, plus the two flows that hang off them — artist **applications** to open calls and collector (**buyer**) **inquiries** routed through Kofi. Shapes mirror the "Programme" section of `src/domain/types.ts`; rules are `src/domain/programme.ts` and the validators in `src/data/mock/MockDataSource.ts`, re-implemented server-side with the **same messages and form fields**, so the UI reads identically in both modes.

### Objects (all in `kofi`)

| Kind | Names |
|---|---|
| Tables | `exhibitions`, `open_calls`, `events`, `stories`, `applications`, `buyer_inquiries`, `applied_migrations` (migration ledger, no API access) |
| Enums | `application_status`, `buyer_inquiry_status`, `event_kind`, `story_kind`, `buyer_intent` |
| Views (`security_invoker`) | `exhibitions_visible`, `stories_visible`, `open_calls_visible`, `events_visible`, `applications_visible`, `buyer_inquiries_visible` |
| RPCs | `submit_application`, `withdraw_application`, `set_application_status`, `submit_buyer_inquiry`, `set_buyer_inquiry_status` |
| Helpers | `artwork_discoverable`, `programme_artwork_ids`, `programme_exhibition_link`, `story_artist_link`, `application_labels`, `buyer_inquiry_labels` (definer, re-check per row); `programme_image_src_ok`, `programme_image_alt_ok`, `venue_ok`, `http_url_ok` (pure, used by CHECKs) |
| Triggers | `*_touch` (updated_at), `*_keep_created`, `*_audit` (`programme.save` / `programme.delete`), `open_calls_guard_delete`, `*_check_artworks` |
| Outside `kofi` | bucket `kofi-programme` (public, 6 MB, JPEG/PNG/WebP); storage policies `kofi programme admin read/insert/update/delete`; six tables added to `supabase_realtime` |

### Access model

| | anon | authenticated (artist / curator) | Kofi admin |
|---|---|---|---|
| Programme items | read published (views) | read published (views) | read drafts too; insert / update / delete the tables directly (RLS) |
| `artwork_ids` | only through `*_visible` — filtered to works that may appear on a public surface (`artwork_discoverable`, the gallery rule: never drafts or Kofi-only, approved artists only; admins see all), order kept | same | all works |
| Links | `exhibition_id` (calls, events) and `stories.artist_id` are not selectable on the base tables; the views return them through `programme_exhibition_link` / `story_artist_link` only when the target is a published exhibition / an artist the viewer may see | same | everything |
| Applications | nothing | own rows only, **never `staff_note`** (column not granted; the view returns it to admins only); write only through the RPCs | all rows + staff note; decide via `set_application_status` |
| Collector inquiries | **no table access**; `submit_buyer_inquiry()` only | `submit_buyer_inquiry()` only; cannot read | read `buyer_inquiries_visible`; triage via `set_buyer_inquiry_status` |

Grants follow 0002's least-privilege style: `anon`/`authenticated` get `SELECT` on the programme tables except `artwork_ids`, `exhibition_id` and `stories.artist_id`, column-level `INSERT`/`UPDATE` (never `id` / `created_at` / `updated_at`) plus `DELETE` for `authenticated` (RLS lets only admins through), `SELECT` on `applications` except `staff_note`, nothing on `applications` / `buyer_inquiries` writes. Trigger functions are not executable by API roles. **Artwork filtering is server-side** (the views), so a hidden work's id never reaches the client.

### Rules the RPCs enforce

- `submit_application(p_call, p_artwork_ids, p_statement)` — artist role only (`Sign in as an artist to apply.`); a draft or unknown call is `Open call not found.`; then `validateApplication()` in order: partner-form calls, upcoming (`This call opens on Nov 15, 2026.` — date formatted like `formatCalendarDate`), closed (deadline inclusive, compared as a calendar day in `America/New_York`), paused profile, no consent, a live application already exists (also a partial unique index, so parallel submits cannot both win), duplicate / zero / too many works, works not the artist's own, `Only me` works, statement 20–2000 characters (trimmed). Audited `application.submit`.
- `withdraw_application(p_id)` — own application, `submitted` or `shortlisted` only. Audited.
- `set_application_status(p_id, p_status, p_decision_note, p_staff_note)` — admin; exactly `canMoveApplication(from, to, 'admin')` (all 25 pairs tested); `decided_at` set on accept/decline, cleared otherwise; a `NULL` note keeps the current one, `''` clears it. Audited.
- `submit_buyer_inquiry(p_artwork, p_name, p_email, p_org, p_intent, p_message, p_consent)` — callable by anon. `validateBuyerInquiry()`, then the work must be discoverable by the caller (else `Artwork not found.`), the artist is derived server-side, then at most `BUYER_INQUIRY_DAILY_LIMIT` (5) per lower-cased email per rolling 24 h (advisory-locked per address). Returns only the new id. The audit row has no email.
- `set_buyer_inquiry_status(p_id, p_status, p_staff_note)` — admin.
- Deleting an open call that has applications raises `This call has applications. Unpublish it instead.` (field `call`). Attached work ids must exist (`One of the attached works no longer exists.`); a deleted linked exhibition / artist maps to `That exhibition no longer exists.` / `That artist no longer exists.` (`FOREIGN_KEY_ERRORS` in `errors.ts`).

### Images

Admin uploads (`data:image/` JPEG/PNG/WebP) go to `kofi-programme/<exhibitions|open-calls|stories>/<uuid>.<ext>` and are stored as `storage:kofi-programme/<path>`; reads return the bucket's public URL (`getPublicUrl`, no signing). Bundled `/art/<file>` paths and other inline `data:image/` URLs are stored as they are. Saving an item converts its public URL back to the ref, so an unchanged image round-trips; a replaced or deleted item's old object is removed (best effort). The bucket is public **on purpose** (editorial images Kofi publishes; artwork photographs stay in the private `artwork-images` bucket). There is no anon `SELECT` policy, so draft images cannot be listed through the API; their URLs contain random UUIDs.

### Applying 0008 to the shared production project

The live project already holds the 13 demo works and must **not** be reset — never run `seed_content.sql` there. Run, in this order, each file on its own (SQL editor / `execute_sql` / `psql -v ON_ERROR_STOP=1 -f`):

| # | File | Size | What |
|---|---|---|---|
| 1 | `supabase/apply/0008_part1.sql` | ~16 KB | ledger, enums, shape checks, the six tables, audit vocabulary |
| 2 | `supabase/apply/0008_part2.sql` | ~14 KB | triggers, read helpers, views |
| 3 | `supabase/apply/0008_part3.sql` | ~14 KB | RPCs with their EXECUTE grants |
| 4 | `supabase/apply/0008_part4.sql` | ~10 KB | table / view grants, RLS, `kofi-programme` bucket + policies, realtime, records `0008_programme` in `kofi.applied_migrations`, reloads PostgREST |
| 5 | `supabase/seed_programme.sql` | ~25 KB | programme rows, insert-only on fixed ids (`on conflict (id) do nothing`); never updates or deletes. **Since 0009 it needs 0009 first** (it writes the call kind / organiser / terms columns) — see §10 |
| 6 | `supabase/apply/0008_live_patch.sql` | ~6 KB | `UPDATE kofi.artworks SET rights_note = …` for the 13 works by fixed id, only where different |

The parts are generated from `0008_programme.sql` (`node supabase/scripts/split-0008.mjs`); each is one transaction and idempotent, so a failed part can be re-run. `0008_programme.sql` itself (one transaction) is equivalent. `run-local.sh` checks this "live path": a database built with parts 1–4 (twice), programme tables emptied and rights notes changed, then `seed_programme.sql` and the live patch (twice) ends in the seeded state with no audit rows, and passes `programme_test.sql` + `isolation_test.sql`.

Notes:
- 0008 needs 0000–0007 (it extends the `audit_events` CHECKs and uses `kofi.is_admin`, `my_artist_id`, `artwork_visible`, `artist_visible`, `write_audit`, `touch_updated_at`). It creates `kofi.applied_migrations` only if missing and enables RLS on it.
- No exposed-schema change: `kofi` is already exposed.
- The bucket row is inserted into `storage.buckets` from SQL, as 0004 did. If the project refuses that, create bucket `kofi-programme` in the dashboard (public, 6 MB, image/jpeg, image/png, image/webp) and re-run part 4.
- `seed_programme.sql` and the live patch set `kofi.seeding` for their own transaction, so they write no audit rows.

### Verification

`supabase/tests/programme_test.sql` (58 assertions, in `run-local.sh`, run on both the migration-file database and the live-path database) covers: visitors see published items only, admins see drafts; filtered and ordered `artwork_ids`; draft / hidden links dropped for visitors and artists, kept for admins; base-table `artwork_ids` / `exhibition_id` / `stories.artist_id` / `staff_note` not selectable; artists and curators cannot write programme rows or applications; admin writes audited; CHECKs (dates, URLs, image source / alt, venue, limits) and reference checks; the delete guard; `submit_application` happy path and every rejection; who sees which application; withdraw rules; the full admin status matrix; collector inquiries as anon, invisible / draft / pending-artist works refused, the 6th in 24 h refused, no anon reads; storage policies; demo reset; and that every 0008 object is in `kofi`, `public` is still byte-identical, and the grants are as narrow as listed above.

The TypeScript side (`SupabaseDataSource` programme methods) was also run end to end against **PostgREST 12.2.3** on the same local database (48 checks: reads through the views, admin create / update / delete with a storage upload, a work's signed image copied into the programme bucket, applications, collector inquiries and the error messages). Not verified: Supabase Storage itself (the upload went through a stand-in that applied the `storage.objects` policies), GoTrue sign-in, Realtime delivery.

### Known differences from mock mode

- Mock-mode audit rows for collector inquiries use the sender's name as the actor name; Supabase records an anonymous visitor as actor `anonymous` / role `public`.
- Event times come back in Kofi's offset (`2026-10-29T18:30:00-04:00`) whatever offset they were saved with; the instant is the same.


## 10. Partners, auctions, payouts, reports (0009)

A call can be an auction run with a partner institution. Selected works become **lots**; recording a hammer price freezes the split (`Sale`) and creates the artist's **payout**; Kofi marks payouts paid; reports are derived from applications, exhibitions, lots and payouts. Shapes mirror the "Sales" section of `src/domain/types.ts`; rules are `src/domain/sales.ts`, `src/domain/reports.ts` and the mock data source's `saveOpenCall` / `listApplications` / `setApplicationStatus` / `saveLot` / `setLotStatus` / `recordSale` / `deleteLot` / `setPayoutStatus` / `kofiReport`, re-implemented server-side with the **same messages, form fields and cents arithmetic**.

### Objects (all in `kofi`)

| Kind | Names |
|---|---|
| Columns on `open_calls` | `kind kofi.call_kind` (default `exhibition`), `organizer_institution_id` → `institutions` (on delete set null), `terms jsonb` (a `CallTerms`, camelCase) with CHECKs `open_calls_terms_shape` (`call_terms_ok()`) and `open_calls_auction_terms` (a published auction has terms) |
| Tables | `lots` (sale jsonb = the frozen `Sale`; partial unique indexes: one live lot per work per call, one lot number per call — withdrawn lots free both), `payouts` |
| Enums | `call_kind`, `lot_status`, `payout_status` |
| Views (`security_invoker`) | `lots_visible` (sale without `buyerRef` for the artist; payout only for Kofi and the artist), `payouts_visible`; `open_calls_visible` gains `kind`, `organizer_institution_id`, `terms` (appended) |
| RPCs | `save_lot(p_lot jsonb)`, `set_lot_status(p_id, p_status text)`, `record_sale(p_id, p_hammer numeric, p_sold_on text, p_buyer_ref text)`, `delete_lot(p_id)`, `set_payout_status(p_id, p_status text, p_method, p_reference, p_note, p_paid_on text)`, `kofi_report(p_from text, p_to text)`, `call_application_works(p_call)`; `set_application_status` now also for partners |
| Helpers | `my_verified_institution_id`, `is_call_organizer`, `require_organiser`, `organiser_sees_artwork`, `lot_extras`, `payout_labels`, `call_lot_state` (definer); `call_terms_problem` / `call_terms_ok` (= `validateTerms`), `kofi_day`, `kofi_today`, `kofi_noon`, `js_iso`, `iso_date_ok`, `json_int`, `try_uuid` (pure); internal guards `require_call_manager`, `require_lot`, `lot_rules` (not API-callable) |
| Trigger | `open_calls_sales_guard` (before insert/update on `open_calls`) |
| Replaced from 0008 | `application_labels` (reviewers' note to Kofi **and the call's organiser**), `programme_exhibition_link` (partner sees its draft's link), `programme_audit` (organiser link is a reference column), `set_application_status`; from 0004 `storage_image_readable` (+ the reviewer rule) |
| Outside `kofi` | storage policy `kofi programme partner insert` (verified curators may add images under `kofi-programme/open-calls/`; no update / delete / list); `lots`, `payouts` added to `supabase_realtime` |

Signatures differ from a naïve `date` / `bigint` design on purpose: the text / numeric parameters let the server answer malformed input with the domain's own messages (`Enter the date of the sale.`, `Enter the hammer price.`, `Pick a start and end date.`, `Unknown status.`) instead of a cast error.

### Access model

| | anon | artist | partner (verified curator of the organiser) | pending curator / other curator | Kofi admin |
|---|---|---|---|---|---|
| Open calls | published | published | + its own drafts; insert a draft for its institution (forced `published = false`, `sample = false`, organiser = its own); edit only while unpublished; never publish / re-assign (`open_calls_sales_guard`) | published | everything |
| Applications | — | own, never `staff_note` | to its calls, with `staff_note` (the reviewers' note); decide via `set_application_status` | — | all |
| Attached works | — | — | `call_application_works()`: any attached work except Only me (applying is consent), price per its own visibility, signed photos (`storage_image_readable`); discovery unchanged | — | `artworks_visible` |
| Lots | — | own, read-only; sale **without** `buyerRef`; own payout | its calls' lots incl. `buyerRef`, **no payout**; RPC writes | — | all |
| Payouts | — | own | — | — | all; `set_payout_status` |
| Report | — | — | — | — | `kofi_report` |

Grants: `lots` — `SELECT` on every column **except `sale`** (read through `lots_visible`), no writes; `payouts` — `SELECT` (RLS), no writes; new RPCs revoked from `public`/`anon`, granted to `authenticated`; `open_calls` gains `SELECT (kind, organizer_institution_id, terms)` for anon/authenticated and column `INSERT`/`UPDATE` on them for authenticated. Lots have **no foreign key to `artworks`** (like the programme's `artwork_ids`): an artist may still delete a work, as in mock mode, and the lot / sale stays on the record ("A work that has been removed").

### Rules the server enforces

- **Terms**: `call_terms_problem()` = `validateTerms()` (first problem, same field); an auction call always carries terms (any save, as `cleanOpenCall`); terms are **locked once a lot has sold** and a call with lots stays an auction — for Kofi too.
- **save_lot**: requireOrganiser → lot exists → requireCallManager → same call / not sold → application / work exist → `validateLot()` (via `lot_rules`); new lots are `planned`; audited `lot.save {callId, lotNumber, created}`. Races on the partial unique indexes map to the same messages.
- **set_lot_status**: `canMoveLot()`; reinstating a withdrawn lot re-runs `validateLot()`; `sold → unsold` voids the sale (sale cleared, the live payout → `void`, kept) unless the payout is paid (`Payout already paid.`); audited `lot.save {status, from, lotNumber}` or `lot.sale {voided, lotNumber}` + `payout.status {status: void}`.
- **record_sale**: terms required → `validateSale()` (same order) → `isIsoDate`; `splitSale()` in cents: `round(hammer × pct / 100)` — Postgres `round(numeric)` rounds half away from zero, which equals `Math.round` for these positive amounts — artist first, then partner, remainder to Kofi, premium on top; `soldAt` = 12:00 Kofi time written like `toISOString()`; payout `due` for the artist amount; audited `lot.sale {hammer, currency, lotNumber}` — never the buyer reference.
- **delete_lot**: only a lot that has never been sold (no payout on record).
- **set_payout_status**: Kofi only; `canMovePayout()`; `void → due` only while the lot is sold with no other live payout; paid needs a method (≤ 80), reference ≤ 120, note ≤ 2000, a valid day not in the future (default today), stored as 12:00 Kofi time; leaving `paid` clears method / reference / day; audited `payout.status {status, lotId, method?}`.
- **set_application_status**: Kofi or the call's partner; a selection with live lots cannot be moved.
- **kofi_report**: Kofi only; `validateRange()`; returns `{participation, placements, payments}` — rows shaped exactly like `ParticipationRow` / `PlacementRow` / `PaymentRow`, over **all** rows, Kofi days compared as `YYYY-MM-DD` strings like the TS. The **client** puts them in `buildReport()`'s order and computes the totals with `buildReport()`'s rules (`assembleReport()` in `SupabaseDataSource.ts`); audited `report.export {from, to}`.

### Applying 0009 to the shared production project

0009 needs 0000–0008 (already live). Never run `seed_content.sql` there. Run, in order, each file on its own:

| # | File | Bytes | What |
|---|---|---|---|
| 1 | `supabase/apply/0009_part1.sql` | 12 922 | enums, pure helpers, `open_calls` columns (+ their SELECT grant), `lots`, `payouts` (RLS on, no access yet), audit vocabulary |
| 2 | `supabase/apply/0009_part2.sql` | 15 792 | partner helpers, guard trigger, replaced read helpers, views |
| 3 | `supabase/apply/0009_part3.sql` | 17 293 | lot RPCs, each with its EXECUTE grant |
| 4 | `supabase/apply/0009_part4.sql` | 15 485 | payout / application / report RPCs, each with its EXECUTE grant |
| 5 | `supabase/apply/0009_part5.sql` | 5 822 | table / view grants, RLS policies, the partner storage policy, realtime, records `0009_sales`, reloads PostgREST |
| 6 | `supabase/seed_programme.sql` | 25 307 | insert-only; adds the CMA benefit auction + its 3 applications (existing rows untouched) |
| 7 | `supabase/seed_sales.sql` | 5 596 | insert-only lots + payouts |
| 8 | `supabase/apply/0009_live_patch.sql` | 2 097 | by fixed id: the sample calls' `kind` (Night Weather → `award`), organiser / terms only where empty |

Generated: parts by `node supabase/scripts/split-0009.mjs`, seeds and patches by `node supabase/scripts/generate-seed.mjs`. Every file is one transaction and idempotent. `run-local.sh` checks this live path: 0008 parts ×2 + 0009 parts ×2, the pre-0009 state recreated (no lots / payouts / auction call, every call kind `exhibition`, old rights notes), then seed_programme / 0008 live patch / seed_sales / 0009 live patch ×2 → seeded state, no audit rows, and `programme_test.sql` + `sales_test.sql` + `isolation_test.sql` pass on it.

**Do not re-run 0008 (or its parts) after 0009.** 0008 redefines the audit vocabulary, the open-call policies and grants, `application_labels` and `set_application_status` without the 0009 additions; its view step fails on `open_calls_visible` (columns cannot be dropped) but its part 1 / part 4 would succeed and silently undo 0009. If 0008 is ever re-run, run 0009 again right after.

### Verification

`supabase/tests/sales_test.sql` (53 assertions, run on both databases) covers: the seeded auction, terms and day helpers; a partner's draft (forced draft / organiser), edits, refused publish / re-assign / published edits / Kofi-run calls / deletes, terms validation; Kofi publishing, the terms lock and kind lock, the backing CHECKs; partner application review (only its calls, reviewers' note, the live-lot rule), reviewer works and photos (incl. a pending artist's attached work, never in discovery); Owen (pending) and artists refused everywhere; every `save_lot` / `record_sale` rule, the 820 000 → 574 000 / 164 000 / 82 000 + 82 000 split and a .5-cent rounding case, void / re-sale / delete / reinstate; the full lot status matrix; payout rules and the paid → void refusal; who sees which lot / payout (artist without `buyerRef`, organiser without payouts); the October 2026 report rows; validateRange; audit rows; storage; demo reset; isolation (new objects only in `kofi`, `public` fingerprint unchanged, least-privilege grants).

`SupabaseDataSource` was also run end to end against **PostgREST 12.2.3** on the same local database (113 checks): Lena creates a draft auction → Kofi publishes → Mara applies with a Kofi-only work → Lena sees it, selects, makes a lot, records the sale → Mara's `listMyLots` has no buyer reference anywhere → Kofi marks the payout paid → `kofiReport` equals `buildReport()` run on the same raw rows (rows and totals). Not verified: Supabase Storage itself (stand-in applying the `storage.objects` policies), GoTrue, Realtime delivery.

### Known differences from mock mode

- Two live lots cannot share a work or a lot number even transiently (partial unique indexes); mock mode only checks this in `validateLot`.
- Report placements with the same day and artist may come in a different (stable, deterministic) order than mock mode; every other row order and all totals are identical.
- Lot, payout, sale and report ids are UUIDs.
