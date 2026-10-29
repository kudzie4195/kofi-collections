/**
 * Controls used by the programme editors: medium chips, an ordered artwork
 * picker and an image field (from an attached work, or an upload re-encoded
 * through the studio's image intake so EXIF/GPS never reaches storage).
 */
import { memo, useId, useMemo, useRef, useState } from 'react';
import type { ArtworkView, CallCriteria, Medium, ProgrammeImage, UseKey } from '@/domain/types';
import { MEDIUMS, USE_KEYS, USE_LABEL } from '@/domain/types';
import { categoryLabel, categoryOf, groupTagIds, tagLabel, type ArtistTagCategory } from '@/domain/taxonomy';
import { validateCriteria } from '@/domain/matching';
import { prepareImage } from '@/native/images';
import { errorMessage } from '@/state/toast';
import { Button, Chip, Icon, Input, Textarea, VisibilityBadge } from '@/ui';
import { Group, capitalize } from '@/features/studio/shared';
import { TagPicker } from '@/features/studio/TagPicker';
import { matchCopy } from '@/features/programme/matchCopy';
import '@/features/programme/match.css';

/** Uploaded programme images are kept small enough for any device's storage. */
export const MAX_PROGRAMME_IMAGE_BYTES = 2 * 1024 * 1024;

