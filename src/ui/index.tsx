/**
 * Kofi UI kit. Everything the feature screens need, styled by global.css.
 * Keep components small and dumb; business rules live in domain/ and data/.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useInRouterContext, useNavigate } from 'react-router-dom';
import type { ArtworkView, Medium, Visibility } from '@/domain/types';
import { VISIBILITIES, VISIBILITY_HELP, VISIBILITY_LABEL } from '@/domain/types';
import { formatDimensions, formatPrice } from '@/domain/units';
import { useToast } from '@/state/toast';
import { tap } from '@/native/platform';
import './site.css';

/* ---------- icons (inline, 24px grid) ---------- */
const I = ({ d, ...rest }: { d: string } & React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    <path d={d} />
  </svg>
);
export const Icon = {
  Back: (p: React.SVGProps<SVGSVGElement>) => <I d="M15 18l-6-6 6-6" {...p} />,
  Close: (p: React.SVGProps<SVGSVGElement>) => <I d="M18 6L6 18M6 6l12 12" {...p} />,
  Search: (p: React.SVGProps<SVGSVGElement>) => <I d="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" {...p} />,
  Filter: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 6h18M6 12h12M10 18h4" {...p} />,
  Plus: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 5v14M5 12h14" {...p} />,
  Gallery: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6" {...p} />,
  Artists: (p: React.SVGProps<SVGSVGElement>) => <I d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" {...p} />,
  Studio: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.6 7.6M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" {...p} />,
  Shortlist: (p: React.SVGProps<SVGSVGElement>) => <I d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" {...p} />,
  Inbox: (p: React.SVGProps<SVGSVGElement>) => <I d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" {...p} />,
  Admin: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" {...p} />,
  Person: (p: React.SVGProps<SVGSVGElement>) => <I d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" {...p} />,
  Eye: (p: React.SVGProps<SVGSVGElement>) => <I d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" {...p} />,
  EyeOff: (p: React.SVGProps<SVGSVGElement>) => <I d="M17.9 17.9A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22" {...p} />,
  Lock: (p: React.SVGProps<SVGSVGElement>) => <I d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" {...p} />,
  Building: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" {...p} />,
  Globe: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" {...p} />,
  Check: (p: React.SVGProps<SVGSVGElement>) => <I d="M20 6L9 17l-5-5" {...p} />,
  Trash: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" {...p} />,
  Download: (p: React.SVGProps<SVGSVGElement>) => <I d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" {...p} />,
  Doc: (p: React.SVGProps<SVGSVGElement>) => <I d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" {...p} />,
  Mail: (p: React.SVGProps<SVGSVGElement>) => <I d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" {...p} />,
  Info: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" {...p} />,
  Warn: (p: React.SVGProps<SVGSVGElement>) => <I d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" {...p} />,
  Edit: (p: React.SVGProps<SVGSVGElement>) => <I d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" {...p} />,
  Sort: (p: React.SVGProps<SVGSVGElement>) => <I d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 4v16" {...p} />,
  Ruler: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 17l14-14 4 4L7 21zM8 10l2 2M11 7l2 2M14 4l2 2M5 13l2 2" {...p} />,
  Sparkle: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM5 19l.7 2 .7-2 2-.7-2-.7-.7-2-.7 2-2 .7z" {...p} />,
  Heart: (p: React.SVGProps<SVGSVGElement>) => <I d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" {...p} />,
  Discover: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z" {...p} />,
  Calendar: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 5h18v16H3zM16 3v4M8 3v4M3 10h18" {...p} />,
  Megaphone: (p: React.SVGProps<SVGSVGElement>) => <I d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" {...p} />,
  Journal: (p: React.SVGProps<SVGSVGElement>) => <I d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" {...p} />,
  External: (p: React.SVGProps<SVGSVGElement>) => <I d="M7 17L17 7M8 7h9v9" {...p} />,
  ArrowRight: (p: React.SVGProps<SVGSVGElement>) => <I d="M5 12h14M13 6l6 6-6 6" {...p} />,
  Room: (p: React.SVGProps<SVGSVGElement>) => <I d="M4 18v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5M2 18h20M6 11V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M5 18v2M19 18v2" {...p} />,
  Phone: (p: React.SVGProps<SVGSVGElement>) => <I d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" {...p} />,
  Pin: (p: React.SVGProps<SVGSVGElement>) => <I d="M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" {...p} />,
};

