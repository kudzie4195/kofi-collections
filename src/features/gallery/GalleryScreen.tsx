import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ArtworkFilters, SortKey } from '@/domain/filters';
import { applyFilters, countActiveFilters } from '@/domain/filters';
import type { Medium, Unit } from '@/domain/types';
import { MEDIUMS } from '@/domain/types';
import { useQuery } from '@/state/session';
import { Button, Chip, EmptyState, ErrorState, FictionalFooter, GallerySkeleton, Icon, LinkButton, Segmented, TopBar, WallLabel } from '@/ui';
import { PageHead } from '@/features/programme/shared';
import { FilterSheet } from './FilterSheet';
import { cap, plural, SearchBox } from './helpers';
import { clearedFilters, compact, filtersFromParams, paramsFromFilters, SORT_OPTIONS, toggleIn, withUnit } from './params';

export function GalleryScreen() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Always fetch the full visible set; filtering happens locally through applyFilters
  // so facets, chip counts and the sheet's live count all share one source.
  const q = useQuery((data, viewer) => data.listArtworks(viewer), []);
  const all = q.data;

  const commit = (next: ArtworkFilters, replace = false) => setParams(paramsFromFilters(compact(next)), { replace });

  const results = useMemo(() => (all ? applyFilters(all, filters) : []), [all, filters]);
  const active = countActiveFilters(filters);
  const unit: Unit = filters.sizeUnit ?? 'cm';

  // Medium chip counts reflect every other active filter, so the numbers say what a tap would give.
  const mediumCounts = useMemo(() => {
    const m = new Map<Medium, number>();
    if (!all) return m;
    for (const w of applyFilters(all, { ...filters, mediums: undefined })) m.set(w.medium, (m.get(w.medium) ?? 0) + 1);
    return m;
  }, [all, filters]);
  const presentMediums = useMemo(() => new Set((all ?? []).map((w) => w.medium)), [all]);
  const chipMediums = MEDIUMS.filter((m) => presentMediums.has(m) || filters.mediums?.includes(m));
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
            {chipMediums.map((m) => (
              <Chip
                key={m}
                medium={m}
                small
                on={filters.mediums?.includes(m) ?? false}
                count={mediumCounts.get(m) ?? 0}
                onClick={() => commit({ ...filters, mediums: toggleIn(filters.mediums, m) })}
              >
                {cap(m)}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <main className="container container--wide kg-gallery">
        <div className="kg-bar">
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
            {active > 0 && (
              <Button tone="ghost" size="sm" onClick={() => commit(clearedFilters(filters))}>
                Clear filters
              </Button>
            )}
          </div>
        </div>

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
