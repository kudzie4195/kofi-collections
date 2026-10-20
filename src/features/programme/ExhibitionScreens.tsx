import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ArtworkView, Exhibition, ExhibitionPhase } from '@/domain/types';
import { exhibitionPhase } from '@/domain/programme';
import { useQuery, useViewer } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, Segmented, SiteFooter, Skeleton, TopBar, WallLabel } from '@/ui';
import { CallCard, EventRow, ExhibitionCard, ExhibitionVisual, PageHead, SampleTag, SectionHead, useToday, workImage } from './shared';
import { creditLine, EXHIBITION_PHASE_LABEL, eventIsPast, formatDateRange, paragraphs } from './format';

const PHASES: ExhibitionPhase[] = ['current', 'upcoming', 'past'];
const TAB_LABEL: Record<ExhibitionPhase, string> = { current: 'Current', upcoming: 'Upcoming', past: 'Past' };

export function ExhibitionsScreen() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const q = useQuery((data, viewer) => data.listExhibitions(viewer), []);
  const list = q.data ?? [];
  const groups = useMemo(() => {
    const g: Record<ExhibitionPhase, Exhibition[]> = { current: [], upcoming: [], past: [] };
    for (const ex of q.data ?? []) g[exhibitionPhase(ex, today)].push(ex);
    return g;
  }, [q.data, today]);
  const asked = params.get('phase') as ExhibitionPhase | null;
  const phase: ExhibitionPhase = asked && PHASES.includes(asked) ? asked : (PHASES.find((p) => groups[p].length > 0) ?? 'current');
  const shown = groups[phase];

  return (
    <div className="screen kp-page">
      <TopBar title="Exhibitions" home subordinate />
      <main className="container container--wide kp-main">
        <PageHead
          eyebrow="Kofi Collections · Programme"
          title="Exhibitions"
          lede="Group shows and single-night exhibitions from Kofi Collections in Pittsburgh, with the works you can still see in the collection."
        />
        <div className="kp-tabs">
          <Segmented<ExhibitionPhase>
            label="Show exhibitions"
            value={phase}
            onChange={(p) => setParams(p === PHASES.find((x) => groups[x].length > 0) ? {} : { phase: p }, { replace: true })}
            options={PHASES.map((p) => ({ value: p, label: `${TAB_LABEL[p]}${q.data ? ` · ${groups[p].length}` : ''}` }))}
          />
        </div>
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="kp-exgrid" aria-busy="true" aria-label="Loading">
            <Skeleton h={320} />
            <Skeleton h={320} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No exhibitions yet" body="Kofi’s programme will appear here. In the meantime, browse the works in the collection." actions={<LinkButton to="/works">Browse works</LinkButton>} />
        ) : shown.length === 0 ? (
          <EmptyState title={`No ${TAB_LABEL[phase].toLowerCase()} exhibitions`} body="Try another tab, or see what else is on." actions={<LinkButton to="/whats-on" tone="secondary">What’s on</LinkButton>} />
        ) : (
          <section aria-labelledby="kp-ex-list">
            <h2 id="kp-ex-list" className="sr-only">
              {TAB_LABEL[phase]} exhibitions
            </h2>
            <ul className="kp-exgrid">
              {shown.map((ex, i) => (
                <li key={ex.id} className={i === 0 && phase !== 'past' ? 'kp-exgrid__feature' : undefined}>
                  <ExhibitionCard ex={ex} today={today} feature={i === 0 && phase !== 'past'} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {q.data && shown.length > 0 && list.length > shown.length && (
          <section className="kp-block" aria-labelledby="kp-ex-more">
            <SectionHead id="kp-ex-more" eyebrow="Also in the programme" title={phase === 'past' ? 'Current and upcoming' : phase === 'current' ? 'Coming up and past' : 'Now showing and past'} tone="gold" />
            <ul className="kp-exgrid kp-exgrid--small">
              {list
                .filter((ex) => exhibitionPhase(ex, today) !== phase)
                .map((ex) => (
                  <li key={ex.id}>
                    <ExhibitionCard ex={ex} today={today} />
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export function ExhibitionScreen() {
  const { id = '' } = useParams();
  const today = useToday();
  const viewer = useViewer();
  const q = useQuery(async (data, v) => {
    const ex = await data.getExhibition(v, id);
    if (!ex) return { ex };
    // listArtworks, not getArtwork: an admin opening a private record is audited, which would re-trigger this query.
    const [all, events, calls] = await Promise.all([data.listArtworks(v), data.listEvents(v), data.listOpenCalls(v)]);
    const byId = new Map(all.map((w) => [w.id, w]));
    return {
      ex,
      others: (await data.listExhibitions(v)).filter((x) => x.id !== ex.id && x.published).slice(0, 3),
      works: ex.artworkIds.map((wid) => byId.get(wid)).filter((w): w is ArtworkView => !!w),
      events: events.filter((e) => e.exhibitionId === ex.id),
      calls: calls.filter((c) => c.exhibitionId === ex.id),
    };
  }, [id]);

  const ex = q.data?.ex && q.data.ex.id === id ? q.data.ex : undefined;
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
        <div className="stack" aria-busy="true" aria-label="Loading exhibition">
          <Skeleton h={360} />
          <Skeleton h={40} w="60%" />
          <Skeleton h={120} />
        </div>
      </Shell>
    );
  }
  if (!ex) {
    return (
      <Shell>
        <div className="kp-notfound">
          <h1 className="kp-head__title">Exhibition not found</h1>
          <EmptyState title="This exhibition isn’t available" body="The link may be wrong, or the exhibition is not published yet." actions={<LinkButton to="/exhibitions">All exhibitions</LinkButton>} />
        </div>
      </Shell>
    );
  }

  const works = q.data.works ?? [];
  const events = q.data.events ?? [];
  const calls = q.data.calls ?? [];
  const others = q.data.others ?? [];
  const phase = exhibitionPhase(ex, today);
  const now = new Date();

  return (
    <div className="screen kp-page kp-exdetail">
      <TopBar title="Exhibition" back="/exhibitions" subordinate />
      <main className="container container--wide kp-main">
        <article>
          {!ex.published && viewer.role === 'admin' && (
            <p className="kp-draft">
              <Icon.Lock /> Draft · only Kofi staff can see this exhibition
            </p>
          )}
          <div className="kp-extop">
            <div className="kp-extop__media">
              <ExhibitionVisual ex={ex} size="lg" fallback={workImage(works[0])} />
              {(ex.image ?? workImage(works[0]))?.credit && <p className="kp-credit">{ex.image ? '' : `${works[0]?.title} · `}{creditLine((ex.image ?? workImage(works[0]))!.credit!)}</p>}
            </div>
            <header className="kp-extop__text">
              <p className="kp-eyebrow-row">
                <span className={`eyebrow kp-phase kp-phase--${phase}`}>{EXHIBITION_PHASE_LABEL[phase]}</span>
                {ex.sample && <SampleTag />}
              </p>
              <h1 className="kp-extop__title">{ex.title}</h1>
              {ex.subtitle && <p className="kp-extop__sub">{ex.subtitle}</p>}
              <p className="kp-extop__summary">{ex.summary}</p>
              <dl className="kp-facts">
                <div>
                  <dt>Dates</dt>
                  <dd>{formatDateRange(ex.startsOn, ex.endsOn)}</dd>
                </div>
                {ex.venue && (
                  <div>
                    <dt>Venue</dt>
                    <dd>
                      {ex.venue.name}
                      <span className="kp-facts__sub">{[ex.venue.address, ex.venue.city].filter(Boolean).join(', ')}</span>
                    </dd>
                  </div>
                )}
                {ex.curatedBy && (
                  <div>
                    <dt>Curated by</dt>
                    <dd>{ex.curatedBy}</dd>
                  </div>
                )}
                {works.length > 0 && (
                  <div>
                    <dt>In the collection</dt>
                    <dd>
                      {works.length} {works.length === 1 ? 'work' : 'works'}
                    </dd>
                  </div>
                )}
              </dl>
              {ex.externalUrl && (
                <a className="btn btn--secondary kp-extop__ext" href={ex.externalUrl} target="_blank" rel="noopener noreferrer">
                  More on koficollections.org ↗
                </a>
              )}
            </header>
          </div>

          <div className="kp-exbody">
            <div className="kp-prose">
              {paragraphs(ex.body).map((p, i) =>
                p.kind === 'quote' ? (
                  <blockquote key={i} className="kp-pull">
                    <p>{p.text}</p>
                  </blockquote>
                ) : (
                  <p key={i} className={i === 0 ? 'kp-prose__first' : undefined}>
                    {p.text}
                  </p>
                ),
              )}
            </div>
            {calls.length > 0 && (
              <aside className="kp-exbody__aside" aria-label="Related open call">
                {calls.map((c) => (
                  <CallCard key={c.id} call={c} today={today} />
                ))}
              </aside>
            )}
          </div>

          {works.length > 0 && (
            <section className="kp-block kp-block--tight" aria-labelledby="kp-ex-works">
              <SectionHead id="kp-ex-works" eyebrow={ex.title} title="Works in the exhibition" />
              <ul className="gallery-grid kp-exworks">
                {works.map((w) => (
                  <li key={w.id}>
                    <WallLabel work={w} to={`/work/${w.id}`} unit={w.dimensions.unit} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {events.length > 0 && (
            <section className="kp-block kp-block--tight" aria-labelledby="kp-ex-events">
              <SectionHead id="kp-ex-events" eyebrow="Events" title="In the gallery" tone="green" />
              <ul className="kp-eventlist">
                {events.map((e) => (
                  <li key={e.id}>
                    <EventRow ev={e} past={eventIsPast(e, now)} link={false} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
        {others.length > 0 && (
          <section className="kp-block" aria-labelledby="kp-ex-others">
            <SectionHead id="kp-ex-others" eyebrow="Kofi Collections" title="More exhibitions" to="/exhibitions" linkLabel="All exhibitions" tone="gold" />
            <ul className="kp-exgrid kp-exgrid--small">
              {others.map((o) => (
                <li key={o.id}>
                  <ExhibitionCard ex={o} today={today} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="screen kp-page">
      <TopBar title="Exhibition" back="/exhibitions" subordinate />
      <main className="container container--wide kp-main">{children}</main>
    </div>
  );
}
