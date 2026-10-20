import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { ArtworkView, Unit } from '@/domain/types';
import { formatDimensions, formatPrice } from '@/domain/units';
import { useQuery, useViewer } from '@/state/session';
import { Avatar, Button, EmptyState, ErrorState, FictionalFooter, Icon, LinkButton, Skeleton, Tag, TopBar, VisibilityBadge, WallLabel } from '@/ui';
import { cap, isVerifiedCurator, useLoad } from './helpers';
import { IntroSheet } from './IntroSheet';
import { CuratorAccessNotice } from './notices';
import { ShortlistSheet } from './ShortlistSheet';

/** "152 × 122 × 4 cm (59.8 × 48 × 1.6 in)": the artist's own unit first, then the other. */
export function bothUnits(d: ArtworkView['dimensions']): string {
  const other: Unit = d.unit === 'cm' ? 'in' : 'cm';
  return `${formatDimensions(d, d.unit)} (${formatDimensions(d, other)})`;
}

export function ArtworkScreen() {
  const { id = '' } = useParams();
  // getArtwork can write an audit event (admin opening a private record), so it must not re-run on data changes.
  const q = useLoad((data, viewer) => data.getArtwork(viewer, id), [id]);
  const work = q.data && q.data.id === id ? q.data : undefined;
  const pending = q.loading && !work;
  // Deep links have no in-app history; send "Back" to the gallery instead of out of the app.
  const loc = useLocation();
  const back = loc.key === 'default' ? '/' : true;

  return (
    <div className="screen">
      <TopBar title="Artwork" back={back} subordinate={!!work} />
      <main className="container container--wide kg-detail">
        {q.error && !work ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : pending ? (
          <DetailSkeleton />
        ) : !work ? (
          <EmptyState
            title="This work isn't available"
            body="The link may be wrong, or the work is not published. Browse the gallery for work you can see."
            actions={<LinkButton to="/">Back to the gallery</LinkButton>}
          />
        ) : (
          <ArtworkDetail work={work} />
        )}
        <FictionalFooter />
      </main>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading artwork">
      <Skeleton h={320} />
      <Skeleton h={18} w="30%" />
      <Skeleton h={36} w="80%" />
      <Skeleton h={16} w="50%" />
      <Skeleton h={120} />
    </div>
  );
}