/* ---------- buttons ---------- */
type Tone = 'primary' | 'secondary' | 'coral' | 'lime' | 'butter' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  size?: 'md' | 'sm';
  block?: boolean;
  icon?: ReactNode;
  loading?: boolean;
}
export function Button({ tone = 'primary', size = 'md', block, icon, loading, className = '', children, onClick, ...rest }: ButtonProps) {
  const cls = ['btn', tone !== 'primary' && `btn--${tone}`, size === 'sm' && 'btn--sm', block && 'btn--block', !children && icon && 'btn--icon', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-busy={loading || undefined}
      onClick={(e) => {
        void tap();
        onClick?.(e);
      }}
      {...rest}
      disabled={loading || rest.disabled}
    >
      {icon}
      {loading ? 'Working…' : children}
    </button>
  );
}

export function LinkButton({ to, tone = 'primary', size = 'md', block, icon, children, className = '' }: { to: string; tone?: Tone; size?: 'md' | 'sm'; block?: boolean; icon?: ReactNode; children?: ReactNode; className?: string }) {
  const cls = ['btn', tone !== 'primary' && `btn--${tone}`, size === 'sm' && 'btn--sm', block && 'btn--block', className].filter(Boolean).join(' ');
  return (
    <Link to={to} className={cls}>
      {icon}
      {children}
    </Link>
  );
}

/* ---------- chips ---------- */
export function Chip({ on, medium, count, small, children, ...rest }: { on?: boolean; medium?: Medium; count?: number; small?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['chip', medium && 'chip--medium', small && 'chip--small'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-pressed={on === undefined ? undefined : on} data-medium={medium} {...rest}>
      {children}
      {count !== undefined && <span className="chip__count">{count}</span>}
    </button>
  );
}

/** Static tag (not a button). */
export function Tag({ medium, children, small = true }: { medium?: Medium; children: ReactNode; small?: boolean }) {
  const cls = ['chip', medium && 'chip--medium', small && 'chip--small'].filter(Boolean).join(' ');
  return (
    <span className={cls} data-medium={medium} style={{ cursor: 'default' }}>
      {children}
    </span>
  );
}

/* ---------- visibility badge ---------- */
export function VisibilityBadge({ level, prefix }: { level: Visibility; prefix?: string }) {
  const icon =
    level === 'public' ? <Icon.Globe /> : level === 'institutions' ? <Icon.Building /> : level === 'kofi' ? <Icon.Admin /> : <Icon.Lock />;
  return (
    <span className={`vis vis--${level}`} title={VISIBILITY_HELP[level]}>
      {icon}
      {prefix ? `${prefix}: ` : ''}
      {VISIBILITY_LABEL[level]}
    </span>
  );
}

export function VisibilityPicker({ value, onChange, label, options = VISIBILITIES, captions }: { value: Visibility; onChange: (v: Visibility) => void; label: string; options?: Visibility[]; captions?: Partial<Record<Visibility, string>> }) {
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
              <span className="vis-option__title">{captions?.[v] ?? VISIBILITY_LABEL[v]}</span>
              <span className="vis-option__help" style={{ display: 'block' }}>
                {captions?.[v] ? VISIBILITY_HELP[v] : VISIBILITY_HELP[v]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- forms ---------- */
interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id, describedBy)}
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
    </div>
  );
}

export function Input({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => <input id={id} className="input" aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...rest} />}
    </Field>
  );
}

export function Textarea({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => <textarea id={id} className="textarea" aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...rest} />}
    </Field>
  );
}

