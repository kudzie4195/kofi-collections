import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { ArtistLink, ArtistView, ArtworkView, CareerStage, IntakeStep, Medium, ProfileImport, RegionPrecision } from '@/domain/types';
import { CAREER_STAGES, CONSENT_VERSION, INTAKE_STEPS, MEDIUMS } from '@/domain/types';
import { MAX_LINKS, isFetchableUrl, mergeLinks, normalizeLink, readyForReview, validateLinkInput, validateSignUp } from '@/domain/intake';
import { regionLabel } from '@/domain/visibility';
import { ConflictError, ValidationError, type ArtistPatch } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Avatar, Button, Chip, EmptyState, ErrorState, Field, Icon, Input, LinkButton, Notice, Segmented, Sheet, Skeleton, Textarea, TopBar } from '@/ui';
import { copy } from './copy';
import { ARTIST_TERMS } from './terms';
import { PlatformIcon } from './PlatformIcon';
import { ImportReview, buildApply, currentValues, mergeImports, type SuggestionKey } from './ImportReview';
import { QuickWork } from './QuickWork';
import { LinkLine, VerifyBox } from './VerifyBox';
import { clearDraft, doneSteps, firstUnfinished, isStep, loadDraft, markDone, saveDraft } from './intakeStore';
import './join.css';

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function focusFirstInvalid() {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>('.kj-col [aria-invalid="true"], .kj-col [data-invalid="true"]');
    el?.focus?.();
    el?.scrollIntoView?.({ block: 'center' });
  }, 0);
}

/* ------------------------------------------------------------------ route */

/**
 * /join and /join/:step. Visitors get step one; an artist lands on the first
 * unfinished step (or the studio once the profile has been sent); curators and
 * admins are told the intake is for artist accounts.
 */
export function JoinRoute() {
  const { step } = useParams();
  const { viewer } = useSession();
  if (viewer.role === 'curator' || viewer.role === 'admin') return <StaffStep role={viewer.role} />;
  if (viewer.role === 'public') {
    if (step && step !== 'account') return <Navigate to="/join" replace />;
    return <AccountStep />;
  }
  return <ArtistIntake step={step} />;
}

interface IntakeData {
  artist: ArtistView | undefined;
  works: ArtworkView[];
}

function ArtistIntake({ step }: { step?: string }) {
  const { viewer } = useSession();
  const nav = useNavigate();
  const q = useQuery<IntakeData>(async (ds, v) => {
    const artist = await ds.getMyArtist(v);
    const works = artist ? await ds.listArtistArtworks(v, artist.id) : [];
    return { artist, works };
  }, []);
  const shown: IntakeStep = isStep(step) && step !== 'account' ? step : 'links';

  if (q.error && !q.data) {
    return (
      <Shell step={shown}>
        <ErrorState error={q.error} retry={q.reload} />
      </Shell>
    );
  }
  if (!q.data) {
    return (
      <Shell step={shown}>
        <div className="stack" aria-busy="true" aria-label={copy.loading}>
          <Skeleton h={48} />
          <Skeleton h={48} />
          <Skeleton h={120} />
        </div>
      </Shell>
    );
  }
  const { artist, works } = q.data;
  if (!artist) {
    return (
      <Shell step={shown}>
        <EmptyState title={copy.loading} actions={<LinkButton to="/studio">{copy.verify.studio}</LinkButton>} />
      </Shell>
    );
  }
  // Once the profile has been sent, the intake is done: every /join route goes to the studio.
  if (artist.status !== 'draft') return <ToStudio live={artist.status === 'approved'} />;
  if (!isStep(step) || step === 'account') {
    return <Navigate to={`/join/${firstUnfinished(artist, works.length, doneSteps(viewer.userId))}`} replace />;
  }
  const go = (s: IntakeStep) => nav(`/join/${s}`);
  switch (step) {
    case 'links':
      return <LinksStep key="links" artist={artist} go={go} />;
    case 'about':
      return <AboutStep key="about" artist={artist} go={go} />;
    case 'work':
      return <WorkStep key="work" artist={artist} works={works} go={go} />;
    case 'verify':
      return <VerifyStep key="verify" artist={artist} works={works} />;
  }
}

