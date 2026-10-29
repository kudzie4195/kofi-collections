import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CallKind, CallTerms, Exhibition, Medium, OpenCall } from '@/domain/types';
import { CALL_KIND_LABEL, CALL_KINDS } from '@/domain/types';
import { kofiToday } from '@/domain/programme';
import { DEFAULT_TERMS, validateTerms } from '@/domain/sales';
import type { CuratorRow, ProgrammeInput } from '@/data/DataSource';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, EmptyState, Icon, Input, LinkButton, Notice, Select, Skeleton, Textarea } from '@/ui';
import { focusFirstError, useUnsavedGuard } from '@/features/studio/shared';
import { BLANK_CRITERIA, criteriaErrors, CriteriaFields, criteriaToForm, formToCriteria, isCriteriaKey, MediumChips, type CriteriaForm } from '@/features/admin/ProgrammeFields';
import { matchCopy } from '@/features/programme/matchCopy';
import { splitExample, termsSentence } from '@/features/programme/terms';
import { isPartnerCurator, PartnerError, PartnerGate, PartnerShell } from './partnerShared';
import '@/features/admin/programme.css';
import '@/features/admin/admin.css';
import './curator.css';

/* ---------------- form model ---------------- */

type PctKey = 'artistSharePct' | 'kofiSharePct' | 'partnerSharePct' | 'buyerPremiumPct' | 'resaleRoyaltyPct';
const PCT_KEYS: PctKey[] = ['artistSharePct', 'kofiSharePct', 'partnerSharePct', 'buyerPremiumPct', 'resaleRoyaltyPct'];

interface Form {
  title: string;
  kind: CallKind;
  summary: string;
  body: string;
  eligibility: string;
  mediums: Medium[];
  opensOn: string;
  deadline: string;
  maxWorks: string;
  fee: string;
  award: string;
  externalUrl: string;
  exhibitionId: string;
  /** Percentages as typed. */
  pct: Record<PctKey, string>;
  currency: string;
  paymentNote: string;
  /** v6: "Looking for" criteria as typed. */
  criteria: CriteriaForm;
}
type Errors = Record<string, string | undefined>;

function pctStrings(t: CallTerms): Record<PctKey, string> {
  return Object.fromEntries(PCT_KEYS.map((k) => [k, String(t[k])])) as Record<PctKey, string>;
}

function blankForm(): Form {
  return {
    title: '',
    kind: 'exhibition',
    summary: '',
    body: '',
    eligibility: '',
    mediums: [],
    opensOn: kofiToday(),
    deadline: '',
    maxWorks: '3',
    fee: 'No entry fee',
    award: '',
    externalUrl: '',
    exhibitionId: '',
    pct: pctStrings(DEFAULT_TERMS),
    currency: DEFAULT_TERMS.currency,
    paymentNote: '',
    criteria: { ...BLANK_CRITERIA, tagIds: [], uses: [] },
  };
}

function fromCall(c: OpenCall): Form {
  const t = c.terms ?? DEFAULT_TERMS;
  return {
    title: c.title,
    kind: c.kind,
    summary: c.summary,
    body: c.body,
    eligibility: c.eligibility,
    mediums: [...c.mediums],
    opensOn: c.opensOn,
    deadline: c.deadline ?? '',
    maxWorks: String(c.maxWorks),
    fee: c.fee,
    award: c.award ?? '',
    externalUrl: c.externalUrl ?? '',
    exhibitionId: c.exhibitionId ?? '',
    pct: pctStrings(t),
    currency: t.currency,
    paymentNote: t.paymentNote ?? '',
    criteria: criteriaToForm(c.lookingFor),
  };
}

/** Whole numbers only; anything else becomes NaN so validateTerms names the field. */
function pctOf(s: string): number {
  const t = s.trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : Number.NaN;
}