export function Select({ label, hint, error, children, ...rest }: { label: string; hint?: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <select id={id} className="select" aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__knob" />
      </span>
      <span className="toggle__label">
        {label}
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="segmented__btn" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- structure ---------- */
/**
 * `back` may be `true` (go back, or to `/` when the app was opened on a deep link)
 * or a path string (always go there — use when there is no sensible history).
 */
export function TopBar({ title, back, right, home, subordinate }: { title: string; back?: boolean | string; right?: ReactNode; home?: boolean; subordinate?: boolean }) {
  const nav = useNavigate();
  const goBack = () => {
    if (typeof back === 'string') return nav(back);
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    return idx > 0 ? nav(-1) : nav('/');
  };
  // The home screen's bar repeats the nav wordmark; on desktop it is visually hidden (h1 stays in the DOM).
  const isHome = home ?? (!back && title === 'Kofi Collections');
  return (
    <header className={isHome ? 'topbar topbar--home' : 'topbar'}>
      <div className="container container--wide topbar__inner">
        {back && (
          <button type="button" className="topbar__back" aria-label="Back" onClick={goBack}>
            <Icon.Back />
          </button>
        )}
        {subordinate ? <p className="topbar__title">{title}</p> : <h1 className="topbar__title">{title}</h1>}
        {right}
      </div>
    </header>
  );
}

export function Panel({ title, pinned, accent, tint, children, className = '', action }: { title?: string; pinned?: boolean; accent?: boolean; tint?: boolean; children: ReactNode; className?: string; action?: ReactNode }) {
  const cls = ['panel', pinned && 'panel--pinned', accent && 'panel--accent', tint && 'panel--tint', className].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {(title || action) && (
        <div className="row row--between" style={{ marginBottom: title ? 8 : 0 }}>
          {title && <h2 className="panel__title" style={{ marginBottom: 0 }}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = 'butter', icon, children }: { tone?: 'butter' | 'cobalt' | 'lime' | 'coral' | 'plain'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice ${tone !== 'butter' ? `notice--${tone}` : ''}`} role={tone === 'coral' ? 'alert' : undefined}>
      {icon ?? <Icon.Info />}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, body, actions }: { title: string; body?: string; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__mark" aria-hidden="true" />
      <h2 className="empty__title">{title}</h2>
      {body && <p className="empty__body">{body}</p>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty__mark" style={{ background: 'var(--coral)' }} aria-hidden="true" />
      <h2 className="empty__title">That didn’t load</h2>
      <p className="empty__body">{error.message}</p>
      {retry && (
        <div className="empty__actions">
          <Button tone="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Skeleton({ h = 20, w = '100%', style }: { h?: number | string; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function GallerySkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="gallery-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="label-card" style={{ boxShadow: 'none' }}>
          <div className="label-card__img skeleton" />
          <div className="label-card__body stack--sm">
            <Skeleton h={16} w="80%" />
            <Skeleton h={12} w="55%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** v1 avatar colours (still stored on older records) → the Kofi Noir brand set. */
const AVATAR_BRAND: Record<string, string> = {
  '#2436f5': '#4f6a25', // cobalt → deep green
  '#ff5c39': '#c8322b', // coral → red
  '#cfff4a': '#7fa344', // lime → green
  '#ffd23f': '#e3b23c', // butter → gold
  '#7b61ff': '#f3eee6', // violet → cream
  '#5b41e6': '#f3eee6', // violet (seed) → cream
  '#0fa3b1': '#7fa344', // teal → green
  '#16122b': '#242424', // ink → charcoal
  '#6b6684': '#242424', // v1 public grey → charcoal
};
export const AVATAR_COLORS = ['#c8322b', '#e3b23c', '#7fa344', '#4f6a25', '#f3eee6', '#242424'] as const;

/** Any stored avatar colour, shown in the brand palette. Unknown hexes pass through. */
export function brandAvatarColor(color: string): string {
  return AVATAR_BRAND[color.trim().toLowerCase()] ?? color;
}

export function Avatar({ name, color, size = 'md' }: { name: string; color: string; size?: 'md' | 'lg' }) {
  const initials = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  const bg = brandAvatarColor(color);
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar--lg' : ''}`} style={{ background: bg, color: inkFor(bg), textShadow: 'none' }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Black or cream text, whichever has the higher contrast on a hex background. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#f3eee6';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // contrast against #0a0a0a (L≈0.003) vs #f3eee6 (L≈0.85)
  return (L + 0.05) / 0.053 > 0.9 / (L + 0.05) ? '#0a0a0a' : '#f3eee6';
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-dot--${status.replace(/\s+/g, '-')}`} aria-hidden="true" />;
}

/* ---------- sheet ---------- */
const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Keyboard-reachable elements inside `root`, in DOM order (unchecked radios in a checked group are skipped, as the browser does). */
export function tabbables(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE));
  return all.filter((el) => {
    if (el.tabIndex < 0) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const vis = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
    if (typeof vis === 'function' && !vis.call(el)) return false;
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name && !el.checked) {
      const group = all.filter((o): o is HTMLInputElement => o instanceof HTMLInputElement && o.type === 'radio' && o.name === el.name && o.form === el.form);
      if (group.some((o) => o.checked) || group[0] !== el) return false;
    }
    return true;
  });
}

/** Open sheets, bottom → top. Only the top one traps focus and answers Escape. */
const sheetStack: HTMLElement[] = [];

/** Make everything behind the top sheet inert: the app root (#root) and any sheet below it. */
function syncInert() {
  const app = document.getElementById('root');
  const top = sheetStack[sheetStack.length - 1];
  if (app) {
    if (top) {
      app.setAttribute('inert', '');
      app.setAttribute('aria-hidden', 'true');
    } else {
      app.removeAttribute('inert');
      app.removeAttribute('aria-hidden');
    }
  }
  for (const layer of sheetStack) {
    if (layer === top) {
      layer.removeAttribute('inert');
      layer.removeAttribute('aria-hidden');
    } else {
      layer.setAttribute('inert', '');
      layer.setAttribute('aria-hidden', 'true');
    }
  }
}

/**
 * Modal bottom sheet. Rendered in a portal on <body> (outside #root) so the page
 * behind can be made inert. On open, focus moves to `[data-autofocus]`, else the
 * first field or button in the body, else the dialog; Tab loops inside; Escape
 * closes; on close focus returns to whatever opened it.
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const dialog = ref.current;
    if (!open || !layer || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    sheetStack.push(layer);
    syncInert();
    const isTop = () => sheetStack[sheetStack.length - 1] === layer;

    // Initial focus — unless something inside (e.g. autoFocus) already took it.
    if (!dialog.contains(document.activeElement)) {
      const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? (bodyRef.current ? tabbables(bodyRef.current)[0] : undefined) ?? dialog;
      target.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = tabbables(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (e.shiftKey && (!inside || active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Belt and braces: if focus ever lands outside the top sheet, pull it back in.
    const onFocusIn = (e: FocusEvent) => {
      if (!isTop()) return;
      const t = e.target;
      if (t instanceof Node && !layer.contains(t)) (tabbables(dialog)[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = prevOverflow;
      const i = sheetStack.lastIndexOf(layer);
      if (i >= 0) sheetStack.splice(i, 1);
      syncInert(); // un-inert first: an element inside an inert root cannot take focus
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="sheet-layer" ref={layerRef}>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <Button tone="ghost" icon={<Icon.Close />} aria-label="Close" onClick={onClose} />
        </div>
        <div className="sheet__body" ref={bodyRef}>
          {children}
        </div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirm dialog built on Sheet. */
export function Confirm({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; body: string; confirmLabel?: string; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button tone="secondary" onClick={onClose} block data-autofocus>
            Cancel
          </Button>
          <Button
            tone={danger ? 'danger' : 'primary'}
            block
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Sheet>
  );
}

/* ---------- wall label (artwork card) ---------- */
export function WallLabel({ work, to, unit = 'cm', corner }: { work: ArtworkView; to?: string; unit?: 'cm' | 'in'; corner?: ReactNode }) {
  const img = work.images.find((i) => i.isPrimary) ?? work.images[0];
  const statusCls = work.status === 'sold' ? 'label-card__status--sold' : work.status === 'on hold' ? 'label-card__status--hold' : '';
  const showStatus = work.status !== 'available';
  const body = (
    <>
      <div className={`label-card__img ${work.medium === 'video' || work.medium === 'photography' ? 'label-card__img--wide' : ''}`}>
        {img ? <img src={img.src} alt={img.alt} loading="lazy" /> : <div className="skeleton" style={{ height: '100%' }} />}
        {corner && <div className="label-card__corner">{corner}</div>}
        {showStatus && <span className={`label-card__status ${statusCls}`}>{work.status}</span>}
      </div>
      <div className="label-card__body">
        <div className="label-card__title">{work.title}</div>
        <div className="label-card__artist">
          {work.artistWorkingName}, {work.year}
        </div>
        <div className="label-card__meta">
          {work.medium} · {formatDimensions(work.dimensions, unit)}
        </div>
        {work.price ? (
          <div className="label-card__price">{formatPrice(work.price.amount, work.price.currency)}</div>
        ) : work.priceWithheld ? (
          <div className="label-card__price label-card__price--withheld">Price on request</div>
        ) : null}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="label-card" data-medium={work.medium}>
      {body}
    </Link>
  ) : (
    <div className="label-card" data-medium={work.medium}>
      {body}
    </div>
  );
}

/* ---------- toasts ---------- */
export function Toasts() {
  const { toasts, dismiss } = useToast();
  // Toasts may be mounted outside the router (tests, boot); fall back to a hash link there.
  const inRouter = useInRouterContext();
  // The live region always exists (screen readers only announce changes to a region that is already
  // in the DOM) and sits outside #root, so toasts stay announced and clickable while a Sheet has made
  // the app inert.
  const region = (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) =>
        t.action ? (
          <div key={t.id} className={`toast toast--${t.kind} toast--action`} role="status">
            <span className="toast__msg">{t.message}</span>
            {inRouter ? (
              <Link to={t.action.to} className="toast__link" onClick={() => dismiss(t.id)}>
                {t.action.label}
              </Link>
            ) : (
              <a href={`#${t.action.to}`} className="toast__link" onClick={() => dismiss(t.id)}>
                {t.action.label}
              </a>
            )}
            <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon.Close />
            </button>
          </div>
        ) : (
          <button key={t.id} type="button" className={`toast toast--${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </button>
        ),
      )}
    </div>
  );
  return typeof document === 'undefined' ? region : createPortal(region, document.body);
}

/* ---------- save (heart) toggle ---------- */
/** Heart toggle for "saved on this device". Purely presentational; the caller owns the state. */
export function SaveButton({ saved, onToggle, size = 'md', className = '' }: { saved: boolean; onToggle: () => void; size?: 'md' | 'sm'; className?: string }) {
  return (
    <button
      type="button"
      className={['btn', 'btn--secondary', 'save-btn', size === 'sm' && 'btn--sm', className].filter(Boolean).join(' ')}
      aria-pressed={saved}
      onClick={() => {
        void tap();
        onToggle();
      }}
    >
      <Icon.Heart fill={saved ? 'currentColor' : 'none'} />
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}

/* ---------- site footer (public pages) ---------- */
const FOOTER_LINKS: { to: string; label: string }[] = [
  { to: '/works', label: 'Works' },
  { to: '/artists', label: 'Artists' },
  { to: '/exhibitions', label: 'Exhibitions' },
  { to: '/calls', label: 'Open calls' },
  { to: '/journal', label: 'Journal' },
  { to: '/whats-on', label: 'What’s on' },
  { to: '/about', label: 'About' },
  { to: '/saved', label: 'Saved' },
];

export function SiteFooter() {
  return (
    <footer className="site-footer" aria-label="Kofi Collections">
      <div className="container container--wide site-footer__inner">
        <div className="site-footer__brand">
          <Link to="/" className="site-footer__mark" aria-label="Kofi Collections home">
            <span className="star" aria-hidden="true" />
            <span>
              Kofi
              <small>Collections</small>
            </span>
          </Link>
          <p className="site-footer__tag">Promoting and amplifying underrepresented voices in the art world. Pittsburgh, since 2024.</p>
          <span className="site-footer__strokes" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        <address className="site-footer__contact">
          <span className="eyebrow">Visit &amp; contact</span>
          <span>213 Smithfield St.</span>
          <span>Pittsburgh, PA 15222</span>
          <a href="mailto:info@koficollections.org">info@koficollections.org</a>
          <a href="tel:+14123907677">412.390.7677</a>
        </address>
        <nav className="site-footer__nav" aria-label="Footer">
          <span className="eyebrow">Explore</span>
          <ul>
            {FOOTER_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="container container--wide site-footer__base">
        <p>Sample artists and institutions are fictional. Artwork photography © the artists, via koficollections.org.</p>
        <a href="https://www.koficollections.org/" target="_blank" rel="noopener noreferrer">
          koficollections.org ↗
        </a>
      </div>
    </footer>
  );
}

export function FictionalFooter() {
  return <p className="fictional">Sample artists and institutions are fictional. Artwork photography © the artists, via koficollections.org.</p>;
}
