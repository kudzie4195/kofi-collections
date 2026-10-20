/**
 * Controls used by the programme editors: medium chips, an ordered artwork
 * picker and an image field (from an attached work, or an upload re-encoded
 * through the studio's image intake so EXIF/GPS never reaches storage).
 */
import { useId, useMemo, useRef, useState } from 'react';
import type { ArtworkView, Medium, ProgrammeImage } from '@/domain/types';
import { MEDIUMS } from '@/domain/types';
import { prepareImage } from '@/native/images';
import { errorMessage } from '@/state/toast';
import { Button, Chip, Icon, Input, VisibilityBadge } from '@/ui';
import { Group, capitalize } from '@/features/studio/shared';

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
