/**
 * Kofi-wide reports — pure. Given the raw rows a data source is allowed to hand
 * an admin, build the report and its CSVs. Dates are compared as Kofi calendar
 * days (America/New_York), like deadlines.
 */
import type { Application, Artist, Artwork, Exhibition, KofiReport, Lot, OpenCall, ParticipationRow, PaymentRow, PlacementRow, Payout, ReportRange } from './types';
import { csvEscape } from './export';
import { kofiToday } from './programme';

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** ISO timestamp → Kofi calendar day (YYYY-MM-DD). */
export function kofiDay(iso: string): string {
  const parts = DAY_FMT.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validateRange(r: ReportRange, today: string = kofiToday()): string | undefined {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(r.from) || !iso.test(r.to)) return 'Pick a start and end date.';
  if (r.from > r.to) return 'The start date must be before the end date.';
  if (r.from > today) return 'The start date is in the future.';
  return undefined;
}

export interface ReportSource {
  artists: Pick<Artist, 'id' | 'workingName'>[];
  artworks: Pick<Artwork, 'id' | 'title' | 'artistId'>[];
  calls: Pick<OpenCall, 'id' | 'title' | 'kind' | 'partner' | 'organizerInstitutionId'>[];
  institutions: { id: string; name: string }[];
  exhibitions: Pick<Exhibition, 'id' | 'title' | 'startsOn' | 'artworkIds' | 'published'>[];
  applications: Application[];
  lots: Lot[];
  payouts: Payout[];
}

const inRange = (day: string, r: ReportRange) => day >= r.from && day <= r.to;

export function buildReport(src: ReportSource, range: ReportRange, generatedAt: string = new Date().toISOString()): KofiReport {
  const artistName = new Map(src.artists.map((a) => [a.id, a.workingName]));
  const work = new Map(src.artworks.map((w) => [w.id, w]));
  const call = new Map(src.calls.map((c) => [c.id, c]));
  const inst = new Map(src.institutions.map((i) => [i.id, i.name]));
  const organizerOf = (c: ReportSource['calls'][number]) => (c.organizerInstitutionId && inst.get(c.organizerInstitutionId)) || c.partner || 'Kofi Collections';

  const participation: ParticipationRow[] = src.applications
    .filter((a) => inRange(kofiDay(a.createdAt), range))
    .map((a) => {
      const c = call.get(a.callId);
      const row: ParticipationRow = {
        artistId: a.artistId,
        artistWorkingName: artistName.get(a.artistId) ?? 'Unknown artist',
        callId: a.callId,
        callTitle: c?.title ?? 'Deleted call',
        callKind: c?.kind ?? 'exhibition',
        organizer: c ? organizerOf(c) : 'Kofi Collections',
        applicationId: a.id,
        status: a.status,
        worksAttached: a.artworkIds.length,
        submittedOn: kofiDay(a.createdAt),
      };
      if (a.decidedAt) row.decidedOn = kofiDay(a.decidedAt);
      return row;
    })
    .sort((x, y) => y.submittedOn.localeCompare(x.submittedOn) || x.artistWorkingName.localeCompare(y.artistWorkingName));

  const placements: PlacementRow[] = [];
  for (const ex of src.exhibitions) {
    if (!ex.published || !inRange(ex.startsOn, range)) continue;
    for (const id of ex.artworkIds) {
      const w = work.get(id);
      if (!w) continue;
      placements.push({ artistId: w.artistId, artistWorkingName: artistName.get(w.artistId) ?? 'Unknown artist', artworkId: w.id, artworkTitle: w.title, kind: 'exhibition', where: ex.title, on: ex.startsOn });
    }
  }
  for (const a of src.applications) {
    if (a.status !== 'accepted' || !a.decidedAt || !inRange(kofiDay(a.decidedAt), range)) continue;
    const c = call.get(a.callId);
    for (const id of a.artworkIds) {
      const w = work.get(id);
      if (!w) continue;
      placements.push({ artistId: w.artistId, artistWorkingName: artistName.get(w.artistId) ?? 'Unknown artist', artworkId: w.id, artworkTitle: w.title, kind: 'selection', where: c?.title ?? 'Deleted call', on: kofiDay(a.decidedAt) });
    }
  }
  for (const l of src.lots) {
    const w = work.get(l.artworkId);
    const c = call.get(l.callId);
    if (!w) continue;
    const base = { artistId: w.artistId, artistWorkingName: artistName.get(w.artistId) ?? 'Unknown artist', artworkId: w.id, artworkTitle: w.title, where: c?.title ?? 'Deleted call' };
    if (l.status !== 'withdrawn' && inRange(kofiDay(l.createdAt), range)) placements.push({ ...base, kind: 'lot', on: kofiDay(l.createdAt) });
    if (l.sale && l.status === 'sold' && inRange(kofiDay(l.sale.soldAt), range)) placements.push({ ...base, kind: 'sale', on: kofiDay(l.sale.soldAt), amount: l.sale.hammerPrice, currency: l.sale.currency });
  }
  placements.sort((x, y) => y.on.localeCompare(x.on) || x.artistWorkingName.localeCompare(y.artistWorkingName));

  const lotById = new Map(src.lots.map((l) => [l.id, l]));
  const payments: PaymentRow[] = src.payouts
    .map((p) => ({ p, l: lotById.get(p.lotId) }))
    // A void payout belongs to a sale that was voided: its figures are gone (and a re-sale of the
    // same lot has its own payout), so it is never joined to the lot's current sale.
    .filter((x): x is { p: Payout; l: Lot } => x.p.status !== 'void' && !!x.l && !!x.l.sale)
    .filter(({ l }) => inRange(kofiDay(l.sale!.soldAt), range))
    .map(({ p, l }) => {
      const s = l.sale!;
      const w = work.get(l.artworkId);
      const c = call.get(l.callId);
      const row: PaymentRow = {
        payoutId: p.id,
        artistId: p.artistId,
        artistWorkingName: artistName.get(p.artistId) ?? 'Unknown artist',
        artworkTitle: w?.title ?? 'Deleted work',
        callTitle: c?.title ?? 'Deleted call',
        lotNumber: l.lotNumber,
        hammerPrice: s.hammerPrice,
        artistAmount: s.artistAmount,
        kofiAmount: s.kofiAmount,
        partnerAmount: s.partnerAmount,
        buyerPremium: s.buyerPremium,
        currency: s.currency,
        status: p.status,
        soldOn: kofiDay(s.soldAt),
      };
      if (p.paidAt) row.paidOn = kofiDay(p.paidAt);
      if (p.method) row.method = p.method;
      if (p.reference) row.reference = p.reference;
      return row;
    })
    .sort((x, y) => y.soldOn.localeCompare(x.soldOn) || x.artistWorkingName.localeCompare(y.artistWorkingName));

  const sum = (rows: PaymentRow[], pick: (r: PaymentRow) => number) => {
    const out: Record<string, number> = {};
    for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + pick(r);
    return out;
  };
  return {
    range,
    generatedAt,
    participation,
    placements,
    payments,
    totals: {
      applications: participation.length,
      selected: participation.filter((r) => r.status === 'accepted').length,
      artistsParticipating: new Set(participation.map((r) => r.artistId)).size,
      lotsSold: payments.length,
      hammerTotal: sum(payments, (r) => r.hammerPrice),
      artistPaid: sum(payments.filter((r) => r.status === 'paid'), (r) => r.artistAmount),
      artistDue: sum(payments.filter((r) => r.status === 'due'), (r) => r.artistAmount),
    },
  };
}

