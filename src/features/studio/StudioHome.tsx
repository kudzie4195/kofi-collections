import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CONSENT_VERSION, VISIBILITY_LABEL } from '@/domain/types';
import type { ApplicationRow, ApplicationStatus, ArtistView, ArtworkView, LotRow, OpenCall, PayoutRow } from '@/domain/types';
import { profileCompleteness, readyForReview } from '@/domain/intake';
import { APPLICATION_STATUSES } from '@/domain/types';
import { callPhase } from '@/domain/programme';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, deadlineLabel } from '@/features/programme/format';
import { formatPrice } from '@/domain/units';
import { useSession, useQuery } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, EmptyState, ErrorState, Icon, LinkButton, Notice, Panel, Skeleton, StatusDot, TopBar, VisibilityBadge } from '@/ui';
import { STATUS_COPY, VisibilityIcon, capitalize } from './shared';
import { payoutTotals, totalsText } from './salesShared';
import { studioIntakeCopy } from './intakeCopy';
import { mediumTagId } from '@/domain/taxonomy';
import { NUDGE_COPY } from './tagCopy';
import './tags.css';

export function StudioHome() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const q = useQuery(
    async (ds, v) => {
      const [artist, works, inquiries, docs, calls, apps, lots, payouts] = await Promise.all([
        ds.getMyArtist(v),
        v.artistId ? ds.listArtistArtworks(v, v.artistId) : Promise.resolve([] as ArtworkView[]),
        ds.listInquiries(v),
        ds.listMyDocuments(v),
        ds.listOpenCalls(v).catch(() => [] as OpenCall[]),
        ds.listMyApplications(v).catch(() => [] as ApplicationRow[]),
        ds.listMyLots(v).catch(() => [] as LotRow[]),
        ds.listPayouts(v).catch(() => [] as PayoutRow[]),
      ]);
      return { artist, works, inquiries, docs, calls, apps, lots, payouts };
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

  const { artist, works, inquiries, docs, calls, apps, lots, payouts } = q.data;
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
      <main className="container container--wide st-main st-home">
        <div className="st-home__aside stack--lg">
          <header className="st-greeting">
            <p className="eyebrow eyebrow--gold st-greeting__kicker">Your studio</p>
            <h2 className="h1 st-greeting__title">Hello, {firstName}.</h2>
            <span className="rule" aria-hidden="true" />
            <p className="small muted st-greeting__who">
              Signed in as <span className="strong">{artist.workingName}</span>
            </p>
          </header>

        {artist.status === 'draft' && <FinishCard artist={artist} workCount={works.length} />}
        {artist.status === 'pending' && <ReviewBanner />}

        <section className="st-status" aria-label="Profile status">
          <div className="row">
            <StatusDot status={artist.status} />
            <span className="eyebrow st-status__label">{status.label}</span>
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

        <ul className="tiles st-tiles" aria-label="Studio at a glance">
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

        <OpportunitiesBlock calls={calls} apps={apps} lots={lots} payouts={payouts} />
        </div>

        <div className="st-home__main stack--lg">
        <TagNudge works={works} />
        <section aria-labelledby="your-works" className="stack">
          <div className="row row--between row--wrap">
            <h2 className="section-title st-works-title" id="your-works">
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
          <h2 className="eyebrow st-tools__title">Studio tools</h2>
          <ul className="list">
            <ToolRow to="profile" icon={<Icon.Person />} title="Profile" sub="Bio, mediums, region and who sees your profile" />
            <ToolRow to="vault" icon={<Icon.Lock />} title="Private vault" sub="Invoices, condition reports, provenance, appraisals" />
            <ToolRow to="inquiries" icon={<Icon.Inbox />} title="Introductions" sub={awaiting ? `${awaiting} waiting for your answer` : 'Requests from verified curators'} />
            <ToolRow to="export" icon={<Icon.Download />} title="Export or withdraw" sub="Download everything, or hide it all in one step" />
            <ToolRow to="import" icon={<Icon.Doc />} title="Import from a spreadsheet" sub="Review every row, then add works as drafts" />
            <ToolRow to="consent" icon={<Icon.Doc />} title="Artist terms" sub={consentCurrent ? `Agreed to ${CONSENT_VERSION}` : 'Needs your agreement'} />
          </ul>
        </nav>
        </div>
      </main>
    </div>
  );
}

