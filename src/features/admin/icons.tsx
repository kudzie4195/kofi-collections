/** Desk-only icons on the kit's 24px stroke grid (the kit's Icon set has no money, tag or chart glyphs). */
import type { SVGProps } from 'react';

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
