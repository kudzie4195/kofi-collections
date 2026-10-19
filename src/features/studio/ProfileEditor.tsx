import { useEffect, useMemo, useState } from 'react';
import type { ArtistLink, ArtistView, CareerStage, Medium, RegionPrecision, Visibility } from '@/domain/types';
import { CAREER_STAGES, MEDIUMS } from '@/domain/types';
import { regionLabel } from '@/domain/visibility';
import type { ArtistPatch } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  LinkButton,
  Notice,
  Panel,
  Segmented,
  Skeleton,
  Textarea,
  Toggle,
  TopBar,
  VisibilityPicker,
} from '@/ui';
import { Group, capitalize, fieldErrorFrom, focusFirstError, useUnsavedGuard } from './shared';

interface ProfileForm {
  workingName: string;
  legalName: string;
  pronouns: string;
  bio: string;
  statement: string;
  mediums: Medium[];
  careerStage: CareerStage;
  city: string;
  region: string;
  country: string;
  precision: RegionPrecision;
  commissions: boolean;
  publicArt: boolean;
  residencies: boolean;
  institutionalShows: boolean;
  yearsPracticing: string;
  availCommissions: boolean;
  availSales: boolean;
  availExhibitions: boolean;
  links: ArtistLink[];
  email: string;
  phone: string;
  studioAddress: string;
  visibility: ArtistView['visibility'];
  avatarColor: string;
}

const SWATCHES: { color: string; name: string }[] = [
  { color: '#2436F5', name: 'Cobalt' },
  { color: '#FF5C39', name: 'Coral' },
  { color: '#CFFF4A', name: 'Lime' },
  { color: '#FFD23F', name: 'Butter' },
  { color: '#5B41E6', name: 'Violet' },
  { color: '#0FA3B1', name: 'Teal' },
  { color: '#16122B', name: 'Ink' },
];

const STAGE_LABEL: Record<CareerStage, string> = { emerging: 'Emerging', 'mid-career': 'Mid-career', established: 'Established' };

function toForm(a: ArtistView): ProfileForm {
  const r = a.region ?? { region: '', country: '', precision: 'region' as const };
  return {
    workingName: a.workingName,
    legalName: a.legalName ?? '',
    pronouns: a.pronouns ?? '',
    bio: a.bio,
    statement: a.statement ?? '',
    mediums: [...a.mediums],
    careerStage: a.careerStage,
    city: r.city ?? '',
    region: r.region,
    country: r.country,
    precision: r.precision,
    commissions: a.experience.commissions,
    publicArt: a.experience.publicArt,
    residencies: a.experience.residencies,
    institutionalShows: a.experience.institutionalShows,
    yearsPracticing: a.experience.yearsPracticing !== undefined ? String(a.experience.yearsPracticing) : '',
    availCommissions: a.availability.commissions,
    availSales: a.availability.sales,
    availExhibitions: a.availability.exhibitions,
    links: a.links.map((l) => ({ ...l })),
    email: a.contact?.email ?? '',
    phone: a.contact?.phone ?? '',
    studioAddress: a.contact?.studioAddress ?? '',
    visibility: a.visibility,
    avatarColor: a.avatarColor,
  };
}

function toPatch(f: ProfileForm): ArtistPatch {
  const years = f.yearsPracticing.trim() === '' ? undefined : Number(f.yearsPracticing);
  const region = { region: f.region.trim(), country: f.country.trim(), precision: f.precision, ...(f.city.trim() ? { city: f.city.trim() } : {}) };
  const contact = {
    email: f.email.trim(),
    ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
    ...(f.studioAddress.trim() ? { studioAddress: f.studioAddress.trim() } : {}),
  };
  return {
    workingName: f.workingName.trim(),
    legalName: f.legalName.trim() || undefined,
    pronouns: f.pronouns.trim() || undefined,
    bio: f.bio.trim(),
    statement: f.statement.trim() || undefined,
    mediums: f.mediums,
    careerStage: f.careerStage,
    region,
    experience: {
      commissions: f.commissions,
      publicArt: f.publicArt,
      residencies: f.residencies,
      institutionalShows: f.institutionalShows,
      ...(years !== undefined ? { yearsPracticing: years } : {}),
    },
    availability: { commissions: f.availCommissions, sales: f.availSales, exhibitions: f.availExhibitions },
    links: f.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label || l.url),
    contact,
    visibility: f.visibility,
    avatarColor: f.avatarColor,
  };
}

