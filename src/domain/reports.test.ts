import { describe, expect, it } from 'vitest';
import { buildReport, kofiDay, participationCsv, paymentsCsv, placementsCsv, validateRange, type ReportSource } from './reports';
import { parseCsv } from './export';
import { formatMoney } from './sales';
import { buildSeed } from '@/data/mock/seed';

function source(): ReportSource {
  const s = buildSeed();
  return { artists: s.artists, artworks: s.artworks, calls: s.openCalls, institutions: s.institutions, exhibitions: s.exhibitions, applications: s.applications, lots: s.lots, payouts: s.payouts };
}
const OCT = { from: '2026-10-01', to: '2026-10-31' };
const GEN = '2026-10-20T16:00:00.000Z';

describe('kofiDay — the calendar day in Pittsburgh', () => {
  it('follows the end of daylight saving on 2026-11-01', () => {
    expect(kofiDay('2026-11-01T03:59:00Z')).toBe('2026-10-31'); // 23:59 EDT
    expect(kofiDay('2026-11-01T04:00:00Z')).toBe('2026-11-01'); // 00:00 EDT
    expect(kofiDay('2026-11-01T17:00:00Z')).toBe('2026-11-01'); // noon EST
    expect(kofiDay('2026-11-02T04:30:00Z')).toBe('2026-11-01'); // 23:30 EST
    expect(kofiDay('2026-11-02T05:00:00Z')).toBe('2026-11-02');
  });
  it('a late-evening submission belongs to the day it was made in Pittsburgh', () => {
    expect(kofiDay('2026-10-12T02:15:00.000Z')).toBe('2026-10-11');
  });
});

describe('validateRange', () => {
  it.each([
    [{ from: '', to: '2026-10-31' }, 'Pick a start and end date.'],
    [{ from: '2026-10-01', to: '31/10/2026' }, 'Pick a start and end date.'],
    [{ from: '2026-11-01', to: '2026-10-01' }, 'The start date must be before the end date.'],
    [{ from: '2026-10-21', to: '2026-12-31' }, 'The start date is in the future.'],
  ])('%j → %s', (r, msg) => expect(validateRange(r, '2026-10-20')).toBe(msg));
  it('accepts a single day and an end date after today', () => {
    expect(validateRange({ from: '2026-10-20', to: '2026-10-20' }, '2026-10-20')).toBeUndefined();
    expect(validateRange({ from: '2026-01-01', to: '2026-12-31' }, '2026-10-20')).toBeUndefined();
  });
});

