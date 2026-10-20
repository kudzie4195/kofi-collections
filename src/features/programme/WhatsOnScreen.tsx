import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Exhibition, OpenCall, ProgrammeEvent, Story } from '@/domain/types';
import { callPhase, exhibitionPhase } from '@/domain/programme';
import { useQuery } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, Segmented, SiteFooter, Skeleton, TopBar } from '@/ui';
import { CallRow, EventRow, ExhibitionRow, groupBy, PageHead, StoryRow, useToday } from './shared';
import { eventIsPast, formatMonth } from './format';

type Tab = 'exhibitions' | 'calls' | 'events' | 'journal';
const TABS: { value: Tab; label: string }[] = [
  { value: 'exhibitions', label: 'Exhibitions' },
  { value: 'calls', label: 'Open calls' },
  { value: 'events', label: 'Events' },
  { value: 'journal', label: 'Journal' },
];

interface Programme {
  exhibitions: Exhibition[];
  calls: OpenCall[];
  events: ProgrammeEvent[];
  stories: Story[];
}

/** The mobile programme hub: exhibitions, calls, events and the journal as compact lists. */
export function WhatsOnScreen() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && TABS.some((t) => t.value === asked) ? asked : 'exhibitions';
  const q = useQuery<Programme>(async (data, viewer) => {
    const [exhibitions, calls, events, stories] = await Promise.all([data.listExhibitions(viewer), data.listOpenCalls(viewer), data.listEvents(viewer), data.listStories(viewer)]);
    return { exhibitions, calls, events, stories };
  }, []);

  const now = useMemo(() => new Date(), []);
  const exTitle = (id?: string) => (id ? q.data?.exhibitions.find((x) => x.id === id)?.title : undefined);

  return (
    <div className="screen kp-page kp-whatson">
      <TopBar title="What’s on" home subordinate />
      <main className="container container--wide kp-main">
        <PageHead eyebrow="Kofi Collections · Programme" title="What’s on" lede="Exhibitions, open calls, events and stories, all in one place." />
        {q.data && <Glance data={q.data} today={today} now={now} onPick={(t) => setParams(t === 'exhibitions' ? {} : { tab: t }, { replace: true })} />}
        <div className="kp-tabs kp-tabs--fit">
          <Segmented<Tab> label="Show" value={tab} onChange={(t) => setParams(t === 'exhibitions' ? {} : { tab: t }, { replace: true })} options={TABS} />
        </div>
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading">
            <Skeleton h={88} />
            <Skeleton h={88} />
            <Skeleton h={88} />
          </div>
        ) : (
          <section aria-labelledby="kp-whatson-panel" className="kp-whatson__panel">
            <h2 id="kp-whatson-panel" className="sr-only">
              {TABS.find((t) => t.value === tab)!.label}
            </h2>
            {tab === 'exhibitions' && <ExhibitionsPanel list={q.data.exhibitions} today={today} />}
            {tab === 'calls' && <CallsPanel list={q.data.calls} today={today} />}
            {tab === 'events' && <EventsPanel list={q.data.events} now={now} exTitle={exTitle} />}
            {tab === 'journal' && <JournalPanel list={q.data.stories} />}
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function Glance({ data, today, now, onPick }: { data: Programme; today: string; now: Date; onPick: (t: Tab) => void }) {
  const showing = data.exhibitions.filter((x) => exhibitionPhase(x, today) === 'current').length;
  const open = data.calls.filter((c) => callPhase(c, today) === 'open').length;
  const events = data.events.filter((e) => !eventIsPast(e, now)).length;
  const items: { tab: Tab; n: number; label: string }[] = [
    { tab: 'exhibitions', n: showing, label: 'Now showing' },
    { tab: 'calls', n: open, label: open === 1 ? 'Open call' : 'Open calls' },
    { tab: 'events', n: events, label: events === 1 ? 'Upcoming event' : 'Upcoming events' },
  ];
  return (
    <div className="kp-glance" role="group" aria-label="At a glance">
      {items.map((i) => (
        <button key={i.tab} type="button" className="kp-glance__item" onClick={() => onPick(i.tab)}>
          <span className="kp-glance__n">{i.n}</span>
          <span className="kp-glance__label">{i.label}</span>
        </button>
      ))}
    </div>
  );
}

function ExhibitionsPanel({ list, today }: { list: Exhibition[]; today: string }) {
  if (!list.length) return <EmptyState title="No exhibitions yet" body="Kofi’s programme will appear here." />;
  const active = list.filter((x) => exhibitionPhase(x, today) !== 'past');
  const past = list.filter((x) => exhibitionPhase(x, today) === 'past');
  return (
    <>
      {active.length > 0 ? (
        <ul className="kp-rows">
          {active.map((x) => (
            <li key={x.id}>
              <ExhibitionRow ex={x} today={today} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="kp-quiet">Nothing showing right now.</p>
      )}
      {past.length > 0 && (
        <details className="kp-disclosure">
          <summary>
            <span>Past exhibitions</span>
            <span className="kp-group-title__n">{past.length}</span>
            <Icon.Back className="kp-disclosure__chev" />
          </summary>
          <ul className="kp-rows">
            {past.map((x) => (
              <li key={x.id}>
                <ExhibitionRow ex={x} today={today} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="kp-panel-more">
        <LinkButton to="/exhibitions" tone="ghost" size="sm">
          All exhibitions
        </LinkButton>
      </p>
    </>
  );
}

function CallsPanel({ list, today }: { list: OpenCall[]; today: string }) {
  if (!list.length) return <EmptyState title="No open calls right now" body="New calls are announced here first." />;
  const live = list.filter((c) => callPhase(c, today) !== 'closed');
  const closed = list.filter((c) => callPhase(c, today) === 'closed');
  return (
    <>
      {live.length > 0 ? (
        <ul className="kp-rows">
          {live.map((c) => (
            <li key={c.id}>
              <CallRow call={c} today={today} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="kp-quiet">No calls are open right now.</p>
      )}
      {closed.length > 0 && (
        <details className="kp-disclosure">
          <summary>
            <span>Closed calls</span>
            <span className="kp-group-title__n">{closed.length}</span>
            <Icon.Back className="kp-disclosure__chev" />
          </summary>
          <ul className="kp-rows">
            {closed.map((c) => (
              <li key={c.id}>
                <CallRow call={c} today={today} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="kp-panel-more">
        <LinkButton to="/calls" tone="ghost" size="sm">
          All open calls
        </LinkButton>
      </p>
    </>
  );
}

export function EventsPanel({ list, now, exTitle }: { list: ProgrammeEvent[]; now: Date; exTitle: (id?: string) => string | undefined }) {
  if (!list.length) return <EmptyState title="No events scheduled" body="Openings, talks and studio visits will appear here." />;
  const upcoming = list.filter((e) => !eventIsPast(e, now));
  const past = list.filter((e) => eventIsPast(e, now)).reverse();
  const months = groupBy(upcoming, (e) => formatMonth(e.startsAt));
  return (
    <>
      {months.length === 0 && <p className="kp-quiet">No upcoming events. Past events are below.</p>}
      {months.map((m) => (
        <section key={m.key} className="kp-month" aria-label={m.key}>
          <h3 className="kp-month__title">{m.key}</h3>
          <ul className="kp-eventlist">
            {m.items.map((e) => (
              <li key={e.id}>
                <EventRow ev={e} exhibitionTitle={exTitle(e.exhibitionId)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {past.length > 0 && (
        <details className="kp-disclosure">
          <summary>
            <span>Past events</span>
            <span className="kp-group-title__n">{past.length}</span>
            <Icon.Back className="kp-disclosure__chev" />
          </summary>
          <ul className="kp-eventlist">
            {past.map((e) => (
              <li key={e.id}>
                <EventRow ev={e} past exhibitionTitle={exTitle(e.exhibitionId)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function JournalPanel({ list }: { list: Story[] }) {
  if (!list.length) return <EmptyState title="No stories yet" body="Interviews and news will appear here." />;
  return (
    <>
      <ul className="kp-rows">
        {list.map((s) => (
          <li key={s.id}>
            <StoryRow story={s} />
          </li>
        ))}
      </ul>
      <p className="kp-panel-more">
        <LinkButton to="/journal" tone="ghost" size="sm">
          Open the journal
        </LinkButton>
      </p>
    </>
  );
}
