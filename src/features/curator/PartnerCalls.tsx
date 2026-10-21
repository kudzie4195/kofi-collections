import { Link } from 'react-router-dom';
import type { OpenCall } from '@/domain/types';
import { CALL_KIND_LABEL } from '@/domain/types';
import { useQuery } from '@/state/session';
import { deadlineLabel } from '@/features/programme/format';
import { EmptyState, Icon, LinkButton, Skeleton } from '@/ui';
import { isPartnerCurator, PartnerError, PartnerGate, PartnerShell, PhaseBadge, PublishBadge } from './partnerShared';
import '@/features/admin/programme.css';
import '@/features/admin/admin.css';
import './curator.css';

interface CallRow {
  call: OpenCall;
  applications: number;
  toReview: number;
  lots: number;
}

export function PartnerCalls() {
  const q = useQuery(async (ds, v) => {
    const curator = await ds.getMyCurator(v);
    if (!isPartnerCurator(curator)) return { curator, rows: [] as CallRow[] };
    const calls = await ds.listMyCalls(v);
    const rows = await Promise.all(
      calls.map(async (call): Promise<CallRow> => {
        const [apps, lots] = await Promise.all([ds.listApplications(v, call.id), call.kind === 'auction' ? ds.listLots(v, call.id) : Promise.resolve([])]);
        return { call, applications: apps.length, toReview: apps.filter((a) => a.status === 'submitted' || a.status === 'shortlisted').length, lots: lots.length };
      }),
    );
    return { curator, rows };
  });

  const curator = q.data?.curator;
  const verified = isPartnerCurator(curator);

  let body: React.ReactNode;
  if (q.error && !q.data) body = <PartnerError error={q.error} retry={q.reload} />;
  else if (!q.data)
    body = (
      <div className="cu-split" aria-busy="true" aria-label="Loading your calls">
        <Skeleton h={220} />
        <div className="stack">
          <Skeleton h={96} />
          <Skeleton h={96} />
        </div>
      </div>
    );
  else if (!verified) body = <PartnerGate curator={curator} />;
  else {
    const rows = q.data.rows;
    body = (
      <div className="cu-split">
        <aside className="cu-split__aside stack" aria-label="About the partner desk">
          <p className="eyebrow eyebrow--gold">Partner desk</p>
          <h2 className="h1 pc-title">Calls you run</h2>
          <span className="rule rule--gold" aria-hidden="true" />
          <p className="pc-lede">
            Open calls {curator.institution.name} runs with Kofi. Draft a call here; Kofi reviews it and publishes it. You read the applications, make the selection and, for an auction, record the lots and the sales.
          </p>
          <p className="pc-org">
            <Icon.Building aria-hidden="true" />
            <span>
              <span className="pc-org__label">Organiser</span>
              <span className="pc-org__name">{curator.institution.name}</span>
            </span>
          </p>
          <div>
            <LinkButton to="/curator/calls/new" icon={<Icon.Plus />}>
              New call
            </LinkButton>
          </div>
        </aside>

        <div className="cu-split__main stack">
          <div className="cu-head">
            <div>
              <p className="eyebrow eyebrow--gold">{rows.length === 1 ? '1 call' : `${rows.length} calls`}</p>
              <h2 className="section-title">Your institution’s calls</h2>
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title="No calls yet"
              body="Draft your first open call: an exhibition, an award, a commission or a benefit auction. Kofi checks it with you before it goes public."
              actions={
                <LinkButton to="/curator/calls/new" icon={<Icon.Plus />}>
                  New call
                </LinkButton>
              }
            />
          ) : (
            <ul className="list pc-calls" aria-label="Calls you run">
              {rows.map(({ call, applications, toReview, lots }) => (
                <li key={call.id}>
                  <Link to={`/curator/calls/${call.id}`} className="list-row pc-call">
                    <span className="list-row__main">
                      <span className="pg-row__badges">
                        <PhaseBadge call={call} />
                        <PublishBadge published={call.published} />
                        {call.sample && <span className="pg-badge pg-badge--sample">Sample</span>}
                      </span>
                      <span className="pc-call__kind">{CALL_KIND_LABEL[call.kind]}</span>
                      <span className="pc-call__title">{call.title}</span>
                      <span className="pc-call__meta">
                        <span>{deadlineLabel(call)}</span>
                        <span>
                          {applications === 1 ? '1 application' : `${applications} applications`}
                          {toReview > 0 ? ` · ${toReview} to review` : ''}
                        </span>
                        {call.kind === 'auction' && <span>{lots === 1 ? '1 lot' : `${lots} lots`}</span>}
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
    );
  }

  return (
    <PartnerShell title="Calls you run" back="/curator">
      {body}
    </PartnerShell>
  );
}
