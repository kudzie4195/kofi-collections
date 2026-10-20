import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ArtistView, ArtworkImage, Medium } from '@/domain/types';
import { MEDIUMS } from '@/domain/types';
import { useQuery } from '@/state/session';
import { Button, Chip, EmptyState, ErrorState, FictionalFooter, Skeleton, Tag, TopBar } from '@/ui';
import { cap, plural, SearchBox } from './helpers';

function matches(a: ArtistView, q: string): boolean {
  if (!q) return true;
  const hay = [a.workingName, a.pronouns ?? '', a.regionLabel, a.careerStage, a.bio, ...a.mediums].join(' ').toLowerCase();
  return hay.includes(q.trim().toLowerCase());
}

export function ArtistsScreen() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const selected = params.getAll('medium').filter((m): m is Medium => (MEDIUMS as string[]).includes(m));

  const q = useQuery((data, viewer) => data.listArtists(viewer), []);
  // One extra read: how many published works each artist has, and their lead works for the row strip.
  const works = useQuery((data, viewer) => data.listArtworks(viewer), []);
  const { workCount, leadWorks } = useMemo(() => {
    const count = new Map<string, number>();
    const lead = new Map<string, ArtworkImage[]>();
    const sorted = [...(works.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const w of sorted) {
      count.set(w.artistId, (count.get(w.artistId) ?? 0) + 1);
      const img = w.images.find((i) => i.isPrimary) ?? w.images[0];
      const list = lead.get(w.artistId) ?? [];
      if (img && list.length < 3) lead.set(w.artistId, [...list, img]);
    }
    return { workCount: count, leadWorks: lead };
  }, [works.data]);

  const update = (nextQuery: string, nextMediums: Medium[], replace = false) => {
    const sp = new URLSearchParams();
    if (nextQuery) sp.set('q', nextQuery);
    for (const m of nextMediums) sp.append('medium', m);
    setParams(sp, { replace });
  };

  const all = q.data;
  const present = MEDIUMS.filter((m) => (all ?? []).some((a) => a.mediums.includes(m)) || selected.includes(m));
  const results = (all ?? []).filter((a) => matches(a, query) && (selected.length === 0 || selected.some((m) => a.mediums.includes(m))));
  const filtering = query.trim() !== '' || selected.length > 0;

  return (
    <div className="screen">
      <TopBar title="Artists" />
      <main className="container container--wide stack kg-artists">
        <header className="stack--sm kg-artists-head">
          <h2 className="h1">
            The <em className="kg-em">artists</em>
          </h2>
          <p className="lede">Every profile is approved by Kofi and published by the artist, who decides how precisely their location is shown.</p>
        </header>

        <div className="kg-toolbar kg-toolbar--flush">
          <div className="stack--sm kg-toolbar__inner">
            <SearchBox label="Search artists" placeholder="Name, place, medium" value={query} onChange={(v) => update(v, selected, true)} />
            {present.length > 0 && (
              <div className="chips chips--scroll" role="group" aria-label="Medium">
                {present.map((m) => (
                  <Chip
                    key={m}
                    small
                    medium={m}
                    on={selected.includes(m)}
                    onClick={() => update(query, selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m])}
                  >
                    {cap(m)}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        {q.error && !all ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !all ? (
          <div className="stack--sm" aria-busy="true" aria-label="Loading artists">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="row" style={{ padding: '12px 0' }}>
                <Skeleton h={56} w={56} style={{ borderRadius: 999 }} />
                <div className="stack--sm" style={{ flex: 1 }}>
                  <Skeleton h={16} w="60%" />
                  <Skeleton h={12} w="40%" />
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          filtering ? (
            <EmptyState
              title="No artists match"
              body="Try another name or place, or clear the medium filter."
              actions={<Button onClick={() => update('', [])}>Show all artists</Button>}
            />
          ) : (
            <EmptyState title="No artists published yet" body="Kofi is onboarding artists now. Check back soon." />
          )
        ) : (
          <>
            <p className="eyebrow kg-artists-count" aria-live="polite">
              {plural(results.length, 'artist')}
            </p>
            <ul className="list kg-artists-list" aria-label="Artists">
              {results.map((a) => {
                const n = workCount.get(a.id);
                const lead = leadWorks.get(a.id) ?? [];
                return (
                  <li key={a.id}>
                    <Link to={`/artists/${a.id}`} className="list-row kg-artist-row">
                      <span className="list-row__main stack--sm">
                        <span className="kg-artist-row__name">
                          <span className="list-row__title">{a.workingName}</span>
                          {a.pronouns && <span className="small muted">{a.pronouns}</span>}
                        </span>
                        <span className="list-row__sub kg-block">
                          {[a.regionLabel, cap(a.careerStage), n !== undefined ? plural(n, 'work') : undefined].filter(Boolean).join(', ')}
                        </span>
                        <span className="chips">
                          {a.mediums.map((m) => (
                            <Tag key={m} medium={m}>
                              {cap(m)}
                            </Tag>
                          ))}
                        </span>
                      </span>
                      {lead.length > 0 ? (
                        <span className="kg-artist-row__strip" aria-hidden="true">
                          {lead.map((img) => (
                            <span key={img.id} className="kg-artist-row__thumb">
                              <img src={img.src} alt="" loading="lazy" />
                            </span>
                          ))}
                        </span>
                      ) : works.data ? (
                        <span className="eyebrow kg-artist-row__none">No public works yet</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <FictionalFooter />
      </main>
    </div>
  );
}
