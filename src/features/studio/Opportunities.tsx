import { Link } from 'react-router-dom';
import type { ApplicationRow, Medium, OpenCall } from '@/domain/types';
import { callPhase } from '@/domain/programme';
import { useQuery } from '@/state/session';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, CALL_PHASE_LABEL, deadlineLabel } from '@/features/programme/format';
import { EmptyState, ErrorState, Icon, LinkButton, Skeleton, StatusDot, Tag, TopBar } from '@/ui';
import { capitalize } from './shared';

/** A call fits when it takes any medium, or shares one with the artist. */
export function fitsMediums(call: Pick<OpenCall, 'mediums'>, mine: Medium[]): boolean {
  return call.mediums.length === 0 || call.mediums.some((m) => mine.includes(m));
}

/** The application that counts for a call (anything but a withdrawn one wins). */
export function currentApplication(apps: ApplicationRow[], callId: string): ApplicationRow | undefined {
  const forCall = apps.filter((a) => a.callId === callId);
  return forCall.find((a) => a.status !== 'withdrawn') ?? forCall[0];
}

export function Opportunities() {
  const q = useQuery(async (ds, v) => {
    const [calls, artist, apps] = await Promise.all([ds.listOpenCalls(v), ds.getMyArtist(v), ds.listMyApplications(v).catch(() => [] as ApplicationRow[])]);
    return { calls: calls.filter((c) => callPhase(c) !== 'closed'), mediums: artist?.mediums ?? [], apps };
  });

  return (
    <div className="screen">
      <TopBar title="Opportunities" back="/studio" />
      <main className="container container--wide st-main">
        <div className="st-split">
          <aside className="st-split__aside stack st-intro">
            <p className="eyebrow eyebrow--gold">Open calls</p>
            <h2 className="h1 sto-title">Apply with the works you already have.</h2>
            <span className="rule" aria-hidden="true" />
            <p className="lede">
              Calls from Kofi and its partners. Pick works straight from your studio and write a short statement. You’ll see every decision in My
              applications.
            </p>
            <ul className="sto-legend small">
              <li>
                <span className="sto-fit" aria-hidden="true">
                  <Icon.Sparkle />
                </span>{' '}
                Fits your mediums: the call takes any medium, or one you work in.
              </li>
              <li>Kofi calls never charge an entry fee.</li>
            </ul>
            <LinkButton to="/studio/applications" tone="secondary" icon={<Icon.Doc />}>
              My applications
            </LinkButton>
          </aside>

          <div className="st-split__main">
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading open calls">
                <Skeleton h={180} />
                <Skeleton h={180} />
              </div>
            ) : q.data.calls.length === 0 ? (
              <EmptyState
                title="No calls open right now"
                body="When Kofi or a partner opens a call, it appears here. Past calls are on the public Open calls page."
                actions={<LinkButton to="/calls" tone="secondary">See all calls</LinkButton>}
              />
            ) : (
              <ul className="sto-calls" aria-label="Open and upcoming calls">
                {q.data.calls.map((c) => (
                  <li key={c.id}>
                    <CallCard call={c} mine={q.data!.mediums} app={currentApplication(q.data!.apps, c.id)} />
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

function CallCard({ call, mine, app }: { call: OpenCall; mine: Medium[]; app?: ApplicationRow }) {
  const phase = callPhase(call);
  const fits = fitsMediums(call, mine);
  const applied = app && app.status !== 'withdrawn';
  return (
    <article className="sto-call" aria-labelledby={`call-${call.id}`}>
      <div className="sto-call__top">
        <span className={`sto-phase sto-phase--${phase}`}>{CALL_PHASE_LABEL[phase]}</span>
        <span className="sto-deadline">{deadlineLabel(call)}</span>
        {call.sample && <Tag>Sample</Tag>}
      </div>
      <h3 className="sto-call__title" id={`call-${call.id}`}>
        <Link to={`/calls/${call.id}`}>{call.title}</Link>
      </h3>
      {call.partner && <p className="sto-call__partner">{call.partner === 'Kofi Collections' ? 'Kofi Collections' : `With ${call.partner}`}</p>}
      <p className="sto-call__summary">{call.summary}</p>
      <dl className="sto-facts">
        <div>
          <dt>Works</dt>
          <dd>Up to {call.maxWorks}</dd>
        </div>
        <div>
          <dt>Mediums</dt>
          <dd>{call.mediums.length ? call.mediums.map(capitalize).join(', ') : 'Any medium'}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{call.fee}</dd>
        </div>
      </dl>
      <div className="sto-call__foot">
        {fits ? (
          <span className="sto-fit-hint">
            <Icon.Sparkle aria-hidden="true" /> Fits your mediums
          </span>
        ) : (
          <span className="sto-nofit small muted">Outside your listed mediums</span>
        )}
        {applied && (
          <span className="status-pill sto-pill">
            <StatusDot status={APPLICATION_STATUS_DOT[app.status]} />
            {APPLICATION_STATUS_LABEL[app.status]}
          </span>
        )}
      </div>
      <div className="sto-call__actions">
        {call.externalUrl ? (
          <a className="btn" href={call.externalUrl} target="_blank" rel="noopener noreferrer">
            Apply on partner form <span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : applied ? (
          <LinkButton to="/studio/applications" tone="secondary">
            View your application
          </LinkButton>
        ) : phase === 'open' ? (
          <LinkButton to={`/studio/apply/${call.id}`}>Apply</LinkButton>
        ) : (
          <span className="small muted">Applications open {deadlineLabel(call).replace(/^Opens /, '')}</span>
        )}
        <LinkButton to={`/calls/${call.id}`} tone="ghost" className="sto-details">
          Read the call
        </LinkButton>
      </div>
    </article>
  );
}