function ArtworkDetail({ work }: { work: ArtworkView }) {
  const viewer = useViewer();
  const [imageId, setImageId] = useState<string>();
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

  useEffect(() => setImageId(undefined), [work.id]);

  const primary = work.images.find((i) => i.isPrimary) ?? work.images[0];
  const shown = work.images.find((i) => i.id === imageId) ?? primary;
  const verified = isVerifiedCurator(viewer);
  const isOwner = work.canEdit && viewer.role === 'artist';
  const isAdmin = work.canEdit && viewer.role === 'admin';

  const artist = useQuery((data, v) => data.getArtist(v, work.artistId), [work.artistId]);
  const more = useQuery((data, v) => data.listArtistArtworks(v, work.artistId), [work.artistId]);
  const others = (more.data ?? []).filter((w) => w.id !== work.id);

  return (
    <article className="stack--lg kg-artwork" data-medium={work.medium}>
      <div className="stack kg-artwork__media">
        <div className="hero-img" data-medium={work.medium}>
          {shown ? <img src={shown.src} alt={shown.alt} /> : <div className="kg-noimg">No image yet</div>}
        </div>
        {work.images.length > 1 && (
          <div className="image-strip" role="group" aria-label="Images">
            {work.images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                className="kg-thumb"
                aria-pressed={img.id === shown?.id}
                aria-label={`Show image ${i + 1} of ${work.images.length}: ${img.alt}`}
                onClick={() => setImageId(img.id)}
              >
                <img src={img.src} alt="" aria-current={img.id === shown?.id ? 'true' : undefined} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stack--lg kg-artwork__label">
        <header className="kg-artwork__head">
          <span className="kicker">{cap(work.medium)}</span>
          <h1 className="h1 kg-title">{work.title}</h1>
          <p className="kg-byline">
            <Link to={`/artists/${work.artistId}`}>{work.artistWorkingName}</Link>
            <span className="muted">, {work.year}</span>
          </p>
          {work.price ? (
            <p className="kg-price">{formatPrice(work.price.amount, work.price.currency)}</p>
          ) : work.priceWithheld ? (
            <p className="kg-price kg-price--withheld">Price on request</p>
          ) : null}
          {work.canEdit && (
            <div className="row row--wrap" aria-label="Who can see this">
              <VisibilityBadge level={work.visibility} prefix="Record" />
              <VisibilityBadge level={work.priceVisibility} prefix="Price" />
            </div>
          )}
        </header>

        {work.description && (
          <div className="prose">
            <p>{work.description}</p>
          </div>
        )}

        <dl className="spec kg-spec">
          <dt>Medium</dt>
          <dd>{cap(work.medium)}</dd>
          <dt>Materials</dt>
          <dd>{work.materials.length ? work.materials.join(', ') : <span className="muted">Not listed</span>}</dd>
          <dt>Dimensions</dt>
          <dd>
            {bothUnits(work.dimensions)}
            <span className="tiny muted kg-block">
              Height × width
              {work.dimensions.depth !== undefined ? ' × depth' : ''}
            </span>
          </dd>
          <dt>Status</dt>
          <dd>{cap(work.status)}</dd>
          <dt>Rights</dt>
          <dd>{work.rightsNote || <span className="muted">No note</span>}</dd>
          {work.tags.length > 0 && (
            <>
              <dt>Tags</dt>
              <dd>
                <span className="chips">
                  {work.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </span>
              </dd>
            </>
          )}
        </dl>

        {(isOwner || isAdmin || verified) && (
          <div className="sticky-actions kg-actions">
            {isOwner && (
              <LinkButton to={`/studio/work/${work.id}`} icon={<Icon.Edit />} block>
                Edit in studio
              </LinkButton>
            )}
            {isAdmin && (
              <LinkButton to={`/admin/artists/${work.artistId}`} icon={<Icon.Admin />} block>
                Review in Kofi admin
              </LinkButton>
            )}
            {verified && (
              <>
                <Button tone="secondary" icon={<Icon.Shortlist />} onClick={() => setShortlistOpen(true)} aria-haspopup="dialog">
                  Add to shortlist
                </Button>
                <Button icon={<Icon.Mail />} onClick={() => setIntroOpen(true)} aria-haspopup="dialog">
                  Request introduction
                </Button>
              </>
            )}
          </div>
        )}
        {!work.canEdit && <CuratorAccessNotice viewer={viewer} />}

        {artist.data && (
          <section className="panel kg-artist-card" aria-labelledby="kg-about">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Avatar name={artist.data.workingName} color={artist.data.avatarColor} />
              <div className="stack--sm" style={{ minWidth: 0, flex: 1 }}>
                <h2 id="kg-about" className="h3">
                  About {artist.data.workingName}
                </h2>
                <p className="small muted">{[artist.data.regionLabel, cap(artist.data.careerStage)].filter(Boolean).join(', ')}</p>
                <p className="small">{artist.data.bio}</p>
                <Link to={`/artists/${artist.data.id}`} className="small strong">
                  View profile
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>

      {others.length > 0 && (
        <section className="stack--lg kg-artwork__more" aria-labelledby="kg-more">
          <h2 id="kg-more" className="h2 kg-sec-title">
            More by {work.artistWorkingName}
          </h2>
          <ul className="kg-rail">
            {others.map((w) => (
              <li key={w.id}>
                <WallLabel
                  work={w}
                  to={`/work/${w.id}`}
                  unit={work.dimensions.unit}
                  corner={w.canEdit && w.visibility !== 'public' ? <VisibilityBadge level={w.visibility} /> : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {verified && (
        <>
          <ShortlistSheet open={shortlistOpen} onClose={() => setShortlistOpen(false)} artworkId={work.id} artworkTitle={work.title} />
          <IntroSheet
            open={introOpen}
            onClose={() => setIntroOpen(false)}
            artistId={work.artistId}
            artistName={work.artistWorkingName}
            artworkId={work.id}
            artworkTitle={work.title}
          />
        </>
      )}
    </article>
  );
}
