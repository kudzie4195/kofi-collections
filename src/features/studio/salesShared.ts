/** Shared by the studio Sales screen and the studio home row. */
import type { LotStatus, PayoutRow } from '@/domain/types';
import { formatMoney } from '@/domain/sales';

export const LOT_STATUS_ARTIST: Record<LotStatus, string> = {
  planned: 'In preparation',
  live: 'In the auction',
  sold: 'Sold',
  unsold: 'Not sold',
  withdrawn: 'Withdrawn',
};
export const LOT_DOT: Record<LotStatus, string> = { planned: 'pending', live: 'forwarded', sold: 'accepted', unsold: 'draft', withdrawn: 'declined' };

/** Sum payouts of one status by currency: { USD: 574000 }. */
export function payoutTotals(payouts: Pick<PayoutRow, 'status' | 'amount' | 'currency'>[], status: 'due' | 'paid'): [string, number][] {
  const out = new Map<string, number>();
  for (const p of payouts) if (p.status === status) out.set(p.currency, (out.get(p.currency) ?? 0) + p.amount);
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** "$5,740.00" or "$5,740.00 + CA$200.00"; `empty` when there is nothing. */
export function totalsText(totals: [string, number][], empty = 'Nothing'): string {
  return totals.length ? totals.map(([c, n]) => formatMoney(n, c)).join(' + ') : empty;
}

