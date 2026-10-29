import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApplicationRow, ArtistView, ArtworkView, OpenCall } from '@/domain/types';
import { callPhase, MAX_STATEMENT, validateApplication } from '@/domain/programme';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { deadlineLabel, formatDay, formatInstantDay } from '@/features/programme/format';
import { TermsBlock } from '@/features/programme/terms';
import { effectiveCriteria, matchWork, type MatchResult } from '@/domain/matching';
import { FitReasons, LookingForBlock } from '@/features/programme/LookingFor';
import { matchCopy } from '@/features/programme/matchCopy';
import { Button, EmptyState, ErrorState, Icon, LinkButton, Notice, Skeleton, TopBar, VisibilityBadge, WallLabel } from '@/ui';
import { capitalize, focusFirstError } from './shared';

type Errors = { artworkIds?: string; statement?: string; general?: string };

function toErrors(field: string | undefined, message: string): Errors {
  if (field === 'artworkIds') return { artworkIds: message };
  if (field === 'statement') return { statement: message };
  return { general: message };
}

export function ApplyScreen() {
  const { callId = '' } = useParams();
  const q = useQuery(
    async (ds, v) => {
      const [call, artist, apps] = await Promise.all([ds.getOpenCall(v, callId), ds.getMyArtist(v), ds.listMyApplications(v).catch(() => [] as ApplicationRow[])]);
      const works = artist ? await ds.listArtistArtworks(v, artist.id) : [];
      return { call, artist, apps, works };
    },
    [callId],
  );

  if (q.error && !q.data) {
    return (
      <Shell>
        <ErrorState error={q.error} retry={q.reload} />
      </Shell>
    );
  }
  if (!q.data) {
    return (
      <Shell>
        <div className="st-split" aria-busy="true" aria-label="Loading the call">
          <Skeleton h={260} />
          <div className="stack">
            <Skeleton h={220} />
            <Skeleton h={160} />
          </div>
        </div>
      </Shell>
    );
  }

  const { call, artist, apps, works } = q.data;
  const guard = guardFor(call, artist, apps);
  if (guard) {
    return (
      <Shell>
        {guard}
        {call?.terms && !call.externalUrl && (
          <div className="sta-guard-terms">
            <TermsBlock terms={call.terms} partnerName={call.partner} title="The call’s terms" variant="compact" />
          </div>
        )}
      </Shell>
    );
  }
  return (
    <Shell>
      <ApplyForm call={call!} artist={artist!} works={works} apps={apps} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="screen">
      <TopBar title="Apply" back="/studio/opportunities" />
      <main className="container container--wide st-main">{children}</main>
    </div>
  );
}

/** Every reason the form can't be shown, each with a way forward. */
function guardFor(call: OpenCall | undefined, artist: ArtistView | undefined, apps: ApplicationRow[]): ReactNode {
  const back = (
    <LinkButton to="/studio/opportunities" tone="secondary">
      See open calls
    </LinkButton>
  );
  if (!artist) {
    return <EmptyState title="We couldn’t find your artist profile" body="Applications are made from an artist studio." actions={<LinkButton to="/account">Switch account</LinkButton>} />;
  }
  if (!call) return <EmptyState title="We couldn’t find that call" body="It may have been removed or not published yet." actions={back} />;
  if (call.externalUrl) {
    return (
      <EmptyState
        title="This call uses the partner’s form"
        body={`${call.partner ?? 'The partner'} takes applications for “${call.title}” on their own form, not in Kofi.`}
        actions={
          <>
            <a className="btn" href={call.externalUrl} target="_blank" rel="noopener noreferrer">
              Apply on partner form <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {back}
          </>
        }
      />
    );
  }
  const phase = callPhase(call);
  if (phase === 'upcoming') {
    return <EmptyState title="This call isn’t open yet" body={`“${call.title}” opens on ${formatDay(call.opensOn)}. You can prepare your works now.`} actions={back} />;
  }
  if (phase === 'closed') {
    return <EmptyState title="This call has closed" body={`Applications for “${call.title}” closed on ${formatDay(call.deadline!)}.`} actions={back} />;
  }
  if (artist.status === 'paused') {
    return <EmptyState title="Your profile is paused" body="Contact Kofi to reopen your profile before applying." actions={back} />;
  }
  if (!artist.consentVersion) {
    return (
      <EmptyState
        title="Agree to the artist terms first"
        body="Kofi needs your agreement to the artist terms before it can read an application."
        actions={<LinkButton to="/studio/consent">Read and agree</LinkButton>}
      />
    );
  }
  const existing = apps.find((a) => a.callId === call.id && a.status !== 'withdrawn');
  if (existing) {
    return (
      <EmptyState
        title="You’ve already applied"
        body={`Your application to “${call.title}” was sent on ${formatInstantDay(existing.createdAt)}. Follow it in My applications.`}
        actions={<LinkButton to="/studio/applications">My applications</LinkButton>}
      />
    );
  }
  return undefined;
}

