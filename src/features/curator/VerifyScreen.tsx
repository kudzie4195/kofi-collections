import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ValidationError, type CuratorRow } from '@/data/DataSource';
import type { InstitutionType } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, ErrorState, Icon, Input, LinkButton, Notice, Panel, Select, Skeleton, Textarea, TopBar } from '@/ui';
import { CuratorPass } from './CuratorPass';
import { formatDate, INSTITUTION_TYPES, institutionTypeLabel } from './shared';
import './curator.css';

interface FormState {
  name: string;
  title: string;
  workEmail: string;
  purpose: string;
  instName: string;
  instType: InstitutionType;
  website: string;
  city: string;
  country: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fromRecord(c: CuratorRow | undefined, fallbackName: string): FormState {
  return {
    name: c?.name ?? fallbackName,
    title: c?.title ?? '',
    workEmail: c?.workEmail ?? '',
    purpose: c?.purpose ?? '',
    instName: c?.institution.name ?? '',
    instType: c?.institution.type ?? 'museum',
    website: c?.institution.website ?? '',
    city: c?.institution.city ?? '',
    country: c?.institution.country ?? '',
  };
}

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = 'Enter your name as it appears in your institution’s staff directory.';
  if (!f.title.trim()) e.title = 'Enter your role, like “Associate Curator” — Kofi checks it against the directory.';
  if (!EMAIL.test(f.workEmail.trim())) e.workEmail = 'Enter your work email at the institution, like name@museum.org.';
  if (!f.instName.trim()) e.instName = 'Enter the institution’s full name.';
  if (f.website.trim() && !/^https?:\/\/\S+\.\S+/i.test(f.website.trim())) e.website = 'Start the website with https:// — or leave it blank.';
  if (!f.country.trim()) e.country = 'Enter the country the institution is based in.';
  if (f.purpose.trim().length < 20) e.purpose = 'Tell Kofi what you’re looking for in a sentence or two (at least 20 characters).';
  return e;
}

/** Data-layer field names → form field names. */
const FIELD_MAP: Record<string, keyof FormState> = {
  name: 'name',
  title: 'title',
  workEmail: 'workEmail',
  purpose: 'purpose',
  institution: 'instName',
};