export function termsOf(f: Pick<Form, 'pct' | 'currency' | 'paymentNote'>): CallTerms {
  const t: CallTerms = {
    artistSharePct: pctOf(f.pct.artistSharePct),
    kofiSharePct: pctOf(f.pct.kofiSharePct),
    partnerSharePct: pctOf(f.pct.partnerSharePct),
    buyerPremiumPct: pctOf(f.pct.buyerPremiumPct),
    resaleRoyaltyPct: pctOf(f.pct.resaleRoyaltyPct),
    currency: f.currency.trim().toUpperCase(),
  };
  if (f.paymentNote.trim()) t.paymentNote = f.paymentNote.trim();
  return t;
}

const opt = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

function toInput(f: Form, existing: OpenCall | undefined, institutionName: string): ProgrammeInput<OpenCall> {
  const input: ProgrammeInput<OpenCall> = {
    id: existing?.id,
    // The data layer forces these for a partner; sent as they are so nothing is implied.
    published: existing?.published ?? false,
    sample: existing?.sample ?? false,
    title: f.title.trim(),
    kind: f.kind,
    partner: institutionName,
    summary: f.summary.trim(),
    body: f.body.trim(),
    eligibility: f.eligibility.trim(),
    mediums: f.mediums,
    opensOn: f.opensOn,
    maxWorks: Number(f.maxWorks),
    fee: f.fee.trim(),
  };
  const deadline = opt(f.deadline);
  if (deadline) input.deadline = deadline;
  const award = opt(f.award);
  if (award) input.award = award;
  const url = opt(f.externalUrl);
  if (url) input.externalUrl = url;
  const ex = opt(f.exhibitionId);
  if (ex) input.exhibitionId = ex;
  if (existing?.image) input.image = existing.image;
  // Always sent (undefined when the section is empty) so clearing it removes the stored criteria.
  input.lookingFor = formToCriteria(f.criteria);
  if (f.kind === 'auction') input.terms = termsOf(f);
  else if (existing?.terms) input.terms = existing.terms; // terms of other kinds are kept as Kofi set them
  return input;
}

/** Instant checks before the server's; the server's answer always wins. */
function clientErrors(f: Form): Errors {
  const e: Errors = {};
  if (!f.title.trim()) e.title = 'Give the call a title.';
  if (!f.summary.trim()) e.summary = 'Write a sentence or two for cards and lists.';
  if (!f.eligibility.trim()) e.eligibility = 'Say who can apply.';
  if (!f.opensOn) e.opensOn = 'Choose the day the call opens.';
  if (f.deadline && f.opensOn && f.deadline < f.opensOn) e.deadline = 'The deadline is before the call opens.';
  const n = Number(f.maxWorks);
  if (!Number.isInteger(n) || n < 1 || n > 10) e.maxWorks = 'Allow between 1 and 10 works.';
  if (!f.fee.trim()) e.fee = 'State the fee, e.g. “No entry fee”.';
  if (f.kind === 'auction') {
    const p = validateTerms(termsOf(f));
    if (p) e[p.field] = p.message;
  }
  Object.assign(e, criteriaErrors(f.criteria));
  return e;
}

/* ---------------- routes ---------------- */

export function PartnerCallNew() {
  return <PartnerCallEditor key="new" />;
}

export function PartnerCallEdit() {
  const { id = '' } = useParams();
  return <PartnerCallEditor key={id} id={id} />;
}

