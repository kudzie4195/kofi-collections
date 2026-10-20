import { useMemo } from 'react';
import bundledArt from 'virtual:bundled-art';
import { Link } from 'react-router-dom';
import type { ArtworkView, Exhibition, OpenCall, ProgrammeEvent, Story } from '@/domain/types';
import { callPhase, exhibitionPhase } from '@/domain/programme';
import { useQuery } from '@/state/session';
import { Icon, LinkButton, SiteFooter, TopBar, WallLabel } from '@/ui';
import { plural } from '@/features/gallery/helpers';
import { DeadlineBadge, EventRow, ExhibitionVisual, PhaseEyebrow, SampleTag, SectionHead, StoryCard, useToday, workImage } from './shared';
import { eventIsPast, formatDateRange } from './format';

const heroSrc: string = bundledArt['hero.jpg'] ?? '/art/hero.jpg';

export const SERVICES = [
  {
    id: 'artists',
    title: 'For artists',
    summary: 'Kofi buys work directly, connects you with collectors, curates exhibitions, and helps with photography, portfolios and pricing strategy.',
    tone: 'red',
  },
  {
    id: 'collectors',
    title: 'For collectors',
    summary: 'Curated selections of emerging artists, early access to exhibitions and private viewings, and transparent terms under an open-source contract.',
    tone: 'gold',
  },
  {
    id: 'organisations',
    title: 'For organisations',
    summary: 'Art for your space, from site assessment and installation to rotating loans, artist calls and the materials that explain the work.',
    tone: 'green',
  },
] as const;

interface DiscoverData {
  exhibitions: Exhibition[];
  calls: OpenCall[];
  events: ProgrammeEvent[];
  stories: Story[];
  works: ArtworkView[];
}

