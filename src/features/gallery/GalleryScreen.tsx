import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { ArtworkFilters, SortKey } from '@/domain/filters';
import { applyFilters, countActiveFilters, tagFacets, toggleTag } from '@/domain/filters';
import { mediumFromTagId, selectableTags } from '@/domain/taxonomy';
import type { Unit } from '@/domain/types';
import { useQuery } from '@/state/session';
import { Button, Chip, EmptyState, ErrorState, FictionalFooter, GallerySkeleton, Icon, LinkButton, Segmented, TopBar, WallLabel } from '@/ui';
import { PageHead } from '@/features/programme/shared';
import { activeChips } from './activeChips';
import { FilterSheet } from './FilterSheet';
import { FILTER_COPY as C } from './filterCopy';
import { plural, SearchBox } from './helpers';
import { clearedFilters, compact, filtersFromParams, searchFromFilters, SORT_OPTIONS, withMediumTag, withUnit } from './params';

export function GalleryScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Always fetch the full visible set; filtering happens locally through applyFilters
  // so facets, chip counts and the sheet's live count all share one source.
  const q = useQuery((data, viewer) => data.listArtworks(viewer), []);
  const all = useMemo(() => q.data?.map(withMediumTag), [q.data]);

  // navigate (not setSearchParams) so commas stay readable in shared links: ?tags=style.abstract,theme.joy
  const commit = (next: ArtworkFilters, replace = false) => {
    const qs = searchFromFilters(compact(next));
    navigate({ pathname, search: qs ? `?${qs}` : '' }, { replace });
  };

  const results = useMemo(() => (all ? applyFilters(all, filters) : []), [all, filters]);
  const active = countActiveFilters(filters);

  // Removing an active chip unmounts the button under the keyboard. Keep focus in the bar:
  // the next remaining chip, else the Filters button, never <body>.
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement>(null);
  const refocus = useRef<number | null>(null);
  const removeChip = (index: number, next: ArtworkFilters) => {
    refocus.current = index;
    commit(next);
  };
  useEffect(() => {
    if (refocus.current === null) return;
    const i = refocus.current;
    refocus.current = null;
    const remaining = activeRef.current?.querySelectorAll<HTMLButtonElement>('.kg-active__chip') ?? [];
    const target = remaining[Math.min(i, remaining.length - 1)] ?? barRef.current?.querySelector<HTMLButtonElement>('.kg-controls button');
    target?.focus();
  });
  const unit: Unit = filters.sizeUnit ?? 'cm';

  // Medium chip counts reflect every other active filter, so the numbers say what a tap would give.
  const facets = useMemo(() => (all ? tagFacets(all, filters) : {}), [all, filters]);
  const presentTags = useMemo(() => new Set((all ?? []).flatMap((w) => w.tagIds)), [all]);
  const chipMediums = selectableTags('medium').filter((t) => presentTags.has(t.id) || filters.tags?.medium?.includes(t.id));
  const chips = activeChips(filters);
  const artistCount = useMemo(() => new Set((all ?? []).map((w) => w.artistId)).size, [all]);

  return (
    <div className="screen">
      <TopBar title="Works" home subordinate />

      <div className="container container--wide kg-works-head">
        <PageHead
          eyebrow="The collection"
          title="Works"
          lede={
            all && all.length > 0
              ? `${plural(all.length, 'work')} by ${plural(artistCount, 'artist')}, each catalogued by the artist who made it.`
              : 'Every work here is catalogued by the artist who made it.'
          }
        />
      </div>

      <div className="kg-toolbar kg-toolbar--home">
        <div className="container container--wide stack--sm kg-toolbar__inner">
          <SearchBox
            label="Search works"
            placeholder="Search title, artist, material, tag"
            value={filters.query ?? ''}
            onChange={(v) => commit({ ...filters, query: v || undefined }, true)}
          />
          <div className="chips chips--scroll" role="group" aria-label="Medium">
            {chipMediums.map((t) => (
              <Chip
                key={t.id}
                medium={mediumFromTagId(t.id)}
                small
                on={filters.tags?.medium?.includes(t.id) ?? false}
                count={facets[t.id] ?? 0}
                onClick={() => commit(toggleTag(filters, t.id))}
              >
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <main className="container container--wide kg-gallery">
        <div className="kg-bar" ref={barRef}>
          <div className="kg-controls">
            <Button tone={active ? 'primary' : 'secondary'} size="sm" icon={<Icon.Filter />} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
              {active ? `Filters (${active})` : 'Filters'}
            </Button>
            <label className="kg-sort">
              <span className="sr-only">Sort works</span>
              <Icon.Sort aria-hidden="true" />
              <select
                className="select kg-sort__select"
                value={filters.sort ?? 'newest'}
                onChange={(e) => commit({ ...filters, sort: e.target.value as SortKey })}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="kg-unit">
              <Segmented<Unit>
                label="Show sizes in"
                value={unit}
                onChange={(u) => commit(withUnit(filters, u), true)}
                options={[
                  { value: 'cm', label: 'cm' },
                  { value: 'in', label: 'in' },
                ]}
              />
            </div>
          </div>

          <div className="row row--between kg-count">
            <p className="eyebrow" aria-live="polite" data-testid="result-count">
              {q.loading && !all ? 'Loading works' : plural(results.length, 'work')}
            </p>
          </div>
        </div>

        {chips.length > 0 && (
          <section className="kg-active" aria-label={C.activeLabel} data-testid="active-filters" ref={activeRef}>
            <ul className="kg-active__list">
              {chips.map((c, i) => (
                <li key={c.key}>
                  <button type="button" className="chip chip--small kg-active__chip" data-category={c.category} aria-label={c.name} title={c.name} onClick={() => removeChip(i, c.without)}>
                    <span>{c.label}</span>
                    <Icon.Close aria-hidden="true" className="kg-active__x" />
                  </button>
                </li>
              ))}
            </ul>
            <Button tone="ghost" size="sm" className="kg-active__clear" onClick={() => removeChip(0, clearedFilters(filters))}>
              {C.clearAll}
            </Button>
          </section>
        )}

        {q.error && !all ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !all ? (
          <GallerySkeleton />
        ) : results.length === 0 ? (
          all.length === 0 ? (
            <EmptyState
              title="Nothing published yet"
              body="Artists are still cataloguing their work. Meet the artists already on Kofi while you wait."
              actions={
                <LinkButton to="/artists" tone="secondary">
                  Browse artists
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              title="No works match those filters"
              body="Try a wider size range, fewer mediums, or a shorter search."
              actions={
                <>
                  <Button onClick={() => commit(clearedFilters(filters))}>Clear filters</Button>
                  <Button tone="secondary" onClick={() => setSheetOpen(true)}>
                    Adjust filters
                  </Button>
                </>
              }
            />
          )
        ) : (
          <ul className="gallery-grid" aria-label="Works">
            {results.map((w) => (
              <li key={w.id}>
                <WallLabel work={w} to={`/work/${w.id}`} unit={unit} />
              </li>
            ))}
          </ul>
        )}

        <FictionalFooter />
      </main>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} filters={filters} works={all ?? []} onApply={(f) => commit(f)} />
    </div>
  );
}
