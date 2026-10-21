/**
 * Sales rules — pure functions shared by both data sources, the UI and the SQL
 * (re-implemented there with the same arithmetic and messages). Money is whole
 * minor units of the call's currency (cents): no floats are ever stored.
 */
import type { Application, Artwork, CallTerms, Lot, LotStatus, OpenCall, PayoutStatus, Sale, Viewer } from './types';
import type { Problem } from './programme';

export const DEFAULT_TERMS: CallTerms = {
  artistSharePct: 70,
  kofiSharePct: 30,
  partnerSharePct: 0,
  buyerPremiumPct: 0,
  resaleRoyaltyPct: 5,
  currency: 'USD',
};

export const ISO_CURRENCY = /^[A-Z]{3}$/;

export function validateTerms(t: CallTerms): Problem | undefined {
  const pcts: [keyof CallTerms, number][] = [
    ['artistSharePct', t.artistSharePct],
    ['kofiSharePct', t.kofiSharePct],
    ['partnerSharePct', t.partnerSharePct],
    ['buyerPremiumPct', t.buyerPremiumPct],
    ['resaleRoyaltyPct', t.resaleRoyaltyPct],
  ];
  for (const [field, v] of pcts) {
    if (!Number.isInteger(v) || v < 0 || v > 100) return { field, message: 'Use a whole number from 0 to 100.' };
  }
  if (t.artistSharePct + t.kofiSharePct + t.partnerSharePct !== 100) return { field: 'artistSharePct', message: 'Artist, Kofi and partner shares must add up to 100%.' };
  if (t.buyerPremiumPct > 30) return { field: 'buyerPremiumPct', message: "A buyer's premium above 30% is not allowed." };
  if (t.resaleRoyaltyPct > 25) return { field: 'resaleRoyaltyPct', message: 'A resale royalty above 25% is not allowed.' };
  if (!ISO_CURRENCY.test(t.currency)) return { field: 'currency', message: 'Currency must be a 3-letter code (USD, CAD).' };
  if ((t.paymentNote ?? '').length > 600) return { field: 'paymentNote', message: 'Keep the payment note under 600 characters.' };
  return undefined;
}

/** Terms a call must carry before it can be published, by kind. */
export function validateCallTerms(call: Pick<OpenCall, 'kind' | 'terms' | 'published'>): Problem | undefined {
  if (call.kind === 'auction' && !call.terms) return { field: 'terms', message: 'An auction call must publish its compensation terms.' };
  return call.terms ? validateTerms(call.terms) : undefined;
}

/**
 * The split of one sale. Amounts are rounded half-up to whole cents; the artist is
 * rounded first and any cent lost to rounding goes to Kofi, never to the artist's
 * disadvantage. The buyer's premium sits on top of the hammer price and is kept by
 * whoever runs the sale (Kofi, or the partner when it has a share).
 */
export function splitSale(hammerPrice: number, terms: CallTerms, soldAt: string, buyerRef?: string): Sale {
  if (!Number.isInteger(hammerPrice) || hammerPrice <= 0) throw new Error('Hammer price must be a whole number of cents above zero.');
  const pct = (p: number) => Math.round((hammerPrice * p) / 100);
  const artistAmount = pct(terms.artistSharePct);
  const partnerAmount = pct(terms.partnerSharePct);
  const kofiAmount = hammerPrice - artistAmount - partnerAmount;
  const buyerPremium = pct(terms.buyerPremiumPct);
  const sale: Sale = { hammerPrice, currency: terms.currency, buyerPremium, artistAmount, kofiAmount, partnerAmount, terms: { ...terms }, soldAt };
  if (buyerRef) sale.buyerRef = buyerRef;
  return sale;
}

/** "$1,234.50" from whole cents. */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
}

/**
 * "1,234.50", "$1,234.50" or "USD 1234.5" → 123450 cents; undefined when not a money amount.
 * Only a currency symbol/code, spaces and thousands commas are ignored — a minus sign,
 * an exponent or any other character makes the input invalid rather than being dropped.
 */
