import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@/state/session';
import { EmptyState, ErrorState, Icon, LinkButton, Skeleton, TopBar } from '@/ui';
import { AuditList, loadAuditNames } from './AuditList';
import './admin.css';

interface TileProps {
  to: string;
  n: number;
  label: string;
  hint: string;
  tone: 'coral' | 'cobalt' | 'butter' | 'lime';
  icon: ReactNode;
}

function QueueTile({ to, n, label, hint, tone, icon }: TileProps) {
  const clear = n === 0;
  return (
    <Link to={to} className={`tile admin-tile ${clear ? 'admin-tile--clear' : `tile--${tone}`}`} aria-label={`${n} ${label}`}>
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
        <span className="admin-tile__hint" style={{ display: 'block' }}>
          {clear ? 'Nothing waiting' : hint}
        </span>
      </span>
    </Link>
  );
}

export function AdminHome() {
  const q = useQuery(async (ds, v) => {
    const [artists, curators, inquiries, works, audit, names] = await Promise.all([
      ds.listAllArtists(v),
      ds.listCurators(v),
      ds.listInquiries(v),
      ds.listArtworks(v),
      ds.listAudit(v, 8),
      loadAuditNames(ds, v),
    ]);
    return {
      pendingArtists: artists.filter((a) => a.status === 'pending').length,
      totalArtists: artists.length,
      pendingCurators: curators.filter((c) => c.status === 'pending').length,
      totalCurators: curators.length,
      pendingInquiries: inquiries.filter((i) => i.status === 'pending').length,
      totalInquiries: inquiries.length,
      unreviewed: works.filter((w) => !w.reviewedAt).length,
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
            {[0, 1, 2, 3].map((i) => (
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