function ApplyForm({ call, artist, works, apps }: { call: OpenCall; artist: ArtistView; works: ArtworkView[]; apps: ApplicationRow[] }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const counterId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [statement, setStatement] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const existing = useMemo(() => apps.filter((a) => a.callId === call.id), [apps, call.id]);
  const problem = validateApplication({ call, artist, works, requestedIds: selected, statement, existing });
  const clientErrors: Errors = tried && problem ? toErrors(problem.field, problem.message) : {};
  const errors: Errors = { ...clientErrors, ...serverErrors };
  const atMax = selected.length >= call.maxWorks;
  const chosen = selected.map((id) => works.find((w) => w.id === id)).filter((w): w is ArtworkView => !!w);
  const len = statement.trim().length;
  // Explainable fit per work (domain/matching). Advice only: every visible work stays selectable.
  const matches = useMemo(() => {
    const criteria = effectiveCriteria(call);
    return new Map(works.map((w) => [w.id, matchWork(w, criteria)]));
  }, [call, works]);
  const asks = works.length ? (matches.get(works[0]!.id)?.of ?? 0) : 0;

  const toggle = (w: ArtworkView) => {
    if (w.visibility === 'private') return;
    setServerErrors((e) => ({ ...e, artworkIds: undefined }));
    setSelected((cur) => (cur.includes(w.id) ? cur.filter((x) => x !== w.id) : cur.length >= call.maxWorks ? cur : [...cur, w.id]));
  };

  async function submit() {
    setTried(true);
    setServerErrors({});
    if (problem) {
      focusFirstError();
      return;
    }
    setBusy(true);
    try {
      await data.submitApplication(viewer, { callId: call.id, artworkIds: selected, statement });
      toast.push(`Application sent to Kofi for “${call.title}”`, 'success');
      nav('/studio/applications');
    } catch (e) {
      setServerErrors(e instanceof ValidationError ? toErrors(e.field, e.message) : { general: errorMessage(e) });
      focusFirstError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-split sta">
      <aside className="st-split__aside stack sta-aside" aria-label="About this call">
        <p className="eyebrow eyebrow--gold">Applying to</p>
        <h2 className="h1 sta-title">{call.title}</h2>
        <span className="rule" aria-hidden="true" />
        <CallFacts call={call} />
        <LookingForBlock call={call} headingLevel={3} id="sta-lf-title" />
        <Link to={`/calls/${call.id}`} className="small sta-readcall">
          Read the full call <Icon.ArrowRight aria-hidden="true" />
        </Link>
        <ol className="sta-steps" aria-label="Steps">
          <li data-done={selected.length > 0 || undefined}>Choose works</li>
          <li data-done={len >= 20 || undefined}>Write a statement</li>
          <li>Review and send</li>
        </ol>
      </aside>

      <form
        className="st-split__main stack--lg sta-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {errors.general && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            <p className="strong" data-invalid="true" tabIndex={-1}>
              {errors.general}
            </p>
          </Notice>
        )}

        <section className="sta-step" aria-labelledby="step-works">
          <header className="sta-step__head">
            <span className="sta-step__n" aria-hidden="true">
              1
            </span>
            <h2 className="sta-step__title" id="step-works">
              Choose works
            </h2>
            <span className="sta-counter" id={counterId} aria-live="polite" data-full={atMax || undefined}>
              {selected.length} of {call.maxWorks} selected
            </span>
          </header>
          <p className="small muted">
            Pick up to {call.maxWorks} from your studio. They’re attached in the order you choose them.
          </p>
          {works.length > 0 && <p className="small muted sta-fitnote">{asks > 0 ? matchCopy.fit.stillYours : matchCopy.fit.none}</p>}
          {works.length === 0 ? (
            <EmptyState title="Your studio has no works yet" body="Add a work first, then come back to apply." actions={<LinkButton to="/studio/work/new">Add a work</LinkButton>} />
          ) : (
            <ul className="sta-works" aria-label="Your works" data-invalid={errors.artworkIds ? 'true' : undefined} tabIndex={errors.artworkIds ? -1 : undefined}>
              {works.map((w) => (
                <li key={w.id}>
                  <WorkPick work={w} order={selected.indexOf(w.id)} atMax={atMax} onToggle={() => toggle(w)} describedBy={counterId} match={matches.get(w.id)} />
                </li>
              ))}
            </ul>
          )}
          {errors.artworkIds && (
            <p className="field__error" role="alert">
              {errors.artworkIds}
            </p>
          )}
        </section>

        <section className="sta-step" aria-labelledby="step-statement">
          <header className="sta-step__head">
            <span className="sta-step__n" aria-hidden="true">
              2
            </span>
            <h2 className="sta-step__title" id="step-statement">
              Statement
            </h2>
          </header>
          <div className="field">
            <label className="field__label" htmlFor="sta-statement">
              Why these works, for this call
            </label>
            <textarea
              id="sta-statement"
              className="textarea sta-statement"
              rows={7}
              value={statement}
              aria-invalid={errors.statement ? true : undefined}
              aria-describedby="sta-statement-hint sta-statement-count"
              onChange={(e) => {
                setStatement(e.target.value);
                if (serverErrors.statement) setServerErrors((s) => ({ ...s, statement: undefined }));
              }}
            />
            <div className="sta-statement__meta">
              <span className="field__hint" id="sta-statement-hint">
                Jurors look for a clear link to the call’s theme, how the works sit together, and one concrete detail about how they were made. Plain
                sentences are best.
              </span>
              <span className="sta-count" id="sta-statement-count" data-over={len > MAX_STATEMENT || undefined}>
                {len.toLocaleString('en-US')} / {MAX_STATEMENT.toLocaleString('en-US')}
              </span>
            </div>
            {errors.statement && (
              <span className="field__error" role="alert">
                {errors.statement}
              </span>
            )}
          </div>
        </section>

        <section className="sta-step" aria-labelledby="step-review">
          <header className="sta-step__head">
            <span className="sta-step__n" aria-hidden="true">
              3
            </span>
            <h2 className="sta-step__title" id="step-review">
              Review and send
            </h2>
          </header>
          <div className="sta-review">
            {call.terms && (
              <TermsBlock terms={call.terms} partnerName={call.partner} headingLevel={3} title="How a sale is shared" variant="compact" id="sta-terms" />
            )}
            <div className="sta-review__facts">
              <p className="eyebrow">The call</p>
              <p className="sta-review__call">{call.title}</p>
              <p className="small muted">
                {deadlineLabel(call)}
                {call.deadline ? ` · last day ${formatDay(call.deadline)}` : ''}
              </p>
            </div>
            <div>
              <p className="eyebrow">Your works</p>
              {chosen.length === 0 ? (
                <p className="small muted sta-review__none">No works chosen yet.</p>
              ) : (
                <ul className="sta-review__works" aria-label="Works you are attaching">
                  {chosen.map((w) => (
                    <li key={w.id}>
                      <WallLabel work={w} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="eyebrow">Your statement</p>
              {len ? <p className="sta-review__statement">{statement.trim()}</p> : <p className="small muted sta-review__none">No statement yet.</p>}
            </div>
            <Notice tone="cobalt" icon={<Icon.Lock />}>
              Kofi reviewers will see the works you attach, including Kofi-team-only ones. Nothing about the application is public.
            </Notice>
          </div>
          <div className="sta-submit">
            <Button type="submit" loading={busy} onClick={() => undefined}>
              Send application
            </Button>
            <LinkButton to="/studio/opportunities" tone="ghost">
              Cancel
            </LinkButton>
          </div>
        </section>
      </form>
    </div>
  );
}

export function CallFacts({ call }: { call: OpenCall }) {
  return (
    <dl className="sta-facts">
      <div>
        <dt>Deadline</dt>
        <dd>{call.deadline ? `${formatDay(call.deadline)} · ${deadlineLabel(call).toLowerCase()}` : deadlineLabel(call)}</dd>
      </div>
      <div>
        <dt>Works</dt>
        <dd>Up to {call.maxWorks}</dd>
      </div>
      <div>
        <dt>Mediums</dt>
        <dd>{call.mediums.length ? call.mediums.map(capitalize).join(', ') : 'Any medium'}</dd>
      </div>
      <div>
        <dt>Eligibility</dt>
        <dd>{call.eligibility}</dd>
      </div>
      <div>
        <dt>Fee</dt>
        <dd>{call.fee}</dd>
      </div>
      {call.award && (
        <div>
          <dt>Award</dt>
          <dd>{call.award}</dd>
        </div>
      )}
    </dl>
  );
}

function WorkPick({ work, order, atMax, onToggle, describedBy, match }: { work: ArtworkView; order: number; atMax: boolean; onToggle: () => void; describedBy: string; match?: MatchResult }) {
  const img = work.images.find((i) => i.isPrimary) ?? work.images[0];
  const on = order >= 0;
  const isPrivate = work.visibility === 'private';
  const blocked = !on && atMax && !isPrivate;
  const reasonId = `${work.id}-why`;
  return (
    <div className="sta-pick" data-on={on || undefined} data-disabled={isPrivate || blocked || undefined} data-medium={work.medium}>
      <button
        type="button"
        role="checkbox"
        className="sta-pick__btn"
        aria-checked={on}
        aria-disabled={isPrivate || blocked || undefined}
        disabled={isPrivate}
        aria-describedby={isPrivate ? reasonId : describedBy}
        onClick={() => {
          if (!blocked) onToggle();
        }}
      >
        <span className="sta-pick__img">
          {img ? <img src={img.src} alt="" loading="lazy" /> : <span className="st-thumb-empty" aria-hidden="true" />}
          <span className="sta-pick__check" aria-hidden="true">
            {on ? order + 1 : <Icon.Plus />}
          </span>
        </span>
        <span className="sta-pick__body">
          <span className="sta-pick__title">{work.title}</span>
          <span className="sta-pick__meta">
            {work.year}, {work.medium}
          </span>
        </span>
      </button>
      <div className="sta-pick__foot">
        <VisibilityBadge level={work.visibility} />
        {match && match.of > 0 && (
          <details className="fit-line" data-fits={match.fits || undefined}>
            <summary aria-label={`${matchCopy.fit.line(match.met, match.of)}. ${matchCopy.fit.whyFor(work.title)}`}>
              <span className="fit-line__dot" aria-hidden="true" />
              <span className="fit-line__text">{matchCopy.fit.line(match.met, match.of)}</span>
              <span className="fit-line__why" aria-hidden="true">
                {matchCopy.fit.why}
              </span>
            </summary>
            <FitReasons reasons={match.reasons} />
          </details>
        )}
        {isPrivate && (
          <p className="tiny sta-pick__why" id={reasonId}>
            Set to Only me — change visibility to attach.{' '}
            <Link to={`/studio/work/${work.id}`}>Edit visibility</Link>
          </p>
        )}
      </div>
    </div>
  );
}
