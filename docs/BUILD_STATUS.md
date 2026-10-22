# BUILD_STATUS — Kofi Collections

Format from the starter guide §06: working / mocked / blocked / known risk / next task. Updated 2026-10-20.

## v5 — artist-first home, intake, link import and self-verification (2026-10-22)

Client feedback: the app is two-way (artists and the public who buy), but the main goal is getting artists on board — 80/20 on the first page — through an intake that builds a profile end to end, pulls what it can from the artist's Instagram / website / Facebook / LinkedIn, and gives the artist a way to self-verify before Kofi reviews.

- **Home** leads with artists: "Bring your work. Kofi brings the room.", **Start your profile**, how it works in three steps, why artists join, open calls, the artist spotlight; then the collectors band (Browse works / Ask Kofi), services and what's showing. Desktop nav gets a cream Start your profile button for visitors; mobile keeps five tabs.
- **Intake** (`/join`): five short steps, resumable, one column, phone first — account (name, email, password, consent), links (paste anything; up to six), **import review** (what we read at each link, per field, with its source; the artist ticks what to keep; nothing is written without a tick), about you (prefilled), one work (three is better), check and send. Sends the profile for Kofi review and makes it public on approval.
- **Import** reads what is public at a link: JSON-LD Person, then OpenGraph, then the handle, with a plain note when a page gives nothing. Platforms don't let third parties read private data, so this is the honest version of "auto-fill": public page + the artist's confirmation.
- **Self-verification**: each artist gets a code (`kofi-xxxxxx`). Put it in an Instagram/TikTok bio, a website page or a LinkedIn About; Kofi's checker reads the page and marks the link Verified. A link back to the Kofi profile also verifies. Reviewer sees Claimed / Verified / Failed / Unreachable per link, the import sources, and the code "if they call".
- **Supabase**: migration `0010_intake` (token, imports, link guard trigger, projections, RPCs), edge function `profile-import` (server-side reader + checker with SSRF guard, 1 MB cap, 6 s timeout, 20 calls/user/10 min, JWT), and a `VITE_KOFI_SIGNUP` switch that defaults to **off** — real sign-up on the shared ColorLab project would create rows in ColorLab's own `public.profiles` (its `handle_new_user` trigger), so live sign-up waits for Kofi's own project.

| Check (v5) | Result |
|---|---|
| typecheck / unit + screen tests / build / cap sync | clean / 502 / clean (main chunk 499 kB) / ok |
| Browser smoke: 153 routes × (375, 900, 1280, 375 dark) | 612 / 612 |
| Intake flow end to end at 390 px and 1280 px (sign-up → import → work → verify → send → Kofi approves → public) | 28 / 28 |
| Earlier flows (demo, programme, partner/auction) and focus gates (v3, v4, new sheets) | 18 · 16 · 20 · 17 · 61 · 21, all pass |
| Copy gate on every new copy file (burstiness, sentence length, short-sentence share, em-dashes, banned words) | 4 / 4 pass |
| SQL suite (RLS, RPCs, programme, sales, intake, isolation, live path run twice) | 414 assertions pass |
| PostgREST harness (v4 113 + v5 intake 27 incl. the edge-function handler on fixture pages) | 140 / 140 |
| Edge-function parser tests (Deno) | 20 / 20 |
| Independent review (fresh Fable reviewer: walked the intake itself, probed SQL projections as anon/curator, fuzzed link parsing, reproduced an Instagram login wall) | SHIP-WITH-FIXES, 1 P1 + 8 P2 → all fixed and re-gated |

Known limits (v5): token-based verification proves control of the page, not identity (same as rel=me) — Kofi still approves by hand; Instagram/Facebook og tags are served to server fetches intermittently and LinkedIn almost never, so the reader is best on websites; partner (curator) sign-up is not in scope; no PWA manifest yet (the site works as a bookmark); the mobile tab bar has no Join tab — the hero carries it.

## v4 — partner calls, auction lots, payouts, reports (2026-10-20)

Built against the client's five-point checklist (artist profile + works; apply with existing work and reuse it; a partner creates a call, reviews, records selections; a selected work becomes an auction lot with compensation and sale records; Kofi exports participation, placement and payment data). Registration stays out of scope until Kofi decides on its own Supabase project.

