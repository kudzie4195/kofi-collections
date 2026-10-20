import { Link } from 'react-router-dom';
import type { InquiryStatus } from '@/domain/types';
import { useQuery } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, Notice, Skeleton, StatusDot, TopBar } from '@/ui';
import { formatDate, INQUIRY_STATUS_COPY } from './shared';
import './curator.css';

const STEPS: Record<InquiryStatus, number> = { pending: 1, forwarded: 2, accepted: 3, declined: 3 };

export function CuratorInquiries() {
  const q = useQuery(async (ds, v) => {
    const curator = await ds.getMyCurator(v);
    return { curator, rows: curator ? await ds.listInquiries(v) : [] };
  });

  return (
    <div className="screen">
      <TopBar title="Introduction requests" />
      <main className="container container--wide cu-main">
        <div className="cu-split">
        <aside className="cu-split__aside stack">
          <p className="eyebrow eyebrow--gold">Requests</p>
          <h2 className="h1">Introductions you’ve asked for</h2>
          <span className="rule rule--gold" aria-hidden="true" />
          <Notice tone="cobalt" icon={<Icon.Lock />}>
            Kofi reviews each request, then forwards it to the artist’s studio. The artist’s contact details are shared only after they accept.
          </Notice>
        </aside>
        <div className="cu-split__main">

        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading requests">
            <Skeleton h={96} />
            <Skeleton h={96} />
          </div>
        ) : q.data.rows.length === 0 ? (
          <EmptyState
            title="No requests yet"
            body={
              q.data.curator?.status === 'verified'
                ? 'Open a shortlist and choose “Request introduction” on any work you want to talk to the artist about.'
                : 'Introductions open once Kofi verifies your institution. Your requests will be tracked here.'
            }
            actions={
              q.data.curator?.status === 'verified' ? (
                <LinkButton to="/curator">Open your shortlists</LinkButton>
              ) : (
                <LinkButton to="/curator/verify">Verify your institution</LinkButton>
              )
            }
          />
        ) : (
          <ul className="cu-inqs" aria-label="Your introduction requests">
            {q.data.rows.map((r) => {
              const step = STEPS[r.status];
              return (
                <li key={r.id} className="inq">
                  <div className="inq__head">
                    <div style={{ minWidth: 0 }}>
                      <div className="inq__artist">{r.artistWorkingName}</div>
                      {r.artworkTitle && r.artworkId ? (
                        <Link to={`/work/${r.artworkId}`} className="small">
                          {r.artworkTitle}
                        </Link>
                      ) : (
                        <span className="small muted">About the artist’s practice</span>
                      )}
                    </div>
                    <time className="tiny muted" dateTime={r.createdAt} style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(r.createdAt)}
                    </time>
                  </div>
                  <p className="inq__msg clamp-3">“{r.message}”</p>
                  <div className={`inq-track inq-track--${r.status}`} aria-hidden="true">
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={`inq-track__step ${n <= step ? 'inq-track__step--on' : ''}`} />
                    ))}
                  </div>
                  <p className="inq__status">
                    <StatusDot status={r.status} />
                    <span>{INQUIRY_STATUS_COPY[r.status]}</span>
                    {r.decidedAt && r.status !== 'pending' && <span className="muted tiny">{formatDate(r.decidedAt)}</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        </div>
        </div>
      </main>
    </div>
  );
}
