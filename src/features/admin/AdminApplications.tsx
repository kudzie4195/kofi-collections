import { Link, useSearchParams } from 'react-router-dom';
import type { ApplicationStatus, OpenCall } from '@/domain/types';
import { APPLICATION_STATUSES } from '@/domain/types';
import { useQuery } from '@/state/session';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, deadlineLabel, formatInstantDay } from '@/features/programme/format';
import { Button, Chip, EmptyState, ErrorState, Icon, Select, Skeleton, StatusDot, TopBar } from '@/ui';
import './admin.css';
import './programme.css';

type Filter = 'review' | 'all' | ApplicationStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'review', label: 'To review' },
  { value: 'all', label: 'All' },
  ...APPLICATION_STATUSES.map((s) => ({ value: s as Filter, label: APPLICATION_STATUS_LABEL[s] })),
];
function isFilter(s: string | null): s is Filter {
  return !!s && FILTERS.some((f) => f.value === s);
}
const RANK: Record<ApplicationStatus, number> = { submitted: 0, shortlisted: 1, accepted: 2, declined: 3, withdrawn: 4 };

export function AdminApplications() {
  const [params, setParams] = useSearchParams();
  const callId = params.get('call') ?? '';
  const raw = params.get('status');
  const filter: Filter = isFilter(raw) ? raw : 'review';

  const q = useQuery(async (ds, v) => {
    const [apps, calls] = await Promise.all([ds.listApplications(v), ds.listOpenCalls(v)]);
    return { apps, calls: calls.filter((c) => !c.externalUrl || apps.some((a) => a.callId === c.id)) };
  });

  const update = (k: 'call' | 'status', val: string, dflt: string) => {
    const p = new URLSearchParams(params);
    if (!val || val === dflt) p.delete(k);
    else p.set(k, val);
    setParams(p, { replace: true });
  };

  const inCall = (q.data?.apps ?? []).filter((a) => !callId || a.callId === callId);
  const matches = (s: ApplicationStatus) => (filter === 'all' ? true : filter === 'review' ? s === 'submitted' || s === 'shortlisted' : s === filter);
  const rows = inCall.filter((a) => matches(a.status)).sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt.localeCompare(a.createdAt));
  const count = (f: Filter) => inCall.filter((a) => (f === 'all' ? true : f === 'review' ? a.status === 'submitted' || a.status === 'shortlisted' : a.status === f)).length;
  const call: OpenCall | undefined = q.data?.calls.find((c) => c.id === callId);

  return (
    <div className="screen">
      <TopBar title="Applications" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
          <aside className="ad-split__aside stack">
            <p className="eyebrow eyebrow--gold">Kofi desk</p>
            <h2 className="h1">Applications</h2>
            <span className="rule rule--gold" aria-hidden="true" />
            <p className="ad-lede" style={{ marginTop: 0 }}>
              Artists’ applications to open calls. Shortlist, then decide. A note to the artist goes with the decision; a staff note stays with Kofi.
            </p>
            <Select label="Call" value={callId} onChange={(e) => update('call', e.target.value, '')}>
              <option value="">All calls</option>
              {(q.data?.calls ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            {call && <p className="tiny muted">{deadlineLabel(call)} · up to {call.maxWorks} works</p>}
            <div className="field">
              <span className="field__label" id="app-status-label">
                Status
              </span>
              <div className="chips chips--scroll" role="group" aria-labelledby="app-status-label">
                {FILTERS.map((f) => (
                  <Chip key={f.value} small on={filter === f.value} count={q.data ? count(f.value) : undefined} onClick={() => update('status', f.value, 'review')}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            </div>
          </aside>

          <div className="ad-split__main stack">
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading applications">
                <Skeleton h={110} />
                <Skeleton h={110} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={filter === 'review' ? 'Nothing waiting for review' : 'No applications here'}
                body={filter === 'review' ? 'Every application in this view has been decided or withdrawn.' : 'Try another call or status.'}
                actions={
                  filter !== 'all' ? (
                    <Button tone="secondary" onClick={() => update('status', 'all', 'review')}>
                      Show all
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="list pg-list" aria-label="Applications">
                {rows.map((a) => (
                  <li key={a.id}>
                    <Link to={`/admin/applications/${a.id}`} className="list-row pg-row">
                      <span className="pg-thumbs" aria-hidden="true">
                        {a.works.slice(0, 3).map((w) => {
                          const img = w.images.find((i) => i.isPrimary) ?? w.images[0];
                          return img ? <img key={w.id} className="thumb" src={img.src} alt="" /> : <span key={w.id} className="thumb pg-row__thumb--empty" />;
                        })}
                      </span>
                      <span className="list-row__main">
                        <span className="pg-row__badges">
                          <span className="status-pill">
                            <StatusDot status={APPLICATION_STATUS_DOT[a.status]} />
                            {APPLICATION_STATUS_LABEL[a.status]}
                          </span>
                        </span>
                        <span className="pg-row__title">{a.artistWorkingName}</span>
                        <span className="list-row__sub">
                          {a.callTitle} · {a.works.length} {a.works.length === 1 ? 'work' : 'works'} · sent {formatInstantDay(a.createdAt)}
                        </span>
                      </span>
                      <Icon.Back className="row-chev" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
