import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CONSENT_VERSION, VISIBILITY_LABEL } from '@/domain/types';
import type { ArtworkView } from '@/domain/types';
import { formatPrice } from '@/domain/units';
import { useSession, useQuery } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, EmptyState, ErrorState, Icon, LinkButton, Notice, Panel, Skeleton, StatusDot, TopBar, VisibilityBadge } from '@/ui';
import { STATUS_COPY, VisibilityIcon, capitalize } from './shared';

export function StudioHome() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const q = useQuery(
    async (ds, v) => {
      const [artist, works, inquiries, docs] = await Promise.all([
        ds.getMyArtist(v),
        v.artistId ? ds.listArtistArtworks(v, v.artistId) : Promise.resolve([] as ArtworkView[]),
        ds.listInquiries(v),
        ds.listMyDocuments(v),
      ]);
      return { artist, works, inquiries, docs };
    },
    [],
  );

  if (q.error && !q.data) {
    return (
      <div className="screen">
        <TopBar title="Studio" />
        <main className="container">
          <ErrorState error={q.error} retry={q.reload} />
        </main>
      </div>
    );
  }

  if (!q.data) return <HomeSkeleton />;

  const { artist, works, inquiries, docs } = q.data;
  if (!artist) {
    return (
      <div className="screen">
        <TopBar title="Studio" />
        <main className="container">
          <EmptyState
            title="We couldn’t find your artist profile"
            body="This account isn’t linked to an artist profile yet. Switch to an artist account, or ask Kofi to finish setting you up."
            actions={<LinkButton to="/account">Switch account</LinkButton>}
          />
        </main>
      </div>
    );
  }

  const published = works.filter((w) => w.visibility === 'public').length;
  const awaiting = inquiries.filter((i) => i.status === 'forwarded').length;
  const consentCurrent = artist.consentVersion === CONSENT_VERSION;
  const status = STATUS_COPY[artist.status];
  const firstName = artist.workingName.split(/\s+/)[0] ?? artist.workingName;

  async function submit() {
    if (!consentCurrent) {
      nav('consent', { state: { next: 'submit' } });
      return;
    }
    setSubmitting(true);
    try {
      await data.submitForReview(viewer);
      toast.push('Sent to Kofi for review', 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen">
      <TopBar title="Studio" />
      <section className="band st-band">
        <div className="band__stripe band__stripe--1" aria-hidden="true" />
        <div className="band__stripe band__stripe--2" aria-hidden="true" />
        <div className="container band__inner">
          <div className="st-greeting" style={{ ['--av' as string]: artist.avatarColor }}>
            <p className="tiny strong st-greeting__kicker">Your studio</p>
            <h2 className="h1">Hello, {firstName}.</h2>
            <p className="small muted">
              Signed in as <span className="strong">{artist.workingName}</span>
            </p>
          </div>
        </div>
      </section>

      <main className="container stack--lg st-main">
        <section className="st-status" aria-label="Profile status">
          <div className="row">
            <StatusDot status={artist.status} />
            <span className="strong">{status.label}</span>
            {artist.status === 'approved' && artist.visibility !== 'public' && (
              <VisibilityBadge level={artist.visibility} prefix="Profile" />
            )}
          </div>
          <p className="small st-status__body">
            {status.body}
            {artist.status === 'approved' && artist.visibility !== 'public' && ' Your profile itself is hidden right now, so none of your work is in discovery.'}
          </p>
          {artist.status === 'draft' && (
            <Button size="sm" loading={submitting} onClick={submit}>
              Submit for review
            </Button>
          )}
        </section>

        {!consentCurrent && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            <p className="strong">Review Kofi’s artist terms</p>
            <p>
              {artist.consentVersion
                ? `The terms changed since you last agreed (you accepted ${artist.consentVersion}; the current version is ${CONSENT_VERSION}).`
                : 'You haven’t agreed to the artist terms yet. Kofi needs this before your profile can be reviewed.'}{' '}
              <Link to="consent" className="strong">
                Read and agree
              </Link>
            </p>
          </Notice>
        )}

        <ul className="tiles" aria-label="Studio at a glance">
          <li className="tile tile--cobalt">
            <div className="tile__num">{works.length}</div>
            <div className="tile__label">{works.length === 1 ? 'Work in your studio' : 'Works in your studio'}</div>
          </li>
          <li className="tile tile--lime">
            <div className="tile__num">{published}</div>
            <div className="tile__label">Public</div>
          </li>
          <li>
            <Link to="inquiries" className="tile tile--coral st-tile-link">
              <div className="tile__num">{awaiting}</div>
              <div className="tile__label">{awaiting === 1 ? 'Introduction to answer' : 'Introductions to answer'}</div>
            </Link>
          </li>
          <li>
            <Link to="vault" className="tile tile--butter st-tile-link">
              <div className="tile__num">{docs.length}</div>
              <div className="tile__label">Vault {docs.length === 1 ? 'document' : 'documents'}</div>
            </Link>
          </li>
        </ul>

        <section aria-labelledby="your-works" className="stack">
          <div className="row row--between row--wrap">
            <h2 className="h2" id="your-works">
              Your works
            </h2>
            {works.length > 0 && (
              <LinkButton to="work/new" icon={<Icon.Plus />}>
                Add a work
              </LinkButton>
            )}
          </div>
          {works.length === 0 ? (
            <EmptyState
              title="Your first work goes here"
              body="Add a photo, the materials and the size. It starts as a draft only you can see — you decide when, and to whom, it shows."
              actions={
                <LinkButton to="work/new" icon={<Icon.Plus />}>
                  Add your first work
                </LinkButton>
              }
            />
          ) : (
            <ul className="list st-works">
              {works.map((w) => (
                <li key={w.id}>
                  <WorkRow work={w} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav aria-label="Studio tools" className="st-tools">
          <h2 className="h3">Studio tools</h2>
          <ul className="list">
            <ToolRow to="profile" icon={<Icon.Person />} title="Profile" sub="Bio, mediums, region and who sees your profile" />
            <ToolRow to="vault" icon={<Icon.Lock />} title="Private vault" sub="Invoices, condition reports, provenance, appraisals" />
            <ToolRow to="inquiries" icon={<Icon.Inbox />} title="Introductions" sub={awaiting ? `${awaiting} waiting for your answer` : 'Requests from verified curators'} />
            <ToolRow to="export" icon={<Icon.Download />} title="Export or withdraw" sub="Download everything, or hide it all in one step" />
            <ToolRow to="consent" icon={<Icon.Doc />} title="Artist terms" sub={consentCurrent ? `Agreed to ${CONSENT_VERSION}` : 'Needs your agreement'} />
          </ul>
        </nav>
      </main>
    </div>
  );
}

function WorkRow({ work }: { work: ArtworkView }) {
  const img = work.images.find((i) => i.isPrimary) ?? work.images[0];
  return (
    <Link to={`work/${work.id}`} className="list-row st-work" data-medium={work.medium}>
      {img ? <img className="thumb thumb--lg" src={img.src} alt="" /> : <span className="thumb thumb--lg st-thumb-empty" aria-hidden="true" />}
      <div className="list-row__main">
        <div className="list-row__title">{work.title}</div>
        <div className="list-row__sub">
          {work.year}, {work.medium}
          {work.status !== 'available' ? `, ${work.status}` : ''}
        </div>
        <div className="row row--wrap st-work__badges">
          <VisibilityBadge level={work.visibility} />
          <PriceBadge work={work} />
        </div>
      </div>
      <Icon.Edit className="st-work__go" aria-hidden="true" />
    </Link>
  );
}

function PriceBadge({ work }: { work: ArtworkView }) {
  if (!work.price) return <span className="st-price st-price--none">No price</span>;
  return (
    <span className={`st-price st-price--${work.priceVisibility}`} title={`Price visible to: ${VISIBILITY_LABEL[work.priceVisibility]}`}>
      <VisibilityIcon level={work.priceVisibility} />
      {formatPrice(work.price.amount, work.price.currency)}
      <span className="sr-only">, price visible to {VISIBILITY_LABEL[work.priceVisibility]}</span>
    </span>
  );
}

function ToolRow({ to, icon, title, sub }: { to: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <li>
      <Link to={to} className="list-row st-tool">
        <span className="st-tool__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="list-row__main">
          <span className="list-row__title" style={{ display: 'block' }}>
            {capitalize(title)}
          </span>
          <span className="list-row__sub">{sub}</span>
        </span>
        <Icon.Back className="st-chevron" aria-hidden="true" />
      </Link>
    </li>
  );
}

function HomeSkeleton() {
  return (
    <div className="screen">
      <TopBar title="Studio" />
      <main className="container stack--lg st-main" aria-busy="true" aria-label="Loading your studio">
        <Skeleton h={120} />
        <Skeleton h={64} />
        <div className="tiles">
          <Skeleton h={84} />
          <Skeleton h={84} />
          <Skeleton h={84} />
          <Skeleton h={84} />
        </div>
        <Panel>
          <div className="stack">
            <Skeleton h={56} />
            <Skeleton h={56} />
            <Skeleton h={56} />
          </div>
        </Panel>
      </main>
    </div>
  );
}
