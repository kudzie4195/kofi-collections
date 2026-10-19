/**
 * Studio-local helpers and small controls. Kept inside the feature folder so the
 * spine stays untouched; anything here that proves generally useful is listed
 * as a spine gap in the unit report.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import type { ArtistStatus, ArtworkView, Medium, Visibility } from '@/domain/types';
import { VISIBILITIES, VISIBILITY_HELP, VISIBILITY_LABEL } from '@/domain/types';
import type { ArtworkInput } from '@/data/DataSource';
import { ValidationError } from '@/data/DataSource';
import { Chip, Confirm, Icon } from '@/ui';

/* ---------- formatting ---------- */

export function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return 'No date';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 104.8576)) / 10} MB`;
}

export const STATUS_COPY: Record<ArtistStatus, { label: string; body: string }> = {
  draft: {
    label: 'Draft',
    body: 'Kofi hasn’t seen your profile yet. When it reads the way you want, send it for review.',
  },
  pending: {
    label: 'Pending review',
    body: 'Kofi is reviewing your profile. Nothing is shown in the gallery until it’s approved.',
  },
  approved: {
    label: 'Approved',
    body: 'Works you mark Public can appear in the gallery and in curator search.',
  },
  paused: {
    label: 'Paused',
    body: 'Your profile is out of discovery for now. Your records are safe; contact Kofi to resume.',
  },
};

/* ---------- artwork view → input ---------- */

/** Rebuild a full save payload from the owner's projection (the owner sees every field). */
export function viewToInput(view: ArtworkView, patch: Partial<ArtworkInput> = {}): ArtworkInput {
  const input: ArtworkInput = {
    id: view.id,
    title: view.title,
    year: view.year,
    medium: view.medium,
    materials: [...view.materials],
    dimensions: { ...view.dimensions },
    description: view.description,
    images: view.images.map((i) => ({ ...i })),
    status: view.status,
    rightsNote: view.rightsNote,
    priceVisibility: view.priceVisibility,
    visibility: view.visibility,
    tags: [...view.tags],
  };
  if (view.price) input.price = { ...view.price };
  return { ...input, ...patch };
}

/** Turn a thrown error into a field map when it is a ValidationError with a field. */
export function fieldErrorFrom(e: unknown): Record<string, string> | undefined {
  if (e instanceof ValidationError && e.field) return { [e.field]: e.message };
  return undefined;
}

/** Move focus to the first invalid control after errors render. */
export function focusFirstError(): void {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
    if (!el) return;
    el.focus?.();
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, 0);
}

/* ---------- unsaved-changes guard ---------- */

/**
 * Blocks in-app navigation (back button, tab bar, links) while `dirty` and
 * shows a Confirm sheet. Also warns on tab close via beforeunload.
 * Call `allowNext()` right before a deliberate navigation (e.g. after saving).
 */
export function useUnsavedGuard(dirty: boolean, what = 'your changes') {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const allow = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && !allow.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const dialog = (
    <Confirm
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title="Leave without saving?"
      body={`You haven’t saved ${what}. If you leave now, they’ll be lost.`}
      confirmLabel="Discard changes"
      danger
    />
  );
  return {
    dialog,
    allowNext: () => {
      allow.current = true;
    },
  };
}

/* ---------- labelled group for custom controls ---------- */

export function Group({ label, hint, error, children, id: forcedId }: { label: string; hint?: string; error?: string; children: ReactNode; id?: string }) {
  const auto = useId();
  const id = forcedId ?? auto;
  return (
    <div className="field" role="group" aria-labelledby={`${id}-label`} data-invalid={error ? 'true' : undefined} tabIndex={error ? -1 : undefined}>
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/* ---------- visibility picker with per-option captions ---------- */

export function StudioVisibilityPicker({
  value,
  onChange,
  label,
  options = VISIBILITIES,
  titles = {},
  captions = {},
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  label: string;
  options?: Visibility[];
  titles?: Partial<Record<Visibility, string>>;
  captions?: Partial<Record<Visibility, string>>;
}) {
  const id = useId();
  return (
    <div className="field" role="radiogroup" aria-labelledby={id}>
      <span className="field__label" id={id}>
        {label}
      </span>
      <div className="vis-picker">
        {options.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className="vis-option" onClick={() => onChange(v)}>
            <span className="vis-option__dot" aria-hidden="true" />
            <span>
              <span className="vis-option__title">{titles[v] ?? VISIBILITY_LABEL[v]}</span>
              <span className="vis-option__help" style={{ display: 'block' }}>
                {captions[v] ?? VISIBILITY_HELP[v]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function VisibilityIcon({ level }: { level: Visibility }) {
  if (level === 'public') return <Icon.Globe />;
  if (level === 'institutions') return <Icon.Building />;
  if (level === 'kofi') return <Icon.Admin />;
  return <Icon.Lock />;
}

/* ---------- chip input (materials, tags) ---------- */

export function ChipInput({
  label,
  values,
  onChange,
  suggestions = [],
  hint,
  error,
  placeholder,
  medium,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  hint?: string;
  error?: string;
  placeholder?: string;
  medium?: Medium;
}) {
  const [text, setText] = useState('');
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;

  const add = (raw: string[]) => {
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const r of raw) {
      const v = r.trim().replace(/\s+/g, ' ');
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      next.push(v);
    }
    if (next.length !== values.length) onChange(next);
  };

  const q = text.trim().toLowerCase();
  const taken = new Set(values.map((v) => v.toLowerCase()));
  const shown = suggestions.filter((s) => !taken.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q))).slice(0, 6);

  return (
    <div className="field" data-invalid={error ? 'true' : undefined}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {values.length > 0 && (
        <ul className="chips" aria-label={`${label} added`}>
          {values.map((v) => (
            <li key={v}>
              <Chip small medium={medium} on={medium ? true : undefined} aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                {v}
                <Icon.Close width={12} height={12} />
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className="input"
        value={text}
        placeholder={placeholder}
        aria-describedby={[hint && !error ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        enterKeyHint="enter"
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            const parts = v.split(',');
            const last = parts.pop() ?? '';
            add(parts);
            setText(last.trimStart());
          } else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add([text]);
            setText('');
          } else if (e.key === 'Backspace' && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (text.trim()) {
            add([text]);
            setText('');
          }
        }}
      />
      {hint && !error && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field__error" id={errId} role="alert">
          {error}
        </span>
      )}
      {shown.length > 0 && (
        <div className="st-suggest">
          <span className="tiny muted">Suggestions</span>
          <div className="chips">
            {shown.map((s) => (
              <Chip small key={s} aria-label={`Add ${s}`} onClick={() => add([s])}>
                <Icon.Plus width={12} height={12} />
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- data URL → openable blob ---------- */

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(5, comma); // after "data:"
  const body = dataUrl.slice(comma + 1);
  const parts = head.split(';');
  const mime = parts[0] || 'application/octet-stream';
  if (parts.includes('base64')) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: parts.includes('charset=utf-8') ? `${mime};charset=utf-8` : mime });
}

export function mimeOf(dataUrl: string): string {
  const m = /^data:([^;,]+)/.exec(dataUrl);
  return m?.[1] ?? 'application/octet-stream';
}
