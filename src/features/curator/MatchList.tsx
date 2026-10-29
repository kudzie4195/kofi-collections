/**
 * "Works that fit" for one call: data.listMatchingWorks ranked by domain/matching
 * (fits first, then most asks met, then newest). Used by the partner call desk
 * (?tab=fit) and under the admin call editor. The data layer only returns works
 * the viewer could already open; this list adds nothing to that.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@/state/session';
import { EmptyState, ErrorState, Notice, Skeleton, Toggle, Icon } from '@/ui';
import { FitPill, FitReasons } from '@/features/programme/LookingFor';
import { matchCopy } from '@/features/programme/matchCopy';
import '@/features/programme/match.css';

export function MatchList({ callId, headingId = 'ml-title', version }: { callId: string; headingId?: string; /** Change to re-fetch (e.g. after the criteria are saved). */ version?: unknown }) {
  const c = matchCopy.list;
  const q = useQuery((ds, v) => ds.listMatchingWorks(v, callId), [callId, version]);
  const [fitsOnly, setFitsOnly] = useState(true);
  const rows = q.data ?? [];
  const asksNothing = rows.length > 0 && rows[0]!.match.of === 0;
  const shown = fitsOnly ? rows.filter((r) => r.match.fits) : rows;

  return (
    <div className="ml stack" data-testid="match-list">
      <div className="ml-head">
        <div>
          <p className="eyebrow eyebrow--gold">{c.eyebrow}</p>
          <h2 className="section-title" id={headingId}>
            {c.title}
          </h2>
        </div>
        {q.data && rows.length > 0 && (
          <div className="ml-tools">
            <Toggle checked={fitsOnly} onChange={setFitsOnly} label={c.fitsOnly} />
            <span className="tiny muted ml-count" aria-live="polite">
              {c.count(shown.length, rows.length)}
            </span>
          </div>
        )}
      </div>
      <p className="small muted ml-lede">{c.lede}</p>

      {q.error && !q.data ? (
        <ErrorState error={q.error} retry={q.reload} />
      ) : !q.data ? (
        <div className="stack" aria-busy="true" aria-label="Loading works that fit">
          <Skeleton h={96} />
          <Skeleton h={96} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={c.emptyTitle} body={c.emptyAll} />
      ) : (
        <>
          {asksNothing && (
            <Notice tone="plain" icon={<Icon.Info />}>
              <p className="small">{c.noCriteria}</p>
            </Notice>
          )}
          {shown.length === 0 ? (
            <EmptyState title={c.emptyTitle} body={c.emptyBody} />
          ) : (
            <ol className="ml-list" aria-label={c.title}>
              {shown.map(({ work, match }) => {
                const img = work.images.find((i) => i.isPrimary) ?? work.images[0];
                return (
                  <li key={work.id} className="ml-row" data-fits={match.fits || undefined} data-medium={work.medium}>
                    <Link to={`/work/${work.id}`} className="ml-row__thumb" tabIndex={-1} aria-hidden="true">
                      {img ? <img src={img.src} alt="" loading="lazy" /> : <span className="pg-row__thumb--empty" />}
                    </Link>
                    <div className="ml-row__body">
                      <div className="ml-row__top">
                        <Link to={`/work/${work.id}`} className="ml-row__title">
                          {work.title}
                        </Link>
                        <FitPill match={match} />
                      </div>
                      <p className="ml-row__meta">
                        {c.by(work.artistWorkingName)} · {work.year}
                      </p>
                      {match.reasons.length > 0 && <FitReasons reasons={match.reasons} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