const money = (cents: number | undefined) => (cents === undefined ? '' : (cents / 100).toFixed(2));
const line = (cells: unknown[]) => cells.map(csvEscape).join(',');

export function participationCsv(rows: ParticipationRow[]): string {
  const head = ['artist', 'call', 'kind', 'organizer', 'status', 'works_attached', 'submitted_on', 'decided_on', 'application_id', 'artist_id', 'call_id'];
  return [line(head), ...rows.map((r) => line([r.artistWorkingName, r.callTitle, r.callKind, r.organizer, r.status, r.worksAttached, r.submittedOn, r.decidedOn ?? '', r.applicationId, r.artistId, r.callId]))].join('\r\n') + '\r\n';
}

export function placementsCsv(rows: PlacementRow[]): string {
  const head = ['artist', 'work', 'placement', 'where', 'on', 'amount', 'currency', 'artist_id', 'artwork_id'];
  return [line(head), ...rows.map((r) => line([r.artistWorkingName, r.artworkTitle, r.kind, r.where, r.on, money(r.amount), r.currency ?? '', r.artistId, r.artworkId]))].join('\r\n') + '\r\n';
}

export function paymentsCsv(rows: PaymentRow[]): string {
  const head = ['artist', 'work', 'call', 'lot', 'hammer_price', 'artist_amount', 'kofi_amount', 'partner_amount', 'buyer_premium', 'currency', 'payout_status', 'sold_on', 'paid_on', 'method', 'reference', 'payout_id', 'artist_id'];
  return [line(head), ...rows.map((r) => line([r.artistWorkingName, r.artworkTitle, r.callTitle, r.lotNumber, money(r.hammerPrice), money(r.artistAmount), money(r.kofiAmount), money(r.partnerAmount), money(r.buyerPremium), r.currency, r.status, r.soldOn, r.paidOn ?? '', r.method ?? '', r.reference ?? '', r.payoutId, r.artistId]))].join('\r\n') + '\r\n';
}