function PartnerCallEditor({ id }: { id?: string }) {
  const isNew = !id;
  const q = useQuery(
    async (ds, v) => {
      const curator = await ds.getMyCurator(v);
      if (!isPartnerCurator(curator)) return { curator, call: undefined, exhibitions: [] as Exhibition[] };
      const [call, exhibitions] = await Promise.all([id ? ds.getOpenCall(v, id) : Promise.resolve(undefined), ds.listExhibitions(v)]);
      return { curator, call, exhibitions };
    },
    [id],
  );
  const title = isNew ? 'New call' : 'Edit call';
  const back = id ? `/curator/calls/${id}` : '/curator/calls';

  if (q.error && !q.data) {
    return (
      <PartnerShell title={title} back={back}>
        <PartnerError error={q.error} retry={q.reload} />
      </PartnerShell>
    );
  }
  if (!q.data) {
    return (
      <PartnerShell title={title} back={back}>
        <div className="pg-editor" aria-busy="true" aria-label="Loading">
          <div className="stack">
            <Skeleton h={56} />
            <Skeleton h={56} />
            <Skeleton h={160} />
          </div>
          <Skeleton h={300} />
        </div>
      </PartnerShell>
    );
  }
  const { curator, call, exhibitions } = q.data;
  if (!isPartnerCurator(curator)) {
    return (
      <PartnerShell title={title} back="/curator">
        <PartnerGate curator={curator} />
      </PartnerShell>
    );
  }
  if (id && (!call || call.organizerInstitutionId !== curator.institutionId)) {
    return (
      <PartnerShell title={title} back="/curator/calls">
        <EmptyState title="We couldn’t find that call" body="It may have been removed, or another institution runs it." actions={<LinkButton to="/curator/calls">Calls you run</LinkButton>} />
      </PartnerShell>
    );
  }
  if (call?.published) {
    return (
      <PartnerShell title={title} back={back}>
        <EmptyState
          title="Kofi has published this call"
          body="Published calls are edited by Kofi so artists who have already read it are never surprised. Ask Kofi for any change."
          actions={
            <>
              <LinkButton to={`/curator/calls/${call.id}`}>Review applications</LinkButton>
              <LinkButton to={`/calls/${call.id}`} tone="secondary">
                View public page
              </LinkButton>
            </>
          }
        />
      </PartnerShell>
    );
  }
  return (
    <PartnerShell title={title} back={back}>
      <EditorForm curator={curator} call={call} exhibitions={exhibitions} />
    </PartnerShell>
  );
}

