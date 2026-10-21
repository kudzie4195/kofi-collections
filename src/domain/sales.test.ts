import { describe, expect, it } from 'vitest';
import {
  canMoveLot,
  canMovePayout,
  DEFAULT_TERMS,
  formatMoney,
  isCallOrganizer,
  parseMoney,
  projectLotForArtist,
  splitSale,
  validateCallTerms,
  validateLot,
  validateSale,
  validateTerms,
  type LotInput,
} from './sales';
import type { CallTerms, Lot, LotStatus, PayoutStatus, Viewer } from './types';
import { LOT_STATUSES, PAYOUT_STATUSES } from './types';

const CMA: CallTerms = { artistSharePct: 70, kofiSharePct: 20, partnerSharePct: 10, buyerPremiumPct: 10, resaleRoyaltyPct: 5, currency: 'USD', paymentNote: 'Paid within 30 days.' };
const terms = (over: Partial<CallTerms>): CallTerms => ({ ...CMA, ...over });

describe('validateTerms', () => {
  it('accepts the defaults and the CMA terms', () => {
    expect(validateTerms(DEFAULT_TERMS)).toBeUndefined();
    expect(validateTerms(CMA)).toBeUndefined();
    expect(validateTerms(terms({ paymentNote: undefined }))).toBeUndefined();
    expect(validateTerms(terms({ buyerPremiumPct: 30, resaleRoyaltyPct: 25 }))).toBeUndefined();
  });

  it.each([
    ['artistSharePct', terms({ artistSharePct: 70.5 })],
    ['kofiSharePct', terms({ kofiSharePct: -1 })],
    ['partnerSharePct', terms({ partnerSharePct: 101 })],
    ['buyerPremiumPct', terms({ buyerPremiumPct: Number.NaN })],
    ['resaleRoyaltyPct', terms({ resaleRoyaltyPct: '5' as never })],
  ])('%s must be a whole percentage 0–100', (field, t) => {
    expect(validateTerms(t)).toEqual({ field, message: 'Use a whole number from 0 to 100.' });
  });

  it('shares must add up to 100', () => {
    expect(validateTerms(terms({ artistSharePct: 60 }))).toEqual({ field: 'artistSharePct', message: 'Artist, Kofi and partner shares must add up to 100%.' });
  });
  it('caps the buyer’s premium at 30% and the resale royalty at 25%', () => {
    expect(validateTerms(terms({ buyerPremiumPct: 31 }))?.field).toBe('buyerPremiumPct');
    expect(validateTerms(terms({ resaleRoyaltyPct: 26 }))?.field).toBe('resaleRoyaltyPct');
  });
  it('needs a 3-letter upper-case currency', () => {
    for (const currency of ['usd', 'US', 'USDT', '']) expect(validateTerms(terms({ currency }))?.field).toBe('currency');
  });
  it('limits the payment note to 600 characters', () => {
    expect(validateTerms(terms({ paymentNote: 'x'.repeat(600) }))).toBeUndefined();
    expect(validateTerms(terms({ paymentNote: 'x'.repeat(601) }))?.field).toBe('paymentNote');
  });
});

describe('validateCallTerms', () => {
  it('an auction must carry terms; other kinds may omit them', () => {
    expect(validateCallTerms({ kind: 'auction', published: false })).toEqual({ field: 'terms', message: 'An auction call must publish its compensation terms.' });
    expect(validateCallTerms({ kind: 'auction', published: true, terms: CMA })).toBeUndefined();
    expect(validateCallTerms({ kind: 'exhibition', published: true })).toBeUndefined();
  });
  it('any terms given are validated, whatever the kind', () => {
    expect(validateCallTerms({ kind: 'commission', published: false, terms: terms({ kofiSharePct: 25 }) })?.field).toBe('artistSharePct');
  });
});

describe('splitSale', () => {
  it('splits whole cents: artist rounded first, the remainder to Kofi; the sum is the hammer price', () => {
    const s = splitSale(100001, CMA, '2026-10-18T16:00:00.000Z');
    expect(s).toMatchObject({ hammerPrice: 100001, artistAmount: 70001, partnerAmount: 10000, kofiAmount: 20000, buyerPremium: 10000, currency: 'USD' });
    expect(s.artistAmount + s.partnerAmount + s.kofiAmount).toBe(100001);
  });
  it('seeded lots: $8,200 and $1,600 at 70/20/10', () => {
    expect(splitSale(820000, CMA, 'x')).toMatchObject({ artistAmount: 574000, kofiAmount: 164000, partnerAmount: 82000, buyerPremium: 82000 });
    expect(splitSale(160000, CMA, 'x')).toMatchObject({ artistAmount: 112000, kofiAmount: 32000, partnerAmount: 16000, buyerPremium: 16000 });
  });
  it('sums to the hammer for every price from 1 to 1,000 cents, and never as floats', () => {
    for (let h = 1; h <= 1000; h++) {
      const s = splitSale(h, terms({ artistSharePct: 33, kofiSharePct: 33, partnerSharePct: 34, buyerPremiumPct: 7 }), 'x');
      expect(s.artistAmount + s.kofiAmount + s.partnerAmount).toBe(h);
      for (const v of [s.artistAmount, s.kofiAmount, s.partnerAmount, s.buyerPremium]) expect(Number.isInteger(v)).toBe(true);
    }
  });
  it('freezes a copy of the terms and only sets buyerRef when given', () => {
    const t = terms({});
    const s = splitSale(5000, t, '2026-10-18T16:00:00.000Z', 'Paddle 9');
    t.artistSharePct = 10;
    expect(s.terms.artistSharePct).toBe(70);
    expect(s.buyerRef).toBe('Paddle 9');
    expect('buyerRef' in splitSale(5000, CMA, 'x')).toBe(false);
  });
  it('refuses a non-integer or non-positive hammer price', () => {
    for (const h of [0, -1, 10.5]) expect(() => splitSale(h, CMA, 'x')).toThrow(/whole number of cents/);
  });
});

