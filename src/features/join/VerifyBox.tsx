import { useRef } from 'react';
import type { ArtistLink, LinkVerification } from '@/domain/types';
import { platformName } from '@/domain/intake';
import { useToast } from '@/state/toast';
import { Button, Icon } from '@/ui';
import { PlatformIcon } from './PlatformIcon';
import { copy } from './copy';
import './join.css';

const c = copy.verifyBox;

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A link's verification as a small pill. Used by the intake and the studio profile editor. */
export function VerificationPill({ state }: { state?: LinkVerification }) {
  const v = state ?? 'claimed';
  return <span className={`kj-pill kj-pill--${v}`}>{c.pill[v]}</span>;
}

/** One link: platform mark, handle, pill and when it was last checked. */
export function LinkLine({ link, action }: { link: ArtistLink; action?: React.ReactNode }) {
  const platform = link.platform ?? 'other';
  const name = link.handle || link.label || link.url;
  return (
    <li className="kj-linkline">
      <span className="kj-linkline__icon">
        <PlatformIcon platform={platform} />
      </span>
      <span className="kj-linkline__text">
        <span className="kj-linkline__handle">{name}</span>
        <span className="kj-linkline__meta">
          {platformName(platform)}
          {link.checkedAt ? ` · ${c.checkedAt(shortDate(link.checkedAt))}` : ''}
        </span>
      </span>
      <VerificationPill state={link.verification} />
      {action}
    </li>
  );
}

/**
 * The artist's verification code with Copy, the three ways to use it, their links
 * with verification pills (unless `hideLinks`), and "Check my links". Owner-facing (the token is
 * owner/admin only); the caller runs the check and passes `checking`.
 */
export function VerifyBox({ token, links, onCheck, checking, hideLinks }: { token?: string; links: ArtistLink[]; onCheck: () => void; checking?: boolean; /** Omit the link list (the caller already shows the links). */ hideLinks?: boolean }) {
  const toast = useToast();
  const codeRef = useRef<HTMLElement>(null);

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.push(c.copied, 'success');
    } catch {
      // Clipboard blocked (insecure origin, old WebView): select the code so a long-press copies it.
      const el = codeRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      toast.push(c.copyFailed, 'info');
    }
  }

  return (
    <section className="kj-verify" aria-labelledby="kj-verify-title">
      <h2 id="kj-verify-title" className="kj-verify__title">
        {c.title}
      </h2>
      <p className="kj-verify__body">{c.body}</p>
      {token ? (
        <div className="kj-code">
          <span className="kj-code__label" id="kj-code-label">
            {c.code}
          </span>
          <code className="kj-code__value" ref={codeRef} aria-labelledby="kj-code-label" data-testid="verification-token">
            {token}
          </code>
          <Button tone="secondary" size="sm" onClick={() => void copyToken()} aria-label={`${c.copy} ${token}`}>
            {c.copy}
          </Button>
        </div>
      ) : (
        <p className="kj-verify__body">{c.noCode}</p>
      )}
      <ul className="kj-ways">
        <li>
          <PlatformIcon platform="instagram" />
          <span>{c.instagram}</span>
        </li>
        <li>
          <PlatformIcon platform="website" />
          <span>{c.website}</span>
        </li>
        <li>
          <PlatformIcon platform="linkedin" />
          <span>{c.linkedin}</span>
        </li>
      </ul>
      <p className="kj-verify__after">{c.after}</p>
      {hideLinks ? null : links.length > 0 ? (
        <ul className="kj-linklist" aria-label={copy.verify.linksTitle}>
          {links.map((l) => (
            <LinkLine key={l.url} link={l} />
          ))}
        </ul>
      ) : (
        <p className="kj-verify__body">{c.noLinks}</p>
      )}
      <div>
        <Button tone="secondary" icon={<Icon.Check />} onClick={onCheck} loading={checking} disabled={!links.length}>
          {c.check}
        </Button>
      </div>
    </section>
  );
}
