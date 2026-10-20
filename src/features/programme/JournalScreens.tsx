import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ArtworkView } from '@/domain/types';
import { useQuery, useViewer } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, SiteFooter, Skeleton, TopBar, WallLabel } from '@/ui';
import { imageSrc, PageHead, Poster, SampleTag, SectionHead, StoryCard, workImage } from './shared';
import { formatDay, paragraphs, STORY_KIND_LABEL } from './format';

export function JournalScreen() {
  const q = useQuery(async (data, viewer) => {
    const [stories, works] = await Promise.all([data.listStories(viewer), data.listArtworks(viewer)]);
    return { stories, works };
  }, []);
  const byId = useMemo(() => new Map((q.data?.works ?? []).map((w) => [w.id, w])), [q.data]);
  const stories = q.data?.stories ?? [];
  const [lead, ...rest] = stories;
  const fallback = (ids: string[]) => workImage(ids.map((id) => byId.get(id)).find(Boolean));

  return (
    <div className="screen kp-page">
      <TopBar title="Journal" home subordinate />
      <main className="container container--wide kp-main">
        <PageHead eyebrow="Kofi Collections · Journal" title="Journal" lede="Interviews, studio visits and news from Kofi Collections and the artists in the collection." />
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading">
            <Skeleton h={360} />
          </div>
        ) : !lead ? (
          <EmptyState title="No stories yet" body="Interviews and news will appear here." actions={<LinkButton to="/works">Browse works</LinkButton>} />
        ) : (
          <>
            <section aria-labelledby="kp-lead-story" className="kp-journal-lead">
              <h2 id="kp-lead-story" className="sr-only">
                Latest story
              </h2>
              <StoryCard story={lead} image={fallback(lead.artworkIds)} lead />
            </section>
            {rest.length > 0 && (
              <section className="kp-block kp-block--tight" aria-labelledby="kp-more-stories">
                <SectionHead id="kp-more-stories" title="More from the journal" tone="gold" />
                <ul className="kp-storygrid">
                  {rest.map((s) => (
                    <li key={s.id}>
                      <StoryCard story={s} image={fallback(s.artworkIds)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export function StoryScreen() {
  const { id = '' } = useParams();
  const viewer = useViewer();
  const q = useQuery(async (data, v) => {
    const story = await data.getStory(v, id);
    if (!story) return { story };
    const [all, artist] = await Promise.all([data.listArtworks(v), story.artistId ? data.getArtist(v, story.artistId) : Promise.resolve(undefined)]);
    const byId = new Map(all.map((w) => [w.id, w]));
    return { story, artist, works: story.artworkIds.map((w) => byId.get(w)).filter((w): w is ArtworkView => !!w) };
  }, [id]);
  const story = q.data?.story && q.data.story.id === id ? q.data.story : undefined;

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
        <div className="stack" aria-busy="true" aria-label="Loading story">
          <Skeleton h={24} w="20%" />
          <Skeleton h={80} w="80%" />
          <Skeleton h={360} />
        </div>
      </Shell>
    );
  }
  if (!story) {
    return (
      <Shell>
        <div className="kp-notfound">
          <h1 className="kp-head__title">Story not found</h1>
          <EmptyState title="This story isn’t available" body="The link may be wrong, or the story is not published." actions={<LinkButton to="/journal">The journal</LinkButton>} />
        </div>
      </Shell>
    );
  }

  const works = q.data.works ?? [];
  const artist = q.data.artist;
  const hero = story.image ?? workImage(works[0]);
  const heroSrc = imageSrc(hero);

  return (
    <div className="screen kp-page kp-article">
      <TopBar title="Journal" back="/journal" subordinate />
      <main>
        <article>
          <header className="container kp-article__head">
            {!story.published && viewer.role === 'admin' && (
              <p className="kp-draft">
                <Icon.Lock /> Draft · only Kofi staff can see this story
              </p>
            )}
            <p className="kp-eyebrow-row kp-article__kicker">
              <span className="eyebrow eyebrow--gold">{STORY_KIND_LABEL[story.kind]}</span>
              {story.sample && <SampleTag />}
            </p>
            <h1 className="kp-article__title">{story.title}</h1>
            <p className="kp-article__dek">{story.dek}</p>
            <p className="kp-article__byline">
              <span>By {story.author}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={story.publishedOn}>{formatDay(story.publishedOn)}</time>
            </p>
          </header>
          <figure className="container container--wide kp-article__hero">
            {heroSrc && hero ? (
              <>
                <img src={heroSrc} alt={hero.alt} />
                {hero.credit && <figcaption className="kp-credit">{works[0] && !story.image ? `${works[0].title} · ` : ''}© {hero.credit}</figcaption>}
              </>
            ) : (
              <Poster title={story.title} kicker={STORY_KIND_LABEL[story.kind]} meta={formatDay(story.publishedOn)} size="lg" />
            )}
          </figure>
          <div className="container kp-article__body kp-prose kp-prose--article">
            {paragraphs(story.body).map((p, i) =>
              p.kind === 'quote' ? (
                <blockquote key={i} className="kp-pull">
                  <p>{p.text}</p>
                  {artist && <cite>{artist.workingName}</cite>}
                </blockquote>
              ) : (
                <p key={i} className={i === 0 ? 'kp-prose__first' : undefined}>
                  {p.text}
                </p>
              ),
            )}
          </div>

          {(artist || works.length > 0) && (
            <footer className="container container--wide kp-article__related">
              {artist && (
                <Link to={`/artists/${artist.id}`} className="kp-artistcard">
                  <span className="eyebrow">In this story</span>
                  <span className="kp-artistcard__name">{artist.workingName}</span>
                  <span className="kp-meta">{[artist.regionLabel, artist.mediums.join(', ')].filter(Boolean).join(' · ')}</span>
                  <span className="kp-artistcard__bio">{artist.bio}</span>
                  <span className="kp-more">
                    View profile
                    <Icon.ArrowRight />
                  </span>
                </Link>
              )}
              {works.length > 0 && (
                <section aria-labelledby="kp-story-works" className="kp-article__works">
                  <SectionHead id="kp-story-works" title="Works in this story" />
                  <ul className="kg-rail kp-rail">
                    {works.map((w) => (
                      <li key={w.id}>
                        <WallLabel work={w} to={`/work/${w.id}`} unit={w.dimensions.unit} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </footer>
          )}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="screen kp-page">
      <TopBar title="Journal" back="/journal" subordinate />
      <main className="container container--wide kp-main">{children}</main>
    </div>
  );
}
