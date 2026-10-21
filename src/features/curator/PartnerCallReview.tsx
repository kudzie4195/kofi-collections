import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ApplicationRow, ApplicationStatus, LotRow } from '@/domain/types';
import { CALL_KIND_LABEL } from '@/domain/types';
import { callPhase } from '@/domain/programme';
import { useQuery } from '@/state/session';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, deadlineLabel, formatDay, formatInstantDay } from '@/features/programme/format';
import { TermsBlock } from '@/features/programme/terms';
import { EmptyState, Icon, LinkButton, Segmented, Skeleton, StatusDot } from '@/ui';
import { LotsPanel } from './LotsPanel';
import { isPartnerCurator, PartnerError, PartnerGate, PartnerShell, PhaseBadge, PublishBadge } from './partnerShared';
import '@/features/admin/programme.css';
import '@/features/admin/admin.css';
import './curator.css';

type Tab = 'applications' | 'lots';
const RANK: Record<ApplicationStatus, number> = { submitted: 0, shortlisted: 1, accepted: 2, declined: 3, withdrawn: 4 };

export function PartnerCallReview() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery(
    async (ds, v) => {
      const curator = await ds.getMyCurator(v);
      if (!isPartnerCurator(curator)) return { curator, call: undefined, apps: [] as ApplicationRow[], lots: [] as LotRow[] };
      const call = await ds.getOpenCall(v, id);
      if (!call || call.organizerInstitutionId !== curator.institutionId) return { curator, call: undefined, apps: [] as ApplicationRow[], lots: [] as LotRow[] };
      const [apps, lots] = await Promise.all([ds.listApplications(v, id), call.kind === 'auction' ? ds.listLots(v, id) : Promise.resolve([] as LotRow[])]);
      return { curator, call, apps, lots };
    },
    [id],
  );

  const curator = q.data?.curator;
  const call = q.data?.call;
  const isAuction = call?.kind === 'auction';
  const tab: Tab = isAuction && params.get('tab') === 'lots' ? 'lots' : 'applications';
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    if (t === 'applications') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
  };

  let body: React.ReactNode;
  if (q.error && !q.data) body = <PartnerError error={q.error} retry={q.reload} />;
  else if (!q.data)
    body = (
      <div className="cu-split" aria-busy="true" aria-label="Loading the call">
        <Skeleton h={320} />
        <div className="stack">
          <Skeleton h={96} />
          <Skeleton h={96} />
        </div>
      </div>
    );
  else if (!isPartnerCurator(curator)) body = <PartnerGate curator={curator} />;
  else if (!call) body = <EmptyState title="We couldn’t find that call" body="It may have been removed, or another institution runs it." actions={<LinkButton to="/curator/calls">Calls you run</LinkButton>} />;
  else {
    const apps = [...q.data.apps].sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt.localeCompare(a.createdAt));
    const toReview = apps.filter((a) => a.status === 'submitted' || a.status === 'shortlisted').length;
    body = (
      <div className="cu-split">
        <aside className="cu-split__aside stack" aria-label="About this call">
          <p className="eyebrow eyebrow--gold">
            {CALL_KIND_LABEL[call.kind]} · {curator.institution.name}
          </p>
          <h2 className="h1 pc-title">{call.title}</h2>
          <span className="rule rule--gold" aria-hidden="true" />
          <div className="pg-row__badges">
            <PhaseBadge call={call} />
            <PublishBadge published={call.published} />
            {call.sample && <span className="pg-badge pg-badge--sample">Sample</span>}
          </div>
          <dl className="pga-facts">
            <div>
              <dt>Opens</dt>
              <dd>{formatDay(call.opensOn)}</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>{call.deadline ? (callPhase(call) === 'closed' ? `${formatDay(call.deadline)} · closed` : `${formatDay(call.deadline)} · ${deadlineLabel(call).toLowerCase()}`) : deadlineLabel(call)}</dd>
            </div>
            <div>
              <dt>Applications</dt>
              <dd>
                {apps.length}
                {toReview ? ` · ${toReview} to review` : ''}
              </dd>
            </div>
            {isAuction && (
              <div>
                <dt>Lots</dt>
                <dd>{q.data.lots.length}</dd>
              </div>
            )}
          </dl>
          <div className="pc-asideactions">
            {!call.published ? (
              <LinkButton to={`/curator/calls/${call.id}/edit`} tone="secondary" size="sm" icon={<Icon.Edit />}>
                Edit draft
              </LinkButton>
            ) : (
              <LinkButton to={`/calls/${call.id}`} tone="secondary" size="sm">
                View public page
              </LinkButton>
            )}
          </div>
          {!call.published && <p className="tiny muted">Draft. Kofi publishes partner calls after review.</p>}
          {call.terms && (
            <details className="pc-termsbox">
              <summary>
                <span className="pc-termsbox__label">Published terms</span>
                <span className="pc-termsbox__gist">
                  Artist {call.terms.artistSharePct}% · Kofi {call.terms.kofiSharePct}%
                  {call.terms.partnerSharePct ? ` · ${curator.institution.name} ${call.terms.partnerSharePct}%` : ''}
                </span>
                <Icon.Back className="pc-termsbox__chev" aria-hidden="true" />
              </summary>
              <TermsBlock terms={call.terms} partnerName={curator.institution.name} headingLevel={2} title="The call’s terms" variant="compact" id="pc-terms" />
            </details>
          )}
        </aside>

        <div className="cu-split__main stack--lg">
          {isAuction && (
            <div className="seg-wrap pg-tabs">
              <Segmented
                label="Show"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'applications', label: `Applications (${apps.length})` },
                  { value: 'lots', label: `Lots (${q.data.lots.length})` },
                ]}
              />
            </div>
          )}
          {tab === 'lots' ? (
            <LotsPanel call={call} lots={q.data.lots} apps={q.data.apps} partnerName={curator.institution.name} />
          ) : (
            <section className="stack" aria-labelledby="pc-apps-title">
              <div className="cu-head">
                <div>
                  <p className="eyebrow eyebrow--gold">{toReview ? `${toReview} to review` : 'All decided'}</p>
                  <h2 className="section-title" id="pc-apps-title">
                    Applications
                  </h2>
                </div>
              </div>
              <p className="small muted">You see the works artists attached and their statements. Contact details stay with Kofi; introductions go through Kofi.</p>
              {apps.length === 0 ? (
                <EmptyState
                  title="No applications yet"
                  body={call.published ? 'Applications appear here as artists send them.' : 'Applications open once Kofi publishes the call.'}
                />
              ) : (
                <ul className="list pg-list pc-apps" aria-label="Applications">
                  {apps.map((a) => (
                    <li key={a.id}>
                      <Link to={`/curator/calls/${call.id}/applications/${a.id}`} className="list-row pg-row pc-app">
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
                          <span className="pc-app__statement">{a.statement}</span>
                          <span className="list-row__sub">
                            {a.works.length} {a.works.length === 1 ? 'work' : 'works'} · sent {formatInstantDay(a.createdAt)}
                          </span>
                        </span>
                        <Icon.Back className="row-chev" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <PartnerShell title="Call desk" back="/curator/calls">
      {body}
    </PartnerShell>
  );
}