function EditorForm({ curator, call, exhibitions }: { curator: CuratorRow; call: OpenCall | undefined; exhibitions: Exhibition[] }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const isNew = !call;
  const [form, setForm] = useState<Form>(() => (call ? fromCall(call) : blankForm()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(call ? fromCall(call) : blankForm()));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  const guard = useUnsavedGuard(dirty && !saving, 'this call');
  const inst = curator.institution.name;

  useEffect(() => {
    if (call) {
      const f = fromCall(call);
      setForm(f);
      setBaseline(JSON.stringify(f));
    }
    // Only when the record itself changes (e.g. after a save).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.updatedAt]);

  const f = form;
  const set = <K extends keyof Form>(k: K, v: Form[K], errKey: string = k as string) => {
    setForm((cur) => ({ ...cur, [k]: v }));
    if (errors[errKey] || errors.general) setErrors((e) => ({ ...e, [errKey]: undefined, general: undefined }));
  };
  const setPct = (k: PctKey, v: string) => {
    setForm((cur) => ({ ...cur, pct: { ...cur.pct, [k]: v } }));
    // A sum error is reported on the artist share; clear it with any share edit.
    if (errors[k] || errors.artistSharePct || errors.terms || errors.general) setErrors((e) => ({ ...e, [k]: undefined, artistSharePct: undefined, terms: undefined, general: undefined }));
  };
  const setCriteria = (v: CriteriaForm) => {
    setForm((cur) => ({ ...cur, criteria: v }));
    if (Object.keys(errors).some((k) => isCriteriaKey(k) && errors[k]) || errors.general)
      setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !isCriteriaKey(k) && k !== 'general')));
  };
  const err = (k: string) => errors[k];
  const terms = termsOf(f);
  const example = f.kind === 'auction' ? splitExample(terms) : undefined;

  async function save() {
    const local = clientErrors(f);
    if (Object.values(local).some(Boolean)) {
      setErrors(local);
      focusFirstError();
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const saved = await data.saveOpenCall(viewer, toInput(f, call, inst));
      const next = fromCall(saved);
      setForm(next);
      setBaseline(JSON.stringify(next));
      toast.push(`Saved draft of “${saved.title}”. Kofi will review it before it is published.`, 'success');
      if (isNew) {
        guard.allowNext();
        nav(`/curator/calls/${saved.id}`, { replace: true });
      }
    } catch (e) {
      if (e instanceof ValidationError && e.field && e.field !== 'call') setErrors({ [e.field]: e.message });
      else setErrors({ general: errorMessage(e) });
      focusFirstError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {guard.dialog}
      <div className="pg-editor">
        <form
          className="pg-editor__form stack--lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <header className="pg-editor__head">
            <p className="eyebrow eyebrow--gold">Partner desk · {isNew ? 'New draft' : 'Draft'}</p>
            <h2 className="h1 pg-editor__title">{isNew ? 'New call' : f.title || 'Untitled'}</h2>
            <span className="rule rule--gold" aria-hidden="true" />
          </header>

          {(errors.general || errors.terms || errors.organizerInstitutionId) && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              <p className="strong" data-invalid="true" tabIndex={-1}>
                {errors.general ?? errors.terms ?? errors.organizerInstitutionId}
              </p>
            </Notice>
          )}

          <Section title="Basics">
            <Input label="Title" value={f.title} maxLength={160} error={err('title')} onChange={(e) => set('title', e.target.value)} />
            <Select label="Kind of call" hint="An auction call turns selected works into lots and publishes how a sale is shared." value={f.kind} error={err('kind')} onChange={(e) => set('kind', e.target.value as CallKind)}>
              {CALL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CALL_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <Textarea label="Summary" hint="One or two sentences for cards and lists." rows={3} value={f.summary} error={err('summary')} onChange={(e) => set('summary', e.target.value)} />
            <div className="pc-readonly">
              <span className="field__label">Organiser</span>
              <p className="pc-readonly__value">
                <Icon.Building aria-hidden="true" /> {inst}
              </p>
              <span className="field__hint">Calls you draft are run by your institution. Shown on the public page as the partner.</span>
            </div>
          </Section>

          <Section title="Dates">
            <div className="pg-two">
              <Input label="Opens on" type="date" value={f.opensOn} error={err('opensOn')} onChange={(e) => set('opensOn', e.target.value)} />
              <Input label="Deadline" type="date" hint="Last day to apply, Pittsburgh time. Empty means open until filled." value={f.deadline} error={err('deadline')} onChange={(e) => set('deadline', e.target.value)} />
            </div>
          </Section>

          <Section title="Who can apply">
            <Textarea label="Eligibility" rows={2} value={f.eligibility} error={err('eligibility')} onChange={(e) => set('eligibility', e.target.value)} />
            <MediumChips value={f.mediums} onChange={(v) => set('mediums', v)} error={err('mediums')} />
            <div className="pg-two">
              <Input label="Most works per application" type="number" inputMode="numeric" min={1} max={10} value={f.maxWorks} error={err('maxWorks')} onChange={(e) => set('maxWorks', e.target.value)} />
              <Input label="Fee" hint="Kofi calls never charge artists." value={f.fee} error={err('fee')} onChange={(e) => set('fee', e.target.value)} />
            </div>
            <Input label="Award" hint="Optional. What a selected artist receives." value={f.award} error={err('award')} onChange={(e) => set('award', e.target.value)} />
            <Input
              label="External application form"
              type="url"
              hint="Only when applications are taken outside Kofi. Leave empty to take them in the app."
              value={f.externalUrl}
              error={err('externalUrl')}
              onChange={(e) => set('externalUrl', e.target.value)}
            />
          </Section>

          <Section title={matchCopy.editor.title}>
            <CriteriaFields value={f.criteria} onChange={setCriteria} errors={errors} />
          </Section>

          <Section title="Text">
            <Textarea label="Body" rows={8} hint="The full call. Leave a blank line between paragraphs." value={f.body} error={err('body')} onChange={(e) => set('body', e.target.value)} />
            <Select label="Exhibition" hint="Optional. Links the call to an exhibition page." value={f.exhibitionId} error={err('exhibitionId')} onChange={(e) => set('exhibitionId', e.target.value)}>
              <option value="">None</option>
              {exhibitions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
          </Section>

          {f.kind === 'auction' && (
            <fieldset className="pg-section pc-terms" data-invalid={err('terms') ? 'true' : undefined}>
              <legend className="pg-section__title">Terms</legend>
              <div className="stack pg-section__body">
                <p className="small muted">
                  Published on the call before anyone applies. Artist, Kofi and partner shares are whole percentages of the hammer price and must add up to 100%. Terms lock once a lot has sold.
                </p>
                <div className="pc-pcts">
                  <Input label="Artist share (%)" type="number" inputMode="numeric" min={0} max={100} value={f.pct.artistSharePct} error={err('artistSharePct')} onChange={(e) => setPct('artistSharePct', e.target.value)} />
                  <Input label="Kofi share (%)" type="number" inputMode="numeric" min={0} max={100} value={f.pct.kofiSharePct} error={err('kofiSharePct')} onChange={(e) => setPct('kofiSharePct', e.target.value)} />
                  <Input label={`${inst} share (%)`} type="number" inputMode="numeric" min={0} max={100} value={f.pct.partnerSharePct} error={err('partnerSharePct')} onChange={(e) => setPct('partnerSharePct', e.target.value)} />
                  <Input label="Buyer’s premium (%)" hint="Charged to the buyer on top of the hammer price." type="number" inputMode="numeric" min={0} max={30} value={f.pct.buyerPremiumPct} error={err('buyerPremiumPct')} onChange={(e) => setPct('buyerPremiumPct', e.target.value)} />
                  <Input label="Resale royalty (%)" hint="The artist’s share of any later resale." type="number" inputMode="numeric" min={0} max={25} value={f.pct.resaleRoyaltyPct} error={err('resaleRoyaltyPct')} onChange={(e) => setPct('resaleRoyaltyPct', e.target.value)} />
                  <Input label="Currency" hint="3-letter code: USD, CAD." maxLength={3} autoCapitalize="characters" value={f.currency} error={err('currency')} onChange={(e) => set('currency', e.target.value, 'currency')} />
                </div>
                <Textarea label="Payment note" hint="Optional. When and how artists are paid, e.g. “Within 30 days of the auction.”" rows={2} value={f.paymentNote} error={err('paymentNote')} onChange={(e) => set('paymentNote', e.target.value, 'paymentNote')} />
                <div className="pc-example" aria-live="polite">
                  <p className="eyebrow">Live example</p>
                  {example ? (
                    <>
                      <p className="pc-example__line" data-testid="terms-example">
                        {example}
                      </p>
                      <p className="tiny muted">{termsSentence(terms, inst)}</p>
                    </>
                  ) : (
                    <p className="small muted">Fix the terms above to see how a sale would be shared.</p>
                  )}
                </div>
              </div>
            </fieldset>
          )}

          <Section title="Publishing">
            <Notice tone="plain" icon={<Icon.Info />}>
              <p className="strong">Kofi publishes partner calls after review.</p>
              <p className="small">Your draft is visible to Kofi and to verified curators of {inst}. Kofi checks it with you, then makes it public.</p>
            </Notice>
          </Section>

          <div className="pg-actions">
            <Button type="submit" loading={saving} onClick={() => undefined}>
              {isNew ? 'Save draft' : 'Save changes'}
            </Button>
            {call && (
              <Link className="btn btn--secondary" to={`/curator/calls/${call.id}`}>
                Back to the call
              </Link>
            )}
            {dirty && <span className="tiny muted pg-dirty">Unsaved changes</span>}
          </div>
        </form>

        <aside className="pg-editor__preview" aria-label="Live preview">
          <p className="pg-preview__caption">Live preview</p>
          <article className="pg-card">
            <div className="pg-card__body">
              <div className="pg-row__badges">
                <span className="pg-badge pg-badge--draft">Draft</span>
              </div>
              <p className="pg-card__eyebrow">
                {CALL_KIND_LABEL[f.kind]} · {inst}
              </p>
              <h3 className="pg-card__title">{f.title.trim() || 'Untitled'}</h3>
              {f.summary && <p className="pg-card__lede">{f.summary}</p>}
              {f.kind === 'auction' && validateTerms(terms) === undefined && <p className="pg-card__when">{termsSentence(terms, inst)}</p>}
            </div>
          </article>
          <p className="tiny muted">How the card reads on the public site once Kofi publishes it.</p>
        </aside>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `pc-sec-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section className="pg-section" role="group" aria-labelledby={id}>
      <h3 className="pg-section__title" id={id}>
        {title}
      </h3>
      <div className="stack pg-section__body">{children}</div>
    </section>
  );
}
