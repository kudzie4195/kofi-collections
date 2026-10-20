import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import type { ArtistView } from '@/domain/types';
import { useQuery, useViewer } from '@/state/session';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  FictionalFooter,
  GallerySkeleton,
  Icon,
  LinkButton,
  Notice,
  Skeleton,
  Tag,
  TopBar,
  VisibilityBadge,
  WallLabel,
} from '@/ui';
import { cap, hostOf, isVerifiedCurator, plural, safeHref } from './helpers';
import { IntroSheet } from './IntroSheet';
import { CuratorAccessNotice } from './notices';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export function ArtistScreen() {
  const { id = '' } = useParams();
  const q = useQuery((data, viewer) => data.getArtist(viewer, id), [id]);
  const artist = q.data && q.data.id === id ? q.data : undefined;
  const loc = useLocation();

  return (
    <div className="screen">
      <TopBar title="Artist" back={loc.key === 'default' ? '/artists' : true} subordinate />
      <main className="container container--wide kg-detail">
        {q.error && !artist ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : q.loading && !artist ? (
          <div className="stack" aria-busy="true" aria-label="Loading artist">
            <div className="row">
              <Skeleton h={72} w={72} style={{ borderRadius: 999 }} />
              <div className="stack--sm" style={{ flex: 1 }}>
                <Skeleton h={28} w="70%" />
                <Skeleton h={14} w="40%" />
              </div>
            </div>
            <Skeleton h={96} />
          </div>
        ) : !artist ? (
          <EmptyState
            title="This artist isn't available"
            body="The link may be wrong, or the profile is not published."
            actions={<LinkButton to="/artists">See all artists</LinkButton>}
          />
        ) : (
          <ArtistProfile artist={artist} />
        )}
        <FictionalFooter />
      </main>
    </div>
  );
}

