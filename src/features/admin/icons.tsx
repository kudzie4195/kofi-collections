/** Desk-only icons on the kit's 24px stroke grid (the kit's Icon set has no money, tag or chart glyphs). */
import type { SVGProps } from 'react';
import type { LinkPlatform } from '@/domain/types';

const I = ({ d, ...rest }: { d: string } & SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    <path d={d} />
  </svg>
);

export const DeskIcon = {
  Money: (p: SVGProps<SVGSVGElement>) => <I d="M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01" {...p} />,
  Lot: (p: SVGProps<SVGSVGElement>) => <I d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01" {...p} />,
  Chart: (p: SVGProps<SVGSVGElement>) => <I d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} />,
};

/* ---------- link platforms (v5 intake) — plain line glyphs, not brand logos ---------- */
const P = ({ children, ...rest }: { children: React.ReactNode } & SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

const PLATFORM_GLYPH: Record<LinkPlatform, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  facebook: <path d="M17 3h-3a4 4 0 0 0-4 4v3H7v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  linkedin: (
    <>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <path d="M2 9h4v12H2z" />
      <circle cx="4" cy="4" r="2" />
    </>
  ),
  tiktok: <path d="M14 3v12.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.4 2.8 2.3 4.6 5 4.8" />,
  youtube: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  other: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1" />,
};

export function PlatformIcon({ platform = 'other', ...rest }: { platform?: LinkPlatform } & SVGProps<SVGSVGElement>) {
  return <P {...rest}>{PLATFORM_GLYPH[platform] ?? PLATFORM_GLYPH.other}</P>;
}
