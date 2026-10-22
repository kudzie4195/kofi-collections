import { Link, useSearchParams } from 'react-router-dom';
import type { ArtistStatus } from '@/domain/types';
import type { AdminArtistRow } from '@/data/DataSource';
import { useQuery } from '@/state/session';
import { Avatar, Chip, EmptyState, ErrorState, Icon, Panel, Segmented, Skeleton, StatusDot, TopBar } from '@/ui';
import { platformName } from '@/domain/intake';
import { deskIntakeCopy, linksSummary } from './intakeCopy';
import { linkParts } from './links';
import './admin.css';

type Filter = 'all' | ArtistStatus;

export const ARTIST_STATUS_ORDER: ArtistStatus[] = ['pending', 'draft', 'approved', 'paused'];
export const ARTIST_STATUS_LABEL: Record<ArtistStatus, string> = {
  pending: 'Waiting for review',
  draft: 'Draft',
  approved: 'Approved',
  paused: 'Paused',
};

export const ARTIST_STATUS_SHORT: Record<ArtistStatus, string> = {
  pending: 'Pending',
  draft: 'Draft',
  approved: 'Approved',
  paused: 'Paused',
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'draft', label: 'Draft' },
  { value: 'paused', label: 'Paused' },
];

function isFilter(s: string | null): s is Filter {
  return !!s && FILTERS.some((f) => f.value === s);
}

export function AdminArtists() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter = isFilter(raw) ? raw : 'all';
  const reviewOnly = params.get('review') === 'works';

  const q = useQuery(async (ds, v) => {
    const [artists, works] = await Promise.all([ds.listAllArtists(v), ds.listArtworks(v)]);
    const unreviewed = new Map<string, number>();
    for (const w of works) if (!w.reviewedAt) unreviewed.set(w.artistId, (unreviewed.get(w.artistId) ?? 0) + 1);
    return { artists, unreviewed };
  });

  const update = (next: { status?: Filter; review?: boolean }) => {
    const p = new URLSearchParams(params);
    const s = next.status ?? filter;
    if (s === 'all') p.delete('status');
    else p.set('status', s);
    const r = next.review ?? reviewOnly;
    if (r) p.set('review', 'works');
    else p.delete('review');
    setParams(p, { replace: true });
  };

  const rows = (q.data?.artists ?? []).filter(
    (a) => (filter === 'all' || a.status === filter) && (!reviewOnly || (q.data?.unreviewed.get(a.id) ?? 0) > 0),
  );
  const groups = ARTIST_STATUS_ORDER.map((s) => ({ status: s, rows: rows.filter((r) => r.status === s) })).filter((g) => g.rows.length > 0);

  return (
    <div className="screen">
      <TopBar title="Artists" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
        <aside className="ad-split__aside stack">
          <p className="eyebrow eyebrow--gold">Kofi desk</p>
          <h2 className="h1">Artists</h2>
          <span className="rule" aria-hidden="true" />
          <div className="seg-wrap">
            <Segmented<Filter> label="Filter artists by status" value={filter} onChange={(v) => update({ status: v })} options={FILTERS} />
          </div>
          <div className="chips">
            <Chip on={reviewOnly} onClick={() => update({ review: !reviewOnly })}>
              Has works Kofi hasn’t reviewed
            </Chip>
          </div>
        </aside>
        <div className="ad-split__main stack--lg">

        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading artists">
            <Skeleton h={64} />
            <Skeleton h={64} />
            <Skeleton h={64} />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            title={reviewOnly ? 'Every listing has been reviewed' : `No ${filter === 'all' ? '' : `${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} `}artists`}
            body={reviewOnly ? 'Nothing in the gallery is waiting on a Kofi review.' : 'Try another status.'}
          />
        ) : (
          groups.map((g) => (
            <section key={g.status} className="stack--sm" aria-labelledby={`grp-${g.status}`}>
              <h2 className="group-title" id={`grp-${g.status}`}>
                <StatusDot status={g.status} />
                {ARTIST_STATUS_LABEL[g.status]}
                <span className="group-title__count">{g.rows.length}</span>
              </h2>
              <Panel className="ad-flat">
                <ul className="list">
                  {g.rows.map((a) => (
                    <ArtistRow key={a.id} a={a} unreviewed={q.data!.unreviewed.get(a.id) ?? 0} />
                  ))}
                </ul>
              </Panel>
            </section>
          ))
        )}
        </div>
        </div>
      </main>
    </div>
  );
}

function ArtistRow({ a, unreviewed }: { a: AdminArtistRow; unreviewed: number }) {
  const sources = [...new Set((a.imports ?? []).filter((r) => r.appliedFields.length > 0).map((r) => platformName(linkParts(r.source).platform)))];
  return (
    <li>
      <Link to={`/admin/artists/${a.id}`} className="list-row">
        <Avatar name={a.workingName} color={a.avatarColor} />
        <span className="list-row__main">
          <span className="list-row__title" style={{ display: 'block' }}>
            {a.workingName}
          </span>
          <span className="list-row__sub" style={{ display: 'block' }}>
            {a.mediums.join(', ')}
          </span>
          <span className="list-row__sub" style={{ display: 'block' }}>
            {a.artworkCount === 1 ? '1 work' : `${a.artworkCount} works`}
            {unreviewed > 0 && <strong style={{ color: 'var(--text-2)' }}>, {unreviewed} not reviewed</strong>}
          </span>
          <span className="list-row__sub ad-intake-sub" data-testid="links-summary">
            {linksSummary(a.links.length, a.links.filter((l) => l.verification === 'verified').length)}
          </span>
          {sources.length > 0 && (
            <span className="ad-intake-chips">
              {sources.map((p) => (
                <span key={p} className="ad-intake-chip">
                  {deskIntakeCopy.importedFrom} {p}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="status-pill">
          <StatusDot status={a.status} />
          {ARTIST_STATUS_SHORT[a.status]}
        </span>
        <Icon.Back className="row-chev" />
      </Link>
    </li>
  );
}