type Errors = Record<string, string>;

function validate(f: ProfileForm): { errors: Errors; linkErrors: Record<number, string> } {
  const errors: Errors = {};
  const linkErrors: Record<number, string> = {};
  if (!f.workingName.trim()) errors.workingName = 'Add the name you work under — it’s how curators will find you.';
  if (f.bio.trim().length < 20) errors.bio = `Write at least a sentence (20 characters). You have ${f.bio.trim().length}.`;
  if (f.mediums.length === 0) errors.mediums = 'Pick at least one medium.';
  if (!f.region.trim()) errors.regionName = 'Add your state, province or region.';
  if (!f.country.trim()) errors.country = 'Add your country.';
  if (f.precision === 'city' && !f.city.trim()) errors.city = 'Add a city, or choose to show only your region or country.';
  const y = f.yearsPracticing.trim();
  if (y && (!/^\d{1,2}$/.test(y) || Number(y) > 80)) errors.yearsPracticing = 'Use a whole number of years, like 6.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) errors.contact = 'Enter an email Kofi can reach you at, like name@example.com.';
  f.links.forEach((l, i) => {
    if (!l.label.trim() && !l.url.trim()) return;
    if (!/^https?:\/\/\S+\.\S+/i.test(l.url.trim())) linkErrors[i] = 'Start the address with https:// — for example https://yourstudio.com';
    else if (!l.label.trim()) linkErrors[i] = 'Give this link a label, like Website or Instagram.';
  });
  if (Object.keys(linkErrors).length) errors.links = 'Fix the highlighted links.';
  return { errors, linkErrors };
}