/** Draft: how far along the profile is, what still blocks review, and the way back into the intake. */
function FinishCard({ artist, workCount }: { artist: ArtistView; workCount: number }) {
  const c = studioIntakeCopy.finish;
  const shape = {
    workingName: artist.workingName,
    bio: artist.bio,
    region: artist.region ?? { region: '', country: '' },
    mediums: artist.mediums,
    links: artist.links,
    consentVersion: artist.consentVersion,
  };
  const pct = profileCompleteness(shape, workCount);
  const left = readyForReview(shape, workCount);
  return (
    <section className="st-finish" aria-labelledby="st-finish-title" data-testid="finish-card">
      <div className="st-finish__head">
        <h2 className="st-finish__title" id="st-finish-title">
          {c.title}
        </h2>
        <span className="st-finish__pct" aria-hidden="true">
          {pct}
          <span className="st-finish__unit">%</span>
        </span>
      </div>
      <div className="st-finish__bar" role="progressbar" aria-label={c.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% ${c.done}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {left.length > 0 ? (
        <div className="st-finish__left">
          <h3 className="eyebrow st-finish__left-title">{c.leftTitle}</h3>
          <ul className="st-finish__list">
            {left.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="small st-finish__ready">{c.ready}</p>
      )}
      <LinkButton to="/join">
        {c.cta}
      </LinkButton>
      <p className="tiny muted">{c.note}</p>
    </section>
  );
}

/** Pending: Kofi has it; what happens next; editing stays open. */
function ReviewBanner() {
  const c = studioIntakeCopy.pending;
  return (
    <section className="st-review" aria-labelledby="st-review-title" data-testid="review-banner">
      <p className="eyebrow eyebrow--gold">{c.lede}</p>
      <h2 className="st-review__title" id="st-review-title">
        {c.title}
      </h2>
      <h3 className="eyebrow st-review__next">{c.nextTitle}</h3>
      <ol className="st-review__list">
        {c.next.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ol>
      <p className="small st-review__edit">{c.keepEditing}</p>
      <div>
        <LinkButton to="profile" tone="secondary" size="sm" icon={<Icon.Edit />}>
          {c.editProfile}
        </LinkButton>
      </div>
    </section>
  );
}

function OpportunitiesBlock({ calls, apps, lots, payouts }: { calls: OpenCall[]; apps: ApplicationRow[]; lots: LotRow[]; payouts: PayoutRow[] }) {
  const due = payoutTotals(payouts, 'due');
  const paid = payoutTotals(payouts, 'paid');
  const sold = lots.filter((l) => l.status === 'sold').length;
  const open = calls.filter((c) => callPhase(c) === 'open');
  const next = open.find((c) => !c.externalUrl && !apps.some((a) => a.callId === c.id && a.status !== 'withdrawn')) ?? open[0];
  const counts = APPLICATION_STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length] as [ApplicationStatus, number]).filter(([, n]) => n > 0);
  return (
    <section className="st-opps" aria-labelledby="st-opps-title">
      <h2 className="eyebrow eyebrow--gold" id="st-opps-title">
        Opportunities
      </h2>
      <ul className="list st-opps__list">
        <li>
          <Link to="opportunities" className="list-row st-opp">
            <span className="st-opp__num" aria-hidden="true">
              {open.length}
            </span>
            <span className="list-row__main">
              <span className="list-row__title st-opp__title">{open.length === 1 ? 'Open call' : 'Open calls'}</span>
              <span className="list-row__sub">
                {next ? `${next.title}: ${deadlineLabel(next).toLowerCase()}` : 'Nothing open right now. New calls appear here.'}
              </span>
              <span className="sr-only">, {open.length} open now</span>
            </span>
            <Icon.Back className="st-chevron" aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="applications" className="list-row st-opp">
            <span className="st-opp__num" aria-hidden="true">
              {apps.length}
            </span>
            <span className="list-row__main">
              <span className="list-row__title st-opp__title">My applications</span>
              {counts.length ? (
                <span className="st-opp__counts">
                  {counts.map(([s, n]) => (
                    <span key={s} className="st-opp__count">
                      <StatusDot status={APPLICATION_STATUS_DOT[s]} />
                      {n} {APPLICATION_STATUS_LABEL[s].toLowerCase()}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="list-row__sub">You haven’t applied to a call yet.</span>
              )}
            </span>
            <Icon.Back className="st-chevron" aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="sales" className="list-row st-opp">
            <span className="st-opp__num" aria-hidden="true">
              {sold}
            </span>
            <span className="list-row__main">
              <span className="list-row__title st-opp__title">Sales</span>
              <span className="list-row__sub" data-testid="studio-sales-totals">
                {lots.length === 0
                  ? 'No auction lots yet.'
                  : `${totalsText(due, 'Nothing')} due · ${totalsText(paid, 'nothing')} paid`}
              </span>
              <span className="sr-only">, {sold === 1 ? '1 work sold' : `${sold} works sold`}</span>
            </span>
            <Icon.Back className="st-chevron" aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </section>
  );
}

/** Works carrying no controlled tags beyond their own medium. */
export function untaggedWorks(works: ArtworkView[]): ArtworkView[] {
  return works.filter((w) => (w.tagIds ?? []).every((t) => t === mediumTagId(w.medium)));
}

const NUDGE_SHOWN = 3;

function TagNudge({ works }: { works: ArtworkView[] }) {
  const list = untaggedWorks(works);
  if (list.length === 0) return null;
  const shown = list.slice(0, NUDGE_SHOWN);
  return (
    <section className="st-nudge" aria-labelledby="st-nudge-title" data-testid="tag-nudge">
      <h2 className="st-nudge__title" id="st-nudge-title">
        {NUDGE_COPY.title}
      </h2>
      <p className="st-nudge__body">{NUDGE_COPY.body(list.length)}</p>
      <ul className="st-nudge__list">
        {shown.map((w) => (
          <li key={w.id}>
            <Link to={`work/${w.id}?section=tags`} className="tagchip">
              {w.title}
            </Link>
          </li>
        ))}
        {list.length > NUDGE_SHOWN && <li className="st-nudge__more">{NUDGE_COPY.more(list.length - NUDGE_SHOWN)}</li>}
      </ul>
    </section>
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
