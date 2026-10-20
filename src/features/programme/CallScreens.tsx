import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApplicationRow, CallPhase, OpenCall, Viewer } from '@/domain/types';
import { callPhase } from '@/domain/programme';
import { useQuery, useViewer } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, SiteFooter, Skeleton, StatusDot, TopBar } from '@/ui';
import { CallCard, DeadlineBadge, PageHead, SampleTag, useToday } from './shared';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, CALL_PHASE_LABEL, formatDay, paragraphs } from './format';

export function CallsScreen() {
  const today = useToday();
  const q = useQuery((data, viewer) => data.listOpenCalls(viewer), []);
  const groups = useMemo(() => {
    const g: Record<CallPhase, OpenCall[]> = { open: [], upcoming: [], closed: [] };
    for (const c of q.data ?? []) g[callPhase(c, today)].push(c);
    return g;
  }, [q.data, today]);

  return (
    <div className="screen kp-page">
      <TopBar title="Open calls" home subordinate />
      <main className="container container--wide kp-main">
        <PageHead
          eyebrow="Opportunities"
          title="Open calls"
          lede="Exhibitions, awards and partner commissions looking for artists. Kofi calls never charge an entry fee; apply with works from your Kofi portfolio."
          aside={
            q.data && (
              <p className="eyebrow kp-head__count">
                {groups.open.length} open · {groups.upcoming.length} opening soon
              </p>
            )
          }
        />
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="kp-callgrid" aria-busy="true" aria-label="Loading">
            <Skeleton h={260} />
            <Skeleton h={260} />
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState title="No open calls right now" body="New calls are announced here and on the journal. Make sure your studio profile is ready to apply." actions={<LinkButton to="/journal" tone="secondary">Read the journal</LinkButton>} />
        ) : (
          <div className="kp-callgroups">
            {(['open', 'upcoming'] as const).map((p) =>
              groups[p].length ? (
                <section key={p} aria-labelledby={`kp-calls-${p}`} className="kp-callgroup">
                  <h2 id={`kp-calls-${p}`} className={`kp-group-title kp-group-title--${p}`}>
                    {CALL_PHASE_LABEL[p]}
                    <span className="kp-group-title__n">{groups[p].length}</span>
                  </h2>
                  <ul className="kp-callgrid">
                    {groups[p].map((c) => (
                      <li key={c.id}>
                        <CallCard call={c} today={today} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null,
            )}
            {groups.open.length === 0 && groups.upcoming.length === 0 && (
              <EmptyState title="No calls are open right now" body="Past calls are listed below. New calls are announced here first." />
            )}
            {groups.closed.length > 0 && (
              <details className="kp-disclosure">
                <summary>
                  <span>Closed calls</span>
                  <span className="kp-group-title__n">{groups.closed.length}</span>
                  <Icon.Back className="kp-disclosure__chev" />
                </summary>
                <ul className="kp-callgrid kp-callgrid--closed">
                  {groups.closed.map((c) => (
                    <li key={c.id}>
                      <CallCard call={c} today={today} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export function CallScreen() {
  const { id = '' } = useParams();
  const today = useToday();
  const viewer = useViewer();
  const q = useQuery(async (data, v) => {
    const call = await data.getOpenCall(v, id);
    const mine = call && v.role === 'artist' ? await data.listMyApplications(v).catch(() => [] as ApplicationRow[]) : [];
    const ex = call?.exhibitionId ? await data.getExhibition(v, call.exhibitionId) : undefined;
    return { call, mine, ex };
  }, [id]);
  const call = q.data?.call && q.data.call.id === id ? q.data.call : undefined;

  if (q.error && !q.data) {
    return (
      <Shell>
        <ErrorState error={q.error} retry={q.reload} />
      </Shell>
    );
  }
  if (!q.data) {
    return (
      <Shell>
        <div className="stack" aria-busy="true" aria-label="Loading call">
          <Skeleton h={24} w="30%" />
          <Skeleton h={64} w="80%" />
          <Skeleton h={200} />
        </div>
      </Shell>
    );
  }
  if (!call) {
    return (
      <Shell>
        <div className="kp-notfound">
          <h1 className="kp-head__title">Call not found</h1>
          <EmptyState title="This call isn’t available" body="The link may be wrong, or the call is not published." actions={<LinkButton to="/calls">All open calls</LinkButton>} />
        </div>
      </Shell>
    );
  }

  const phase = callPhase(call, today);
  const application = q.data.mine.find((a) => a.callId === call.id && a.status !== 'withdrawn');
  const facts: { label: string; value: string }[] = [
    { label: 'Deadline', value: call.deadline ? formatDay(call.deadline) : 'None stated · open until filled' },
    { label: 'Opens', value: formatDay(call.opensOn) },
    { label: 'Works accepted', value: `Up to ${call.maxWorks}` },
    { label: 'Mediums', value: call.mediums.length ? call.mediums.map((m) => m[0]!.toUpperCase() + m.slice(1)).join(', ') : 'Any medium' },
    { label: 'Fee', value: call.fee },
    ...(call.award ? [{ label: 'Award', value: call.award }] : []),
    { label: 'Eligibility', value: call.eligibility },
  ];

  return (
    <div className="screen kp-page kp-calldetail">
      <TopBar title="Open call" back="/calls" subordinate />
      <main className="container container--wide kp-main">
        {!call.published && viewer.role === 'admin' && (
          <p className="kp-draft">
            <Icon.Lock /> Draft · only Kofi staff can see this call
          </p>
        )}
        <header className="kp-callhead">
          <p className="kp-eyebrow-row">
            <span className="eyebrow eyebrow--gold">{call.partner ?? 'Kofi Collections'}</span>
            <span className="eyebrow">· {CALL_PHASE_LABEL[phase]}</span>
            {call.sample && <SampleTag />}
          </p>
          <h1 className="kp-callhead__title">{call.title}</h1>
          <p className="kp-callhead__summary">{call.summary}</p>
          <DeadlineBadge call={call} today={today} large />
        </header>

        <div className="kp-calllayout">
          <div className="kp-calllayout__main">
            <dl className="kp-facts kp-facts--grid">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
            <div className="kp-prose">
              {paragraphs(call.body).map((p, i) =>
                p.kind === 'quote' ? (
                  <blockquote key={i} className="kp-pull">
                    <p>{p.text}</p>
                  </blockquote>
                ) : (
                  <p key={i}>{p.text}</p>
                ),
              )}
            </div>
            {q.data.ex && (
              <p className="kp-related">
                <span className="eyebrow">Related exhibition</span>
                <Link to={`/exhibitions/${q.data.ex.id}`}>
                  {q.data.ex.title}
                  <Icon.ArrowRight />
                </Link>
              </p>
            )}
          </div>
          <aside className="kp-calllayout__aside" aria-label="How to apply">
            <CallAction call={call} phase={phase} viewer={viewer} application={application} />
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function CallAction({ call, phase, viewer, application }: { call: OpenCall; phase: CallPhase; viewer: Viewer; application?: ApplicationRow }) {
  let body: React.ReactNode;
  if (phase === 'closed') {
    body = (
      <>
        <p className="kp-cta__title">This call has closed</p>
        <p className="kp-cta__note">{call.deadline ? `Applications closed on ${formatDay(call.deadline)}.` : 'Applications are no longer being taken.'}</p>
        <button type="button" className="btn btn--secondary btn--block" disabled>
          Applications closed
        </button>
      </>
    );
  } else if (phase === 'upcoming') {
    body = (
      <>
        <p className="kp-cta__title">Opening soon</p>
        <p className="kp-cta__note">Applications open on {formatDay(call.opensOn)}. Get your works ready in your studio.</p>
        <button type="button" className="btn btn--secondary btn--block" disabled>
          Opens {formatDay(call.opensOn)}
        </button>
      </>
    );
  } else if (call.externalUrl) {
    body = (
      <>
        <p className="kp-cta__title">Apply on the partner’s form</p>
        <p className="kp-cta__note">{call.partner ?? 'The partner'} takes applications for this call on their own form. Read their terms there.</p>
        <a className="btn btn--block" href={call.externalUrl} target="_blank" rel="noopener noreferrer">
          Apply on the partner’s form ↗
        </a>
      </>
    );
  } else if (viewer.role === 'artist' && application) {
    body = (
      <>
        <p className="kp-cta__title">You have applied</p>
        <p className="kp-cta__status">
          <StatusDot status={APPLICATION_STATUS_DOT[application.status]} />
          {APPLICATION_STATUS_LABEL[application.status]}
          <span className="kp-cta__date">· {formatDay(application.createdAt.slice(0, 10))}</span>
        </p>
        {application.decisionNote && <p className="kp-cta__note">“{application.decisionNote}”</p>}
        <LinkButton to="/studio/applications" tone="secondary" block>
          Your applications
        </LinkButton>
      </>
    );
  } else if (viewer.role === 'artist') {
    body = (
      <>
        <p className="kp-cta__title">Apply with your works</p>
        <p className="kp-cta__note">
          Choose up to {call.maxWorks} {call.maxWorks === 1 ? 'work' : 'works'} from your portfolio and add a short statement. Kofi reads every application.
        </p>
        <LinkButton to={`/studio/apply/${call.id}`} block>
          Apply with your works
        </LinkButton>
      </>
    );
  } else {
    body = (
      <>
        <p className="kp-cta__title">Artists apply from their studio</p>
        <p className="kp-cta__note">Applications use the works in an artist’s Kofi portfolio, so there is nothing to upload twice.</p>
        {viewer.role === 'public' && (
          <LinkButton to="/account" block>
            Sign in as an artist to apply
          </LinkButton>
        )}
      </>
    );
  }
  return <div className="kp-cta">{body}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="screen kp-page">
      <TopBar title="Open call" back="/calls" subordinate />
      <main className="container container--wide kp-main">{children}</main>
    </div>
  );
}
