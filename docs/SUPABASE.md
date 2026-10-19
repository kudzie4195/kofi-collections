# Kofi Collections — Supabase backend

Supabase mode replaces the in-browser mock with a real Postgres backend where **every visibility rule is enforced on the server**: row-level security, column privileges, redacting views, guard triggers, private storage buckets and an append-only audit log. The UI code does not change; it talks to the same `DataSource` interface (`src/data/DataSource.ts`).

All demo content is fictional (guide §07). Use a **demo project** for the seed — the seed's reset function wipes the content tables.

---

## 1. Apply the schema

Migrations live in `supabase/migrations/` and must run in order:

| File | What it does |
|---|---|
| `0001_schema.sql` | Enums, tables, indexes, `updated_at` triggers, profile-on-signup trigger, append-only triggers on `audit_events` / `consents` |
| `0002_rls.sql` | Helper functions (`current_role_of`, `is_admin`, `is_verified_curator`, `my_artist_id`, `my_curator_id`, `can_see`, …), the audit writer, guard triggers, audit triggers, the inquiry status machine, column privileges, RLS policies on every table |
| `0003_views.sql` | `region_label()`, field-redacting views `artworks_visible`, `artists_visible`, `inquiries_visible` |
| `0004_storage.sql` | Private buckets `artwork-images` and `vault`, storage policies, `open_document()` |
| `0005_rpcs.sql` | `whoami`, `describe_access`, `log_audit`, `accept_consent`, `submit_for_review`, `save_artwork`, `export_my_data`, `request_verification`, `set_inquiry_status`, `set_artist_status`, `set_kofi_notes`, `mark_artwork_reviewed`, `set_curator_status` |
| `0006_realtime.sql` | Adds the main tables to the `supabase_realtime` publication |

**Option A — Supabase CLI (linked project)**

```bash
npx supabase init            # once, creates supabase/config.toml; keep the existing migrations
npx supabase link --project-ref <your-project-ref>
npx supabase db push         # applies supabase/migrations/* in filename order
```

**Option B — SQL editor.** Open each file above in order (0001 → 0006), paste, run.

## 2. Load the demo seed

`supabase/seed.sql` is **generated** from the TypeScript seed so both modes hold the same records:

```bash
node supabase/scripts/generate-seed.mjs   # rewrites supabase/seed.sql from src/data/mock/seed.ts
```

Run it against the project:

- SQL editor: paste `supabase/seed.sql` and run, or
- `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql`, or
- local stack: `npx supabase db reset` runs `seed.sql` automatically.

The seed is safe to re-run. It creates the 8 demo auth users once, then calls `public.kofi_demo_reset()`, which restores every content table from a private snapshot schema (`kofi_demo`). Audit events and consents are append-only and are never deleted.

Then upload the two fictional vault files (they are Storage objects, not rows):

```bash
node supabase/scripts/upload-demo-vault.mjs --dry-run      # shows the two paths
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node supabase/scripts/upload-demo-vault.mjs
```

The service-role key bypasses Storage policies. Run that script from your own machine only; never put the key in `.env` for the app.

## 3. Point the app at it

Create `.env.local` in the project root:

```bash
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
# Optional, demo projects only: let the identity switcher sign in as the demo users automatically.
VITE_SUPABASE_DEMO_LOGIN=true
```

If `VITE_DATA_MODE=supabase` is set but the URL or key is missing, `src/data/index.ts` falls back to mock data and logs a warning.

### Signing in (follow-up for the shell)

`DataSource` has no sign-in method. Supabase mode handles identities like this:

- `listDemoIdentities()` returns the same seven demo identities (same ids, labels, captions) as mock mode, with UUID-keyed viewers.
- `signInDemo(ds, identityId)` (exported from `src/data/supabase/SupabaseDataSource.ts`) signs in with email + password and returns the `Viewer` the **server** resolved. `'visitor'` signs out.
- Every call re-checks the session: the visitor always uses a session-less client; any other `Viewer` must match the Supabase session, otherwise the call fails with *"Your session has ended. Sign in again from Account."*
- **Follow-up:** `src/app/AccountScreen.tsx` should call `await signInDemo(data, identity.id)` before `signInAs(identity)` when `data.mode === 'supabase'` (and pass the returned viewer). Until then, set `VITE_SUPABASE_DEMO_LOGIN=true` on a demo project: the data source then signs in as the chosen demo user automatically on the first call.
- "Reset demo data" in Supabase mode calls `kofi_demo_reset()`, which only Kofi staff (Quincy) may run. Other identities get a clear error. Consider hiding the button for non-staff in Supabase mode.

