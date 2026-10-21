import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ApplicationRow, Institution } from '@/domain/types';
import { CALL_KIND_LABEL } from '@/domain/types';
import { callPhase, exhibitionPhase, kofiToday } from '@/domain/programme';
import { useQuery } from '@/state/session';
import {
  CALL_PHASE_LABEL,
  deadlineLabel,
  EVENT_KIND_LABEL,
  EXHIBITION_PHASE_LABEL,
  formatDateRange,
  formatDay,
  formatEventTime,
  STORY_KIND_LABEL,
} from '@/features/programme/format';
import { EmptyState, ErrorState, Icon, LinkButton, Segmented, Skeleton, TopBar } from '@/ui';
import { isProgrammeKind, KIND_LABEL, KIND_SINGULAR, PROGRAMME_KINDS, type ProgrammeKind } from './programmeShared';
import './admin.css';
import './programme.css';

interface Row {
  id: string;
  title: string;
  line: string;
  phase?: { label: string; tone: 'now' | 'soon' | 'past' };
  draft: boolean;
  sample: boolean;
  extra?: string;
  image?: string;
}

export function AdminProgramme() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: ProgrammeKind = isProgrammeKind(raw) ? raw : 'exhibitions';

  const q = useQuery(async (ds, v) => {
    const [exhibitions, calls, events, stories, apps, institutions] = await Promise.all([
      ds.listExhibitions(v),
      ds.listOpenCalls(v),
      ds.listEvents(v),
      ds.listStories(v),
      ds.listApplications(v).catch(() => [] as ApplicationRow[]),
      ds.listInstitutions(v).catch(() => [] as Institution[]),
    ]);
    const instName = new Map(institutions.map((i) => [i.id, i.name]));
    const today = kofiToday();
    const rows: Record<ProgrammeKind, Row[]> = {
      exhibitions: exhibitions.map((x) => {
        const p = exhibitionPhase(x, today);
        return {
          id: x.id,
          title: x.title,
          line: [formatDateRange(x.startsOn, x.endsOn), x.venue?.name].filter(Boolean).join(' · '),
          phase: { label: EXHIBITION_PHASE_LABEL[p], tone: p === 'current' ? 'now' : p === 'upcoming' ? 'soon' : 'past' },
          draft: !x.published,
          sample: x.sample,
          extra: x.artworkIds.length ? `${x.artworkIds.length} ${x.artworkIds.length === 1 ? 'work' : 'works'}` : undefined,
          image: x.image?.src,
        };
      }),
      calls: calls.map((c) => {
        const p = callPhase(c, today);
        const n = apps.filter((a) => a.callId === c.id).length;
        return {
          id: c.id,
          title: c.title,
          // Kind · who runs it · deadline. A partner institution organises; otherwise Kofi runs it (with any named partner).
          line: [
            CALL_KIND_LABEL[c.kind ?? 'exhibition'],
            c.organizerInstitutionId
              ? `Run by ${instName.get(c.organizerInstitutionId) ?? c.partner ?? 'a partner'}`
              : c.partner && c.partner !== 'Kofi Collections'
                ? `Kofi with ${c.partner}`
                : 'Kofi Collections',
            deadlineLabel(c, today),
          ].join(' · '),
          phase: { label: CALL_PHASE_LABEL[p], tone: p === 'open' ? 'now' : p === 'upcoming' ? 'soon' : 'past' },
          draft: !c.published,
          sample: c.sample,
          extra: c.externalUrl ? 'Partner form' : `${n} ${n === 1 ? 'application' : 'applications'}`,
          image: c.image?.src,
        };
      }),
      events: events
        .slice()
        .sort((a, b) => {
          const pa = Date.parse(a.endsAt ?? a.startsAt) < Date.now();
          const pb = Date.parse(b.endsAt ?? b.startsAt) < Date.now();
          if (pa !== pb) return pa ? 1 : -1;
          return pa ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt);
        })
        .map((e) => {
          const past = Date.parse(e.endsAt ?? e.startsAt) < Date.now();
          return {
            id: e.id,
            title: e.title,
            line: [formatEventTime(e.startsAt, e.endsAt), e.venue?.name].filter(Boolean).join(' · '),
            phase: { label: past ? 'Past' : EVENT_KIND_LABEL[e.kind], tone: past ? 'past' : 'soon' },
            draft: !e.published,
            sample: e.sample,
          };
        }),
      stories: stories.map((s) => ({
        id: s.id,
        title: s.title,
        line: [s.author, formatDay(s.publishedOn)].join(' · '),
        phase: { label: STORY_KIND_LABEL[s.kind], tone: 'now' },
        draft: !s.published,
        sample: s.sample,
        image: s.image?.src,
      })),
    };
    return rows;
  });

  const setTab = (t: ProgrammeKind) => {
    const p = new URLSearchParams(params);
    if (t === 'exhibitions') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
  };

  const rows = q.data?.[tab] ?? [];
  const drafts = rows.filter((r) => r.draft).length;

  return (
    <div className="screen">
      <TopBar title="Programme" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
          <aside className="ad-split__aside stack">
            <p className="eyebrow eyebrow--gold">Kofi desk</p>
            <h2 className="h1">Programme</h2>
            <span className="rule" aria-hidden="true" />
            <p className="ad-lede" style={{ marginTop: 0 }}>
              Exhibitions, open calls, events and the journal. Drafts stay on this desk until you publish them.
            </p>
            <div className="seg-wrap pg-tabs">
              <Segmented<ProgrammeKind>
                label="Programme section"
                value={tab}
                onChange={setTab}
                options={PROGRAMME_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            </div>
            <LinkButton to={`/admin/programme/${tab}/new`} icon={<Icon.Plus />}>
              New {KIND_SINGULAR[tab]}
            </LinkButton>
          </aside>

          <div className="ad-split__main stack">
            <div className="row row--between row--wrap">
              <h2 className="group-title">
                {KIND_LABEL[tab]}
                {q.data && <span className="group-title__count">{rows.length}</span>}
              </h2>
              {drafts > 0 && <span className="small muted">{drafts === 1 ? '1 draft' : `${drafts} drafts`}</span>}
            </div>
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading programme">
                <Skeleton h={88} />
                <Skeleton h={88} />
                <Skeleton h={88} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={`No ${KIND_LABEL[tab].toLowerCase()} yet`}
                body="Start a draft. Nothing is public until you switch Published on."
                actions={<LinkButton to={`/admin/programme/${tab}/new`}>New {KIND_SINGULAR[tab]}</LinkButton>}
              />
            ) : (
              <ul className="list pg-list" aria-label={KIND_LABEL[tab]}>
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link to={`/admin/programme/${tab}/${r.id}`} className="list-row pg-row">
                      {r.image ? <img className="thumb pg-row__thumb" src={r.image} alt="" /> : <span className="thumb pg-row__thumb pg-row__thumb--empty" aria-hidden="true" />}
                      <span className="list-row__main">
                        <span className="pg-row__badges">
                          {r.phase && <Badge tone={r.phase.tone}>{r.phase.label}</Badge>}
                          {r.draft && <Badge tone="draft">Draft</Badge>}
                          {r.sample && <Badge tone="sample">Sample</Badge>}
                        </span>
                        <span className="pg-row__title">{r.title}</span>
                        <span className="list-row__sub">
                          {r.line}
                          {r.extra ? ` · ${r.extra}` : ''}
                        </span>
                      </span>
                      <Icon.Edit className="pg-row__go" aria-hidden="true" />
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

export function Badge({ tone, children }: { tone: 'now' | 'soon' | 'past' | 'draft' | 'sample'; children: ReactNode }) {
  return <span className={`pg-badge pg-badge--${tone}`}>{children}</span>;
}
