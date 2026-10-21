import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApplicationRow, ApplicationStatus } from '@/domain/types';
import { canMoveApplication } from '@/domain/programme';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, deadlineLabel, formatInstantDay } from '@/features/programme/format';
import { Button, EmptyState, ErrorState, Icon, LinkButton, Notice, Sheet, Skeleton, StatusDot, TopBar, WallLabel } from '@/ui';
import './admin.css';
import './programme.css';
import './sales.css';

type Move = Extract<ApplicationStatus, 'shortlisted' | 'accepted' | 'declined'>;

function moveLabel(from: ApplicationStatus, to: Move): string {
  if (to === 'shortlisted') return from === 'submitted' ? 'Shortlist' : 'Back to shortlist';
  return to === 'accepted' ? 'Select' : 'Not selected';
}

const SHEET_TITLE: Record<Move, string> = {
  shortlisted: 'Move to the shortlist?',
  accepted: 'Select this application?',
  declined: 'Mark as not selected?',
};

export function AdminApplicationDetail() {
  const { id = '' } = useParams();
  const [move, setMove] = useState<Move>();
  const trigger = useRef<HTMLElement | null>(null);
  const q = useQuery(
    async (ds, v) => {
      const app = (await ds.listApplications(v)).find((a) => a.id === id);
      const call = app ? await ds.getOpenCall(v, app.callId) : undefined;
      return { app, call };
    },
    [id],
  );

  const open = (m: Move) => {
    trigger.current = document.activeElement as HTMLElement | null;
    setMove(m);
  };
  const close = () => {
    setMove(undefined);
    window.setTimeout(() => trigger.current?.focus?.(), 0);
  };

  let body: React.ReactNode;
  if (q.error && !q.data) body = <ErrorState error={q.error} retry={q.reload} />;
  else if (!q.data)
    body = (
      <div className="ad-split" aria-busy="true" aria-label="Loading application">
        <Skeleton h={280} />
        <Skeleton h={420} />
      </div>
    );
  else if (!q.data.app)
    body = <EmptyState title="We couldn’t find that application" body="It may belong to a call that was removed." actions={<LinkButton to="/admin/applications">All applications</LinkButton>} />;
  else {
    const a = q.data.app;
    const call = q.data.call;
    const moves = (['shortlisted', 'accepted', 'declined'] as Move[]).filter((m) => canMoveApplication(a.status, m, 'admin'));
    body = (
      <div className="ad-split">
        <aside className="ad-split__aside stack">
          <p className="eyebrow eyebrow--gold">Application</p>
          <h2 className="h1 pga-artist">
            <Link to={`/admin/artists/${a.artistId}`}>{a.artistWorkingName}</Link>
          </h2>
          <span className="rule rule--gold" aria-hidden="true" />
          <div className="row row--wrap">
            <span className="status-pill" data-testid="app-status">
              <StatusDot status={APPLICATION_STATUS_DOT[a.status]} />
              {APPLICATION_STATUS_LABEL[a.status]}
            </span>
          </div>
          <dl className="pga-facts">
            <div>
              <dt>Call</dt>
              <dd>
                <Link to={`/admin/programme/calls/${a.callId}`}>{a.callTitle}</Link>
                {call && <span className="tiny muted pga-sub">{deadlineLabel(call)}</span>}
              </dd>
            </div>
            <div>
              <dt>Sent</dt>
              <dd>{formatInstantDay(a.createdAt)}</dd>
            </div>
            {a.decidedAt && (
              <div>
                <dt>Decided</dt>
                <dd>{formatInstantDay(a.decidedAt)}</dd>
              </div>
            )}
            <div>
              <dt>Works</dt>
              <dd>{a.works.length}</dd>
            </div>
          </dl>
          {a.status === 'withdrawn' ? (
            <Notice tone="plain" icon={<Icon.Info />}>
              The artist withdrew this application. It stays here for the record and can’t be changed.
            </Notice>
          ) : (
            <div className="pga-actions" role="group" aria-label="Decision">
              {moves.map((m) => (
                <Button key={m} size="sm" tone={m === 'accepted' ? 'primary' : m === 'declined' ? 'danger' : 'secondary'} onClick={() => open(m)}>
                  {moveLabel(a.status, m)}
                </Button>
              ))}
            </div>
          )}
          {call?.kind === 'auction' && a.status === 'accepted' && (
            <LinkButton to={`/admin/lots?call=${a.callId}`} tone="secondary" size="sm" icon={<Icon.Plus />} className="pga-lot">
              Make a lot
            </LinkButton>
          )}
          <Link to={`/admin/applications?call=${a.callId}`} className="small pga-back">
            All applications to this call
          </Link>
        </aside>

        <div className="ad-split__main stack--lg">
          <section className="stack" aria-labelledby="pga-statement">
            <h2 className="eyebrow" id="pga-statement">
              Statement
            </h2>
            <p className="ops__quote pga-statement">{a.statement}</p>
          </section>

          <section className="stack" aria-labelledby="pga-works">
            <h2 className="eyebrow" id="pga-works">
              Attached works
            </h2>
            {a.works.length === 0 ? (
              <p className="small muted">None of the attached works exist any more.</p>
            ) : (
              <ul className="pga-works">
                {a.works.map((w) => (
                  <li key={w.id}>
                    <WallLabel work={w} to={`/work/${w.id}`} />
                    {w.visibility !== 'public' && <p className="tiny muted pga-works__vis">Not public: {w.visibility === 'kofi' ? 'Kofi team only' : w.visibility === 'institutions' ? 'verified institutions' : 'only the artist'}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pga-notes" aria-label="Notes">
            <div className="pga-note">
              <p className="eyebrow eyebrow--gold">Note to the artist</p>
              <p className="pga-note__text">{a.decisionNote ?? <span className="muted">No note yet.</span>}</p>
              <p className="tiny muted">Shown to {a.artistWorkingName} with the decision.</p>
            </div>
            <div className="pga-note pga-note--private">
              <p className="eyebrow pga-lock">
                <Icon.Lock aria-hidden="true" /> Private staff note
              </p>
              <p className="pga-note__text">{a.staffNote ?? <span className="muted">No staff note.</span>}</p>
              <p className="tiny muted">{call?.organizerInstitutionId ? 'Kofi and the call’s organiser. Never shown to the artist.' : 'Kofi only. Never shown to the artist.'}</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title="Application" back="/admin/applications" />
      <main className="container container--wide ad-main">{body}</main>
      {q.data?.app && <DecisionSheet app={q.data.app} move={move} onClose={close} />}
    </div>
  );
}

function DecisionSheet({ app, move, onClose }: { app: ApplicationRow; move: Move | undefined; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [decision, setDecision] = useState('');
  const [staff, setStaff] = useState('');
  const [errors, setErrors] = useState<{ decisionNote?: string; staffNote?: string; general?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!move) return;
    setDecision(app.decisionNote ?? '');
    setStaff(app.staffNote ?? '');
    setErrors({});
  }, [move, app.decisionNote, app.staffNote]);

  const go = async () => {
    if (!move) return;
    setBusy(true);
    try {
      await data.setApplicationStatus(viewer, app.id, move, { decisionNote: decision, staffNote: staff });
      toast.push(`${app.artistWorkingName}: ${APPLICATION_STATUS_LABEL[move].toLowerCase()}`, 'success');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError && (e.field === 'decisionNote' || e.field === 'staffNote')) setErrors({ [e.field]: e.message });
      else setErrors({ general: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!move}
      onClose={onClose}
      title={move ? SHEET_TITLE[move] : ''}
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button tone={move === 'declined' ? 'danger' : 'primary'} block loading={busy} onClick={go}>
            {move ? moveLabel(app.status, move) : ''}
          </Button>
        </>
      }
    >
      {move && (
        <div className="stack">
          <p className="small">
            {move === 'shortlisted'
              ? `${app.artistWorkingName} will see “Shortlisted” in their studio.`
              : move === 'accepted'
                ? `${app.artistWorkingName} will see “Selected” and your note in their studio.`
                : `${app.artistWorkingName} will see “Not selected” and your note in their studio.`}
          </p>
          {errors.general && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              {errors.general}
            </Notice>
          )}
          <div className="field">
            <label className="field__label" htmlFor="pga-decision">
              Note to the artist
            </label>
            <textarea
              id="pga-decision"
              className="textarea"
              rows={3}
              value={decision}
              maxLength={2000}
              aria-invalid={errors.decisionNote ? true : undefined}
              aria-describedby="pga-decision-hint"
              onChange={(e) => setDecision(e.target.value)}
            />
            <span className="field__hint" id="pga-decision-hint">
              Optional. Shown to the artist with the decision.
            </span>
            {errors.decisionNote && (
              <span className="field__error" role="alert">
                {errors.decisionNote}
              </span>
            )}
          </div>
          <div className="field pga-private-field">
            <label className="field__label pga-lock" htmlFor="pga-staff">
              <Icon.Lock aria-hidden="true" /> Private staff note
            </label>
            <textarea
              id="pga-staff"
              className="textarea"
              rows={3}
              value={staff}
              maxLength={2000}
              aria-invalid={errors.staffNote ? true : undefined}
              aria-describedby="pga-staff-hint"
              onChange={(e) => setStaff(e.target.value)}
            />
            <span className="field__hint" id="pga-staff-hint">
              Kofi only. The artist never sees this.
            </span>
            {errors.staffNote && (
              <span className="field__error" role="alert">
                {errors.staffNote}
              </span>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