## 4. Demo users

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

The full mock-id → UUID table is at the top of `supabase/seed.sql` and in `src/data/supabase/demo.ts`.

## 5. What is enforced where

"Client" = the app; everything else runs in Postgres / Supabase Storage and holds even if someone calls the API directly with the anon key.

| Rule (guide §04 / `src/domain/visibility.ts`) | Enforced by |
|---|---|
| `canSee(level, viewer, owner)` | `public.can_see(visibility, uuid)` — same truth table; owner = artist role + own artist id; admin always; verified curator for `institutions`; never anyone else for `kofi`/`private` |
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

Error mapping (`mapPgError`): `42501` → `ForbiddenError`; `P0002`, `PGRST116`, `23503`, bad uuid → `NotFoundError`; `22023` (HINT = field), `23514` (known constraints → mock message), `23502`, `23505` → `ValidationError`; expired JWT → `ForbiddenError("Your session has ended…")`.

## 6. Verification status

**Verified** (real PostgreSQL 16.15, local throwaway cluster, `supabase/tests/LAST_RUN.log`):

- All six migrations load cleanly on top of `supabase/tests/shim.sql`, a stand-in for Supabase's `auth`, `storage`, `extensions` schemas and the `anon`/`authenticated`/`service_role` roles (with Supabase's default grants, so the revokes are exercised).
- `seed.sql` loads, and loads again (idempotent).
- `supabase/tests/rls_test.sql` + `supabase/tests/rpc_test.sql`: 100 assertions executed as each demo identity the way PostgREST does it (`set local role …; set local request.jwt.claims = …`), all passing. These include the policies, column privileges, views, guard and audit triggers, the inquiry state machine, every RPC, the storage policies on `storage.objects`, the vault "audited open first" gate, cascades, and `kofi_demo_reset()`.
- Run it yourself: `PGHOST=… PGPORT=… PGUSER=postgres supabase/tests/run-local.sh` (it drops and recreates a database — never point it at a Supabase project).

**Not verified against a live Supabase project** (no project or Docker daemon was available):

1. The migrations on Supabase's real platform schemas (real `auth.users` columns, `storage` schema ownership, `supabase_realtime`), on Postgres 15/17, via `supabase db push`, including that the CLI accepts the `0001_…`-style file names.
2. Seeded `auth.users` / `auth.identities` rows actually signing in through GoTrue with the demo password.
3. Supabase Storage honouring the `storage.objects` policies when signing URLs (`createSignedUrl(s)`), uploading and removing — the policies were only exercised with direct SQL against the shim table. Bucket size / MIME limits were not exercised.
4. Realtime delivering `postgres_changes` events under these RLS policies, and Realtime omitting columns the subscriber cannot select (e.g. `artworks.price_amount`). The client only uses events as a refetch signal and never reads payloads.
5. `src/data/supabase/SupabaseDataSource.ts` was never run against a server. It typechecks and its pure parts are unit-tested (`src/data/supabase/supabase.test.ts`: error mapping, row mappers, storage-ref round-trip, data URL helpers, demo identity mapping, offline session check). Every network path — queries, RPC argument names, embedded selects (`curators → institution:institutions(*)`, `shortlists → shortlist_items(*)`), uploads, signed URLs — is unexercised.
6. `supabase/scripts/upload-demo-vault.mjs` was run only with `--dry-run`.
7. Supabase's security advisor / linter output.

### Known differences from mock mode

- Re-setting an artist's or curator's status to the value it already has is a no-op and writes no audit row (mock logs it again). Removing an item that is not in a shortlist writes no audit row.
- `private.view` events (staff opening a private record or a work's documents) are reported by the client through `log_audit()`; a modified client could skip them. Vault file access is server-enforced and always audited.
- Seeded images stay inline SVG `data:` URLs; uploaded images go to Storage and come back as signed URLs. `saveArtwork` converts signed URLs back to `storage:` refs, so editing a work round-trips its images.
- `exportMyData` inlines stored images as `data:` URLs when it can fetch them; if a fetch fails, that image keeps its `storage:artwork-images/…` reference.
- `resetDemoData()` is staff-only and does not delete audit events or consents.
- Two Supabase clients exist (session + session-less visitor), so supabase-js prints a one-time "Multiple GoTrueClient instances" console warning. They use different storage keys.