export function parseMoney(input: string): number | undefined {
  const s = input.trim().replace(/^[A-Z]{3}(?=[\s\d$.])/i, '').replace(/[A-Z]{3}$/i, '').replace(/[\s,$€£]/g, '');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return undefined;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

export interface LotInput {
  callId: string;
  applicationId: string;
  artworkId: string;
  lotNumber: number;
  reserve?: number;
  startingBid?: number;
}

/**
 * A lot can only be made from a work on an ACCEPTED application to an AUCTION call,
 * once per work per call. The artist's price floor (reserve) must be at or above
 * nothing in particular — artists set it when applying is a later feature; for now
 * the organiser records it from the artist's agreement.
 */
export function validateLot(args: {
  call: Pick<OpenCall, 'id' | 'kind' | 'terms' | 'published'>;
  application: Pick<Application, 'id' | 'callId' | 'status' | 'artworkIds' | 'artistId'>;
  artwork: Pick<Artwork, 'id' | 'artistId'>;
  input: LotInput;
  existing: Pick<Lot, 'id' | 'artworkId' | 'lotNumber' | 'callId' | 'status'>[];
  editingId?: string;
}): Problem | undefined {
  const { call, application, artwork, input, existing, editingId } = args;
  if (call.kind !== 'auction') return { field: 'callId', message: 'Only auction calls have lots.' };
  if (!call.terms) return { field: 'callId', message: 'Set the call’s compensation terms before adding lots.' };
  if (application.callId !== call.id) return { field: 'applicationId', message: 'That application is for a different call.' };
  if (application.status !== 'accepted') return { field: 'applicationId', message: 'Only selected (accepted) applications can become lots.' };
  if (!application.artworkIds.includes(input.artworkId)) return { field: 'artworkId', message: 'That work is not on the application.' };
  if (artwork.artistId !== application.artistId) return { field: 'artworkId', message: 'That work belongs to another artist.' };
  const others = existing.filter((l) => l.id !== editingId && l.status !== 'withdrawn');
  if (others.some((l) => l.artworkId === input.artworkId && l.callId === call.id)) return { field: 'artworkId', message: 'This work is already a lot in this auction.' };
  if (!Number.isInteger(input.lotNumber) || input.lotNumber < 1 || input.lotNumber > 9999) return { field: 'lotNumber', message: 'Lot number must be between 1 and 9999.' };
  if (others.some((l) => l.lotNumber === input.lotNumber && l.callId === call.id)) return { field: 'lotNumber', message: `Lot ${input.lotNumber} is already used in this auction.` };
  for (const [field, v] of [['reserve', input.reserve], ['startingBid', input.startingBid]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) return { field, message: 'Enter a whole amount of money, or leave it empty.' };
  }
  if (input.reserve !== undefined && input.startingBid !== undefined && input.startingBid > input.reserve) return { field: 'startingBid', message: 'The starting bid cannot be above the reserve.' };
  return undefined;
}

export interface SaleInput {
  hammerPrice: number;
  /** ISO date (YYYY-MM-DD) in Kofi's time zone. */
  soldOn: string;
  buyerRef?: string;
}

export function validateSale(lot: Pick<Lot, 'status' | 'reserve'>, input: SaleInput, today: string): Problem | undefined {
  if (lot.status === 'sold') return { field: 'status', message: 'This lot is already sold. Void the sale first to record it again.' };
  if (lot.status === 'withdrawn') return { field: 'status', message: 'A withdrawn lot cannot be sold.' };
  if (!Number.isInteger(input.hammerPrice) || input.hammerPrice <= 0) return { field: 'hammerPrice', message: 'Enter the hammer price.' };
  if (lot.reserve !== undefined && input.hammerPrice < lot.reserve) return { field: 'hammerPrice', message: 'The hammer price is below the artist’s reserve.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.soldOn)) return { field: 'soldOn', message: 'Enter the date of the sale.' };
  if (input.soldOn > today) return { field: 'soldOn', message: 'The sale date cannot be in the future.' };
  if ((input.buyerRef ?? '').length > 160) return { field: 'buyerRef', message: 'Keep the buyer reference under 160 characters.' };
  return undefined;
}

/** Status moves for lots: Kofi and the organiser may move; sold is reached only via recordSale. */
export function canMoveLot(from: LotStatus, to: LotStatus): boolean {
  if (from === to) return false;
  if (to === 'sold') return false;
  if (from === 'sold') return to === 'unsold'; // "void the sale" — reopens the lot
  if (from === 'withdrawn') return to === 'planned';
  return to === 'live' || to === 'unsold' || to === 'withdrawn' || to === 'planned';
}

export function canMovePayout(from: PayoutStatus, to: PayoutStatus): boolean {
  if (from === to) return false;
  if (from === 'due') return to === 'paid' || to === 'void';
  if (from === 'paid') return to === 'due'; // correction
  return to === 'due';
}

/** Who may run a call: Kofi admins, or a verified curator of the call's organiser institution. */
export function isCallOrganizer(viewer: Viewer, call: Pick<OpenCall, 'organizerInstitutionId'>, viewerInstitutionId?: string): boolean {
  if (viewer.role === 'admin') return true;
  return viewer.role === 'curator' && viewer.curatorVerified === true && !!call.organizerInstitutionId && call.organizerInstitutionId === viewerInstitutionId;
}

/** Artists see their lots once the lot exists; the sale once recorded; never the buyer reference. */
export function projectLotForArtist<T extends Lot>(lot: T): T {
  if (!lot.sale) return lot;
  const { buyerRef: _omit, ...sale } = lot.sale;
  return { ...lot, sale };
}
