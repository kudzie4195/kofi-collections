import { useCallback, useEffect, useId, useState, type InputHTMLAttributes } from 'react';
import type { DataSource } from '@/data/DataSource';
import type { Viewer } from '@/domain/types';
import { useSession, type QueryState } from '@/state/session';
import { Icon } from '@/ui';

/** "mixed media" → "Mixed media". Data values are lower case; labels are sentence case. */
export function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function isVerifiedCurator(v: Viewer): boolean {
  return v.role === 'curator' && v.curatorVerified === true;
}

export function isPendingCurator(v: Viewer): boolean {
  return v.role === 'curator' && v.curatorVerified !== true;
}

/** Only render links that are plain web links. */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Like `useQuery`, but does NOT re-run when the data source reports a change.
 * Used for `getArtwork`: when an admin opens a private record the mock data
 * source writes an audit event and notifies subscribers, and `useQuery` would
 * then re-fetch, audit again, and loop. Re-runs on viewer / data source / deps.
 */
export function useLoad<T>(fn: (data: DataSource, viewer: Viewer) => Promise<T>, deps: unknown[]): QueryState<T> {
  const { data, viewer } = useSession();
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn(data, viewer)
      .then((d) => alive && setState({ data: d, error: undefined, loading: false }))
      .catch((e: unknown) => alive && setState({ data: undefined, error: e instanceof Error ? e : new Error(String(e)), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, viewer, tick, ...deps]);
  return { ...state, reload };
}

/** Search input with a visually hidden label and a leading icon. */
export function SearchBox({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div className="kg-search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon.Search className="kg-search__icon" />
      <input
        id={id}
        className="input kg-search__input"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="kg-search__clear" aria-label="Clear search" onClick={() => onChange('')}>
          <Icon.Close />
        </button>
      )}
    </div>
  );
}

/**
 * Number input that keeps its own text while typing ("4", "40", "40.") and
 * reports a parsed number (or undefined when empty). Resyncs when the value is
 * changed from outside (a preset, "Clear all", a unit switch).
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  ...rest
}: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; suffix?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = parseNum(text);
    if (parsed !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="kg-num">
        <input
          id={id}
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(',', '.');
            setText(t);
            onChange(parseNum(t));
          }}
          {...rest}
        />
        {suffix && (
          <span className="kg-num__suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function parseNum(t: string): number | undefined {
  if (!t.trim()) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