describe('money', () => {
  it('formatMoney renders whole cents', () => {
    expect(formatMoney(574000, 'USD')).toBe('$5,740.00');
    expect(formatMoney(1, 'USD')).toBe('$0.01');
    expect(formatMoney(980000, 'USD')).toBe('$9,800.00');
    expect(formatMoney(260000, 'CAD')).toBe('CA$2,600.00');
  });
  it.each([
    ['1,234.50', 123450],
    ['$1,234.50', 123450],
    ['1234.5', 123450],
    ['  6000 ', 600000],
    ['USD 1,000', 100000],
    ['1000 USD', 100000],
    ['.5', 50],
    ['0', 0],
    ['0.01', 1],
  ])('parseMoney(%j) = %d', (input, cents) => expect(parseMoney(input)).toBe(cents));
  it.each(['', '.', 'abc', '1.234', '1.2.3', '-5', '1e5', '12a', '$', '99999999999999999'])('parseMoney(%j) is not money', (input) => expect(parseMoney(input)).toBeUndefined());
  it('round-trips with formatMoney', () => {
    for (const c of [0, 1, 99, 100, 123456, 574000]) expect(parseMoney(formatMoney(c, 'USD'))).toBe(c);
  });
});

describe('validateLot', () => {
  const call = { id: 'c1', kind: 'auction' as const, terms: CMA, published: true };
  const application = { id: 'a1', callId: 'c1', status: 'accepted' as const, artworkIds: ['w1', 'w2'], artistId: 'art_a' };
  const artwork = { id: 'w1', artistId: 'art_a' };
  const input: LotInput = { callId: 'c1', applicationId: 'a1', artworkId: 'w1', lotNumber: 1, reserve: 1000, startingBid: 500 };
  const ok = { call, application, artwork, input, existing: [] };

  it('passes for a selected work on an auction call', () => {
    expect(validateLot(ok)).toBeUndefined();
    expect(validateLot({ ...ok, input: { ...input, reserve: undefined, startingBid: undefined } })).toBeUndefined();
  });
  it.each([
    ['callId', { call: { ...call, kind: 'exhibition' as const } }, 'Only auction calls have lots.'],
    ['callId', { call: { ...call, terms: undefined } }, 'Set the call’s compensation terms before adding lots.'],
    ['applicationId', { application: { ...application, callId: 'c2' } }, 'That application is for a different call.'],
    ['applicationId', { application: { ...application, status: 'shortlisted' as const } }, 'Only selected (accepted) applications can become lots.'],
    ['artworkId', { input: { ...input, artworkId: 'w9' } }, 'That work is not on the application.'],
    ['artworkId', { artwork: { id: 'w1', artistId: 'art_b' } }, 'That work belongs to another artist.'],
    ['lotNumber', { input: { ...input, lotNumber: 0 } }, 'Lot number must be between 1 and 9999.'],
    ['lotNumber', { input: { ...input, lotNumber: 10000 } }, 'Lot number must be between 1 and 9999.'],
    ['lotNumber', { input: { ...input, lotNumber: 1.5 } }, 'Lot number must be between 1 and 9999.'],
    ['reserve', { input: { ...input, reserve: -1 } }, 'Enter a whole amount of money, or leave it empty.'],
    ['startingBid', { input: { ...input, startingBid: 10.5 } }, 'Enter a whole amount of money, or leave it empty.'],
    ['startingBid', { input: { ...input, startingBid: 2000 } }, 'The starting bid cannot be above the reserve.'],
  ])('%s: %s', (field, over, message) => {
    expect(validateLot({ ...ok, ...over })).toEqual({ field, message });
  });
  it('a work is a lot once per call, and lot numbers are unique per call; withdrawn lots and the lot being edited do not count', () => {
    const lot = { id: 'l1', callId: 'c1', artworkId: 'w1', lotNumber: 1, status: 'planned' as LotStatus };
    expect(validateLot({ ...ok, existing: [lot] })).toEqual({ field: 'artworkId', message: 'This work is already a lot in this auction.' });
    expect(validateLot({ ...ok, input: { ...input, artworkId: 'w2' }, existing: [lot] })).toEqual({ field: 'lotNumber', message: 'Lot 1 is already used in this auction.' });
    expect(validateLot({ ...ok, existing: [{ ...lot, status: 'withdrawn' }] })).toBeUndefined();
    expect(validateLot({ ...ok, existing: [lot], editingId: 'l1' })).toBeUndefined();
    expect(validateLot({ ...ok, existing: [{ ...lot, callId: 'c2' }] })).toBeUndefined();
  });
});

