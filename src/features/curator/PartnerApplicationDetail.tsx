import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApplicationRow, ApplicationStatus } from '@/domain/types';
import { canMoveApplication } from '@/domain/programme';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { APPLICATION_STATUS_DOT, APPLICATION_STATUS_LABEL, deadlineLabel, formatInstantDay } from '@/features/programme/format';
import { Button, EmptyState, Icon, LinkButton, Notice, Sheet, Skeleton, StatusDot, WallLabel } from '@/ui';
import { isPartnerCurator, PartnerError, PartnerGate, PartnerShell } from './partnerShared';
import '@/features/admin/programme.css';
import '@/features/admin/admin.css';
import './curator.css';

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

export function PartnerApplicationDetail() {
  const { id = '', appId = '' } = useParams();
  const [move, setMove] = useState<Move>();
  const q = useQuery(
    async (ds, v) => {
      const curator = await ds.getMyCurator(v);
      if (!isPartnerCurator(curator)) return { curator, call: undefined, app: undefined };
      const call = await ds.getOpenCall(v, id);
      if (!call || call.organizerInstitutionId !== curator.institutionId) return { curator, call: undefined, app: undefined };
      const app = (await ds.listApplications(v, id)).find((a) => a.id === appId);
      return { curator, call, app };
    },
    [id, appId],
  );
  const back = `/curator/calls/${id}`;

  let body: React.ReactNode;
  if (q.error && !q.data) body = <PartnerError error={q.error} retry={q.reload} />;
  else if (!q.data)
    body = (
      <div className="cu-split" aria-busy="true" aria-label="Loading application">
        <Skeleton h={280} />
        <Skeleton h={420} />
      </div>
    );
  else if (!isPartnerCurator(q.data.curator)) body = <PartnerGate curator={q.data.curator} />;
  else if (!q.data.call || !q.data.app)
    body = <EmptyState title="We couldn’t find that application" body="It may belong to a call another institution runs." actions={<LinkButton to="/curator/calls">Calls you run</LinkButton>} />;
  else {
    const a = q.data.app;
    const call = q.data.call;
    const moves = (['shortlisted', 'accepted', 'declined'] as Move[]).filter((m) => canMoveApplication(a.status, m, 'admin'));
    body = (
      <div className="cu-split">
        <aside className="cu-split__aside stack" aria-label="About this application">
          <p className="eyebrow eyebrow--gold">Application</p>
          <h2 className="h1 pga-artist">{a.artistWorkingName}</h2>
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
                <Link to={back}>{a.callTitle}</Link>
                <span className="tiny muted pga-sub">{deadlineLabel(call)}</span>
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
            <div className="pga-actions pc-decide" role="group" aria-label="Decision">
              {moves.map((m) => (
                <Button key={m} size="sm" tone={m === 'accepted' ? 'primary' : m === 'declined' ? 'danger' : 'secondary'} onClick={() => setMove(m)}>
                  {moveLabel(a.status, m)}
                </Button>
              ))}
            </div>
          )}
          <p className="tiny muted">Contact details stay with Kofi. If you want to work with this artist beyond the call, ask Kofi for an introduction.</p>
          <Link to={back} className="small pga-back">
            All applications to this call
          </Link>
        </aside>

        <div className="cu-split__main stack--lg">
          <section className="stack" aria-labelledby="pc-statement">
            <h2 className="eyebrow" id="pc-statement">
              Statement
            </h2>
            <p className="ops__quote pga-statement">{a.statement}</p>
          </section>

          <section className="stack" aria-labelledby="pc-works">
            <h2 className="eyebrow" id="pc-works">
              Attached works
            </h2>
            {a.works.length === 0 ? (
              <p className="small muted">None of the attached works exist any more.</p>
            ) : (
              <ul className="pga-works pc-works">
                {a.works.map((w) => (
                  <li key={w.id}>
                    <WallLabel work={w} />
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
                <Icon.Lock aria-hidden="true" /> Reviewers’ note
              </p>
              <p className="pga-note__text">{a.staffNote ?? <span className="muted">No reviewers’ note.</span>}</p>
              <p className="tiny muted">Shared with Kofi. Never shown to the artist.</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <PartnerShell title="Application" back={back}>
      {body}
      {q.data?.app && <DecisionSheet app={q.data.app} move={move} onClose={() => setMove(undefined)} />}
    </PartnerShell>
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
              <Icon.Lock aria-hidden="true" /> Reviewers’ note · shared with Kofi
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
              Shared with Kofi. The artist never sees this.
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
