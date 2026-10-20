import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicationRow } from '@/domain/types';
import { canMoveApplication } from '@/domain/programme';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, formatDay, formatInstantDay } from '@/features/programme/format';
import { Button, Confirm, EmptyState, ErrorState, Icon, LinkButton, Skeleton, StatusDot, TopBar } from '@/ui';

const STATUS_HELP: Record<ApplicationRow['status'], string> = {
  submitted: 'Kofi has your application and will read it after the deadline.',
  shortlisted: 'You’re on the shortlist. Kofi will be in touch before a final decision.',
  accepted: 'Selected. Kofi will contact you about next steps.',
  declined: 'Not selected this time.',
  withdrawn: 'You withdrew this application.',
};

export function Applications() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [withdrawing, setWithdrawing] = useState<ApplicationRow>();
  const q = useQuery((ds, v) => ds.listMyApplications(v));

  const rows = q.data ?? [];
  const live = rows.filter((r) => r.status === 'submitted' || r.status === 'shortlisted').length;

  return (
    <div className="screen">
      <TopBar title="My applications" back="/studio" />
      <main className="container container--wide st-main">
        <div className="st-split">
          <aside className="st-split__aside stack st-intro">
            <p className="eyebrow eyebrow--gold">Opportunities</p>
            <h2 className="h1 sto-title">Every call you’ve applied to.</h2>
            <span className="rule" aria-hidden="true" />
            <p className="lede">
              {q.data
                ? live
                  ? `${live === 1 ? 'One application is' : `${live} applications are`} with Kofi now.`
                  : 'Nothing is waiting on a decision right now.'
                : 'Decisions and notes from Kofi appear here.'}
            </p>
            <p className="small muted">You can withdraw an application until Kofi makes a decision. Notes from Kofi appear under each decision.</p>
            <LinkButton to="/studio/opportunities" tone="secondary">
              Find open calls
            </LinkButton>
          </aside>

          <div className="st-split__main">
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading applications">
                <Skeleton h={160} />
                <Skeleton h={160} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title="No applications yet"
                body="When you apply to an open call, you can follow it here."
                actions={<LinkButton to="/studio/opportunities">See open calls</LinkButton>}
              />
            ) : (
              <ul className="stap-list" aria-label="Your applications">
                {rows.map((r) => (
                  <li key={r.id} className="stap" aria-labelledby={`app-${r.id}`}>
                    <div className="stap__head">
                      <span className="status-pill">
                        <StatusDot status={APPLICATION_STATUS_DOT[r.status]} />
                        {APPLICATION_STATUS_LABEL[r.status]}
                      </span>
                      <span className="tiny muted">Sent {formatInstantDay(r.createdAt)}</span>
                    </div>
                    <h3 className="stap__title" id={`app-${r.id}`}>
                      <Link to={`/calls/${r.callId}`}>{r.callTitle}</Link>
                    </h3>
                    <p className="small muted">
                      {STATUS_HELP[r.status]}
                      {r.decidedAt && (r.status === 'accepted' || r.status === 'declined') ? ` Decided ${formatInstantDay(r.decidedAt)}.` : ''}
                      {r.status === 'submitted' && r.callDeadline ? ` The call closes ${formatDay(r.callDeadline)}.` : ''}
                    </p>
                    {r.works.length > 0 && (
                      <ul className="stap__works" aria-label="Works attached">
                        {r.works.map((w) => {
                          const img = w.images.find((i) => i.isPrimary) ?? w.images[0];
                          return (
                            <li key={w.id} className="stap__work" data-medium={w.medium}>
                              {img ? <img className="thumb" src={img.src} alt="" /> : <span className="thumb st-thumb-empty" aria-hidden="true" />}
                              <span className="stap__work-title">{w.title}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {r.decisionNote && (
                      <blockquote className="stap__note">
                        <p className="eyebrow eyebrow--gold">Note from Kofi</p>
                        <p>{r.decisionNote}</p>
                      </blockquote>
                    )}
                    {canMoveApplication(r.status, 'withdrawn', 'artist') && (
                      <div className="stap__actions">
                        <Button tone="ghost" size="sm" onClick={() => setWithdrawing(r)} aria-label={`Withdraw application to ${r.callTitle}`}>
                          <Icon.Close aria-hidden="true" /> Withdraw
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
      <Confirm
        open={!!withdrawing}
        onClose={() => setWithdrawing(undefined)}
        title="Withdraw this application?"
        body={withdrawing ? `Kofi will stop reviewing your application to “${withdrawing.callTitle}”. If the call is still open you can apply again.` : ''}
        confirmLabel="Withdraw application"
        danger
        onConfirm={async () => {
          if (!withdrawing) return;
          try {
            await data.withdrawApplication(viewer, withdrawing.id);
            toast.push('Application withdrawn', 'success');
            setWithdrawing(undefined);
          } catch (e) {
            toast.push(errorMessage(e), 'error');
          }
        }}
      />
    </div>
  );
}