describe('validateSale', () => {
  const today = '2026-10-20';
  const ok = { hammerPrice: 820000, soldOn: '2026-10-18', buyerRef: 'Paddle 14' };
  it('passes at or above the reserve, on or before today', () => {
    expect(validateSale({ status: 'live', reserve: 600000 }, ok, today)).toBeUndefined();
    expect(validateSale({ status: 'planned', reserve: 820000 }, { ...ok, soldOn: today }, today)).toBeUndefined();
    expect(validateSale({ status: 'unsold' }, { hammerPrice: 1, soldOn: today }, today)).toBeUndefined();
  });
  it.each([
    ['status', { status: 'sold' as const }, ok, 'This lot is already sold. Void the sale first to record it again.'],
    ['status', { status: 'withdrawn' as const }, ok, 'A withdrawn lot cannot be sold.'],
    ['hammerPrice', { status: 'live' as const }, { ...ok, hammerPrice: 0 }, 'Enter the hammer price.'],
    ['hammerPrice', { status: 'live' as const }, { ...ok, hammerPrice: 100.5 }, 'Enter the hammer price.'],
    ['hammerPrice', { status: 'live' as const, reserve: 900000 }, ok, 'The hammer price is below the artist’s reserve.'],
    ['soldOn', { status: 'live' as const }, { ...ok, soldOn: '18/10/2026' }, 'Enter the date of the sale.'],
    ['soldOn', { status: 'live' as const }, { ...ok, soldOn: '2026-10-21' }, 'The sale date cannot be in the future.'],
    ['buyerRef', { status: 'live' as const }, { ...ok, buyerRef: 'x'.repeat(161) }, 'Keep the buyer reference under 160 characters.'],
  ])('%s: %s', (field, lot, input, message) => {
    expect(validateSale(lot, input, today)).toEqual({ field, message });
  });
});

describe('status moves', () => {
  it('canMoveLot: sold only via recordSale; sold → unsold voids; withdrawn → planned only', () => {
    const allowed: Record<LotStatus, LotStatus[]> = {
      planned: ['live', 'unsold', 'withdrawn'],
      live: ['planned', 'unsold', 'withdrawn'],
      sold: ['unsold'],
      unsold: ['planned', 'live', 'withdrawn'],
      withdrawn: ['planned'],
    };
    for (const from of LOT_STATUSES) for (const to of LOT_STATUSES) expect(canMoveLot(from, to), `${from} → ${to}`).toBe(allowed[from].includes(to));
  });
  it('canMovePayout: due → paid/void; paid → due (correction); void → due', () => {
    const allowed: Record<PayoutStatus, PayoutStatus[]> = { due: ['paid', 'void'], paid: ['due'], void: ['due'] };
    for (const from of PAYOUT_STATUSES) for (const to of PAYOUT_STATUSES) expect(canMovePayout(from, to), `${from} → ${to}`).toBe(allowed[from].includes(to));
  });
});

describe('isCallOrganizer', () => {
  const call = { organizerInstitutionId: 'inst_cma' };
  const lena: Viewer = { role: 'curator', userId: 'u', curatorId: 'c', curatorVerified: true };
  it('admins always; a verified curator of the organiser institution only', () => {
    expect(isCallOrganizer({ role: 'admin' }, call)).toBe(true);
    expect(isCallOrganizer({ role: 'admin' }, {})).toBe(true);
    expect(isCallOrganizer(lena, call, 'inst_cma')).toBe(true);
    expect(isCallOrganizer(lena, call, 'inst_pit')).toBe(false);
    expect(isCallOrganizer(lena, call)).toBe(false);
    expect(isCallOrganizer(lena, {}, 'inst_cma')).toBe(false);
    expect(isCallOrganizer({ ...lena, curatorVerified: false }, call, 'inst_cma')).toBe(false);
    expect(isCallOrganizer({ role: 'artist', artistId: 'a' }, call, 'inst_cma')).toBe(false);
    expect(isCallOrganizer({ role: 'public' }, call, 'inst_cma')).toBe(false);
  });
});

describe('projectLotForArtist', () => {
  it('drops the buyer reference and nothing else', () => {
    const lot: Lot = { id: 'l', callId: 'c', applicationId: 'a', artworkId: 'w', artistId: 'art', lotNumber: 1, status: 'sold', sale: splitSale(1000, CMA, 'x', 'Paddle 1'), createdAt: 'x', updatedAt: 'x' };
    const out = projectLotForArtist(lot);
    expect(out.sale && 'buyerRef' in out.sale).toBe(false);
    expect(out.sale?.artistAmount).toBe(700);
    expect(lot.sale?.buyerRef).toBe('Paddle 1');
    const unsold = { ...lot, status: 'live' as const, sale: undefined };
    expect(projectLotForArtist(unsold)).toBe(unsold);
  });
});
