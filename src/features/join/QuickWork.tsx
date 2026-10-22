import { useRef, useState } from 'react';
import type { ArtistView, ArtworkImage, ArtworkView, Medium, Unit, Visibility } from '@/domain/types';
import { MEDIUMS, VISIBILITIES, VISIBILITY_LABEL } from '@/domain/types';
import type { ArtworkInput } from '@/data/DataSource';
import { ValidationError } from '@/data/DataSource';
import { prepareImage } from '@/native/images';
import { useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Icon, Input, Segmented, Select } from '@/ui';
import { copy } from './copy';

const c = copy.work;
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'];

interface QuickForm {
  image?: ArtworkImage;
  title: string;
  year: string;
  medium: Medium;
  materials: string;
  height: string;
  width: string;
  unit: Unit;
  amount: string;
  currency: string;
  priceVisibility: Visibility;
  visibility: Visibility;
}

function blank(artist: ArtistView): QuickForm {
  const country = artist.region?.country ?? '';
  return {
    title: '',
    year: String(new Date().getFullYear()),
    medium: artist.mediums[0] ?? 'painting',
    materials: '',
    height: '',
    width: '',
    unit: country === 'United States' ? 'in' : 'cm',
    amount: '',
    currency: country === 'Canada' ? 'CAD' : 'USD',
    priceVisibility: 'institutions',
    visibility: 'public',
  };
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

type Errors = Partial<Record<'title' | 'year' | 'materials' | 'size' | 'price' | 'photo', string>>;

/**
 * Only a photo, a title and a medium are required here. Year and materials are optional:
 * a blank year saves as this year, blank materials save as the medium (the record needs
 * both; the full editor can refine them). Whatever is filled in is still checked.
 * Size stays required: every work record carries a height and a width.
 */
export function validateQuick(f: Pick<QuickForm, 'image' | 'title' | 'year' | 'height' | 'width' | 'amount'>): Errors {
  const e: Errors = {};
  const max = new Date().getFullYear() + 1;
  if (!f.image) e.photo = c.errors.photo;
  if (!f.title.trim()) e.title = c.errors.title;
  if (f.year.trim()) {
    const y = num(f.year);
    if (!Number.isInteger(y) || y < 1900 || y > max) e.year = c.errors.year(max);
  }
  if (!(num(f.height) > 0) || !(num(f.width) > 0)) e.size = c.errors.size;
  if (f.amount.trim() && !(num(f.amount) >= 0)) e.price = c.errors.price;
  return e;
}

function materialsOf(f: QuickForm): string[] {
  const list = f.materials
    .split(/[,;]/)
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : [f.medium];
}

function toInput(f: QuickForm, artist: ArtistView): ArtworkInput {
  const input: ArtworkInput = {
    title: f.title.trim(),
    year: f.year.trim() ? num(f.year) : new Date().getFullYear(),
    medium: f.medium,
    materials: materialsOf(f),
    dimensions: { height: num(f.height), width: num(f.width), unit: f.unit },
    description: '',
    images: f.image ? [f.image] : [],
    status: 'available',
    rightsNote: `© ${artist.workingName}.`,
    priceVisibility: f.priceVisibility,
    visibility: f.visibility,
    tags: [],
  };
  if (f.amount.trim()) input.price = { amount: num(f.amount), currency: f.currency };
  return input;
}

const FIELD_OF: Record<string, keyof Errors> = { title: 'title', year: 'year', materials: 'materials', dimensions: 'size', price: 'price', images: 'photo' };

/** The compact add-a-work card of step four. Saves through saveArtwork; WorkEditor stays the full editor. */
export function QuickWork({ artist, onSaved, onCancel }: { artist: ArtistView; onSaved: (w: ArtworkView) => void; onCancel?: () => void }) {
  const { data, viewer } = useSession();
  const toast = useToast();
  const [f, setF] = useState<QuickForm>(() => blank(artist));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof QuickForm>(k: K, v: QuickForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const clear = (k: keyof Errors) => errors[k] && setErrors((e) => ({ ...e, [k]: undefined }));

  async function pick(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    try {
      const p = await prepareImage(file);
      set('image', { id: `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, src: p.dataUrl, alt: '', isPrimary: true, metadataStripped: p.metadataStripped });
      clear('photo');
    } catch (e) {
      setErrors((x) => ({ ...x, photo: errorMessage(e) }));
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    const e = validateQuick(f);
    setErrors(e);
    if (Object.values(e).some(Boolean)) {
      window.setTimeout(() => document.querySelector<HTMLElement>('.kj-quick [aria-invalid="true"], .kj-quick [data-invalid="true"]')?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      const input = toInput(f, artist);
      if (input.images[0]) input.images[0] = { ...input.images[0], alt: input.title };
      const w = await data.saveArtwork(viewer, input);
      toast.push(c.added(w.title), 'success');
      setF(blank(artist));
      onSaved(w);
    } catch (err) {
      if (err instanceof ValidationError && err.field && FIELD_OF[err.field]) setErrors({ [FIELD_OF[err.field]!]: err.message });
      else toast.push(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="kj-quick"
      noValidate
      aria-labelledby="kj-quick-title"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="kj-quick-title" className="kj-quick__title">
        {c.cardTitle}
      </h2>

      <div className="field" data-invalid={errors.photo ? 'true' : undefined} tabIndex={errors.photo ? -1 : undefined}>
        <span className="field__label" id="kj-photo-label">
          {c.photo}
        </span>
        <div className="kj-photo">
          <div className="kj-photo__frame" aria-hidden="true">
            {f.image ? <img src={f.image.src} alt="" /> : <span className="star" />}
          </div>
          <div className="kj-photo__side">
            <input
              ref={fileRef}
              id="kj-photo-input"
              type="file"
              accept="image/*"
              className="kj-visually-hidden"
              aria-labelledby="kj-photo-label"
              aria-describedby="kj-photo-hint"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Button tone="secondary" size="sm" icon={<Icon.Plus />} onClick={() => fileRef.current?.click()} loading={preparing}>
              {f.image ? c.photoChange : c.photoPick}
            </Button>
            <span className="field__hint" id="kj-photo-hint">
              {preparing ? c.photoWorking : c.photoHint}
            </span>
          </div>
        </div>
        {errors.photo && (
          <span className="field__error" role="alert">
            {errors.photo}
          </span>
        )}
      </div>

      <Input label={c.titleLabel} hint={c.titleHint} value={f.title} error={errors.title} onChange={(e) => (set('title', e.target.value), clear('title'))} />
      <div className="kj-row2">
        <Input label={c.year} hint={c.yearHint} inputMode="numeric" value={f.year} error={errors.year} onChange={(e) => (set('year', e.target.value.replace(/[^\d]/g, '')), clear('year'))} />
        <Select label={c.medium} value={f.medium} onChange={(e) => set('medium', e.target.value as Medium)}>
          {MEDIUMS.map((m) => (
            <option key={m} value={m}>
              {cap(m)}
            </option>
          ))}
        </Select>
      </div>
      <Input label={c.materials} hint={c.materialsHint} value={f.materials} error={errors.materials} onChange={(e) => (set('materials', e.target.value), clear('materials'))} />
      <div className="kj-size" data-invalid={errors.size ? 'true' : undefined} tabIndex={errors.size ? -1 : undefined}>
        <div className="kj-row3">
          <Input label={c.height} inputMode="decimal" value={f.height} aria-invalid={errors.size ? true : undefined} onChange={(e) => (set('height', e.target.value), clear('size'))} />
          <Input label={c.width} inputMode="decimal" value={f.width} aria-invalid={errors.size ? true : undefined} onChange={(e) => (set('width', e.target.value), clear('size'))} />
          <div className="field">
            <span className="field__label" aria-hidden="true">
              {c.unit}
            </span>
            <Segmented<Unit>
              label={c.unit}
              value={f.unit}
              onChange={(v) => set('unit', v)}
              options={[
                { value: 'in', label: 'in' },
                { value: 'cm', label: 'cm' },
              ]}
            />
          </div>
        </div>
        {errors.size && (
          <span className="field__error" role="alert">
            {errors.size}
          </span>
        )}
      </div>
      <div className="kj-row2">
        <Input label={c.price} hint={c.priceHint} inputMode="decimal" value={f.amount} error={errors.price} onChange={(e) => (set('amount', e.target.value), clear('price'))} />
        <Select label={c.currency} value={f.currency} onChange={(e) => set('currency', e.target.value)}>
          {CURRENCIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </div>
      <Select label={c.priceWho} value={f.priceVisibility} onChange={(e) => set('priceVisibility', e.target.value as Visibility)}>
        {VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {VISIBILITY_LABEL[v]}
          </option>
        ))}
      </Select>
      <Select label={c.visibility} hint={c.visibilityHint} value={f.visibility} onChange={(e) => (set('visibility', e.target.value as Visibility), clear('photo'))}>
        {VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {VISIBILITY_LABEL[v]}
          </option>
        ))}
      </Select>

      <div className="kj-actions">
        <Button type="submit" loading={busy} disabled={preparing}>
          {c.save}
        </Button>
        {onCancel && (
          <Button tone="ghost" onClick={onCancel} disabled={busy}>
            {c.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
