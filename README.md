# Kofi Collections

Artist-owned documentation, discovery and opportunities. One React codebase, shipped to iOS and Android with Capacitor and to the web with Vite.

> Everything in the demo is fictional sample content. Do not invite real artists or institutions until the release gate in `docs/guide/quincy.md` §07 is cleared.

## What's in the box

| Area | Where | What it does |
|---|---|---|
| Public gallery | `src/features/gallery` | Search + filter by medium, materials, size (cm/in), availability, career stage, region, experience, budget. Artwork and artist pages. |
| Artist studio | `src/features/studio` | Profile, works (images re-encoded to strip metadata), field-level visibility (record + price), private document vault, consent, export (JSON + CSV), withdraw, inquiry inbox. |
| Curator desk | `src/features/curator` | Institution verification request, shortlists, controlled introduction requests. |
| Kofi admin | `src/features/admin` | Review queue, curator verification, inquiry forwarding, append-only activity log. |
| Visibility rules | `src/domain/visibility.ts` | The one `canSee` rule every read goes through. Tested in `src/domain/*.test.ts`. |
| Data layer | `src/data` | `DataSource` contract. `mock/` runs fully on-device (default). `supabase/` talks to Postgres with RLS + redaction views (`supabase/migrations`). |
| Design system | `src/styles`, `src/ui` | Tokens, components. Syne + Instrument Sans (self-hosted), cobalt/coral/lime/butter palette, hard offset shadows. Light + dark. |

## Run it

```bash
nvm use            # Node 22 (see .nvmrc)
npm ci
npm run dev        # http://localhost:5173 — mock mode, no accounts, no network
```

Pick an identity on the Account tab. Each identity sees only what its role may see — the data layer enforces it, not the UI.

### Checks

```bash
npm run typecheck
npm test
npm run build
```

### Native

```bash
npm run cap:sync        # builds web + copies into ios/ and android/
npx cap open ios        # Xcode (run `pod install` in ios/App first on a Mac)
npx cap open android    # Android Studio
```

App id `org.kofi.collections`. Capacitor plugins: Share, Filesystem (export), Haptics, Status Bar, App.

### Supabase mode

See `docs/SUPABASE.md`. In short: apply `supabase/migrations/*` in order, run `supabase/seed.sql`, copy `.env.example` → `.env` with `VITE_DATA_MODE=supabase` and your project URL + anon key.

## The visibility model (read this before changing anything)

| Level | Who sees it |
|---|---|
| Public | anyone |
| Verified institutions | curators Kofi has verified, Kofi admins, the owner |
| Kofi team only | Kofi admins, the owner |
| Only me | the owner; Kofi admins can open it and every open is logged |

Applied per field: a work can be public while its price is institutions-only. Artist contact, legal name and documents are never part of any non-owner projection (`NEVER_LEAK_ARTIST_KEYS`). A curator's "verified" flag is re-read from the record on every request — the client is never trusted.

Kofi does not estimate or label appraised values. The vault stores human appraisals; the app assembles a packet.

## Docs

- `docs/guide/quincy.md` — the client's starter guide this build follows.
- `docs/SPINE.md` — architecture and conventions for contributors.
- `docs/SUPABASE.md` — backend setup and what is enforced where.
- `docs/BUILD_STATUS.md` — what is running, what is mocked, what is blocked.
