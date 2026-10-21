/** Display vocabulary for the Kofi desk's lots, payouts and reports. Money always goes through formatMoney. */
import type { CallTerms, LotStatus, PayoutStatus } from '@/domain/types';
import { formatMoney, splitSale, validateTerms } from '@/domain/sales';

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  planned: 'Planned',
  live: 'Live',
  sold: 'Sold',
  unsold: 'Unsold',
  withdrawn: 'Withdrawn',
};

/** StatusDot classes from global.css. */
export const LOT_STATUS_DOT: Record<LotStatus, string> = {
  planned: 'draft',
  live: 'pending',
  sold: 'accepted',
  unsold: 'forwarded',
  withdrawn: 'declined',
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  due: 'Due',
  paid: 'Paid',
  void: 'Void',
};

export const PAYOUT_STATUS_DOT: Record<PayoutStatus, string> = {
  due: 'pending',
  paid: 'accepted',
  void: 'draft',
};

/** Sum amounts per currency. */
export function totalsBy<T>(rows: T[], currency: (r: T) => string, amount: (r: T) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[currency(r)] = (out[currency(r)] ?? 0) + amount(r);
  return out;
}

/** ["$5,740.00", "CA$120.00"]; a single "$0.00" (in `fallback`) when there is nothing. */
export function moneyLines(totals: Record<string, number>, fallback = 'USD'): string[] {
  const keys = Object.keys(totals).sort();
  if (keys.length === 0) return [formatMoney(0, fallback)];
  return keys.map((c) => formatMoney(totals[c] ?? 0, c));
}

export const EXAMPLE_HAMMER = 100000;

/** "On a $1,000.00 hammer price: artist $700.00 · Kofi $200.00 · partner $100.00 · buyer pays $1,100.00". */
export function exampleSplit(terms: CallTerms, hammer = EXAMPLE_HAMMER): string | undefined {
  if (validateTerms(terms)) return undefined;
  const s = splitSale(hammer, terms, new Date(0).toISOString());
  const m = (n: number) => formatMoney(n, terms.currency);
  const parts = [`artist ${m(s.artistAmount)}`, `Kofi ${m(s.kofiAmount)}`];
  if (terms.partnerSharePct > 0) parts.push(`partner ${m(s.partnerAmount)}`);
  parts.push(`buyer pays ${m(s.hammerPrice + s.buyerPremium)}`);
  return `On a ${m(hammer)} hammer price: ${parts.join(' · ')}`;
}

/** "Artist 70% · Kofi 20% · Partner 10% · Premium 10%" */
export function termsSummary(t: CallTerms): string {
  const parts = [`Artist ${t.artistSharePct}%`, `Kofi ${t.kofiSharePct}%`];
  if (t.partnerSharePct > 0) parts.push(`Partner ${t.partnerSharePct}%`);
  if (t.buyerPremiumPct > 0) parts.push(`Premium ${t.buyerPremiumPct}%`);
  return parts.join(' · ');
}

/** ISO date `days` before `iso` (both YYYY-MM-DD, calendar arithmetic in UTC so DST never shifts it). */
export function daysBefore(iso: string, days: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