describe('buildReport on the seed', () => {
  it('October 2026: two sales, $9,800.00 hammer, $1,120.00 paid and $5,740.00 due to artists', () => {
    const r = buildReport(source(), OCT, GEN);
    expect(r.range).toEqual(OCT);
    expect(r.generatedAt).toBe(GEN);
    expect(r.totals).toEqual({
      applications: 1,
      selected: 0,
      artistsParticipating: 1,
      lotsSold: 2,
      hammerTotal: { USD: 980000 },
      artistPaid: { USD: 112000 },
      artistDue: { USD: 574000 },
    });
    expect(formatMoney(r.totals.hammerTotal.USD!, 'USD')).toBe('$9,800.00');
    expect(formatMoney(r.totals.artistPaid.USD!, 'USD')).toBe('$1,120.00');
    expect(formatMoney(r.totals.artistDue.USD!, 'USD')).toBe('$5,740.00');
  });

  it('participation rows are by the Kofi day of submission', () => {
    expect(buildReport(source(), OCT, GEN).participation).toEqual([
      {
        artistId: 'art_deshawn',
        artistWorkingName: 'DeShawn Ferris',
        callId: 'call_night_weather',
        callTitle: 'Night Weather Studio Award',
        callKind: 'award',
        organizer: 'Kofi Collections',
        applicationId: 'app_deshawn_night',
        status: 'submitted',
        worksAttached: 2,
        submittedOn: '2026-10-11',
      },
    ]);
    const sep = buildReport(source(), { from: '2026-09-01', to: '2026-09-30' }, GEN);
    expect(sep.participation.map((p) => [p.applicationId, p.organizer, p.callKind, p.status, p.submittedOn, p.decidedOn])).toEqual([
      ['app_priya_cma', 'Carnegie Museum of Art', 'auction', 'declined', '2026-09-28', '2026-10-05'],
      ['app_deshawn_cma', 'Carnegie Museum of Art', 'auction', 'accepted', '2026-09-21', '2026-10-05'],
      ['app_mara_cma', 'Carnegie Museum of Art', 'auction', 'accepted', '2026-09-14', '2026-10-05'],
      ['app_june_summer', 'Kofi Collections', 'exhibition', 'declined', '2026-09-09', '2026-09-25'],
      ['app_mara_summer', 'Kofi Collections', 'exhibition', 'accepted', '2026-09-02', '2026-09-25'],
    ]);
    expect(sep.totals).toMatchObject({ applications: 5, selected: 3, artistsParticipating: 4, lotsSold: 0, hammerTotal: {}, artistPaid: {}, artistDue: {} });
  });

  it('placements: sales, lots, selections and the Night Weather hang, newest first', () => {
    const rows = buildReport(source(), OCT, GEN).placements.map((p) => [p.on, p.kind, p.artistWorkingName, p.artworkId, p.where, p.amount ?? null]);
    expect(rows).toEqual([
      ['2026-10-18', 'sale', 'DeShawn Ferris', 'aw_deshawn_1', 'Night Weather Benefit Auction', 160000],
      ['2026-10-18', 'sale', 'Mara Oyelaran', 'aw_mara_1', 'Night Weather Benefit Auction', 820000],
      ['2026-10-08', 'lot', 'DeShawn Ferris', 'aw_deshawn_1', 'Night Weather Benefit Auction', null],
      ['2026-10-08', 'lot', 'Mara Oyelaran', 'aw_mara_1', 'Night Weather Benefit Auction', null],
      ['2026-10-08', 'lot', 'Mara Oyelaran', 'aw_mara_2', 'Night Weather Benefit Auction', null],
      ['2026-10-05', 'selection', 'DeShawn Ferris', 'aw_deshawn_1', 'Night Weather Benefit Auction', null],
      ['2026-10-05', 'selection', 'Mara Oyelaran', 'aw_mara_1', 'Night Weather Benefit Auction', null],
      ['2026-10-05', 'selection', 'Mara Oyelaran', 'aw_mara_2', 'Night Weather Benefit Auction', null],
      ['2026-10-02', 'exhibition', 'DeShawn Ferris', 'aw_deshawn_1', 'Night Weather', null],
      ['2026-10-02', 'exhibition', 'June Takahashi-Bell', 'aw_june_1', 'Night Weather', null],
      ['2026-10-02', 'exhibition', 'Mara Oyelaran', 'aw_mara_1', 'Night Weather', null],
      ['2026-10-02', 'exhibition', 'Mara Oyelaran', 'aw_mara_2', 'Night Weather', null],
      ['2026-10-02', 'exhibition', 'Priya Venkataraman', 'aw_priya_1', 'Night Weather', null],
    ]);
  });

  it('payments: one row per live payout, with the frozen split', () => {
    expect(buildReport(source(), OCT, GEN).payments).toEqual([
      { payoutId: 'payout_cma_3', artistId: 'art_deshawn', artistWorkingName: 'DeShawn Ferris', artworkTitle: 'Night Shift: Bakery, 3:10am', callTitle: 'Night Weather Benefit Auction', lotNumber: 3, hammerPrice: 160000, artistAmount: 112000, kofiAmount: 32000, partnerAmount: 16000, buyerPremium: 16000, currency: 'USD', status: 'paid', soldOn: '2026-10-18', paidOn: '2026-10-19', method: 'Bank transfer', reference: 'KC-2026-0031' },
      { payoutId: 'payout_cma_1', artistId: 'art_mara', artistWorkingName: 'Mara Oyelaran', artworkTitle: 'Doubling (Liberty Avenue, 7:40pm)', callTitle: 'Night Weather Benefit Auction', lotNumber: 1, hammerPrice: 820000, artistAmount: 574000, kofiAmount: 164000, partnerAmount: 82000, buyerPremium: 82000, currency: 'USD', status: 'due', soldOn: '2026-10-18' },
    ]);
  });

  it('a voided payout is never joined to a later re-sale of the same lot (no double count)', () => {
    const src = source();
    src.payouts.push({ id: 'payout_old', lotId: 'lot_cma_1', artistId: 'art_mara', amount: 420000, currency: 'USD', status: 'void', createdAt: '2026-10-17T16:00:00.000Z', updatedAt: '2026-10-17T18:00:00.000Z' });
    const r = buildReport(src, OCT, GEN);
    expect(r.payments.map((p) => p.payoutId)).toEqual(['payout_cma_3', 'payout_cma_1']);
    expect(r.totals.lotsSold).toBe(2);
    expect(r.totals.hammerTotal).toEqual({ USD: 980000 });
  });

  it('drafts, withdrawn lots and out-of-range rows are left out', () => {
    const src = source();
    src.exhibitions = src.exhibitions.map((x) => (x.id === 'ex_night_weather' ? { ...x, published: false } : x));
    src.lots = src.lots.map((l) => (l.id === 'lot_cma_2' ? { ...l, status: 'withdrawn' as const } : l));
    const r = buildReport(src, OCT, GEN);
    expect(r.placements.filter((p) => p.kind === 'exhibition')).toEqual([]);
    expect(r.placements.filter((p) => p.kind === 'lot').map((p) => p.artworkId)).toEqual(['aw_deshawn_1', 'aw_mara_1']);
    const nov = buildReport(source(), { from: '2026-11-01', to: '2026-11-30' }, GEN);
    expect([nov.participation, nov.placements, nov.payments]).toEqual([[], [], []]);
  });
});

