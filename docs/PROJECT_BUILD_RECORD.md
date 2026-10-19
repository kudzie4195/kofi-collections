# Kofi Collections — build record (2026-10-19)

Source: Quincy_Starter_Guide.docx v1.0. Repo delivered as kofi-collections.zip; live demo published as the "Kofi Collections" artifact.


## What is actually running

- Full app in **mock mode** on web, iOS (WebView) and Android (WebView): gallery + filters, artwork and artist pages, artist studio (profile, works with image intake, visibility per record and per price, vault, consent, export, withdraw, inquiry inbox), curator desk (verification request, shortlists, introduction requests), Kofi admin (review queue, curator verification, inquiry forwarding, append-only activity log).
- Field-level visibility enforced in the data layer, with 126 automated tests (domain + screens + hardening against spoofed sessions) and an end-to-end browser run of the guide's 10-minute demo.
- Reviewable CSV import (`/studio/import`): every row is shown with its problems before anything is written; imports land as "Only me" drafts.
- Supabase schema, RLS, redaction views, storage policies and RPCs — executed against a real PostgreSQL 16 with 100 passing assertions (`supabase/tests/LAST_RUN.log`).
- Capacitor projects for iOS and Android generated and synced (`ios/`, `android/`).

## What is still a mock

- **Accounts.** Mock mode has demo identities, not real sign-in. Supabase mode has email/password demo users (`docs/SUPABASE.md`) but has **not been run against a live Supabase project**.
- **Storage.** Mock mode keeps images and vault files on-device (localStorage, ~5 MB practical limit on WebViews — fine for a demo, not for a real catalog). When the device store is full a save now fails loudly and rolls back instead of looking saved. Supabase mode uploads to private buckets with signed URLs; untested live.
- **Realtime.** The Supabase data source subscribes to `postgres_changes`; untested live.
- **Fonts** are bundled (fontsource), so the app works offline.

## Local demo path

```
npm ci && npm run dev   →  http://localhost:5173
```
Account tab → pick an identity. Or open `dist-single/index.html` (one self-contained file) in any browser.

## What was tested, with results

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 126 / 126 |
| `npm run build` | clean, 447 kB JS gz 136 kB |
| Browser smoke: 6 identities × every route × (375 px light, 1024 px light, 375 px dark), each screen must render for its role | 195 / 195 — no console errors, no horizontal overflow, axe serious/critical 0, every input labelled |
| 10-minute demo flow (filter → open → artist hides price → curator sees "Price on request" → shortlist → intro request → Kofi forwards → artist accepts → export → curator verified by record, not client flag) | 18 / 18 |
| RLS + RPC suite on PostgreSQL 16 | 100 assertions pass |
| Independent review (fresh agent, adversarial: spoofed sessions, forged JWT claims, cross-artist access, quota exhaustion) | pass 1 found 4 blockers → all fixed with tests → pass 2 see `docs/REVIEW.md` |
| `npx cap sync` | ios + android copied |
| Cross-product contamination scan | 0 hits |

## Known risks

1. Supabase code paths are verified against local Postgres with a shim for `auth`/`storage`, not against Supabase itself. Expect small fixes on first live run (sign-in of seeded `auth.users`, storage policy behaviour for signed URLs, realtime filtering).
2. iOS project needs `pod install` on a Mac; Android needs Android Studio. Neither was built here (no Xcode / SDK in this environment).
3. Mock-mode `private.view` audit events are written by the client; the Supabase vault path audits server-side. Anything that must be tamper-proof belongs in Supabase mode.
4. Google-free fonts, but the display face (Syne) is wide — very long artist names wrap to three lines on 375 px. Acceptable, not pretty.
5. Deleting a work keeps its vault documents (detached) and removes it from shortlists; the UI explains this. Audit rows are never deleted.

## Biggest blocker / decision needed

Guide §03 "decisions before stage 2": who approves artists and verifies curators, whether artists approve every listing Kofi enters, pricing/commission policy, and which entity is the legal data steward. The app has a place for each answer (admin status actions, consent text, price visibility, export) but the policy text in `Consent.tsx` and the verification criteria are placeholders written as real copy — they need a human owner.

## Next user story

"As Kofi staff I create a Supabase project, apply the migrations and seed, and run the same 10-minute demo against it." That is the first live-service step and the one most likely to surface integration bugs.

---

# Independent review record

Two passes by a fresh reviewer agent that received only the acceptance criteria, the repository and the raw gate logs — never the authors' reasoning. Reviewer wrote and ran its own adversarial tests (spoofed sessions, forged JWT claims, cross-artist access, storage-quota exhaustion, direct SQL against the Supabase views as anon).

## Pass 1 (HEAD 0c152cc) — NO-SHIP, 4 blockers
1. 28 light-mode + 10 dark-mode axe serious contrast failures (kofi/private badges, hints, danger buttons, one avatar color).
2. P1: mock data layer swallowed `QuotaExceededError` → saves toasted "Saved" and vanished on reload.
3. The orchestrator's smoke harness never signed in (hash navigation doesn't reload), so role screens were never exercised — a false "126/126".
4. Working tree had drifted from the reviewed commit.

Also: three mock-only privilege holes (curator claim matched by id only; profile patch not whitelisted; `artistId`/`reviewedAt` copied from input), admin view of pending artists not audited, budget filter ignoring currency, `maximum-scale=1` blocking zoom, no CSV import path (guide §02), design 8/10.

## Fixes
`MockDataSource.commit()` rolls back to the last durable snapshot and throws `StorageFullError`; curator claims require id + userId; `ARTIST_PATCH_KEYS` whitelist; `artistId`/`reviewedAt` stripped; admin artist views audited; `budgetCurrency` filter + UI; contrast tokens for light and dark; viewport zoom restored; `/studio/import` reviewable CSV import; harness reloads after sign-in, asserts route + `h1`, runs a dark pass. Tests added: `src/domain/hardening.test.ts`, `src/domain/importCsv.test.ts`.

## Pass 2 (HEAD c3507b3) — all blockers verified fixed by the reviewer's own runs
- Contrast light 144/144 + dark 144/144, including error states; smoke harness integrity confirmed; quota: 12 × 600 KB saves under a 5 MB cap → 8 succeed and survive reload, 4 fail loudly and roll back, later saves still persist; A2/A6/A8/A9 closed; budget currency correct; zoom unblocked; import refuses to write before confirm and lands private drafts.
- One new P1: the import screen's dropzone rendered inline (overlapping the template button). **Fixed after pass 2** (`.dropzone { display:block }`), re-verified by the full gate suite (smoke 195/195, flow 18/18) — not by a third reviewer pass.
- Design re-scored 8.5/10; the one change named to reach 9 — desktop navigation at ≥900 px — was implemented after pass 2 as a left rail (gate-verified, not reviewer-verified).

## Not verified anywhere
- Supabase code against a live Supabase project (auth sign-in of seeded users, Storage signed-URL policy behaviour, Realtime filtering).
- Native builds (no Xcode / Android SDK here).
- Image intake on a real device (HEIC decode varies by WebView).
