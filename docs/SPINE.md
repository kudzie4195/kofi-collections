# Kofi Collections — spine reference for feature workers

Read this fully before writing code. The spine (domain, data layer, UI kit, shell, styles) is **owned by the orchestrator** and is not yours to edit. If you need something added to it, implement a local helper inside your own feature folder and list the gap in your report.

## What this app is

Kofi Collections: artists document their practice and control who sees what; verified curators discover work and request introductions through Kofi; Kofi staff onboard artists, verify institutions and keep an audit trail. iOS + Android via Capacitor, same React code on web. All demo content is fictional. Product rules come from `docs/guide/quincy.md` (the client's starter guide) — read §02, §04 and §07 at least.

**Visibility is field-specific.** Never filter private fields in the UI — the data source already redacts. Your job is to *render what the projection gives you* and to let owners edit visibility. `ArtworkView.price` is absent when the viewer may not see it; `priceWithheld` tells you to render "Price on request".

## Stack & conventions

- Vite + React 18 + TypeScript (strict, `noUncheckedIndexedAccess`), react-router v6 (**hash router**), no CSS framework — plain CSS classes from `src/styles/global.css`.
- Path alias `@/` → `src/`.
- `npm run typecheck`, `npm test` (vitest + jsdom + testing-library), `npm run build` must stay green. Run them before you report.
- Mobile-first. Phone width (375px) is the primary target; it must also look right at 1024px. No horizontal overflow.
- Copy: sentence case, plain verbs, no "Submit". Buttons name the action ("Save changes", "Publish", "Request introduction"). Errors say what happened and what to do. Empty states invite an action.
- No new dependencies.
- Always `import type` for types.
- Every screen: `<div className="screen"><TopBar …/><main className="container …">…</main></div>`. End long public screens with `<FictionalFooter />`.

## Session & data access

```ts
import { useSession, useViewer, useData, useQuery } from '@/state/session';
import { useToast, errorMessage } from '@/state/toast';

const { viewer, data, version } = useSession();   // data: DataSource; version bumps on every change
const q = useQuery((data, viewer) => data.listArtworks(viewer, filters), [filters]);
// q.data, q.loading, q.error, q.reload. Re-runs on viewer change, data change, deps change.
```

Write operations: call `data.xxx(viewer, …)` inside an event handler, wrap in try/catch, `toast.push(errorMessage(e), 'error')`. The data source throws `ForbiddenError`, `NotFoundError`, `ValidationError` (has `.field`) — map `ValidationError.field` to the matching form field's `error` prop.

Full API: `src/data/DataSource.ts`. Types: `src/domain/types.ts`. Pure helpers: `src/domain/filters.ts` (`applyFilters`, `countActiveFilters`, `materialFacets`, `EMPTY_FILTERS`, `SortKey`), `src/domain/units.ts` (`formatDimensions`, `formatPrice`, `convertDimensions`, `longestEdge`), `src/domain/visibility.ts`.

Native helpers: `src/native/platform.ts` (`saveTextFile`, `tap`, `notify`, `isNative`), `src/native/images.ts` (`prepareImage(file)` → data URL with metadata stripped; throws `ImageIntakeError`; `readFileAsDataUrl`).

## UI kit (`import { … } from '@/ui'`)

`Button` (tone: primary|secondary|coral|lime|butter|ghost|danger; size md|sm; block; icon; loading), `LinkButton`, `Chip` (on, medium, count, small), `Tag`, `VisibilityBadge`, `VisibilityPicker`, `Field`, `Input`, `Textarea`, `Select`, `Toggle`, `Segmented`, `TopBar` (title, back, right), `Panel` (title, pinned, accent, tint, action), `Notice` (tone butter|cobalt|lime|coral|plain), `EmptyState`, `ErrorState`, `Skeleton`, `GallerySkeleton`, `Avatar`, `StatusDot`, `Sheet` (bottom drawer; open, onClose, title, footer), `Confirm`, `WallLabel` (artwork card; `to`, `unit`, `corner`), `Toasts`, `FictionalFooter`, `Icon.*` (Back, Close, Search, Filter, Plus, Gallery, Artists, Studio, Shortlist, Inbox, Admin, Person, Eye, EyeOff, Lock, Building, Globe, Check, Trash, Download, Doc, Mail, Info, Warn, Edit, Sort, Ruler, Sparkle).

Useful CSS classes (see `global.css`): `.display .h1 .h2 .h3 .lede .muted .small .tiny .strong .prose`, `.stack .stack--sm .stack--lg .row .row--between .row--wrap .grid-2 .section`, `.gallery-grid`, `.chips .chips--scroll`, `.list .list-row .list-row__main .list-row__title .list-row__sub .thumb .thumb--lg`, `.spec` (dl), `.kicker`, `.hero-img`, `.sticky-actions`, `.tiles .tile .tile--cobalt|coral|lime|butter .tile__num .tile__label`, `.band .band__stripe--1/2/3 .band__inner` (hero band with rotated stripes), `.marquee .marquee__track`, `.image-strip`, `.dropzone`, `.upload-grid*`, `.range-row`, `.filter-section .filter-section__title`, `.audit-row`, `.input-group`, `.divider`, `.notice`, `data-medium="painting"` on any element gives it `--m` / `--m-ink` accent vars.

Design language: bright and eccentric. Hard two-tone offset shadows (never soft grey). Syne display type for headings, Instrument Sans body. Medium → accent color via `data-medium`. One memorable moment per screen; everything else quiet. No ALL-CAPS labels, no "→" on buttons, no middle-dot meta strings except inside `.label-card__meta`. Motion only in response to the user's action.

## Routes (hash router)

Public (worker W1, `src/features/gallery/routes.tsx` exports `galleryRoutes: RouteObject[]` with absolute paths):
- `/` Gallery · `/work/:id` Artwork detail · `/artists` Artists · `/artists/:id` Artist profile

Artist studio (W2, `src/features/studio/routes.tsx` exports `studioRoutes` as **relative** children of `/studio`): `index`, `profile`, `work/new`, `work/:id`, `vault`, `export`, `inquiries`, `consent`.

Curator (W3, `src/features/curator/routes.tsx` → `curatorRoutes`, children of `/curator`): `index` (shortlists), `shortlists/:id`, `verify`, `inquiries`.

Admin (W3, `src/features/admin/routes.tsx` → `adminRoutes`, children of `/admin`): `index`, `artists`, `artists/:id`, `curators`, `inquiries`, `activity`.

`/account` (identity switcher) is in the spine. Role gates are in the spine: unauthorized viewers are redirected to `/account`.

Tab bar per role is in the spine: public → Gallery, Artists, Sign in · artist → + Studio · curator → + Shortlists, Requests · admin → + Kofi.

## Demo identities (mock mode)

Visitor · Mara Oyelaran (artist, approved, has institution-only priced work `aw_mara_1`, a kofi-only draft `aw_mara_3`, two vault documents) · June Takahashi-Bell (artist, approved, private draft `aw_june_3`) · Priya Venkataraman (artist, **pending** review) · Lena Marchetti (curator, **verified**, has a shortlist and two inquiries) · Owen Blackwood (curator, **pending** verification) · Quincy (Kofi admin). See `src/data/mock/seed.ts`.

## The 10-minute demonstration (must work end to end)

1. Gallery → filter "painting" + size under 40 in → one result (Small Weather No. 4).
2. Open a work → materials, dimensions (unit toggle), status, artist bio link.
3. Sign in as Mara → studio → edit "Doubling" → set price visibility to "Only me" → save.
4. Sign in as Lena → open "Doubling" → "Price on request".
5. Lena → add to a shortlist → request an introduction → Quincy forwards → Mara accepts in her studio inbox.