export function ProfileEditor() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const q = useQuery((ds, v) => ds.getMyArtist(v), []);
  const [form, setForm] = useState<ProfileForm>();
  const [baseline, setBaseline] = useState<string>('');
  const [errors, setErrors] = useState<Errors>({});
  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data && !form) {
      const f = toForm(q.data);
      setForm(f);
      setBaseline(JSON.stringify(f));
    }
  }, [q.data, form]);

  const dirty = !!form && JSON.stringify(form) !== baseline;
  const guard = useUnsavedGuard(dirty && !saving, 'your profile changes');

  const preview = useMemo(() => {
    if (!form) return '';
    const label = regionLabel({ city: form.city.trim() || undefined, region: form.region.trim(), country: form.country.trim(), precision: form.precision });
    return label.replace(/^,\s*|,\s*$/g, '').trim();
  }, [form]);

  if (q.error && !form) {
    return (
      <Shell>
        <ErrorState error={q.error} retry={q.reload} />
      </Shell>
    );
  }
  if (!q.loading && !q.data && !form) {
    return (
      <Shell>
        <EmptyState title="No artist profile on this account" body="Switch to an artist account to edit a profile." actions={<LinkButton to="/account">Switch account</LinkButton>} />
      </Shell>
    );
  }
  if (!form) {
    return (
      <Shell>
        <div className="stack" aria-busy="true" aria-label="Loading your profile">
          <Skeleton h={48} />
          <Skeleton h={48} />
          <Skeleton h={112} />
          <Skeleton h={160} />
        </div>
      </Shell>
    );
  }

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: '' }));
  };
  const f = form;

  async function save() {
    if (!form) return;
    const v = validate(form);
    setLinkErrors(v.linkErrors);
    if (Object.keys(v.errors).length) {
      setErrors(v.errors);
      toast.push('Check the highlighted fields.', 'error');
      focusFirstError();
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await data.updateMyArtist(viewer, toPatch(form));
      setBaseline(JSON.stringify(form));
      toast.push('Profile saved', 'success');
    } catch (e) {
      const fe = fieldErrorFrom(e);
      if (fe) {
        // Server uses 'region' for the whole region object; show it on the region input.
        const mapped = 'region' in fe ? { regionName: fe.region! } : fe;
        setErrors(mapped);
        focusFirstError();
      }
      toast.push(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  const bioLen = f.bio.trim().length;

  return (
    <Shell>
      {guard.dialog}
      <form
        className="stack--lg"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="st-idcard" style={{ ['--av' as string]: f.avatarColor }} aria-label="How your name appears">
          <Avatar name={f.workingName || '?'} color={f.avatarColor} size="lg" />
          <div className="st-idcard__text">
            <div className="h3">{f.workingName || 'Your working name'}</div>
            <div className="small muted">
              {[f.pronouns.trim(), preview].filter(Boolean).join(', ') || 'Pronouns and region show here'}
            </div>
          </div>
        </section>

        <Panel title="Identity">
          <div className="stack">
            <Input label="Working name" value={f.workingName} onChange={(e) => set('workingName', e.target.value)} error={errors.workingName} hint="Shown publicly. The name on your wall labels." autoComplete="name" />
            <Input
              label="Legal name"
              value={f.legalName}
              onChange={(e) => set('legalName', e.target.value)}
              hint="Private — never shown. Only you and Kofi staff can see it, for contracts and payments."
            />
            <Input label="Pronouns" value={f.pronouns} onChange={(e) => set('pronouns', e.target.value)} placeholder="she/her, they/them…" />
            <Group label="Avatar color">
              <div className="st-swatches" role="radiogroup" aria-label="Avatar color">
                {SWATCHES.map((s) => (
                  <button
                    key={s.color}
                    type="button"
                    role="radio"
                    aria-checked={f.avatarColor.toLowerCase() === s.color.toLowerCase()}
                    aria-label={s.name}
                    className="st-swatch"
                    style={{ background: s.color }}
                    onClick={() => set('avatarColor', s.color)}
                  />
                ))}
              </div>
            </Group>
          </div>
        </Panel>

        <Panel title="About your practice">
          <div className="stack">
            <Textarea
              label="Bio"
              value={f.bio}
              onChange={(e) => set('bio', e.target.value)}
              error={errors.bio}
              hint={`At least 20 characters — a sentence or two in the third person. ${bioLen < 20 ? `${20 - bioLen} to go.` : `${bioLen} characters.`}`}
              rows={4}
            />
            <Textarea label="Artist statement" value={f.statement} onChange={(e) => set('statement', e.target.value)} hint="Optional. In your own voice." rows={4} />
            <Group label="Mediums" error={errors.mediums} hint="Pick every medium you work in.">
              <div className="chips">
                {MEDIUMS.map((m) => {
                  const on = f.mediums.includes(m);
                  return (
                    <Chip key={m} medium={m} on={on} onClick={() => set('mediums', on ? f.mediums.filter((x) => x !== m) : [...f.mediums, m])}>
                      {on && <Icon.Check width={14} height={14} />}
                      {capitalize(m)}
                    </Chip>
                  );
                })}
              </div>
            </Group>
            <Group label="Career stage">
              <Segmented<CareerStage>
                label="Career stage"
                value={f.careerStage}
                onChange={(v) => set('careerStage', v)}
                options={CAREER_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
              />
            </Group>
          </div>
        </Panel>

        <Panel title="Where you work">
          <div className="stack">
            <Input label="City" value={f.city} onChange={(e) => set('city', e.target.value)} error={errors.city} autoComplete="address-level2" />
            <div className="grid-2">
              <Input label="State, province or region" value={f.region} onChange={(e) => set('region', e.target.value)} error={errors.regionName} autoComplete="address-level1" />
              <Input label="Country" value={f.country} onChange={(e) => set('country', e.target.value)} error={errors.country} autoComplete="country-name" />
            </div>
            <Group label="How precisely to show it">
              <Segmented<RegionPrecision>
                label="How precisely to show your location"
                value={f.precision}
                onChange={(v) => set('precision', v)}
                options={[
                  { value: 'city', label: 'City' },
                  { value: 'region', label: 'Region' },
                  { value: 'country', label: 'Country' },
                ]}
              />
            </Group>
            <p className="st-pin" aria-live="polite">
              <Icon.Globe aria-hidden="true" />
              <span>
                Shown publicly as: <span className="strong">{preview || 'add your region and country'}</span>
              </span>
            </p>
          </div>
        </Panel>

        <Panel title="Experience">
          <div className="stack--sm">
            <Toggle checked={f.commissions} onChange={(v) => set('commissions', v)} label="Commissions" hint="You’ve completed commissioned work." />
            <Toggle checked={f.publicArt} onChange={(v) => set('publicArt', v)} label="Public art" hint="Permanent or temporary work in public space." />
            <Toggle checked={f.residencies} onChange={(v) => set('residencies', v)} label="Residencies" />
            <Toggle checked={f.institutionalShows} onChange={(v) => set('institutionalShows', v)} label="Institutional shows" hint="Museums, university galleries, nonprofits." />
            <div style={{ maxWidth: 200, paddingTop: 8 }}>
              <Input
                label="Years practicing"
                inputMode="numeric"
                value={f.yearsPracticing}
                onChange={(e) => set('yearsPracticing', e.target.value.replace(/[^\d]/g, ''))}
                error={errors.yearsPracticing}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Open to">
          <div className="stack--sm">
            <Toggle checked={f.availCommissions} onChange={(v) => set('availCommissions', v)} label="Commissions" />
            <Toggle checked={f.availSales} onChange={(v) => set('availSales', v)} label="Sales" />
            <Toggle checked={f.availExhibitions} onChange={(v) => set('availExhibitions', v)} label="Exhibitions and loans" />
          </div>
        </Panel>

        <Panel title="Links">
          <div className="stack">
            {f.links.length === 0 && <p className="small muted">Add your website, portfolio or social accounts. Links are public.</p>}
            {f.links.map((l, i) => (
              <div key={i} className="st-link-row">
                <Input
                  label={`Link ${i + 1} label`}
                  value={l.label}
                  placeholder="Website"
                  onChange={(e) => set('links', f.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <Input
                  label={`Link ${i + 1} address`}
                  value={l.url}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  error={linkErrors[i]}
                  onChange={(e) => {
                    set('links', f.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)));
                    if (linkErrors[i]) setLinkErrors((le) => ({ ...le, [i]: '' }));
                  }}
                />
                <Button
                  tone="ghost"
                  icon={<Icon.Trash />}
                  aria-label={`Remove link ${i + 1}${l.label ? ` (${l.label})` : ''}`}
                  className="st-link-row__remove"
                  onClick={() => {
                    set('links', f.links.filter((_, j) => j !== i));
                    setLinkErrors({});
                  }}
                />
              </div>
            ))}
            {errors.links && !Object.values(linkErrors).some(Boolean) && (
              <p className="field__error" role="alert">
                {errors.links}
              </p>
            )}
            <div>
              <Button tone="secondary" size="sm" icon={<Icon.Plus />} onClick={() => set('links', [...f.links, { label: '', url: '' }])}>
                Add a link
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Private — only you and Kofi staff" tint>
          <div className="stack">
            <p className="small st-private-note">
              <Icon.Lock aria-hidden="true" /> Curators never see these. Kofi shares your email only when you accept an introduction.
            </p>
            <Input label="Contact email" type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} error={errors.contact} />
            <Input label="Phone" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} hint="Optional." />
            <Textarea label="Studio address" value={f.studioAddress} onChange={(e) => set('studioAddress', e.target.value)} rows={2} hint="Optional. For shipping and studio visits Kofi arranges." />
          </div>
        </Panel>

        <Panel title="Who sees your profile" accent>
          <VisibilityPicker
            label="Profile visibility"
            value={f.visibility}
            onChange={(v: Visibility) => set('visibility', v as ProfileForm['visibility'])}
            options={['public', 'kofi', 'private']}
          />
          {f.visibility === 'public' && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Public profiles appear once Kofi approves them. Each work and price still has its own setting.
            </p>
          )}
        </Panel>

        {Object.values(errors).some(Boolean) && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            Some fields need attention before this can be saved. They’re marked in red above.
          </Notice>
        )}

        <div className="sticky-actions st-savebar">
          <span className="small st-savebar__state" aria-live="polite">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button type="submit" loading={saving} disabled={!dirty || saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="screen">
      <TopBar title="Profile" back="/studio" />
      <main className="container section">{children}</main>
    </div>
  );
}
