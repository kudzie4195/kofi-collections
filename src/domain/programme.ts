/**
 * Programme rules — pure functions shared by both data sources and the UI.
 * Dates are compared as calendar days in Kofi's time zone (Pittsburgh), so a
 * deadline of 2026-11-30 accepts applications until 23:59 Eastern on that day,
 * wherever the artist is. The Supabase RPCs use the same rule
 * ((now() at time zone 'America/New_York')::date).
 */
import type {
  ApplicationStatus,
  Application,
  Artist,
  Artwork,
  BuyerIntent,
  CallPhase,
  Exhibition,
  ExhibitionPhase,
  OpenCall,
  ProgrammeBase,
  Viewer,
} from './types';
import { BUYER_INTENTS } from './types';

export const KOFI_TIME_ZONE = 'America/New_York';

/** Today's date in Kofi's time zone, as YYYY-MM-DD. */
export function kofiToday(now: Date = new Date()): string {
  // Assemble from parts rather than trusting a locale's default pattern (en-CA's
  // short-date pattern has changed between ICU releases).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: KOFI_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A calendar date (YYYY-MM-DD) for people: "Nov 15, 2026". Never shows a raw ISO string. */
export function formatCalendarDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: string | undefined): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function exhibitionPhase(ex: Pick<Exhibition, 'startsOn' | 'endsOn'>, today: string = kofiToday()): ExhibitionPhase {
  const end = ex.endsOn ?? ex.startsOn;
  if (today < ex.startsOn) return 'upcoming';
  if (today > end) return 'past';
  return 'current';
}

export function callPhase(call: Pick<OpenCall, 'opensOn' | 'deadline'>, today: string = kofiToday()): CallPhase {
  if (today < call.opensOn) return 'upcoming';
  if (call.deadline && today > call.deadline) return 'closed';
  return 'open';
}