function ArtistProfile({ artist }: { artist: ArtistView }) {
  const viewer = useViewer();
  const [introOpen, setIntroOpen] = useState(false);
  const works = useQuery((data, v) => data.listArtistArtworks(v, artist.id), [artist.id]);
  const verified = isVerifiedCurator(viewer);
  const isOwner = artist.canEdit && viewer.role === 'artist';
  const isAdmin = artist.canEdit && viewer.role === 'admin';
  const lead = artist.mediums[0];
  const exp = artist.experience;
  const availability = [
    artist.availability.commissions && 'Open to commissions',
    artist.availability.sales && 'Open to sales',
    artist.availability.exhibitions && 'Open to exhibitions',
  ].filter((x): x is string => Boolean(x));
  const links = artist.links.map((l) => ({ ...l, href: safeHref(l.url) })).filter((l): l is typeof l & { href: string } => Boolean(l.href));
  const unpublished = artist.status !== 'approved' || artist.visibility !== 'public';

  return (
    <div className="stack--lg kg-artist">
      <div className="stack--lg kg-artist__aside">
        <header className="kg-profile" data-medium={lead}>
          <div className="kg-profile__top">
            <Avatar name={artist.workingName} color={artist.avatarColor} size="lg" />
            <div className="kg-profile__id">
              <h1 className="h1 kg-title">{artist.workingName}</h1>
              <p className="kg-profile__meta">{[artist.pronouns, artist.regionLabel].filter(Boolean).join(', ')}</p>
            </div>
          </div>
          <div className="chips">
            <Tag>{cap(artist.careerStage)}</Tag>
            {artist.mediums.map((m) => (
              <Tag key={m} medium={m}>
                {cap(m)}
              </Tag>
            ))}
          </div>
          {availability.length > 0 && (
            <div className="chips" aria-label="Availability">
              {availability.map((a) => (
                <Tag key={a}>
                  <Icon.Check width={12} height={12} aria-hidden="true" />
                  {a}
                </Tag>
              ))}
            </div>
          )}
        </header>

        {artist.canEdit && unpublished && (
          <Notice tone="butter" icon={<Icon.EyeOff />}>
            {artist.status === 'pending'
              ? 'This profile is waiting for Kofi review. Only you and Kofi staff can see it until it is approved.'
              : artist.status === 'approved'
                ? 'This profile is hidden from the public. Only you and Kofi staff can see it.'
                : 'This profile is not published. Only you and Kofi staff can see it.'}
          </Notice>
        )}

        {(isOwner || isAdmin || verified) && (
          <div className="row row--wrap kg-actions kg-actions--inline">
            {isOwner && (
              <LinkButton to="/studio/profile" icon={<Icon.Edit />}>
                Edit profile
              </LinkButton>
            )}
            {isAdmin && (
              <LinkButton to={`/admin/artists/${artist.id}`} icon={<Icon.Admin />}>
                Review in Kofi admin
              </LinkButton>
            )}
            {verified && (
              <Button icon={<Icon.Mail />} onClick={() => setIntroOpen(true)} aria-haspopup="dialog">
                Request introduction
              </Button>
            )}
          </div>
        )}
        {!artist.canEdit && <CuratorAccessNotice viewer={viewer} />}

        <section className="stack" aria-labelledby="kg-bio">
          <h2 id="kg-bio" className="h2 kg-sec-title">
            About
          </h2>
          <div className="prose">
            <p>{artist.bio}</p>
          </div>
          {artist.statement && (
            <figure className="kg-statement" data-medium={lead}>
              <blockquote className="prose">
                <p>{artist.statement}</p>
              </blockquote>
              <figcaption className="small muted">Artist statement</figcaption>
            </figure>
          )}
        </section>
      </div>

      <div className="stack--lg kg-artist__main" data-medium={lead}>
        <section className="stack" aria-labelledby="kg-works">
          <div className="row row--between kg-works-head">
            <h2 id="kg-works" className="h2 kg-sec-title">
              Works
            </h2>
            {works.data && <span className="eyebrow">{plural(works.data.length, 'work')}</span>}
          </div>
          {works.error && !works.data ? (
            <ErrorState error={works.error} retry={works.reload} />
          ) : !works.data ? (
            <GallerySkeleton n={4} />
          ) : works.data.length === 0 ? (
            <EmptyState
              title="No published works yet"
              body={isOwner ? 'Add your first work in the studio. You choose who can see it.' : `${artist.workingName} hasn’t published any work yet.`}
              actions={isOwner ? <LinkButton to="/studio/work/new">Add a work</LinkButton> : undefined}
            />
          ) : (
            <ul className="gallery-grid" aria-label={`Works by ${artist.workingName}`}>
              {works.data.map((w) => (
                <li key={w.id}>
                  <WallLabel
                    work={w}
                    to={`/work/${w.id}`}
                    unit={w.dimensions.unit}
                    corner={w.canEdit && w.visibility !== 'public' ? <VisibilityBadge level={w.visibility} /> : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="stack--sm" aria-labelledby="kg-exp">
          <h2 id="kg-exp" className="h2 kg-sec-title">
            Experience
          </h2>
          <dl className="spec">
            <dt>Commissions</dt>
            <dd>{yesNo(exp.commissions)}</dd>
            <dt>Public art</dt>
            <dd>{yesNo(exp.publicArt)}</dd>
            <dt>Residencies</dt>
            <dd>{yesNo(exp.residencies)}</dd>
            <dt>Institutional shows</dt>
            <dd>{yesNo(exp.institutionalShows)}</dd>
            {exp.yearsPracticing !== undefined && (
              <>
                <dt>Years practicing</dt>
                <dd>{exp.yearsPracticing}</dd>
              </>
            )}
          </dl>
        </section>

        {links.length > 0 && (
          <section className="stack--sm" aria-labelledby="kg-links">
            <h2 id="kg-links" className="h2 kg-sec-title">
              Links
            </h2>
            <ul className="list">
              {links.map((l) => (
                <li key={l.href}>
                  <a className="list-row" href={l.href} target="_blank" rel="noopener noreferrer">
                    <Icon.Globe width={20} height={20} aria-hidden="true" />
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        {l.label || hostOf(l.href)}
                      </span>
                      <span className="list-row__sub">{hostOf(l.href)}</span>
                    </span>
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {verified && <IntroSheet open={introOpen} onClose={() => setIntroOpen(false)} artistId={artist.id} artistName={artist.workingName} />}
    </div>
  );
}
