import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { FILTER_TAG_CATEGORIES, SOCIAL_IMPACT_BOUNDARY, categoryLabel, groupTagIds, tagDef, tagLabel } from '@/domain/taxonomy';
import type { ArtworkView, Unit } from '@/domain/types';
import { EDITION_LABEL, ORIENTATION_LABEL, USE_KEYS, USE_LABEL } from '@/domain/types';
import { formatDimensions, formatPrice } from '@/domain/units';
import { useQuery, useViewer } from '@/state/session';
import { useToast } from '@/state/toast';
import { Avatar, Button, EmptyState, ErrorState, FictionalFooter, Icon, LinkButton, SaveButton, Skeleton, TopBar, VisibilityBadge, WallLabel } from '@/ui';
import { CollectorInquirySheet } from '@/features/programme/CollectorInquirySheet';
import { ViewInRoomSheet } from '@/features/programme/ViewInRoomSheet';
import { useSaved } from '@/features/programme/saved';
import { formatDateRange } from '@/features/programme/format';
import { exhibitionPhase } from '@/domain/programme';
import { FILTER_COPY as C } from './filterCopy';
import { cap, isVerifiedCurator, useLoad } from './helpers';
import { worksTagHref } from './params';
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
  const back = loc.key === 'default' ? '/works' : true;

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
            body="The link may be wrong, or the work is not published. Browse the collection for work you can see."
            actions={<LinkButton to="/works">Browse the works</LinkButton>}
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
  const [roomOpen, setRoomOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const saved = useSaved();
  const toast = useToast();
  const isSaved = saved.has(work.id);
  const toggleSave = () => {
    const now = saved.toggle(work.id);
    if (now) toast.push('Saved on this device', 'success', { label: 'View', to: '/saved' });
    else toast.push('Removed from saved', 'info');
  };

  useEffect(() => setImageId(undefined), [work.id]);

  const primary = work.images.find((i) => i.isPrimary) ?? work.images[0];
  const shown = work.images.find((i) => i.id === imageId) ?? primary;
  const verified = isVerifiedCurator(viewer);
  const isOwner = work.canEdit && viewer.role === 'artist';
  const isAdmin = work.canEdit && viewer.role === 'admin';
  // Collectors, visitors, other artists and pending curators ask Kofi; verified curators keep the introduction request as primary.
  const askPrimary = !isOwner && !isAdmin && !verified;

  const artist = useQuery((data, v) => data.getArtist(v, work.artistId), [work.artistId]);
  const more = useQuery((data, v) => data.listArtistArtworks(v, work.artistId), [work.artistId]);
  const others = (more.data ?? []).filter((w) => w.id !== work.id);
  const shows = useQuery((data, v) => data.listExhibitions(v), []);
  const onView = (shows.data ?? []).filter((x) => x.published && x.artworkIds.includes(work.id) && exhibitionPhase(x) !== 'past');

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
          {onView.map((x) => (
            <Link key={x.id} to={`/exhibitions/${x.id}`} className="kp-onview">
              <span className="eyebrow eyebrow--green">{exhibitionPhase(x) === 'current' ? 'On view' : 'Coming up'}</span>
              <span className="kp-onview__title">{x.title}</span>
              <span className="kp-meta">{formatDateRange(x.startsOn, x.endsOn)}</span>
            </Link>
          ))}
          <div className="kp-worktools" role="group" aria-label="This work">
            <SaveButton saved={isSaved} onToggle={toggleSave} size="sm" />
            <Button tone="secondary" size="sm" icon={<Icon.Room />} onClick={() => setRoomOpen(true)} aria-haspopup="dialog">
              View in a room
            </Button>
          </div>
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
          <dt>{C.orientationLabel}</dt>
          <dd>{ORIENTATION_LABEL[work.orientation]}</dd>
          {work.edition && (
            <>
              <dt>{C.editionLabel}</dt>
              <dd>
                {EDITION_LABEL[work.edition.type]}
                {work.edition.number !== undefined && work.edition.size !== undefined && <span className="muted">, {C.editionNumber(work.edition.number, work.edition.size)}</span>}
              </dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{cap(work.status)}</dd>
          <dt>{C.usesLabel}</dt>
          <dd>{USE_KEYS.some((u) => work.uses[u]) ? USE_KEYS.filter((u) => work.uses[u]).map((u) => USE_LABEL[u]).join(', ') : <span className="muted">{C.usesNone}</span>}</dd>
          <dt>Rights</dt>
          <dd>{work.rightsNote || <span className="muted">No note</span>}</dd>
        </dl>

        <WorkTags work={work} />

        {askPrimary && (
          <div className="sticky-actions kg-actions">
            <Button icon={<Icon.Mail />} onClick={() => setAskOpen(true)} aria-haspopup="dialog" block>
              Ask Kofi about this work
            </Button>
          </div>
        )}
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
        {verified && (
          <p className="kp-askline">
            Buying or placing this work rather than showing it?{' '}
            <button type="button" className="kp-linkbtn" onClick={() => setAskOpen(true)} aria-haspopup="dialog">
              Ask Kofi about this work
            </button>
          </p>
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

      <ViewInRoomSheet open={roomOpen} onClose={() => setRoomOpen(false)} work={work} />
      {!isOwner && !isAdmin && (
        <CollectorInquirySheet open={askOpen} onClose={() => setAskOpen(false)} artwork={{ id: work.id, title: work.title, artistName: work.artistWorkingName }} />
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

/** The artist's controlled tags as grouped chip rows; each chip opens Works filtered by that tag. Keywords sit quietly underneath. */
export function WorkTags({ work }: { work: Pick<ArtworkView, 'tagIds' | 'tags'> }) {
  const grouped = groupTagIds(work.tagIds);
  const order = [...FILTER_TAG_CATEGORIES, ...Object.keys(grouped).filter((c) => !(FILTER_TAG_CATEGORIES as readonly string[]).includes(c))];
  const rows = order.filter((c) => grouped[c]?.length);
  if (!rows.length && !work.tags.length) return null;
  return (
    <section className="kg-wtags" aria-labelledby="kg-wtags-title">
      <h2 id="kg-wtags-title" className="eyebrow kg-wtags__title">
        {C.tagsTitle}
      </h2>
      {rows.map((cat) => {
        const social = cat === 'social_impact';
        return (
          <div key={cat} className="kg-wtags__row" data-category={cat} title={social ? SOCIAL_IMPACT_BOUNDARY : undefined}>
            <h3 className="kg-wtags__cat" id={`kg-wtags-${cat}`}>
              {categoryLabel(cat)}
            </h3>
            {social && <p className="small muted kg-wtags__lede">{C.socialImpactLede}</p>}
            <ul className="chips kg-wtags__chips" aria-labelledby={`kg-wtags-${cat}`}>
              {grouped[cat]!.map((id) => (
                <li key={id}>
                  <Link
                    to={worksTagHref(id)}
                    className="chip chip--small kg-wtag"
                    title={social ? [tagDef(id)?.definition, SOCIAL_IMPACT_BOUNDARY].filter(Boolean).join(' ') : C.tagLinkTitle(tagLabel(id))}
                  >
                    {tagLabel(id)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {work.tags.length > 0 && (
        <p className="small muted kg-wtags__keywords">
          <span className="kg-wtags__kwlabel">{C.keywordsLabel}</span> {work.tags.join(', ')}
        </p>
      )}
    </section>
  );
}
