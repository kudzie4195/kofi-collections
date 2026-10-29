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

---

# Design v2 — "Kofi Noir" (2026-10-20)

Client feedback on v1 (live at kofi-collections.vercel.app): "everything looks very squashed … doesn't look super professional and high end. edgy sexy colorful artsy", use the koficollections.org colour scheme and its art.

## What changed
- **Palette** lifted from the site: gallery black `#0a0a0a`, warm off-white `#f3eee6`, brush-stroke red `#c8322b` / gold `#e3b23c` / green `#7fa344` (the Ghana-star motif). Dark only. Hairlines instead of 2px boxes; no offset shadows; red/gold/green as strokes, chips, tiles and status — not big fields.
- **Type**: Instrument Serif headlines and titles; Jost (Futura-like, as on the site) for body and tracked-uppercase labels, nav, buttons.
- **Desktop**: the mobile tab bar becomes the site's top nav (wordmark + tracked links) at ≥900 px; content opens to 1280 px; artwork, artist, studio, curator and admin screens are two-column with sticky asides. 375 px stays single column.
- **Real art**: 11 of 13 demo works now use artwork photography from koficollections.org (feather dress, masks, the Clarence James face painting, the Black Cowboys mural, alcohol-ink pieces, crops of the exhibition photograph…). No portraits of real people as artist images. Files live in `public/art/` (re-encoded, metadata stripped) and, for Supabase mode, in the private `artwork-images` bucket per artist — uploaded as each demo artist via `supabase/scripts/upload-art.sh`, which doubles as a storage-policy check. Two sculpture/ceramics works use generated "lit object in a dark gallery" placeholders in brand colours.
- **Hero**: the site's opening-night photograph behind the serif headline, scrimmed for contrast.
- **Single-file demo** inlines the photographs (`virtual:bundled-art`), so `kofi-collections-demo.html` works offline with every image.

## Verified
| Check | Result |
|---|---|
| typecheck / tests / build / cap sync | clean / 130 / clean / ok |
| Smoke: 6 identities × every route × (375, 1024, 375 dark): console errors, overflow, axe serious/critical, labels, h1+route | 195 / 195 |
| 10-minute demo flow | 18 / 18 |
| Live Supabase (shared ColorLab project, schema `kofi`): storage upload as owner, signed read as anon for public works, 404 for drafts and unlinked objects; `artwork_images.src` → `storage:` refs for 11 works | verified |
| Independent design review (fresh reviewer; own Playwright runs at 375/768/1280/1600, contrast measured, sheets/toasts/confirm exercised) | SHIP-WITH-FIXES (≈7.5–8/10 before fixes); 6 majors + 9 minors found → all majors and most minors fixed and gate-verified; 2 minors accepted (hero occupies the 768 fold; filter apply scrolls to top) |
| fable-orchestrator adherence check | PASS |

## Catches this round (what the process found)
AA contrast on coloured tiles (opacity on labels); 375 overflow on the account card with a long name; two curator tabs lit at once (NavLink prefix match); the same mask painting credited to two artists; a lavender v1 empty-image SVG in the work editor; toast layered above dialogs; double h1 on detail pages; artists index with no artwork; placeholder sculptures that read as icons; not-found pages losing their h1 after the h1 fix.

## Commits (push from the Mac: `cd ~/Downloads/kofi-collections && git pull && git push`)
bd318f4 foundation · 86af037 gallery/account · 161d028 studio/curator/admin · 7fe5662 review fixes · 5f4baad artists/placeholders/touch · 32b770a h1 fix · 3498954 single-file images

