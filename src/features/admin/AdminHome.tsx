import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicationRow, BuyerInquiryRow, LotRow, PayoutRow } from '@/domain/types';
import { useQuery } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, Skeleton, TopBar } from '@/ui';
import { AuditList, loadAuditNames } from './AuditList';
import { moneyLines, totalsBy } from './salesShared';
import { DeskIcon } from './icons';
import './admin.css';

interface TileProps {
  to: string;
  n: number;
  label: string;
  hint: string;
  tone: 'coral' | 'cobalt' | 'butter' | 'lime';
  icon: ReactNode;
  /** A money amount read out with the count, e.g. "$5,740.00". */
  amount?: string;
}

function QueueTile({ to, n, label, hint, tone, icon, amount }: TileProps) {
  const clear = n === 0;
  return (
    <Link to={to} className={`tile admin-tile ${clear ? 'admin-tile--clear' : `tile--${tone}`}`} aria-label={`${n} ${label}${amount && !clear ? `: ${amount}` : ''}`}>
      <span className="admin-tile__corner" aria-hidden="true">
        {clear ? <Icon.Check /> : icon}
      </span>
      <span className="tile__num" data-testid="tile-num">
        {n}
      </span>
      <span>
        <span className="tile__label" style={{ display: 'block' }}>
          {label}
        </span>
        {amount && !clear && (
          <span className="admin-tile__amount" style={{ display: 'block' }}>
            {amount}
          </span>
        )}
        <span className="admin-tile__hint" style={{ display: 'block' }}>
          {clear ? 'Nothing waiting' : hint}
        </span>
      </span>
    </Link>
  );
}

function NavRow({ to, icon, title, sub }: { to: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <li>
      <Link to={to} className="list-row">
        <span className="ad-nav__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="list-row__main">
          <span className="list-row__title" style={{ display: 'block' }}>
            {title}
          </span>
          <span className="list-row__sub">{sub}</span>
        </span>
        <Icon.Back className="row-chev" />
      </Link>
    </li>
  );
}

