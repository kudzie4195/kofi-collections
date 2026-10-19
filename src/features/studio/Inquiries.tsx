import { useState } from 'react';
import type { InquiryRow } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Confirm, EmptyState, ErrorState, Icon, LinkButton, Notice, Sheet, Skeleton, StatusDot, Textarea, TopBar } from '@/ui';
import { formatDate } from './shared';

const STATUS_LABEL: Record<InquiryRow['status'], string> = {
  pending: 'In Kofi review',
  forwarded: 'Waiting for you',
  accepted: 'Accepted',
  declined: 'Declined',
};

export function Inquiries() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [accepting, setAccepting] = useState<InquiryRow>();
  const [declining, setDeclining] = useState<InquiryRow>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useQuery(
    async (ds, v) => {
      const [rows, artist] = await Promise.all([ds.listInquiries(v), ds.getMyArtist(v)]);
      return { rows: rows.filter((r) => r.status !== 'pending'), email: artist?.contact?.email };
    },
    [],
  );

  async function accept() {
    if (!accepting) return;
    try {
      await data.setInquiryStatus(viewer, accepting.id, 'accepted');
      toast.push(`Accepted. Kofi will introduce you to ${accepting.curatorName}.`, 'success');
      setAccepting(undefined);
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    }
  }

  async function decline() {
    if (!declining) return;
    setBusy(true);
    try {
      await data.setInquiryStatus(viewer, declining.id, 'declined', note.trim() || undefined);
      toast.push('Declined. Only Kofi has been told.', 'success');
      setDeclining(undefined);
      setNote('');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (q.error && !q.data) body = <ErrorState error={q.error} retry={q.reload} />;
  else if (!q.data)
    body = (
      <div className="stack" aria-busy="true" aria-label="Loading introductions">
        <Skeleton h={140} />
        <Skeleton h={140} />
      </div>
    );
  else if (q.data.rows.length === 0)
    body = (
      <EmptyState
        title="No introduction requests yet"
        body="When a verified curator asks to meet you, Kofi reviews the request first. The ones Kofi forwards land here for you to accept or decline."
        actions={
          <LinkButton to="/studio/profile" tone="secondary">
            Polish your profile
          </LinkButton>
        }
      />
    );
  else {
    const waiting = q.data.rows.filter((r) => r.status === 'forwarded');
    const answered = q.data.rows.filter((r) => r.status !== 'forwarded');
    body = (
      <div className="stack--lg">
        {waiting.length > 0 && (
          <section aria-labelledby="waiting" className="stack">
            <h2 className="h3" id="waiting">
              Waiting for you
            </h2>
            <ul className="stack">
              {waiting.map((r) => (
                <InquiryCard key={r.id} row={r} onAccept={() => setAccepting(r)} onDecline={() => setDeclining(r)} />
              ))}
            </ul>
          </section>
        )}
        {answered.length > 0 && (
          <section aria-labelledby="answered" className="stack">
            <h2 className="h3" id="answered">
              Answered
            </h2>
            <ul className="stack">
              {answered.map((r) => (
                <InquiryCard key={r.id} row={r} />
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title="Introductions" back="/studio" />
      <main className="container section stack--lg">
        <Notice tone="cobalt" icon={<Icon.Admin />}>
          Kofi reviews every request before it reaches you. Accepting lets Kofi share your email with this curator; declining tells Kofi only.
        </Notice>
        {body}
      </main>

      <Confirm
        open={!!accepting}
        onClose={() => setAccepting(undefined)}
        onConfirm={accept}
        title="Accept this introduction?"
        body={
          accepting
            ? `Kofi will share ${q.data?.email ? `your email (${q.data.email})` : 'your contact email'} with ${accepting.curatorName} at ${accepting.institutionName}. Your phone and studio address stay private.`
            : ''
        }
        confirmLabel="Accept introduction"
      />

      <Sheet
        open={!!declining}
        onClose={() => {
          setDeclining(undefined);
          setNote('');
        }}
        title="Decline this request?"
        footer={
          <>
            <Button
              tone="secondary"
              block
              onClick={() => {
                setDeclining(undefined);
                setNote('');
              }}
            >
              Cancel
            </Button>
            <Button tone="danger" block loading={busy} onClick={() => void decline()}>
              Decline request
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>
            {declining ? `${declining.curatorName} at ${declining.institutionName} won’t receive your contact details.` : ''} Kofi will let them know the introduction isn’t going ahead.
          </p>
          <Textarea label="Note for Kofi (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} hint="Only Kofi sees this — for example, “Not taking loans this year.”" />
        </div>
      </Sheet>
    </div>
  );
}

function InquiryCard({ row, onAccept, onDecline }: { row: InquiryRow; onAccept?: () => void; onDecline?: () => void }) {
  return (
    <li className={`st-inq st-inq--${row.status}`}>
      <div className="row row--between row--wrap st-inq__head">
        <div className="st-inq__who">
          <div className="h3">{row.institutionName}</div>
          <div className="small">{row.curatorName}</div>
        </div>
        <div className="row small strong">
          <StatusDot status={row.status} />
          {STATUS_LABEL[row.status]}
        </div>
      </div>
      {row.artworkTitle && (
        <p className="small">
          About <span className="strong">{row.artworkTitle}</span>
        </p>
      )}
      <blockquote className="st-quote">{row.message}</blockquote>
      {row.staffNote && (
        <p className="tiny muted">
          {row.status === 'forwarded' ? 'Note from Kofi: ' : 'Note: '}
          {row.staffNote}
        </p>
      )}
      <p className="tiny muted">
        Requested {formatDate(row.createdAt)}
        {row.decidedAt && row.status !== 'forwarded' ? `, answered ${formatDate(row.decidedAt)}` : ''}
      </p>
      {row.status === 'forwarded' && onAccept && onDecline && (
        <div className="row row--wrap st-inq__actions">
          <Button icon={<Icon.Check />} onClick={onAccept}>
            Accept introduction
          </Button>
          <Button tone="secondary" onClick={onDecline}>
            Decline
          </Button>
        </div>
      )}
    </li>
  );
}