- **A call is the unit.** Every open call has a **kind** (exhibition, auction, commission, award) and an **organiser** (Kofi or a partner institution). Auction calls carry **published compensation terms** (artist / Kofi / partner shares summing to 100%, buyer's premium ≤30%, resale royalty ≤25%, currency, payment note) shown on the public call page and on the apply screen before the artist sends.
- **Partner desk** (`/curator/calls`): a verified curator of the organiser institution drafts calls (Kofi publishes), reviews applications (works and statements, never contact details), decides, makes **lots** from selected works and **records sales**. No new role: partner = verified curator whose institution organises the call. Pending curators see "Verification pending".
- **Lots and sales**: money is whole cents; a sale freezes the split (artist rounded first, remainder to Kofi) and creates the artist's **payout** (due → paid with method/reference, or void when a sale is voided; a paid payout can't be voided). Artists see their lots, hammer price, share and payout status at `/studio/sales` — never the buyer reference.
- **Kofi desk**: call editor with kind/organiser/terms (locked once a lot sells), `/admin/lots`, `/admin/payouts`, `/admin/reports` (participation, placements, payments by Kofi-day range, CSV downloads with formula-injection-safe cells).
- Supabase: migration `0009_sales` (lots, payouts, call kind/organiser/terms, RLS for partners, RPCs `record_sale`, `set_lot_status`, `set_payout_status`, `kofi_report`), all in schema `kofi`. Apply order and the 0008-after-0009 hazard are in `supabase/README.md` and `docs/SUPABASE.md` §10.

| Check (v4) | Result |
|---|---|
| typecheck / unit + screen tests / build / cap sync | clean / 421 / clean (main chunk 475 kB) / ok |
| Browser smoke: 133 routes × (375, 900, 1280, 375 dark) | 532 / 532 |
| Demo flow / programme flow / **partner → lot → sale → payout → report flow** / modal focus v3 / **focus on the five new sheets** | 18 / 18 · 16 / 16 · 20 / 20 · 17 / 17 · 61 / 61 |
| SQL suite (RLS, RPCs, sales arithmetic incl. half-cent cases, isolation, live apply path run twice) | 357 assertions pass |
| SupabaseDataSource against a real PostgREST, full partner/sale/report flow, server report = `buildReport()` on the same rows | 113 / 113 |
| Independent review (fresh Fable reviewer: recomputed the split in TS and SQL, partner scope, privacy, report totals by hand) | SHIP-WITH-FIXES (0 P0/P1, 9 P2) → all fixed and re-gated |

Known limits (v4): the sample "Night Weather Benefit Auction" names a real museum as a fictional organiser and is tagged Sample — swap before a public demo; the curator nav highlights "Shortlists" while on the partner desk (one curator area); no payment rails — payouts are records Kofi marks paid.

## v3 — the programme (2026-10-20)

Client feedback: "looks good, just feels empty with 3 tabs". Benchmarked against Ocula, Artsy, Saatchi Art and open-call platforms (CaFÉ, EntryThingy) and against koficollections.org's own sections, then added the "opportunities" half of the brief:

- **Discover** home (now showing, open call, new works, artist spotlight, journal, what's on, services), **Works** (the gallery; old `/?filters` links redirect), **Exhibitions** (current / upcoming / past, typographic posters when there's no image), **Open calls** with **in-app applications from the artist's portfolio**, **Events / What's on**, **Journal**, **About** (Kofi's real services and contact), **Saved** (per device).
- Artwork page: **View in a room** at true scale, **Save**, **Ask Kofi about this work** (collector inquiries routed through Kofi; artist contact never exposed; 5 per email per day).
- Studio: opportunities, apply (Only-me works can't be attached), my applications with decisions and withdraw.
- Kofi desk: programme editors (exhibitions, calls, events, stories, publish/draft), application review with a note to the artist plus a private staff note, collector inquiry inbox.
- Real Kofi programme seeded from koficollections.org (Being/Seen, The Spirit of the West, I Am, The Art of Advocacy, now closed: extended deadline Sep 11, 2026, auction Oct 6, 2026), alongside sample content tagged "Sample".

| Check (v3) | Result |
|---|---|
| typecheck / unit + screen tests / build / cap sync | clean / 273 / clean (main chunk 447 kB, desks lazy-loaded) / ok |
| Browser smoke: 107 routes × (375, 900, 1280, 375 dark): errors, overflow, axe, labels, one h1, ≤5 mobile tabs, one active nav item, nav fits | 428 / 428 |
| v2 demo flow / programme flow / modal focus | 18 / 18 · 16 / 16 · 17 / 17 |
| SQL suite incl. programme RLS, RPCs, isolation, and a rehearsal of the live apply path run twice | 251 assertions pass |
| SupabaseDataSource against a real PostgREST 12.2.3 | 48 / 48 |
| Independent review (fresh Fable reviewer, adversarial) | pass 1 SHIP-WITH-FIXES (3 major, 5 minor) → all fixed → pass 2: every defect verified fixed, design 9/10, 1 new layout regression → fixed and gate-verified |

Open items for Kofi: (1) the artwork photographs come from koficollections.org and are shown on fictional sample artists with a "Sample listing … not by this sample artist" line; get the artists' permission or swap them before any real launch; (2) "painting by Clarence James" is inferred from the site's image file name; (3) the site's History page dates I Am / The Spirit of the West differently from its Exhibitions pages (this build uses the Exhibitions pages); (4) the site still says submissions are open for The Art of Advocacy although its own extended deadline has passed.

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