export function VerifyScreen() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery((ds, v) => ds.getMyCurator(v));
  const [form, setForm] = useState<FormState>(() => fromRecord(undefined, viewer.displayName ?? ''));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Prefill once from the record when it arrives.
  useEffect(() => {
    if (seeded || q.loading) return;
    setForm(fromRecord(q.data, viewer.displayName ?? ''));
    setSeeded(true);
  }, [q.data, q.loading, seeded, viewer.displayName]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.push('Check the highlighted fields.', 'error');
      return;
    }
    setBusy(true);
    try {
      const institution: { name: string; type: InstitutionType; country: string; website?: string; city?: string } = {
        name: form.instName.trim(),
        type: form.instType,
        country: form.country.trim(),
      };
      if (form.website.trim()) institution.website = form.website.trim();
      if (form.city.trim()) institution.city = form.city.trim();
      await data.requestVerification(viewer, {
        name: form.name.trim(),
        title: form.title.trim(),
        workEmail: form.workEmail.trim(),
        purpose: form.purpose.trim(),
        institution,
      });
      toast.push('Sent to Kofi. You’ll see your status on your curator pass.', 'success');
      nav('/curator');
    } catch (e) {
      if (e instanceof ValidationError && e.field && FIELD_MAP[e.field]) {
        setErrors((x) => ({ ...x, [FIELD_MAP[e.field!]!]: e.message }));
      } else toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const c = q.data;

  return (
    <div className="screen">
      <TopBar title="Verification" back="/curator" />
      <main className="container stack--lg" style={{ paddingTop: 20 }}>
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : q.loading && !seeded ? (
          <div className="stack" aria-busy="true" aria-label="Loading your verification status">
            <Skeleton h={168} />
            <Skeleton h={48} />
            <Skeleton h={48} />
          </div>
        ) : c?.status === 'verified' ? (
          <>
            <CuratorPass curator={c} fallbackName={viewer.displayName ?? 'Curator'} />
            <Notice tone="lime" icon={<Icon.Check />}>
              <p className="strong">Kofi verified {c.institution.name}{c.verifiedAt ? ` on ${formatDate(c.verifiedAt)}` : ''}.</p>
              <p>You can see prices artists share with verified institutions and request introductions from any shortlist.</p>
            </Notice>
            <Panel title="On file with Kofi">
              <dl className="spec">
                <dt>Name</dt>
                <dd>{c.name}</dd>
                <dt>Role</dt>
                <dd>{c.title}</dd>
                <dt>Work email</dt>
                <dd style={{ overflowWrap: 'anywhere' }}>{c.workEmail}</dd>
                <dt>Institution</dt>
                <dd>
                  {c.institution.name}, {institutionTypeLabel(c.institution.type).toLowerCase()}
                </dd>
                <dt>Looking for</dt>
                <dd>{c.purpose}</dd>
              </dl>
            </Panel>
            <ContactRule />
            <LinkButton to="/curator" tone="secondary">
              Back to your shortlists
            </LinkButton>
          </>
        ) : (
          <>
            <section className="stack--sm">
              <h2 className="h1">Verify your institution</h2>
              <p className="lede">
                A person at Kofi checks every request by hand — usually against your institution’s staff directory or by writing to your work email.
              </p>
            </section>

            {c?.status === 'pending' && (
              <Notice tone="butter" icon={<Icon.Info />}>
                <p className="strong">Your request is with Kofi{c.createdAt ? `, sent ${formatDate(c.createdAt)}` : ''}.</p>
                <p>You can correct anything below. Resending keeps you in the queue.</p>
              </Notice>
            )}
            {c?.status === 'rejected' && (
              <Notice tone="coral" icon={<Icon.Warn />}>
                <p className="strong">Kofi couldn’t verify this request.</p>
                {c.verificationNote && <p>Note from Kofi: {c.verificationNote}</p>}
                <p>Update the details below and send it again.</p>
              </Notice>
            )}

            <ContactRule />

            <form className="stack" onSubmit={submit} noValidate aria-label="Verification request">
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="h3" style={{ marginBottom: 12 }}>
                  About you
                </legend>
                <Input label="Your name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
                <Input
                  label="Your role"
                  autoComplete="organization-title"
                  placeholder="Associate Curator, Contemporary"
                  value={form.title}
                  error={errors.title}
                  onChange={(e) => set('title', e.target.value)}
                />
                <Input
                  label="Work email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  hint="At your institution’s domain. Used only for verification; artists never see it."
                  value={form.workEmail}
                  error={errors.workEmail}
                  onChange={(e) => set('workEmail', e.target.value)}
                />
              </fieldset>

              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="h3" style={{ marginBottom: 12, marginTop: 8 }}>
                  Your institution
                </legend>
                <Input
                  label="Institution name"
                  autoComplete="organization"
                  value={form.instName}
                  error={errors.instName}
                  onChange={(e) => set('instName', e.target.value)}
                />
                <Select label="Institution type" value={form.instType} onChange={(e) => set('instType', e.target.value as InstitutionType)}>
                  {INSTITUTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Website (optional)"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={form.website}
                  error={errors.website}
                  onChange={(e) => set('website', e.target.value)}
                />
                <div className="grid-2">
                  <Input label="City (optional)" autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} />
                  <Input label="Country" autoComplete="country-name" value={form.country} error={errors.country} onChange={(e) => set('country', e.target.value)} />
                </div>
              </fieldset>

              <Textarea
                label="What are you looking for?"
                hint="The show, commission or collection you’re working on. Kofi uses this to judge fit, not just identity."
                value={form.purpose}
                error={errors.purpose}
                maxLength={1000}
                onChange={(e) => set('purpose', e.target.value)}
              />

              <Button type="submit" block loading={busy} icon={<Icon.Building />}>
                {c ? 'Resend for verification' : 'Send for verification'}
              </Button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function ContactRule() {
  return (
    <Notice tone="plain" icon={<Icon.Lock />}>
      Artist contact details are never shown to curators, even after verification. Introductions go through Kofi, and the artist decides whether to
      connect.
    </Notice>
  );
}