export function MediumChips({ value, onChange, error }: { value: Medium[]; onChange: (v: Medium[]) => void; error?: string }) {
  return (
    <Group label="Mediums" hint={value.length ? `${value.length} selected` : 'None selected means any medium is welcome.'} error={error}>
      <ul className="chips pg-mediums">
        {MEDIUMS.map((m) => {
          const on = value.includes(m);
          return (
            <li key={m}>
              <Chip medium={m} on={on} onClick={() => onChange(on ? value.filter((x) => x !== m) : [...value, m])}>
                {capitalize(m)}
              </Chip>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

function primary(w: ArtworkView) {
  return w.images.find((i) => i.isPrimary) ?? w.images[0];
}

export function ArtworkPicker({ works, value, onChange, error }: { works: ArtworkView[]; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [q, setQ] = useState('');
  const searchId = useId();
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const selected = value.map((id) => byId.get(id)).filter((w): w is ArtworkView => !!w);
  const needle = q.trim().toLowerCase();
  const results = works.filter((w) => !needle || `${w.title} ${w.artistWorkingName} ${w.medium} ${w.year}`.toLowerCase().includes(needle));
  const hidden = selected.filter((w) => w.visibility !== 'public').length;

  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <Group label="Works" hint="Shown in this order on the public page." error={error}>
      {selected.length > 0 ? (
        <ol className="pg-picked" aria-label="Selected works, in order">
          {selected.map((w, i) => {
            const img = primary(w);
            return (
              <li key={w.id} className="pg-picked__row" data-medium={w.medium}>
                <span className="pg-picked__n" aria-hidden="true">
                  {i + 1}
                </span>
                {img ? <img className="thumb" src={img.src} alt="" /> : <span className="thumb pg-row__thumb--empty" aria-hidden="true" />}
                <span className="pg-picked__main">
                  <span className="pg-picked__title">{w.title}</span>
                  <span className="tiny muted">
                    {w.artistWorkingName}, {w.year}
                  </span>
                  {w.visibility !== 'public' && <VisibilityBadge level={w.visibility} />}
                </span>
                <span className="pg-picked__tools">
                  <Button tone="ghost" size="sm" icon={<Icon.Back className="pg-up" />} aria-label={`Move ${w.title} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button tone="ghost" size="sm" icon={<Icon.Back className="pg-down" />} aria-label={`Move ${w.title} down`} disabled={i === selected.length - 1} onClick={() => move(i, 1)} />
                  <Button tone="ghost" size="sm" icon={<Icon.Close />} aria-label={`Remove ${w.title}`} onClick={() => onChange(value.filter((x) => x !== w.id))} />
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="small muted pg-picked__empty">No works attached yet.</p>
      )}
      {hidden > 0 && (
        <p className="tiny pg-warn">
          <Icon.EyeOff aria-hidden="true" /> {hidden === 1 ? '1 attached work isn’t public' : `${hidden} attached works aren’t public`}. Visitors won’t see{' '}
          {hidden === 1 ? 'it' : 'them'} on the page until the artist changes that.
        </p>
      )}
      <div className="pg-search">
        <label className="sr-only" htmlFor={searchId}>
          Find works to attach
        </label>
        <Icon.Search aria-hidden="true" className="pg-search__icon" />
        <input id={searchId} className="input pg-search__input" type="search" placeholder="Find works by title, artist or medium" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="pg-results" aria-label="All works">
        {results.length === 0 && <li className="small muted pg-results__none">No works match “{q}”.</li>}
        {results.map((w) => {
          const on = value.includes(w.id);
          const img = primary(w);
          return (
            <li key={w.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                className="pg-result"
                data-on={on || undefined}
                onClick={() => onChange(on ? value.filter((x) => x !== w.id) : [...value, w.id])}
              >
                {img ? <img className="thumb" src={img.src} alt="" /> : <span className="thumb pg-row__thumb--empty" aria-hidden="true" />}
                <span className="pg-result__main">
                  <span className="pg-result__title">{w.title}</span>
                  <span className="tiny muted">
                    {w.artistWorkingName} · {w.medium}, {w.year}
                  </span>
                </span>
                <span className="pg-result__mark" aria-hidden="true">
                  {on ? <Icon.Check /> : <Icon.Plus />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

export function ImageField({
  value,
  onChange,
  candidates,
  error,
}: {
  value: ProgrammeImage | undefined;
  onChange: (v: ProgrammeImage | undefined) => void;
  /** Works whose primary image may be used (the attached works, or all works). */
  candidates: ArtworkView[];
  error?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [intakeError, setIntakeError] = useState<string>();
  const usable = candidates.filter((w) => primary(w)).slice(0, 12);
  const altMissing = !!error && !!value && !value.alt.trim();

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setIntakeError(undefined);
    try {
      const out = await prepareImage(file);
      if (out.dataUrl.length > MAX_PROGRAMME_IMAGE_BYTES * 1.37) throw new Error('That image is still over 2 MB after resizing. Try a smaller file.');
      onChange({ src: out.dataUrl, alt: value?.alt ?? '', credit: value?.credit });
    } catch (e) {
      setIntakeError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group label="Image" hint="Wide images work best. Describe what is in the picture for people using screen readers." error={altMissing ? undefined : error}>
      {value ? (
        <div className="pg-image">
          <img className="pg-image__img" src={value.src} alt="" />
          <div className="stack pg-image__fields">
            <Input
              label="Image description (alt text)"
              value={value.alt}
              required
              error={altMissing ? error : undefined}
              onChange={(e) => onChange({ ...value, alt: e.target.value })}
            />
            <Input label="Image credit" value={value.credit ?? ''} onChange={(e) => onChange({ ...value, credit: e.target.value || undefined })} />
            <div className="pg-image__remove">
              <Button tone="ghost" size="sm" icon={<Icon.Trash />} onClick={() => onChange(undefined)}>
                Remove image
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="small muted">No image. Cards fall back to a plain panel.</p>
      )}
      {usable.length > 0 && (
        <div className="pg-image__choose">
          <p className="tiny muted">Use a work’s image</p>
          <ul className="pg-image__works">
            {usable.map((w) => {
              const img = primary(w)!;
              const on = value?.src === img.src;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    className="pg-image__work"
                    aria-pressed={on}
                    aria-label={`Use the image of ${w.title}`}
                    onClick={() => onChange({ src: img.src, alt: img.alt || `${w.title} by ${w.artistWorkingName}`, credit: w.artistWorkingName })}
                  >
                    <img src={img.src} alt="" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="row row--wrap">
        <Button tone="secondary" size="sm" icon={<Icon.Plus />} loading={busy} onClick={() => fileRef.current?.click()}>
          Upload an image
        </Button>
        <span className="tiny muted">JPG, PNG, WebP or HEIC. Resized and stripped of location data.</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          aria-label="Upload an image"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {intakeError && (
        <p className="field__error" role="alert">
          {intakeError}
        </p>
      )}
    </Group>
  );
}

/* ---------------- "Looking for" (v6 call criteria) ---------------- */

/** Tag categories an organiser can ask for, in form order. */
export const CRITERIA_CATEGORIES: readonly ArtistTagCategory[] = ['style', 'subject', 'theme', 'social_impact', 'material', 'medium'];

/** The criteria as typed: sizes stay strings so a half-typed number is never lost. */
export interface CriteriaForm {
  tagIds: string[];
  uses: UseKey[];
  region: string;
  minCm: string;
  maxCm: string;
  note: string;
}

export const BLANK_CRITERIA: CriteriaForm = { tagIds: [], uses: [], region: '', minCm: '', maxCm: '', note: '' };

export function criteriaToForm(c: CallCriteria | undefined): CriteriaForm {
  if (!c) return { ...BLANK_CRITERIA, tagIds: [], uses: [] };
  const tagIds = Object.entries(c.tags ?? {}).flatMap(([cat, ids]) => ids.filter((id) => categoryOf(id) === cat));
  return {
    tagIds,
    uses: USE_KEYS.filter((k) => c.uses?.includes(k)),
    region: c.region ?? '',
    minCm: c.minLongestEdgeCm === undefined ? '' : String(c.minLongestEdgeCm),
    maxCm: c.maxLongestEdgeCm === undefined ? '' : String(c.maxLongestEdgeCm),
    note: c.note ?? '',
  };
}

/** '' → undefined; anything else a number (NaN when not one, so validateCriteria names the field). */
function cmOf(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  return t ? Number(t) : undefined;
}

/** The form as CallCriteria, or undefined when it asks nothing (an empty section saves as no criteria). */
export function formToCriteria(f: CriteriaForm): CallCriteria | undefined {
  const c: CallCriteria = {};
  const grouped = groupTagIds(f.tagIds);
  const tags: Record<string, string[]> = {};
  for (const cat of CRITERIA_CATEGORIES) if (grouped[cat]?.length) tags[cat] = grouped[cat]!;
  if (Object.keys(tags).length) c.tags = tags;
  const uses = USE_KEYS.filter((k) => f.uses.includes(k));
  if (uses.length) c.uses = uses;
  if (f.region.trim()) c.region = f.region.trim();
  const min = cmOf(f.minCm);
  const max = cmOf(f.maxCm);
  if (min !== undefined) c.minLongestEdgeCm = min;
  if (max !== undefined) c.maxLongestEdgeCm = max;
  if (f.note.trim()) c.note = f.note.trim();
  return Object.keys(c).length ? c : undefined;
}

/** How many separate asks the criteria make (one per tag category, uses, region, size). */
export function countAsks(c: CallCriteria | undefined): number {
  if (!c) return 0;
  const cats = Object.values(c.tags ?? {}).filter((l) => l.length).length;
  return cats + (c.uses?.length ? 1 : 0) + (c.region?.trim() ? 1 : 0) + (c.minLongestEdgeCm !== undefined || c.maxLongestEdgeCm !== undefined ? 1 : 0);
}

/** validateCriteria over the form, as an editor error record ({ 'lookingFor.region': '…' }). */
export function criteriaErrors(f: CriteriaForm): Record<string, string> {
  const c = formToCriteria(f);
  const p = c ? validateCriteria(c) : undefined;
  return p ? { [p.field]: p.message } : {};
}

/** True for an error key this section shows. */
export const isCriteriaKey = (k: string) => k === 'lookingFor' || k.startsWith('lookingFor.');

type CriteriaFieldsProps = { value: CriteriaForm; onChange: (v: CriteriaForm) => void; errors: Record<string, string | undefined> };

/**
 * Memoised: the tag picker renders ~170 chips, so typing elsewhere in a call form must
 * not re-render it. `onChange` is ignored in the comparison: editors pass a fresh closure
 * each render whose only captured state is `errors`, which is compared.
 */
export const CriteriaFields = memo(CriteriaFieldsInner, (a, b) => a.value === b.value && criteriaErrorsEqual(a.errors, b.errors));

function criteriaErrorsEqual(a: CriteriaFieldsProps['errors'], b: CriteriaFieldsProps['errors']): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => isCriteriaKey(k) || k === 'general'));
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function CriteriaFieldsInner({ value, onChange, errors }: CriteriaFieldsProps) {
  const c = matchCopy.editor;
  const uid = useId();
  const asks = countAsks(formToCriteria(value));
  const set = <K extends keyof CriteriaForm>(k: K, v: CriteriaForm[K]) => onChange({ ...value, [k]: v });
  const toggleUse = (k: UseKey) => set('uses', value.uses.includes(k) ? value.uses.filter((x) => x !== k) : [...value.uses, k]);
  const empty = !formToCriteria(value);
  const [tagsOpen, setTagsOpen] = useState(false);
  const grouped = groupTagIds(value.tagIds);
  const chosen = CRITERIA_CATEGORIES.filter((cat) => grouped[cat]?.length).map((cat) => [cat, grouped[cat]!] as const);
  return (
    <div className="stack lf-fields" data-testid="looking-for">
      <p className="small muted lf-fields__lede">{c.lede}</p>
      <Group label={c.tagsLabel} hint={c.tagsHint} error={errors.lookingFor}>
        {/* The picker is ~170 chips: closed by default so the call form stays light; the chosen tags show as a summary. */}
        {tagsOpen ? (
          <>
            <TagPicker mode="criteria" categories={CRITERIA_CATEGORIES} value={value.tagIds} onChange={(ids) => set('tagIds', ids)} label={c.tagsLabel} />
            <span className="tiny muted">{c.mediumHint}</span>
          </>
        ) : chosen.length ? (
          <dl className="lf-chosen">
            {chosen.map(([cat, ids]) => (
              <div key={cat}>
                <dt>{categoryLabel(cat)}</dt>
                <dd>{ids.map(tagLabel).join(', ')}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="small muted">{c.tagsNone}</span>
        )}
        <div>
          <Button tone="secondary" size="sm" aria-expanded={tagsOpen} onClick={() => setTagsOpen((o) => !o)}>
            {tagsOpen ? c.tagsDone : c.tagsEdit}
          </Button>
        </div>
      </Group>
      <fieldset className="lf-fieldset" aria-describedby={`${uid}-uses`} data-invalid={errors['lookingFor.uses'] ? 'true' : undefined} tabIndex={errors['lookingFor.uses'] ? -1 : undefined}>
        <legend className="field__label">{c.usesLabel}</legend>
        <div className="lf-ticks">
          {USE_KEYS.map((k) => (
            <label key={k} className="lf-tick">
              <input type="checkbox" checked={value.uses.includes(k)} onChange={() => toggleUse(k)} />
              <span>{USE_LABEL[k]}</span>
            </label>
          ))}
        </div>
        {errors['lookingFor.uses'] ? (
          <span className="field__error" role="alert" id={`${uid}-uses`}>
            {errors['lookingFor.uses']}
          </span>
        ) : (
          <span className="field__hint" id={`${uid}-uses`}>
            {c.usesHint}
          </span>
        )}
      </fieldset>
      <Input label={c.region} hint={c.regionHint} value={value.region} error={errors['lookingFor.region']} onChange={(e) => set('region', e.target.value)} />
      <div className="pg-two">
        <Input label={c.minCm} type="number" inputMode="decimal" min={0} step="any" value={value.minCm} error={errors['lookingFor.minLongestEdgeCm']} onChange={(e) => set('minCm', e.target.value)} />
        <Input label={c.maxCm} type="number" inputMode="decimal" min={0} step="any" value={value.maxCm} error={errors['lookingFor.maxLongestEdgeCm']} onChange={(e) => set('maxCm', e.target.value)} />
      </div>
      <span className="tiny muted lf-sizehint">{c.sizeHint}</span>
      <Textarea label={c.note} hint={c.noteHint} rows={2} value={value.note} error={errors['lookingFor.note']} onChange={(e) => set('note', e.target.value)} />
      <div className="lf-summary">
        <span className="small muted" aria-live="polite">
          {asks === 0 ? c.summaryNone : c.summarySome(asks)}
        </span>
        {!empty && (
          <Button tone="ghost" size="sm" onClick={() => onChange({ ...BLANK_CRITERIA, tagIds: [], uses: [] })}>
            {c.clear}
          </Button>
        )}
      </div>
    </div>
  );
}
