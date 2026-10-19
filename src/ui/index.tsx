/**
 * Kofi UI kit. Everything the feature screens need, styled by global.css.
 * Keep components small and dumb; business rules live in domain/ and data/.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ArtworkView, Medium, Visibility } from '@/domain/types';
import { VISIBILITIES, VISIBILITY_HELP, VISIBILITY_LABEL } from '@/domain/types';
import { formatDimensions, formatPrice } from '@/domain/units';
import { useToast } from '@/state/toast';
import { tap } from '@/native/platform';

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
export function TopBar({ title, back, right }: { title: string; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  const goBack = () => {
    if (typeof back === 'string') return nav(back);
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    return idx > 0 ? nav(-1) : nav('/');
  };
  return (
    <header className="topbar">
      <div className="container container--wide topbar__inner">
        {back && (
          <button type="button" className="topbar__back" aria-label="Back" onClick={goBack}>
            <Icon.Back />
          </button>
        )}
        <h1 className="topbar__title">{title}</h1>
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

export function Avatar({ name, color, size = 'md' }: { name: string; color: string; size?: 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar--lg' : ''}`} style={{ background: color, color: inkFor(color), textShadow: 'none' }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** White or ink text, whichever has the higher contrast on a hex background. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#16122B' : '#fff';
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-dot--${status.replace(/\s+/g, '-')}`} aria-hidden="true" />;
}

/* ---------- sheet ---------- */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <Button tone="ghost" icon={<Icon.Close />} aria-label="Close" onClick={onClose} />
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </>
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
          <Button tone="secondary" onClick={onClose} block>
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
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast--${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function FictionalFooter() {
  return <p className="fictional">All artists, works and institutions shown are fictional sample content.</p>;
}