describe('report CSVs', () => {
  it('round-trip through parseCsv, including names that need quoting', () => {
    const src = source();
    src.artists = src.artists.map((a) => (a.id === 'art_mara' ? { ...a, workingName: 'Mara "M" Oyelaran, Jr.\nStudio' } : a));
    const r = buildReport(src, { from: '2026-09-01', to: '2026-10-31' }, GEN);

    const part = parseCsv(participationCsv(r.participation));
    expect(part[0]).toEqual(['artist', 'call', 'kind', 'organizer', 'status', 'works_attached', 'submitted_on', 'decided_on', 'application_id', 'artist_id', 'call_id']);
    expect(part.slice(1)).toEqual(r.participation.map((p) => [p.artistWorkingName, p.callTitle, p.callKind, p.organizer, p.status, String(p.worksAttached), p.submittedOn, p.decidedOn ?? '', p.applicationId, p.artistId, p.callId]));
    expect(part.slice(1).map((row) => row[0])).toContain('Mara "M" Oyelaran, Jr.\nStudio');

    const place = parseCsv(placementsCsv(r.placements));
    expect(place).toHaveLength(r.placements.length + 1);
    expect(place.find((row) => row[2] === 'sale' && row[8] === 'aw_mara_1')).toEqual(['Mara "M" Oyelaran, Jr.\nStudio', 'Doubling (Liberty Avenue, 7:40pm)', 'sale', 'Night Weather Benefit Auction', '2026-10-18', '8200.00', 'USD', 'art_mara', 'aw_mara_1']);

    const pay = parseCsv(paymentsCsv(r.payments));
    expect(pay[0]).toEqual(['artist', 'work', 'call', 'lot', 'hammer_price', 'artist_amount', 'kofi_amount', 'partner_amount', 'buyer_premium', 'currency', 'payout_status', 'sold_on', 'paid_on', 'method', 'reference', 'payout_id', 'artist_id']);
    expect(pay.slice(1)).toEqual([
      ['DeShawn Ferris', 'Night Shift: Bakery, 3:10am', 'Night Weather Benefit Auction', '3', '1600.00', '1120.00', '320.00', '160.00', '160.00', 'USD', 'paid', '2026-10-18', '2026-10-19', 'Bank transfer', 'KC-2026-0031', 'payout_cma_3', 'art_deshawn'],
      ['Mara "M" Oyelaran, Jr.\nStudio', 'Doubling (Liberty Avenue, 7:40pm)', 'Night Weather Benefit Auction', '1', '8200.00', '5740.00', '1640.00', '820.00', '820.00', 'USD', 'due', '2026-10-18', '', '', '', 'payout_cma_1', 'art_mara'],
    ]);
  });

  it('an empty table is just the header line', () => {
    expect(participationCsv([])).toBe('artist,call,kind,organizer,status,works_attached,submitted_on,decided_on,application_id,artist_id,call_id\r\n');
  });
});