export function DiscoverScreen() {
  const today = useToday();
  const q = useQuery<DiscoverData>(async (data, viewer) => {
    const [exhibitions, calls, events, stories, works] = await Promise.all([
      data.listExhibitions(viewer),
      data.listOpenCalls(viewer),
      data.listEvents(viewer),
      data.listStories(viewer),
      data.listArtworks(viewer),
    ]);
    return { exhibitions, calls, events, stories, works };
  }, []);
  const d = q.data;

  const works = d?.works ?? [];
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const artistCount = useMemo(() => new Set(works.map((w) => w.artistId)).size, [works]);

  const published = (d?.exhibitions ?? []).filter((x) => x.published);
  const nowShowing = published.find((x) => exhibitionPhase(x, today) === 'current') ?? published.find((x) => exhibitionPhase(x, today) === 'upcoming');
  const openCalls = (d?.calls ?? []).filter((c) => c.published && callPhase(c, today) === 'open');
  const newest = [...works].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const stories = (d?.stories ?? []).filter((s) => s.published).slice(0, 3);
  const now = new Date();
  const upcoming = (d?.events ?? []).filter((e) => e.published && !eventIsPast(e, now)).slice(0, 3);
  const exTitle = (id?: string) => (id ? d?.exhibitions.find((x) => x.id === id)?.title : undefined);
  const featuredArtistId = nowShowing?.artworkIds.map((id) => byId.get(id)).find(Boolean)?.artistId;

  return (
    <div className="screen kp-discover">
      <TopBar title="Kofi Collections" />

      <section className="band kg-hero kp-hero" aria-labelledby="kg-hero-title">
        {heroSrc && <div className="kg-hero--photo" style={{ ['--kg-hero-img' as string]: `url("${heroSrc}")` }} aria-hidden="true" />}
        <span className="band__stripe band__stripe--1" aria-hidden="true" />
        <span className="band__stripe band__stripe--2" aria-hidden="true" />
        <span className="band__stripe band__stripe--3" aria-hidden="true" />
        <div className="container container--wide band__inner kg-hero__inner">
          <p className="eyebrow kg-hero__eyebrow">Pittsburgh · Artist-owned records</p>
          <h2 id="kg-hero-title" className="display kg-hero__title">
            <span className="kg-hero__line">Artists keep the record.</span> <span className="kg-hero__line kg-hero__line--offset">Curators find the work.</span>
          </h2>
          <p className="kg-hero__lede">
            Every work here was catalogued by the artist who made it, with price and detail shown only to the people they choose.
            {works.length > 0 && (
              <span className="kg-hero__count">
                {' '}
                {plural(works.length, 'work')} by {plural(artistCount, 'artist')}
                {openCalls.length > 0 ? ` · ${plural(openCalls.length, 'open call')}` : ''}
              </span>
            )}
          </p>
          <div className="kp-hero__ctas">
            <LinkButton to="/works">Browse the works</LinkButton>
            <LinkButton to="/whats-on" tone="secondary">
              What’s on
            </LinkButton>
          </div>
        </div>
      </section>

      <main className="kp-discover__main">
        {nowShowing && <NowShowing ex={nowShowing} today={today} byId={byId} />}

        {openCalls.length > 0 && <OpenCallBand calls={openCalls} today={today} />}

        {newest.length > 0 && (
          <section className="container container--wide kp-block" aria-labelledby="kp-new">
            <SectionHead id="kp-new" eyebrow="The collection" title="New to the collection" to="/works" linkLabel="All works" />
            <ul className="kg-rail kp-rail">
              {newest.map((w) => (
                <li key={w.id}>
                  <WallLabel work={w} to={`/work/${w.id}`} unit={w.dimensions.unit} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {featuredArtistId && <ArtistSpotlight artistId={featuredArtistId} exhibition={nowShowing} />}

        {stories.length > 0 && (
          <section className="container container--wide kp-block" aria-labelledby="kp-journal">
            <SectionHead id="kp-journal" eyebrow="Journal" title="From the journal" to="/journal" linkLabel="All stories" tone="gold" />
            <ul className="kp-storygrid">
              {stories.map((s) => (
                <li key={s.id}>
                  <StoryCard story={s} image={workImage(s.artworkIds.map((id) => byId.get(id)).find(Boolean))} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="container container--wide kp-block kp-whats" aria-labelledby="kp-whats">
            <SectionHead id="kp-whats" eyebrow="Events" title="What’s on" to="/whats-on?tab=events" linkLabel="Full programme" tone="green" />
            <ul className="kp-eventlist">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <EventRow ev={e} exhibitionTitle={exTitle(e.exhibitionId)} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="container container--wide kp-block" aria-labelledby="kp-services">
          <SectionHead id="kp-services" eyebrow="Kofi Collections" title="How Kofi works with you" to="/about" linkLabel="About Kofi" />
          <ul className="kp-services">
            {SERVICES.map((s) => (
              <li key={s.id}>
                <Link to={`/about#${s.id}`} className={`kp-service kp-service--${s.tone}`}>
                  <span className="kp-service__stroke" aria-hidden="true" />
                  <h3 className="kp-service__title">{s.title}</h3>
                  <p className="kp-service__body">{s.summary}</p>
                  <span className="kp-more">
                    Read more
                    <Icon.ArrowRight />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function NowShowing({ ex, today, byId }: { ex: Exhibition; today: string; byId: Map<string, ArtworkView> }) {
  const works = ex.artworkIds.map((id) => byId.get(id)).filter((w): w is ArtworkView => !!w);
  const phase = exhibitionPhase(ex, today);
  return (
    <section className="kp-now" aria-labelledby="kp-now-title">
      <div className="container container--wide kp-now__inner">
        <Link to={`/exhibitions/${ex.id}`} className="kp-now__media" tabIndex={-1} aria-hidden="true">
          <ExhibitionVisual ex={ex} size="lg" fallback={workImage(works[0])} />
        </Link>
        <div className="kp-now__text">
          <PhaseEyebrow ex={ex} today={today} sample={ex.sample} />
          <h2 id="kp-now-title" className="kp-now__title">
            <Link to={`/exhibitions/${ex.id}`}>{ex.title}</Link>
          </h2>
          {ex.subtitle && <p className="kp-now__sub">{ex.subtitle}</p>}
          <p className="kp-meta kp-now__meta">
            {formatDateRange(ex.startsOn, ex.endsOn)}
            {ex.venue ? ` · ${ex.venue.name}, ${ex.venue.city}` : ''}
          </p>
          <p className="kp-now__summary">{ex.summary}</p>
          {works.length > 0 && (
            <ul className="kp-now__thumbs" aria-label="Works in the exhibition">
              {works.slice(0, 4).map((w) => {
                const im = workImage(w);
                return (
                  <li key={w.id}>
                    <Link to={`/work/${w.id}`} aria-label={`${w.title} by ${w.artistWorkingName}`}>
                      {im && <img src={im.src} alt="" loading="lazy" />}
                    </Link>
                  </li>
                );
              })}
              {works.length > 4 && <li className="kp-now__more">+{works.length - 4}</li>}
            </ul>
          )}
          <LinkButton to={`/exhibitions/${ex.id}`} tone="secondary">
            {phase === 'upcoming' ? 'Preview the exhibition' : 'Visit the exhibition'}
          </LinkButton>
        </div>
      </div>
    </section>
  );
}

function OpenCallBand({ calls, today }: { calls: OpenCall[]; today: string }) {
  const [lead, ...rest] = calls;
  if (!lead) return null;
  return (
    <section className="kp-callband" aria-labelledby="kp-callband-title">
      <span className="kp-callband__strokes" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="container container--wide kp-callband__inner">
        <div className="kp-callband__main">
          <p className="kp-eyebrow-row">
            <span className="eyebrow eyebrow--gold">Open call{lead.partner ? ` · ${lead.partner}` : ''}</span>
            {lead.sample && <SampleTag />}
          </p>
          <h2 id="kp-callband-title" className="kp-callband__title">
            <Link to={`/calls/${lead.id}`}>{lead.title}</Link>
          </h2>
          <p className="kp-callband__summary">{lead.summary}</p>
        </div>
        <div className="kp-callband__side">
          <DeadlineBadge call={lead} today={today} large />
          <LinkButton to={`/calls/${lead.id}`}>Read the call</LinkButton>
          {rest.length > 0 && (
            <div className="kp-callband__also">
              <span className="eyebrow">Also open</span>
              {rest.slice(0, 2).map((c) => (
                <Link key={c.id} to={`/calls/${c.id}`}>
                  {c.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ArtistSpotlight({ artistId, exhibition }: { artistId: string; exhibition?: Exhibition }) {
  const q = useQuery(async (data, viewer) => {
    const [artist, works] = await Promise.all([data.getArtist(viewer, artistId), data.listArtistArtworks(viewer, artistId)]);
    return { artist, works: works.filter((w) => w.visibility === 'public' || !w.canEdit) };
  }, [artistId]);
  const artist = q.data?.artist;
  if (!artist) return null;
  const works = (q.data?.works ?? []).slice(0, 3);
  const quote = artist.statement || artist.bio;
  return (
    <section className="container container--wide kp-block kp-spot" aria-labelledby="kp-spot-name">
      <div className="kp-spot__text">
        <p className="eyebrow eyebrow--gold">Artist spotlight{exhibition ? ` · in ${exhibition.title}` : ''}</p>
        <h2 id="kp-spot-name" className="kp-spot__name">
          {artist.workingName}
        </h2>
        <p className="kp-meta">{[artist.regionLabel, artist.careerStage[0]!.toUpperCase() + artist.careerStage.slice(1), artist.mediums.join(', ')].filter(Boolean).join(' · ')}</p>
        {quote && (
          <blockquote className="kp-spot__quote">
            <p>{quote}</p>
          </blockquote>
        )}
        <LinkButton to={`/artists/${artist.id}`} tone="secondary">
          View {artist.workingName.split(' ')[0]}’s profile
        </LinkButton>
      </div>
      {works.length > 0 && (
        <ul className="kp-spot__works">
          {works.map((w) => (
            <li key={w.id}>
              <WallLabel work={w} to={`/work/${w.id}`} unit={w.dimensions.unit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