/** Whole days from today until the deadline (0 = closes today). Undefined when there is no deadline. */
export function daysLeft(call: Pick<OpenCall, 'deadline'>, today: string = kofiToday()): number | undefined {
  if (!call.deadline) return undefined;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${call.deadline}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Exhibitions in display order: current (ending soonest), upcoming (soonest first), past (most recent first). */
export function sortExhibitions<T extends Pick<Exhibition, 'startsOn' | 'endsOn'>>(list: T[], today: string = kofiToday()): T[] {
  const rank: Record<ExhibitionPhase, number> = { current: 0, upcoming: 1, past: 2 };
  return [...list].sort((a, b) => {
    const pa = exhibitionPhase(a, today);
    const pb = exhibitionPhase(b, today);
    if (pa !== pb) return rank[pa] - rank[pb];
    const ea = a.endsOn ?? a.startsOn;
    const eb = b.endsOn ?? b.startsOn;
    if (pa === 'current') return ea.localeCompare(eb);
    if (pa === 'upcoming') return a.startsOn.localeCompare(b.startsOn);
    return eb.localeCompare(ea);
  });
}

/** Published items for everyone; drafts for admins only. */
export function canSeeProgramme(item: Pick<ProgrammeBase, 'published'>, viewer: Viewer): boolean {
  return item.published || viewer.role === 'admin';
}

export const MAX_STATEMENT = 2000;
export const MAX_MESSAGE = 2000;

export interface Problem {
  field: string;
  message: string;
}

/**
 * Everything that must hold for an artist to submit an application. Returns the
 * first problem, or undefined. Both data sources call this before writing; the
 * SQL RPC re-implements the same checks server-side.
 */
export function validateApplication(args: {
  call: OpenCall;
  artist: Pick<Artist, 'id' | 'status' | 'consentVersion'>;
  /** The works the artist chose, resolved from the store (not from the client). */
  works: Pick<Artwork, 'id' | 'artistId' | 'visibility' | 'title'>[];
  requestedIds: string[];
  statement: string;
  /** The artist's existing applications to this call. */
  existing: Pick<Application, 'status'>[];
  today?: string;
}): Problem | undefined {
  const { call, artist, works, requestedIds, statement, existing } = args;
  const today = args.today ?? kofiToday();
  if (!call.published) return { field: 'call', message: 'This call is not open.' };
  if (call.externalUrl) return { field: 'call', message: 'Applications for this call are taken on the partner’s form.' };
  const phase = callPhase(call, today);
  if (phase === 'upcoming') return { field: 'call', message: `This call opens on ${formatCalendarDate(call.opensOn)}.` };
  if (phase === 'closed') return { field: 'call', message: 'This call has closed.' };
  if (artist.status === 'paused') return { field: 'artist', message: 'Your profile is paused. Contact Kofi to reopen it before applying.' };
  if (!artist.consentVersion) return { field: 'artist', message: 'Accept the data consent in your studio before applying.' };
  if (existing.some((a) => a.status !== 'withdrawn')) return { field: 'call', message: 'You have already applied to this call.' };
  const unique = [...new Set(requestedIds)];
  if (unique.length !== requestedIds.length) return { field: 'artworkIds', message: 'Each work can only be attached once.' };
  if (unique.length === 0) return { field: 'artworkIds', message: 'Attach at least one work.' };
  if (unique.length > call.maxWorks) return { field: 'artworkIds', message: `This call accepts up to ${call.maxWorks} ${call.maxWorks === 1 ? 'work' : 'works'}.` };
  for (const id of unique) {
    const w = works.find((x) => x.id === id);
    if (!w || w.artistId !== artist.id) return { field: 'artworkIds', message: 'You can only attach your own works.' };
    if (w.visibility === 'private') return { field: 'artworkIds', message: `“${w.title}” is set to Only me. Change it to Kofi team only or wider to attach it.` };
  }
  const st = statement.trim();
  if (st.length < 20) return { field: 'statement', message: 'Write at least a sentence or two about why these works fit the call.' };
  if (st.length > MAX_STATEMENT) return { field: 'statement', message: `Keep the statement under ${MAX_STATEMENT} characters.` };
  return undefined;
}

/** Allowed status moves. Artists may only withdraw; admins move everything else. */
export function canMoveApplication(from: ApplicationStatus, to: ApplicationStatus, role: Viewer['role']): boolean {
  if (from === to) return false;
  if (from === 'withdrawn') return false;
  if (role === 'artist') return to === 'withdrawn' && (from === 'submitted' || from === 'shortlisted');
  // Admins shortlist and decide; a decision can be corrected, but only the artist withdraws.
  if (role === 'admin') return to === 'shortlisted' || to === 'accepted' || to === 'declined';
  return false;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface BuyerInquiryInput {
  artworkId?: string;
  name: string;
  email: string;
  organization?: string;
  intent: BuyerIntent;
  message: string;
  /** The visitor ticked "Kofi may email me about this inquiry". */
  consent: boolean;
}

export function validateBuyerInquiry(input: BuyerInquiryInput): Problem | undefined {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) return { field: 'name', message: 'Tell us your name.' };
  if (!EMAIL.test(input.email.trim()) || input.email.length > 200) return { field: 'email', message: 'Enter an email address we can reply to.' };
  if ((input.organization ?? '').length > 160) return { field: 'organization', message: 'Keep the organisation name under 160 characters.' };
  if (!BUYER_INTENTS.includes(input.intent)) return { field: 'intent', message: 'Choose what you are asking about.' };
  const msg = input.message.trim();
  if (msg.length < 10) return { field: 'message', message: 'Add a line or two so Kofi knows how to help.' };
  if (msg.length > MAX_MESSAGE) return { field: 'message', message: `Keep the message under ${MAX_MESSAGE} characters.` };
  if (!input.consent) return { field: 'consent', message: 'Tick the box so Kofi can reply to you.' };
  return undefined;
}

/** Collector inquiries allowed per email address per rolling 24 hours (anti-spam; mirrored in SQL). */
export const BUYER_INQUIRY_DAILY_LIMIT = 5;