## Open
- Repo should be made Private on GitHub (artwork photography is the client's).
- Vault file uploads and realtime are still unverified live.
- Policy copy (consent text, verification criteria) still needs a human owner — unchanged from v1.

---

# v3 — the programme (2026-10-20)

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

Live database: 0008 fully applied and seeded 2026-10-20 (user ran the SQL files); v3 pushed as 101848b and verified live.

---

# v4 — partner calls, auction lots, payouts, reports (2026-10-20)

Built against Quincy's five-point checklist (artist profile + 3 works; apply with existing work and reuse it; a partner creates a call, reviews, records selections; a selected work becomes an auction lot with compensation and sale records; Kofi exports participation, placement and payment data). Registration stays out of scope until Kofi decides on its own Supabase project ("not right now").

- **A call is the unit.** Every open call has a **kind** (exhibition, auction, commission, award) and an **organiser** (Kofi or a partner institution). Auction calls carry **published compensation terms** (artist / Kofi / partner shares summing to 100%, buyer's premium ≤30%, resale royalty ≤25%, currency, payment note) shown on the public call page and on the apply screen before the artist sends.
- **Partner desk** (`/curator/calls`): a verified curator of the organiser institution drafts calls (Kofi publishes), reviews applications (works and statements, never contact details), decides, makes **lots** from selected works and **records sales**. No new role: partner = verified curator whose institution organises the call. Pending curators see "Verification pending".
- **Lots and sales**: money is whole cents; a sale freezes the split (artist rounded first, remainder to Kofi) and creates the artist's **payout** (due → paid with method/reference, or void when a sale is voided; a paid payout can't be voided). Artists see their lots, hammer price, share and payout status at `/studio/sales` — never the buyer reference.
- **Kofi desk**: call editor with kind/organiser/terms (locked once a lot sells), `/admin/lots`, `/admin/payouts`, `/admin/reports` (participation, placements, payments by Kofi-day range; CSV downloads with formula-injection-safe cells).
- Supabase migration `0009_sales` (lots, payouts, call kind/organiser/terms, partner RLS, RPCs `record_sale`, `set_lot_status`, `set_payout_status`, `kofi_report`), all in schema `kofi`.

| Check (v4) | Result |
|---|---|
| typecheck / unit + screen tests / build / cap sync | clean / 421 / clean (main chunk 475 kB) / ok |
| Browser smoke: 133 routes × (375, 900, 1280, 375 dark) | 532 / 532 |
| Demo flow / programme flow / partner → lot → sale → payout → report flow / modal focus (v3 sheets, five new sheets) | 18 / 18 · 16 / 16 · 20 / 20 · 17 / 17 · 61 / 61 |
| SQL suite (RLS, RPCs, sales arithmetic incl. half-cent cases, isolation, live apply path run twice) | 357 assertions pass |
| SupabaseDataSource against a real PostgREST, full partner/sale/report flow; server report = `buildReport()` on the same rows | 113 / 113 |
| Independent review (fresh Fable reviewer: recomputed the split in TS and SQL incl. a 1..200000 sweep, partner scope, privacy, report totals by hand) | SHIP-WITH-FIXES, 0 P0/P1, 9 P2 → all fixed and re-gated |
| fable-orchestrator adherence check | PASS (9/9 steps) |

Catches this round: CSV formula injection; parseMoney accepting "-5"/"1e5"; voided payouts double-counted in the payments report; partner call desk overflowing at 900 px; the organiser being told a payout was already paid; v3 device state turning the Night Weather award into an exhibition; sheets with an autofocused field not returning focus on Escape; two weak harness assertions.

Commit 446288c, pushed and live 2026-10-21; 0009 applied live by the user (8 SQL files); public schema fingerprint unchanged; live walkthrough 13/13. Never re-run 0008 after 0009.

Known limits: the sample "Night Weather Benefit Auction" names a real museum as a fictional organiser (tagged Sample — swap before a public demo); the curator nav highlights "Shortlists" while on the partner desk; no payment rails — payouts are records Kofi marks paid; registration/sign-up still needs the own-project decision.

---

# v5 — artist-first home, intake, link import and self-verification (2026-10-22)

Client feedback: two-way app (artists and the public who buy) but the main goal is artists on board — 80/20 on the first page; an intake that builds a profile end to end, pulls from Instagram / website / Facebook / LinkedIn, and lets the artist self-verify before Kofi reviews. Benchmarked against Saatchi Art's artist onboarding and the rel=me link-verification pattern.

- **Home** leads with artists: "Bring your work. Kofi brings the room.", Start your profile, how it works (3 steps), why artists join, open calls, spotlight; then the collectors band (Browse works / Ask Kofi), services, now showing. Desktop nav: cream Start your profile button for visitors; mobile keeps five tabs.
- **Intake** (`/join`): account → links (paste anything, up to six) → import review (per field, with its source; replacements unticked; nothing written without a tick) → about (prefilled) → one work (photo + title + medium) → check and send. Resumable; the draft never holds the password; the profile goes public on Kofi's approval.
- **Import** reads what is public: JSON-LD Person, then OpenGraph, then the handle, with a plain note when a page gives nothing. Login walls and missing pages are read as nothing (the reviewer caught Instagram's login wall turning into "Working name: Login").
- **Self-verification**: each artist gets a code (`kofi-xxxxxx`) for a bio/page; Kofi's checker marks the link Verified (or a link back to the Kofi profile). A client can never set "verified". Reviewer sees Claimed / Verified / Code not found / Unreachable, the import sources, and the code "if they call".
- **Supabase**: `0010_intake` (token, imports, link guard trigger, projections, RPCs), edge function `profile-import` (SSRF guard incl. DNS and redirects, 1 MB, 6 s, JWT, 20 calls/user/10 min). `VITE_KOFI_SIGNUP` defaults **off**: real sign-up on the shared ColorLab project would create rows in ColorLab's `public.profiles` via its own `handle_new_user` trigger. Decision asked (A: Kofi-owned Supabase project, recommended; B: invite-gated on the shared DB; C: on-device demo mode) — pending.

| Check (v5) | Result |
|---|---|
| typecheck / tests / build / cap sync | clean / 513 / clean (main chunk 499.6 kB) / ok |
| Browser smoke: 153 routes × (375, 900, 1280, 375 dark) | 612 / 612 |
| Intake flow end to end at 390 px (sign-up → import → work → verify → send → Kofi approves → public) | 30 / 30 |
| Earlier flows + focus gates (v3, v4, new sheets) | 18 · 16 · 20 · 17 · 61 · 21 |
| Copy gate (burstiness, sentence length, short-sentence share, em-dashes, banned words) on 4 copy files | 4 / 4 |
| SQL suite / PostgREST harness / Deno parser tests | 414 assertions · 140 checks · 20 / 20 |
| Independent review (fresh Fable reviewer walked the intake, probed SQL as anon/curator, fuzzed links, reproduced a login wall) | SHIP-WITH-FIXES: 1 P1 + 8 P2 → all fixed and re-gated |
| fable-orchestrator adherence check | PASS (9/9) |

Catches this round: Instagram login wall → "Login" as a name; links not canonical (three forms of the same Instagram URL); suggestions pre-ticked even when replacing a typed name; photo recorded as "used" while nothing was copied; copy claims the product can't keep ("about a week", "by email"); step 3 blocking on City; live patch touching every artist; hero lede over the bright part of the photo; bundle 0.9 kB over the cap; a v4 test time bomb (sale sheet on the real clock).

Commit 7a9aced (bundle `~/Downloads/kofi-v5.bundle`, fetched into branch `kofi-v5` on the Mac clone). Live database: `~/Downloads/kofi-sql-v5/` 1 → 3, then optionally deploy the `profile-import` function. Push: `git merge --ff-only kofi-v5 && git push origin main`.

Known limits: token verification proves control of a page, not identity (Kofi still approves by hand); Instagram/Facebook og tags reach server fetches intermittently, LinkedIn almost never; partner sign-up not in scope; no PWA manifest; no Join tab on mobile (the hero carries it); profile photos not imported yet.

Decision taken 2026-10-29: the live demo runs on-device (`VITE_DATA_MODE=mock` on Vercel) so sign-up works at no cost; Kofi's own database will be a free Supabase organisation created by the user (no paid plan while in demo).

---

# v6 — classification and filter taxonomy, call criteria, matching (2026-10-29)

Client feedback: "the app is looking great"; an institution wants to run a large call for artists on the platform; a workbook (`Kofi_Collections_Artwork_Filter_Taxonomy_v1.0_2026-10-27.xlsx`) with the tagging and filter system including social-impact tags; and two business asks: how to protect the IP, and formalising equity. Built the workbook; answered the rest in a reply pack.

- **Workbook as source of truth**: checked in under `docs/source/`; `scripts/taxonomy-from-xlsx.py` generates `src/domain/taxonomy.data.ts` (25 categories, 172 tags with stable ids, labels and definitions verbatim, release phase, Social Impact boundary text, 14 acceptance tests). Two app additions (Performance, Video) are flagged for Kofi to keep or drop. The reviewer's own openpyxl diff found 0 field differences.
- **Tagging on upload**: eight chip groups (medium, style, subject, theme, social impact, material, palette, display format), MVP tags only, caps of 6 per group and 4 for Social Impact, the main medium mirrored and locked, definitions per group, keywords as free text. Nothing is suggested or inferred; the boundary sentence is visible at the picker and on the public work page.
- **Structured fields**: Available for (auction / exhibition / licensing / commission; never guessed), Edition, Where the work is (owner and Kofi only), Orientation derived from dimensions.
- **Filters**: tags with live counts, any-of inside a group and all groups combined; active chips with remove and Clear all; URLs carry ids, never labels; cm/inch size conversion.
- **Calls and matching**: a call states what it is looking for in the same tag language; the partner desk ranks works that fit with a plain reason per ask; matching reads only artwork data (tags, uses, location label, dimensions) and never shows a partner a work they could not already open.
- **Supabase**: `0011_taxonomy` (tags tables, artwork columns with a normalising trigger, `open_calls.looking_for`, RPCs `search_artworks` and `match_works`), apply as `0011_part1..7` + `0011_live_patch` (tags the 13 fictional works only). 0010 before 0011; never re-run 0003 or 0009 after 0011.

| Check (v6) | Result |
|---|---|
| typecheck / tests / build / cap sync | clean / 595 / clean (main chunk 435 kB; both data sources lazy) / ok |
| Browser smoke: 159 routes × (375, 900, 1280, 375 dark) | 636 / 636 |
| Taxonomy flow at 390 px (tag → filter → criteria → works that fit → fit lines) | 24 / 24 |
| Earlier flows + focus gates | 30 · 20 · 16 · 18 · 21 · 61 · 17 |
| Copy gate on 7 copy files | 7 / 7 |
| SQL suite (incl. taxonomy relabel, OR/AND, private-price and Only-me probes; live path twice) | 463 assertions pass |
| PostgREST harness (v4 113 + v5 27 + v6 27) | 167 / 167 |
| Independent review (fresh Fable reviewer: own workbook diff, 11 mock probes, SQL probes, keyboard walks, 300-work scale probe, live-patch probe) | FIX THEN SHIP: 5 catches → all fixed and re-verified |
| fable-orchestrator adherence check | PASS (10 steps / 9 required) |

Catches this round: main chunk 566 kB on first integration (demo data source now lazy); partner-desk tabs truncating at 375; the v5→v6 migration dropping a seeded work's second medium tag; keyboard focus lost after removing a filter chip; an intro sentence claiming fewer tags = more searches; the boundary text tooltip-only on phones; the live patch bumping `updated_at` on every demo work.

Commit ccddc00 (bundle `~/Downloads/kofi-v6.bundle`, fetched into branch `kofi-v6` on the Mac clone). Live database: `~/Downloads/kofi-sql-v6/` 1 → 8 (0010 from v5 first if not yet run). Push: `git merge --ff-only kofi-v6 && git push origin main`. Live demo currently runs on-device (`VITE_DATA_MODE=mock`) so sign-up works; a free Supabase organisation for Kofi's own database is the agreed no-cost next step.

Reply pack for Kofi (PDF): what was built; a functional demo for the institution's call (eight prerequisites, three weeks to a dry run); an IP inventory with what copyright, trade secret and trademark each cover, and the cheap steps (private repo, trademark, assignment signed with the equity agreement); seven points to settle for equity, term sheet first.

Known limits: no pagination for 100+ applicant calls (RPC supports it; client does not use it yet); Phase 2/3 tags hidden, not built; CSV import has no tag column; matching ships ahead of the workbook's Phase 3; Location filter on Works means the artist's region.
