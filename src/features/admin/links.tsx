/**
 * Link display shared by the Kofi desk and the artist's studio: platform glyph,
 * handle, and the verification pill with when it was last checked.
 */
import type { ArtistLink, LinkVerification } from '@/domain/types';
import { normalizeLink, platformName } from '@/domain/intake';
import { PlatformIcon } from './icons';
import { PILL_HELP, PILL_LABEL, deskIntakeCopy } from './intakeCopy';
import './links.css';

export function verificationOf(l: ArtistLink): LinkVerification {
  return l.verification ?? 'claimed';
}

/** Platform and handle for any link, typed or free-text (derived when missing). */
export function linkParts(l: ArtistLink): { platform: NonNullable<ArtistLink['platform']>; handle: string } {
  if (l.platform && l.handle) return { platform: l.platform, handle: l.handle };
  const n = normalizeLink(l.url);
  return { platform: l.platform ?? n?.platform ?? 'other', handle: l.handle ?? n?.handle ?? l.url.replace(/^https?:\/\//, '') };
}

export function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function VerificationPill({ link, showChecked = true }: { link: ArtistLink; showChecked?: boolean }) {
  const v = verificationOf(link);
  const when = showChecked && link.checkedAt ? shortDate(link.checkedAt) : '';
  return (
    <span className={`lk-pill lk-pill--${v}`} title={PILL_HELP[v]} data-verification={v}>
      <span className="lk-pill__dot" aria-hidden="true" />
      {PILL_LABEL[v]}
      {when && (
        <time className="lk-pill__when" dateTime={link.checkedAt} title={`${deskIntakeCopy.checked} ${longDate(link.checkedAt!)}`}>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, {deskIntakeCopy.checked.toLowerCase()} </span>
          {when}
        </time>
      )}
    </span>
  );
}

/** One link as a row: glyph, platform + handle, pill. `action` sits at the end (remove, etc.). */
export function LinkLine({ link, action, explain }: { link: ArtistLink; action?: React.ReactNode; explain?: boolean }) {
  const { platform, handle } = linkParts(link);
  const v = verificationOf(link);
  const label = link.label?.trim() && link.label.trim() !== `${platformName(platform)} ${handle}` && link.label.trim() !== handle ? link.label.trim() : platformName(platform);
  return (
    <div className="lk-line" data-platform={platform}>
      <span className="lk-line__icon" aria-hidden="true">
        <PlatformIcon platform={platform} />
      </span>
      <span className="lk-line__main">
        <span className="lk-line__platform">{label}</span>
        <a className="lk-line__handle" href={link.url} target="_blank" rel="noopener noreferrer">
          {handle}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {explain && v !== 'claimed' && <span className="lk-line__help">{PILL_HELP[v]}</span>}
      </span>
      <span className="lk-line__side">
        <VerificationPill link={link} />
        {action}
      </span>
    </div>
  );
}

export function LinkList({ links, explain, label }: { links: ArtistLink[]; explain?: boolean; label?: string }) {
  if (!links.length) return <p className="small muted">{deskIntakeCopy.linksNone}</p>;
  return (
    <ul className="lk-list" aria-label={label}>
      {links.map((l) => (
        <li key={l.url}>
          <LinkLine link={l} explain={explain} />
        </li>
      ))}
    </ul>
  );
}
