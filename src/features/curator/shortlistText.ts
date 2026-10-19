import type { ArtworkView, Shortlist, Unit } from '@/domain/types';
import { formatDimensions, formatPrice } from '@/domain/units';

export interface ResolvedItem {
  artworkId: string;
  note?: string;
  /** undefined when the work is no longer visible to this curator. */
  work: ArtworkView | undefined;
}

/**
 * Plain-text version of a shortlist for pasting into an email or a planning doc.
 * One line per work: title — artist — dimensions — price or "Price on request".
 * Only uses what the projection already gave this viewer, so nothing private leaks.
 */
export function shortlistToText(
  list: Pick<Shortlist, 'name'>,
  items: ResolvedItem[],
  opts: { unit?: Unit; fictional?: boolean; exportedAt?: Date } = {},
): string {
  const lines: string[] = [list.name];
  const when = opts.exportedAt ?? new Date();
  lines.push(`Exported from Kofi Collections on ${when.toISOString().slice(0, 10)}`);
  lines.push('');
  items.forEach((it, i) => {
    const n = `${i + 1}.`;
    if (!it.work) {
      lines.push(`${n} No longer available`);
      return;
    }
    const w = it.work;
    const dims = formatDimensions(w.dimensions, opts.unit ?? w.dimensions.unit);
    const price = w.price ? formatPrice(w.price.amount, w.price.currency) : 'Price on request';
    lines.push(`${n} ${w.title} (${w.year}) — ${w.artistWorkingName} — ${dims} — ${price}`);
    if (it.note) lines.push(`   Note: ${it.note}`);
  });
  if (items.length === 0) lines.push('(No works yet)');
  lines.push('');
  lines.push('Introductions to artists go through Kofi. Artist contact details are not included.');
  if (opts.fictional) lines.push('All artists and works listed are fictional sample content.');
  return lines.join('\n');
}