export function AdminHome() {
  const q = useQuery(async (ds, v) => {
    const [artists, curators, inquiries, works, audit, names, apps, buyers, exhibitions, calls, events, stories, payouts, lots] = await Promise.all([
      ds.listAllArtists(v),
      ds.listCurators(v),
      ds.listInquiries(v),
      ds.listArtworks(v),
      ds.listAudit(v, 8),
      loadAuditNames(ds, v),
      ds.listApplications(v).catch(() => [] as ApplicationRow[]),
      ds.listBuyerInquiries(v).catch(() => [] as BuyerInquiryRow[]),
      ds.listExhibitions(v).catch(() => []),
      ds.listOpenCalls(v).catch(() => []),
      ds.listEvents(v).catch(() => []),
      ds.listStories(v).catch(() => []),
      ds.listPayouts(v).catch(() => [] as PayoutRow[]),
      ds.listLots(v).catch(() => [] as LotRow[]),
    ]);
    const due = payouts.filter((p) => p.status === 'due');
    return {
      pendingArtists: artists.filter((a) => a.status === 'pending').length,
      totalArtists: artists.length,
      pendingCurators: curators.filter((c) => c.status === 'pending').length,
      totalCurators: curators.length,
      pendingInquiries: inquiries.filter((i) => i.status === 'pending').length,
      totalInquiries: inquiries.length,
      unreviewed: works.filter((w) => !w.reviewedAt).length,
      toReview: apps.filter((a) => a.status === 'submitted' || a.status === 'shortlisted').length,
      totalApps: apps.length,
      newBuyers: buyers.filter((b) => b.status === 'new').length,
      totalBuyers: buyers.length,
      programmeCount: exhibitions.length + calls.length + events.length + stories.length,
      drafts: [...exhibitions, ...calls, ...events, ...stories].filter((x) => !x.published).length,
      payoutsDue: due.length,
      dueAmount: moneyLines(totalsBy(due, (p) => p.currency, (p) => p.amount)).join(' + '),
      paidCount: payouts.filter((p) => p.status === 'paid').length,
      openLots: lots.filter((l) => l.status === 'planned' || l.status === 'live').length,
      totalLots: lots.length,
      soldLots: lots.filter((l) => l.status === 'sold').length,
      audit,
      names,
    };
  });

  return (
    <div className="screen">
      <TopBar title="Kofi desk" />
      <main className="container container--wide stack--lg ad-main">
        <section>
          <p className="eyebrow eyebrow--gold">Operations</p>
          <h2 className="section-title ad-title" style={{ marginTop: 8 }}>
            Today’s queue
          </h2>
          <p className="ad-lede">Everything waiting on a person at Kofi. Tap a number to work through it.</p>
        </section>

        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="tiles admin-tiles" aria-busy="true" aria-label="Loading queue">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} h={132} />
            ))}
          </div>
        ) : (
          <>
            <nav className="tiles admin-tiles" aria-label="Review queues">
              <QueueTile
                to="/admin/artists?status=pending"
                n={q.data.pendingArtists}
                label={q.data.pendingArtists === 1 ? 'artist waiting for review' : 'artists waiting for review'}
                hint="Approve, or send back with a note"
                tone="coral"
                icon={<Icon.Artists />}
              />
              <QueueTile
                to="/admin/curators"
                n={q.data.pendingCurators}
                label={q.data.pendingCurators === 1 ? 'curator to verify' : 'curators to verify'}
                hint="Check the institution by hand"
                tone="cobalt"
                icon={<Icon.Building />}
              />
              <QueueTile
                to="/admin/inquiries?status=pending"
                n={q.data.pendingInquiries}
                label={q.data.pendingInquiries === 1 ? 'introduction request' : 'introduction requests'}
                hint="Forward to the artist or decline"
                tone="butter"
                icon={<Icon.Mail />}
              />
              <QueueTile
                to="/admin/artists?review=works"
                n={q.data.unreviewed}
                label={q.data.unreviewed === 1 ? 'work never reviewed' : 'works never reviewed'}
                hint="Listings Kofi hasn’t checked yet"
                tone="lime"
                icon={<Icon.Gallery />}
              />
              <QueueTile
                to="/admin/applications"
                n={q.data.toReview}
                label={q.data.toReview === 1 ? 'application to review' : 'applications to review'}
                hint="Submitted or shortlisted, waiting on a decision"
                tone="coral"
                icon={<Icon.Doc />}
              />
              <QueueTile
                to="/admin/collectors?status=new"
                n={q.data.newBuyers}
                label={q.data.newBuyers === 1 ? 'new collector inquiry' : 'new collector inquiries'}
                hint="Reply from Kofi; artist contact stays private"
                tone="cobalt"
                icon={<Icon.Inbox />}
              />
              <QueueTile
                to="/admin/payouts"
                n={q.data.payoutsDue}
                label={q.data.payoutsDue === 1 ? 'payout due' : 'payouts due'}
                amount={q.data.dueAmount}
                hint="Owed to artists from recorded sales"
                tone="butter"
                icon={<DeskIcon.Money />}
              />
              <QueueTile
                to="/admin/lots"
                n={q.data.openLots}
                label={q.data.openLots === 1 ? 'lot open for sale' : 'lots open for sale'}
                hint="Planned or live; record the hammer price"
                tone="lime"
                icon={<DeskIcon.Lot />}
              />
            </nav>

            <div className="ad-home-grid">
              <ul className="list ad-nav" aria-label="Kofi admin sections">
                <li>
                  <Link to="/admin/artists" className="list-row">
                    <span className="ad-nav__icon" aria-hidden="true">
                      <Icon.Artists />
                    </span>
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        Artists
                      </span>
                      <span className="list-row__sub">{q.data.totalArtists} profiles, all statuses</span>
                    </span>
                    <Icon.Back className="row-chev" />
                  </Link>
                </li>
                <li>
                  <Link to="/admin/curators" className="list-row">
                    <span className="ad-nav__icon" aria-hidden="true">
                      <Icon.Building />
                    </span>
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        Curators
                      </span>
                      <span className="list-row__sub">{q.data.totalCurators} institution requests</span>
                    </span>
                    <Icon.Back className="row-chev" />
                  </Link>
                </li>
                <li>
                  <Link to="/admin/inquiries" className="list-row">
                    <span className="ad-nav__icon" aria-hidden="true">
                      <Icon.Mail />
                    </span>
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        Introduction requests
                      </span>
                      <span className="list-row__sub">{q.data.totalInquiries} in total</span>
                    </span>
                    <Icon.Back className="row-chev" />
                  </Link>
                </li>
                <NavRow to="/admin/programme" icon={<Icon.Calendar />} title="Programme" sub={`${q.data.programmeCount} exhibitions, calls, events and stories${q.data.drafts ? ` · ${q.data.drafts} ${q.data.drafts === 1 ? 'draft' : 'drafts'}` : ''}`} />
                <NavRow to="/admin/applications" icon={<Icon.Doc />} title="Applications" sub={`${q.data.totalApps} to open calls`} />
                <NavRow to="/admin/collectors" icon={<Icon.Inbox />} title="Collector inquiries" sub={`${q.data.totalBuyers} in total`} />
                <NavRow to="/admin/lots" icon={<DeskIcon.Lot />} title="Lots" sub={`${q.data.totalLots} on auction calls · ${q.data.soldLots} sold`} />
                <NavRow to="/admin/payouts" icon={<DeskIcon.Money />} title="Payouts" sub={q.data.payoutsDue ? `${q.data.dueAmount} due · ${q.data.paidCount} paid` : `Nothing due · ${q.data.paidCount} paid`} />
                <NavRow to="/admin/reports" icon={<DeskIcon.Chart />} title="Reports" sub="Participation, placements and payments, as CSV" />
                <li>
                  <Link to="/admin/activity" className="list-row">
                    <span className="ad-nav__icon" aria-hidden="true">
                      <Icon.Eye />
                    </span>
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        Activity log
                      </span>
                      <span className="list-row__sub">Append-only record of sensitive actions</span>
                    </span>
                    <Icon.Back className="row-chev" />
                  </Link>
                </li>
              </ul>

            <section className="stack">
              <div className="row row--between row--wrap">
                <h2 className="eyebrow">Recent activity</h2>
                <LinkButton to="/admin/activity" tone="ghost" size="sm" className="ghost-flat">
                  See all activity
                </LinkButton>
              </div>
              {q.data.audit.length === 0 ? (
                <EmptyState title="No activity yet" body="Sensitive actions across the app will be recorded here as they happen." />
              ) : (
                <AuditList events={q.data.audit} names={q.data.names} />
              )}
            </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
