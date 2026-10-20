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

## Design v2 review (2026-10-20, fresh reviewer, screenshots + own Playwright runs at 375/768/1280/1600)

Verdict: SHIP-WITH-FIXES. All majors fixed in the same session:
lavender empty-image SVG → brand (WorkEditor); tile hint contrast (opacity removed); duplicate mask painting across two artists → distinct crops of the exhibition photograph; toast layered above sheets → now below; artists index without artwork → lead-work strips; sculpture/ceramics placeholders → object-in-gallery renders; double h1 on detail pages → topbar title subordinate; hero eyebrow contrast → scrim; monospace audit times → tracked sans; "Quincy (Kofi) (Kofi staff)" → de-duplicated; 375 tap targets and shortlist rows.
Left as-is: 768 home shows no artwork above the fold (hero is the point of the opener); filter apply scrolls to top (hash-router ScrollRestoration; results are one scroll below).