/** Set when this tab has just sent the profile, so the studio redirect does not toast twice. */
let justSent = 0;

function ToStudio({ live }: { live: boolean }) {
  const toast = useToast();
  useEffect(() => {
    if (Date.now() - justSent > 4000) toast.push(live ? copy.verify.redirect.live : copy.verify.redirect.pending, 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Navigate to="/studio" replace />;
}

/* ------------------------------------------------------------------ shell */

function Shell({ step, title, lede, children, member }: { step: IntakeStep; title?: string; lede?: ReactNode; children: ReactNode; member?: boolean }) {
  const n = INTAKE_STEPS.indexOf(step) + 1;
  const prev = INTAKE_STEPS[n - 2];
  const back = prev && prev !== 'account' && member ? `/join/${prev}` : true;
  const h1 = useRef<HTMLHeadingElement>(null);
  // Moving between steps is a page change: put focus on the new heading for screen readers.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.closest('.kj-col')) return;
    h1.current?.focus({ preventScroll: true });
  }, [step]);
  return (
    <div className="screen kj">
      <TopBar title={copy.topbar} subordinate back={back} />
      <main className="container container--wide kj-main">
        <div className="kj-layout">
          <aside className="kj-aside" aria-label={copy.aside.title}>
            <p className="eyebrow eyebrow--gold">{copy.aside.eyebrow}</p>
            <p className="kj-aside__title">{copy.aside.title}</p>
            <ol className="kj-steps">
              {INTAKE_STEPS.map((s, i) => {
                const state = i + 1 < n ? 'done' : i + 1 === n ? 'current' : 'todo';
                const label = (
                  <>
                    <span className="kj-steps__num" aria-hidden="true">
                      {state === 'done' ? <Icon.Check width={14} height={14} /> : i + 1}
                    </span>
                    <span>{copy.steps[s]}</span>
                  </>
                );
                return (
                  <li key={s} className={`kj-steps__item kj-steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                    {member && s !== 'account' && state !== 'current' ? <Link to={`/join/${s}`}>{label}</Link> : <span className="kj-steps__static">{label}</span>}
                  </li>
                );
              })}
            </ol>
            <p className="kj-aside__body">{copy.aside.body}</p>
            <p className="kj-aside__note">{copy.aside.note}</p>
          </aside>
          <div className="kj-col">
            <div className="kj-progress">
              <p className="kj-progress__label">{copy.progress(n, INTAKE_STEPS.length, copy.steps[step])}</p>
              <div className="kj-progress__track" aria-hidden="true">
                <span style={{ width: `${(n / INTAKE_STEPS.length) * 100}%` }} />
              </div>
            </div>
            {title && (
              <h1 className="kj-title" ref={h1} tabIndex={-1}>
                {title}
              </h1>
            )}
            {lede && <p className="kj-lede">{lede}</p>}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------ step 1: account */

function AccountStep() {
  const { data, signInAs, refreshIdentities } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const c = copy.account;
  const [draft, setDraft] = useState(loadDraft);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => saveDraft(draft), [draft]);

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    const field = k === 'consent' ? 'consentVersion' : k;
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
    if (k === 'email') setConflict(false);
  };

  async function submit() {
    const input = { displayName: draft.displayName.trim(), email: draft.email.trim(), password, consentVersion: draft.consent ? CONSENT_VERSION : '' };
    const problem = validateSignUp(input);
    if (problem) {
      setErrors({ [problem.field]: problem.message });
      focusFirstInvalid();
      return;
    }
    setBusy(true);
    try {
      const r = await data.signUpArtist(input);
      if (r.emailConfirmationRequired) {
        setSentTo(input.email);
        setBusy(false);
        return;
      }
      const identity = r.identity ?? { id: r.viewer.userId ?? `user_${Date.now()}`, label: r.viewer.displayName ?? input.displayName, caption: c.identityCaption, viewer: r.viewer };
      clearDraft();
      setPassword('');
      // Same path as the account picker: the session takes the viewer the data source returned.
      signInAs({ ...identity, viewer: r.viewer });
      // The new identity joins the account picker without a reload.
      void refreshIdentities().catch(() => undefined);
      nav('/join/links', { replace: true });
    } catch (e) {
      setBusy(false);
      if (e instanceof ConflictError) {
        setErrors({ email: e.message });
        setConflict(true);
        focusFirstInvalid();
      } else if (e instanceof ValidationError && e.field) {
        setErrors({ [e.field]: e.message });
        focusFirstInvalid();
      } else {
        toast.push(errorMessage(e), 'error');
      }
    }
  }

  if (sentTo) {
    return (
      <Shell step="account" title={c.checkEmail.title} lede={c.checkEmail.body(sentTo)}>
        <p className="kj-quiet">
          {c.checkEmail.wrong}{' '}
          <button type="button" className="kj-textlink" onClick={() => setSentTo(undefined)}>
            {c.checkEmail.fix}
          </button>
        </p>
      </Shell>
    );
  }

  return (
    <Shell step="account" title={c.title} lede={c.lede}>
      <form
        className="kj-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input label={c.name} hint={c.nameHint} autoComplete="name" value={draft.displayName} error={errors.displayName} onChange={(e) => set('displayName', e.target.value)} />
        <Input label={c.email} hint={c.emailHint} type="email" inputMode="email" autoComplete="email" value={draft.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
        {conflict && (
          <p className="kj-quiet kj-conflict">
            <Link to="/account" className="kj-textlink">
              {c.conflictSignIn}
            </Link>
          </p>
        )}
        <div className="kj-password">
          <Input
            label={c.password}
            hint={c.passwordHint}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            error={errors.password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors((x) => ({ ...x, password: '' }));
            }}
          />
          <button type="button" className="kj-password__toggle" aria-label={show ? c.hidePasswordLabel : c.showPasswordLabel} aria-pressed={show} onClick={() => setShow((s) => !s)}>
            {show ? c.hidePassword : c.showPassword}
          </button>
        </div>
        <div className="field kj-consent" data-invalid={errors.consentVersion ? 'true' : undefined} tabIndex={errors.consentVersion ? -1 : undefined}>
          <label className="kj-tick">
            <input
              type="checkbox"
              checked={draft.consent}
              aria-invalid={errors.consentVersion ? true : undefined}
              aria-describedby={errors.consentVersion ? 'kj-consent-err' : undefined}
              onChange={(e) => set('consent', e.target.checked)}
            />
            <span>{c.consent}</span>
          </label>
          <button type="button" className="kj-textlink kj-consent__read" onClick={() => setTermsOpen(true)}>
            {c.consentRead}
          </button>
          {errors.consentVersion && (
            <span className="field__error" id="kj-consent-err" role="alert">
              {errors.consentVersion}
            </span>
          )}
        </div>
        <div className="kj-actions">
          <Button type="submit" loading={busy}>
            {c.submit}
          </Button>
        </div>
        <p className="kj-quiet">
          {c.haveOne}{' '}
          <Link to="/account" className="kj-textlink">
            {c.signIn}
          </Link>
        </p>
      </form>
      <Sheet open={termsOpen} onClose={() => setTermsOpen(false)} title={copy.terms.title}>
        <p className="small muted">{copy.terms.intro}</p>
        <ol className="kj-terms">
          {ARTIST_TERMS.map((t) => (
            <li key={t.title}>
              <h3 className="kj-terms__title">{t.title}</h3>
              <p className="small">{t.body}</p>
            </li>
          ))}
        </ol>
        <p className="tiny muted">{CONSENT_VERSION}</p>
      </Sheet>
    </Shell>
  );
}

function StaffStep({ role }: { role: 'curator' | 'admin' }) {
  const { signOut } = useSession();
  const c = copy.account.staff;
  return (
    <Shell step="account" title={c.title} lede={role === 'curator' ? c.curator : c.admin}>
      <div className="kj-actions">
        <Button onClick={signOut}>{c.signOut}</Button>
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------- step 2: links */

type RunStatus = 'waiting' | 'reading' | 'done';
interface Run {
  link: ArtistLink;
  status: RunStatus;
  found?: number;
  note?: string;
}

function detailCount(imp: ProfileImport): number {
  const f = imp.fields;
  return [f.workingName, f.bio, f.photoUrl, f.city || f.region || f.country, f.links?.length].filter(Boolean).length;
}

function LinksStep({ artist, go }: { artist: ArtistView; go: (s: IntakeStep) => void }) {
  const { data, viewer } = useSession();
  const toast = useToast();
  const c = copy.links;
  const [links, setLinks] = useState<ArtistLink[]>(artist.links);
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string>();
  const [runs, setRuns] = useState<Run[]>();
  const [imports, setImports] = useState<ProfileImport[]>();
  const [applying, setApplying] = useState(false);

  const merged = useMemo(() => (imports ? mergeImports(imports, links) : undefined), [imports, links]);

  async function persist(next: ArtistLink[]) {
    const before = links;
    setLinks(next);
    try {
      await data.updateMyArtist(viewer, { links: next });
    } catch (e) {
      setLinks(before);
      toast.push(errorMessage(e), 'error');
    }
  }

  function add() {
    const problem = validateLinkInput(raw, links);
    if (problem) {
      setErr(problem.message);
      return;
    }
    const n = normalizeLink(raw)!;
    if (!isFetchableUrl(n.url)) {
      setErr(c.privateHost);
      return;
    }
    setErr(undefined);
    setRaw('');
    void persist(mergeLinks(links, [{ label: n.label, url: n.url, platform: n.platform, handle: n.handle, verification: 'claimed' }]));
  }

  async function pull() {
    const list = links.map<Run>((link) => ({ link, status: 'waiting' }));
    setRuns(list);
    const out: ProfileImport[] = [];
    for (let i = 0; i < list.length; i++) {
      setRuns((r) => r?.map((x, j) => (j === i ? { ...x, status: 'reading' } : x)));
      let patch: Partial<Run>;
      try {
        const imp = await data.importProfile(viewer, list[i]!.link.url);
        out.push(imp);
        patch = { found: detailCount(imp), note: imp.notes.join(' ') || undefined };
      } catch (e) {
        // A link we cannot read is a note on its line, never an error toast.
        patch = { found: 0, note: errorMessage(e) };
      }
      setRuns((r) => r?.map((x, j) => (j === i ? { ...x, ...patch, status: 'done' } : x)));
    }
    setImports(out);
  }

  async function use(ticked: Set<SuggestionKey>) {
    if (!imports || !merged) return;
    const { patch, records } = buildApply(imports, merged.suggestions, ticked, artist);
    setApplying(true);
    try {
      if (Object.keys(patch).length) await data.updateMyArtist(viewer, patch);
      for (const r of records) await data.recordImport(viewer, r);
      markDone(viewer.userId, 'links');
      go('about');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
      setApplying(false);
    }
  }

  function skip() {
    markDone(viewer.userId, 'links');
    go('about');
  }

  return (
    <Shell step="links" title={c.title} lede={c.lede} member>
      <div className="kj-form">
        {!runs && (
          <>
            <form
              className="kj-addlink"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Field label={c.input} hint={c.inputHint} error={err}>
                {(id, describedBy) => (
                  <div className="kj-addlink__row">
                    <input
                      id={id}
                      className="input"
                      aria-describedby={describedBy}
                      aria-invalid={err ? true : undefined}
                      value={raw}
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="@yourname"
                      onChange={(e) => {
                        setRaw(e.target.value);
                        if (err) setErr(undefined);
                      }}
                    />
                    <Button type="submit" tone="secondary" icon={<Icon.Plus />} disabled={links.length >= MAX_LINKS}>
                      {c.add}
                    </Button>
                  </div>
                )}
              </Field>
            </form>
            <div className="kj-listhead">
              <span className="kj-listhead__count">{c.count(links.length, MAX_LINKS)}</span>
            </div>
            {links.length ? (
              <ul className="kj-linklist">
                {links.map((l) => (
                  <LinkLine
                    key={l.url}
                    link={l}
                    action={<Button tone="ghost" icon={<Icon.Close />} aria-label={c.remove(l.handle || l.label)} onClick={() => void persist(links.filter((x) => x.url !== l.url))} />}
                  />
                ))}
              </ul>
            ) : (
              <p className="kj-quiet">{c.empty}</p>
            )}
            <div className="kj-actions">
              <Button onClick={() => void pull()} disabled={!links.length}>
                {c.pull}
              </Button>
              <Button tone="ghost" onClick={skip}>
                {c.skip}
              </Button>
            </div>
          </>
        )}

        {runs && (
          <ul className="kj-runs" aria-live="polite">
            {runs.map((r) => (
              <li key={r.link.url} className={`kj-run kj-run--${r.status}`}>
                <span className="kj-linkline__icon">
                  <PlatformIcon platform={r.link.platform} />
                </span>
                <span className="kj-run__text">
                  <span className="kj-linkline__handle">{r.link.handle || r.link.label}</span>
                  <span className="kj-run__status">
                    {r.status === 'waiting' ? c.status.waiting : r.status === 'reading' ? c.status.reading : r.found ? c.status.found(r.found) : c.status.nothing}
                    {r.status === 'done' && r.note ? <span className="kj-run__note"> {r.note}</span> : null}
                  </span>
                </span>
                {r.status === 'reading' && <span className="kj-spinner" aria-hidden="true" />}
                {r.status === 'done' && (r.found ? <Icon.Check className="kj-run__ok" /> : <span className="kj-run__dash" aria-hidden="true" />)}
              </li>
            ))}
          </ul>
        )}

        {imports && merged && (
          <ImportReview
            imports={imports}
            suggestions={merged.suggestions}
            photo={merged.photo}
            found={merged.found}
            current={currentValues(artist)}
            busy={applying}
            onUse={(t) => void use(t)}
            onSkip={skip}
            onAddFound={(l) => void persist(mergeLinks(links, [l]))}
          />
        )}
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------- step 3: about */

interface AboutForm {
  workingName: string;
  city: string;
  region: string;
  country: string;
  precision: RegionPrecision;
  bio: string;
  mediums: Medium[];
  careerStage: CareerStage;
  commissions: boolean;
  sales: boolean;
  exhibitions: boolean;
}

function aboutForm(artist: ArtistView): AboutForm {
  const r = artist.region ?? { region: '', country: '', precision: 'region' as const };
  return {
    workingName: artist.workingName,
    city: r.city ?? '',
    region: r.region,
    country: r.country,
    // "Show as city" with no city on file would block Continue on a field nobody asked for.
    precision: r.precision === 'city' && !r.city?.trim() ? 'region' : r.precision,
    bio: artist.bio,
    mediums: [...artist.mediums],
    careerStage: artist.careerStage,
    commissions: artist.availability.commissions,
    sales: artist.availability.sales,
    exhibitions: artist.availability.exhibitions,
  };
}

function AboutStep({ artist, go }: { artist: ArtistView; go: (s: IntakeStep) => void }) {
  const { data, viewer } = useSession();
  const toast = useToast();
  const c = copy.about;
  const [f, setF] = useState<AboutForm>(() => aboutForm(artist));
  // The profile may still be refreshing after step two wrote to it: follow it until the artist types.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setF(aboutForm(artist));
  }, [artist]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AboutForm>(k: K, v: AboutForm[K]) => {
    touched.current = true;
    setF((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };
  const shownAs = useMemo(() => {
    if (!f.region.trim() || !f.country.trim()) return '';
    return regionLabel({ city: f.city.trim() || undefined, region: f.region.trim(), country: f.country.trim(), precision: f.precision });
  }, [f]);
  const bioLen = f.bio.trim().length;

  async function save() {
    const e: Record<string, string> = {};
    if (!f.workingName.trim()) e.workingName = c.errors.workingName;
    if (!f.region.trim()) e.region = c.errors.region;
    if (!f.country.trim()) e.country = c.errors.country;
    if (f.precision === 'city' && !f.city.trim()) e.city = c.errors.city;
    if (bioLen < 40) e.bio = c.errors.bio;
    if (!f.mediums.length) e.mediums = c.errors.mediums;
    setErrors(e);
    if (Object.keys(e).length) {
      focusFirstInvalid();
      return;
    }
    const patch: ArtistPatch = {
      workingName: f.workingName.trim(),
      bio: f.bio.trim(),
      region: { region: f.region.trim(), country: f.country.trim(), precision: f.precision, ...(f.city.trim() ? { city: f.city.trim() } : {}) },
      mediums: f.mediums,
      careerStage: f.careerStage,
      availability: { commissions: f.commissions, sales: f.sales, exhibitions: f.exhibitions },
    };
    setBusy(true);
    try {
      await data.updateMyArtist(viewer, patch);
      markDone(viewer.userId, 'about');
      go('work');
    } catch (err) {
      setBusy(false);
      if (err instanceof ValidationError && err.field) {
        setErrors({ [err.field]: err.message });
        focusFirstInvalid();
      } else toast.push(errorMessage(err), 'error');
    }
  }

  return (
    <Shell step="about" title={c.title} lede={c.lede} member>
      <form
        className="kj-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input label={c.workingName} hint={c.workingNameHint} value={f.workingName} error={errors.workingName} autoComplete="name" onChange={(e) => set('workingName', e.target.value)} />
        <Input label={c.city} value={f.city} error={errors.city} autoComplete="address-level2" onChange={(e) => set('city', e.target.value)} />
        <div className="kj-row2">
          <Input label={c.region} value={f.region} error={errors.region} autoComplete="address-level1" onChange={(e) => set('region', e.target.value)} />
          <Input label={c.country} value={f.country} error={errors.country} autoComplete="country-name" onChange={(e) => set('country', e.target.value)} />
        </div>
        <div className="field">
          <span className="field__label" aria-hidden="true">
            {c.precision}
          </span>
          <Segmented<RegionPrecision>
            label={c.precision}
            value={f.precision}
            onChange={(v) => set('precision', v)}
            options={[
              { value: 'city', label: c.precisionCity },
              { value: 'region', label: c.precisionRegion },
              { value: 'country', label: c.precisionCountry },
            ]}
          />
          <span className="kj-shownas" aria-live="polite">
            <Icon.Globe aria-hidden="true" />
            {c.shownAs}: <strong>{shownAs || c.shownAsEmpty}</strong>
          </span>
        </div>
        <Textarea label={c.bio} hint={`${c.bioHint} ${c.bioCount(bioLen)}`} rows={5} value={f.bio} error={errors.bio} onChange={(e) => set('bio', e.target.value)} />
        <div className="field" role="group" aria-labelledby="kj-mediums-label" data-invalid={errors.mediums ? 'true' : undefined} tabIndex={errors.mediums ? -1 : undefined}>
          <span className="field__label" id="kj-mediums-label">
            {c.mediums}
          </span>
          <div className="chips">
            {MEDIUMS.map((m) => {
              const on = f.mediums.includes(m);
              return (
                <Chip key={m} medium={m} on={on} onClick={() => set('mediums', on ? f.mediums.filter((x) => x !== m) : [...f.mediums, m])}>
                  {on && <Icon.Check width={14} height={14} />}
                  {cap(m)}
                </Chip>
              );
            })}
          </div>
          {errors.mediums ? (
            <span className="field__error" role="alert">
              {errors.mediums}
            </span>
          ) : (
            <span className="field__hint">{c.mediumsHint}</span>
          )}
        </div>
        <div className="field">
          <span className="field__label" aria-hidden="true">
            {c.stage}
          </span>
          <Segmented<CareerStage> label={c.stage} value={f.careerStage} onChange={(v) => set('careerStage', v)} options={CAREER_STAGES.map((s) => ({ value: s, label: c.stages[s] }))} />
        </div>
        <fieldset className="kj-fieldset">
          <legend className="field__label">{c.available}</legend>
          <div className="kj-ticks">
            {(['commissions', 'sales', 'exhibitions'] as const).map((k) => (
              <label key={k} className="kj-tick kj-tick--inline">
                <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
                <span>{c[k]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {Object.values(errors).some(Boolean) && <p className="field__error">{c.errors.fix}</p>}
        <div className="kj-actions">
          <Button type="submit" loading={busy}>
            {c.continue}
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/* --------------------------------------------------------- step 4: work */

function WorkStep({ artist, works, go }: { artist: ArtistView; works: ArtworkView[]; go: (s: IntakeStep) => void }) {
  const { viewer } = useSession();
  const c = copy.work;
  const [open, setOpen] = useState(works.length === 0);

  function next() {
    markDone(viewer.userId, 'work');
    go('verify');
  }

  return (
    <Shell step="work" title={c.title} lede={c.lede} member>
      <div className="kj-form">
        {works.length > 0 && (
          <section aria-labelledby="kj-works-title">
            <h2 id="kj-works-title" className="kj-subtitle">
              {c.listTitle}
            </h2>
            <ul className="kj-works">
              {works.map((w) => {
                const im = w.images.find((i) => i.isPrimary) ?? w.images[0];
                return (
                  <li key={w.id} className="kj-workrow">
                    <span className="kj-workrow__thumb">{im ? <img src={im.src} alt="" /> : <span className="star" aria-hidden="true" />}</span>
                    <span className="kj-workrow__text">
                      <span className="kj-workrow__title">{w.title}</span>
                      <span className="kj-workrow__meta">
                        {[w.year, cap(w.medium), w.materials.join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {open ? (
          <QuickWork artist={artist} onSaved={() => setOpen(false)} onCancel={works.length ? () => setOpen(false) : undefined} />
        ) : (
          <div>
            <Button tone="secondary" size="sm" icon={<Icon.Plus />} onClick={() => setOpen(true)}>
              {c.addAnother}
            </Button>
          </div>
        )}

        {works.length === 0 && <p className="kj-quiet">{c.none}</p>}
        <div className="kj-actions kj-actions--end">
          <Button tone={open ? 'secondary' : 'primary'} onClick={next}>
            {c.continue}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------- step 5: verify */

function VerifyStep({ artist, works }: { artist: ArtistView; works: ArtworkView[] }) {
  const { data, viewer } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const c = copy.verify;
  const [links, setLinks] = useState<ArtistLink[]>(artist.links);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  useEffect(() => setLinks(artist.links), [artist.links]);

  const region = artist.region ?? { region: '', country: '', precision: 'region' as const };
  const missing = readyForReview({ ...artist, region }, works.length);
  const needsTerms = artist.consentVersion !== CONSENT_VERSION;
  const textMissing = needsTerms ? missing.slice(0, -1) : missing;

  async function check() {
    setChecking(true);
    try {
      const next = await data.checkMyLinks(viewer);
      setLinks(next);
      const unread = next.filter((l) => l.verification === 'unreachable').length;
      if (unread) toast.push(copy.verifyBox.unreadable(unread), 'info');
      else if (next.length && next.every((l) => l.verification === 'verified')) toast.push(copy.verifyBox.allVerified, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setChecking(false);
    }
  }

  async function send() {
    setSending(true);
    setSendError(undefined);
    try {
      // A new profile is private; it goes public when Kofi approves it, not before.
      if (artist.visibility !== 'public') await data.updateMyArtist(viewer, { visibility: 'public' });
      justSent = Date.now();
      await data.submitForReview(viewer);
      toast.push(c.sent, 'success');
      nav('/studio');
    } catch (e) {
      setSending(false);
      setSendError(errorMessage(e));
    }
  }

  const rows: { label: string; value: ReactNode; to: IntakeStep }[] = [
    { label: copy.links.review.location, value: region.region && region.country ? artist.regionLabel || regionLabel(region) : c.noLocation, to: 'about' },
    { label: copy.about.mediums, value: artist.mediums.length ? artist.mediums.map(cap).join(', ') : c.noMediums, to: 'about' },
    { label: copy.steps.work, value: c.works(works.length), to: 'work' },
    { label: c.linksTitle, value: links.length ? links.map((l) => l.handle || l.label).join(', ') : c.notYet, to: 'links' },
  ];

  return (
    <Shell step="verify" title={c.title} lede={c.lede} member>
      <div className="kj-form">
        <section className="kj-summary" aria-labelledby="kj-summary-title">
          <div className="kj-summary__head">
            <Avatar name={artist.workingName || '?'} color={artist.avatarColor} size="lg" />
            <h2 id="kj-summary-title" className="kj-summary__name">
              {artist.workingName}
            </h2>
          </div>
          <dl className="kj-summary__rows">
            {rows.map((r) => (
              <div key={r.label} className="kj-summary__row">
                <dt>{r.label}</dt>
                <dd>
                  <span className="kj-summary__value">{r.value}</span>
                  <Link to={`/join/${r.to}`} className="kj-textlink kj-summary__edit" aria-label={`${c.edit} ${r.label.toLowerCase()}`}>
                    {c.edit}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <VerifyBox token={artist.verificationToken} links={links} onCheck={() => void check()} checking={checking} />

        {artist.status === 'draft' && (textMissing.length > 0 || needsTerms) && (
          <section className="kj-missing" aria-labelledby="kj-missing-title">
            <h2 id="kj-missing-title" className="kj-subtitle">
              {c.missingTitle}
            </h2>
            <ul>
              {textMissing.map((m) => (
                <li key={m}>
                  <Icon.Info aria-hidden="true" />
                  <span>{m}</span>
                </li>
              ))}
              {needsTerms && (
                <li>
                  <Icon.Info aria-hidden="true" />
                  <Link to="/studio/consent" state={{ next: 'submit' }} className="kj-textlink">
                    {c.acceptTerms}
                  </Link>
                </li>
              )}
            </ul>
          </section>
        )}
        {sendError && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            {sendError}
          </Notice>
        )}

        {artist.status === 'draft' ? (
          <div className="kj-actions kj-actions--send">
            <p className="kj-quiet kj-actions__note">{c.goesPublic}</p>
            <Button onClick={() => void send()} loading={sending} disabled={missing.length > 0}>
              {c.send}
            </Button>
          </div>
        ) : (
          <>
            <Notice tone={artist.status === 'approved' ? 'lime' : 'butter'} icon={<Icon.Check />}>
              {artist.status === 'approved' ? c.approved : c.pending}
            </Notice>
            <div className="kj-actions">
              <LinkButton to="/studio">{c.studio}</LinkButton>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
