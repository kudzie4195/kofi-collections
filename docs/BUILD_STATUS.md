# BUILD_STATUS — Kofi Collections

Format from the starter guide §06: working / mocked / blocked / known risk / next task. Updated 2026-10-20.

## What is actually running

- Full app in **mock mode** on web, iOS (WebView) and Android (WebView): gallery + filters, artwork and artist pages, artist studio (profile, works with image intake, visibility per record and per price, vault, consent, export, withdraw, inquiry inbox), curator desk (verification request, shortlists, introduction requests), Kofi admin (review queue, curator verification, inquiry forwarding, append-only activity log).
- Field-level visibility enforced in the data layer, with 126 automated tests (domain + screens + hardening against spoofed sessions) and an end-to-end browser run of the guide's 10-minute demo.
- Reviewable CSV import (`/studio/import`): every row is shown with its problems before anything is written; imports land as "Only me" drafts.
- Supabase schema, RLS, redaction views, storage policies and RPCs — executed against a real PostgreSQL 16 with 100 passing assertions (`supabase/tests/LAST_RUN.log`).
- Capacitor projects for iOS and Android generated and synced (`ios/`, `android/`).

## What is still a mock

- **Accounts.** Mock mode has demo identities, not real sign-in. Supabase mode uses real email/password demo users (`docs/SUPABASE.md`) — **verified live on the shared `colorlabpro` project (schema `kofi`) on 2026-10-19**: sign-in, whoami, verified-curator pricing, contact redaction, studio, vault, admin desk and activity log all load with zero console errors.
- **Storage.** Mock mode keeps images and vault files on-device (localStorage, ~5 MB practical limit on WebViews — fine for a demo, not for a real catalog). When the device store is full a save now fails loudly and rolls back instead of looking saved. Supabase mode uploads to private buckets with signed URLs; untested live.
- **Realtime.** The Supabase data source subscribes to `postgres_changes`; untested live.
- **Fonts** are bundled (fontsource: Jost, Instrument Serif), so the app works offline.
- **Images.** 11 of 13 demo works use artwork photography from koficollections.org (`public/art/`, bundled for mock mode; uploaded to the private `artwork-images` bucket per artist for Supabase mode — storage upload, signed-URL read and the anon/draft read policies are now **verified live**). The two sculpture/ceramics works use generated placeholders.

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
| RLS + RPC + schema-isolation suite on PostgreSQL 16 | 117 assertions pass |
| Live project (`colorlabpro`, schema `kofi`): REST as anon → 9 works, prices withheld; Lena via Supabase Auth → $9,800; June → Mara's contact null; ColorLab `public` schema unchanged (51 tables) | verified |
| Independent review (fresh agent, adversarial: spoofed sessions, forged JWT claims, cross-artist access, quota exhaustion) | pass 1 found 4 blockers → all fixed with tests → pass 2 see `docs/REVIEW.md` |
| `npx cap sync` | ios + android copied |
| Cross-product contamination scan | 0 hits |

## Known risks

1. Live-verified: auth, views, RPCs, RLS, artwork-image storage (upload as owner, signed read as anon, drafts hidden). Not yet exercised live: vault file uploads and realtime delivery.
2. iOS project needs `pod install` on a Mac; Android needs Android Studio. Neither was built here (no Xcode / SDK in this environment).
3. Mock-mode `private.view` audit events are written by the client; the Supabase vault path audits server-side. Anything that must be tamper-proof belongs in Supabase mode.
4. Design v2 ("Kofi Noir", 2026-10-20) replaced the v1 cobalt/coral look after client feedback ("squashed", not high-end). Independent review pass: SHIP-WITH-FIXES → fixes applied (see `docs/REVIEW.md`). Dark-only by design.
5. Deleting a work keeps its vault documents (detached) and removes it from shortlists; the UI explains this. Audit rows are never deleted.

## Biggest blocker / decision needed

Guide §03 "decisions before stage 2": who approves artists and verifies curators, whether artists approve every listing Kofi enters, pricing/commission policy, and which entity is the legal data steward. The app has a place for each answer (admin status actions, consent text, price visibility, export) but the policy text in `Consent.tsx` and the verification criteria are placeholders written as real copy — they need a human owner.

## Next user story

"As Kofi staff I create a Supabase project, apply the migrations and seed, and run the same 10-minute demo against it." That is the first live-service step and the one most likely to surface integration bugs.
