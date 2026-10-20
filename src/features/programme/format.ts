/**
 * Display helpers for programme content, shared by the public screens,
 * the studio (opportunities) and the Kofi admin desk. Never render a raw ISO
 * string — go through these.
 */
import type { ApplicationStatus, BuyerInquiryStatus, CallPhase, EventKind, ExhibitionPhase, OpenCall, StoryKind } from '@/domain/types';
import { callPhase, daysLeft, KOFI_TIME_ZONE, kofiToday } from '@/domain/programme';

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const DAY_NO_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: KOFI_TIME_ZONE });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: KOFI_TIME_ZONE });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: KOFI_TIME_ZONE });

/** ISO date (YYYY-MM-DD) as a calendar day, independent of the device time zone. */
function day(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/** "Oct 2, 2026" */
export function formatDay(iso: string): string {
  return DAY.format(day(iso));
}

/** "Oct 2 – Nov 22, 2026", "Dec 12, 2026 – Jan 4, 2027", or a single day. */
export function formatDateRange(startsOn: string, endsOn?: string): string {
  if (!endsOn || endsOn === startsOn) return formatDay(startsOn);
  const sameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
  return `${sameYear ? DAY_NO_YEAR.format(day(startsOn)) : formatDay(startsOn)} – ${formatDay(endsOn)}`;
}

/** "Thu, Oct 29 · 6:30 PM" in Pittsburgh time. */
export function formatEventTime(startsAt: string, endsAt?: string): string {
  const s = new Date(startsAt);
  const base = `${LONG_DAY.format(s)} · ${TIME.format(s)}`;
  return endsAt ? `${base} – ${TIME.format(new Date(endsAt))}` : base;
}

/** "October 2026" — for grouping events. */
export function formatMonth(iso: string): string {
  return MONTH.format(new Date(iso));
}

export const EXHIBITION_PHASE_LABEL: Record<ExhibitionPhase, string> = {
  current: 'Now showing',
  upcoming: 'Coming up',
  past: 'Past',
};

export const CALL_PHASE_LABEL: Record<CallPhase, string> = {
  open: 'Open',
  upcoming: 'Opening soon',
  closed: 'Closed',
};

/** "Closes in 41 days", "Closes today", "Closed Jun 15, 2026", "Opens Nov 15, 2026", "Open until filled". */
export function deadlineLabel(call: Pick<OpenCall, 'opensOn' | 'deadline'>, today?: string): string {
  const phase = callPhase(call, today);
  if (phase === 'upcoming') return `Opens ${formatDay(call.opensOn)}`;
  if (!call.deadline) return 'Open until filled';
  if (phase === 'closed') return `Closed ${formatDay(call.deadline)}`;
  const n = daysLeft(call, today) ?? 0;
  if (n === 0) return 'Closes today';
  if (n === 1) return 'Closes tomorrow';
  return `Closes in ${n} days`;
}

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  shortlisted: 'Shortlisted',
  accepted: 'Selected',
  declined: 'Not selected',
  withdrawn: 'Withdrawn',
};

/** Matches the StatusDot classes in global.css. */
export const APPLICATION_STATUS_DOT: Record<ApplicationStatus, string> = {
  submitted: 'pending',
  shortlisted: 'forwarded',
  accepted: 'accepted',
  declined: 'declined',
  withdrawn: 'draft',
};

export const BUYER_STATUS_LABEL: Record<BuyerInquiryStatus, string> = {
  new: 'New',
  'in progress': 'In progress',
  closed: 'Closed',
};

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  opening: 'Opening',
  talk: 'Talk',
  'studio visit': 'Studio visit',
  workshop: 'Workshop',
  social: 'Evening',
};

export const STORY_KIND_LABEL: Record<StoryKind, string> = {
  interview: 'Interview',
  'studio visit': 'Studio visit',
  essay: 'Essay',
  news: 'News',
};

/** Split long text into paragraphs; lines starting with "> " become pull quotes. */
export function paragraphs(body: string): { kind: 'p' | 'quote'; text: string }[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('> ') ? { kind: 'quote' as const, text: p.slice(2).trim() } : { kind: 'p' as const, text: p }));
}

const PART_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: KOFI_TIME_ZONE });
const PART_DAY = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: KOFI_TIME_ZONE });
const PART_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: KOFI_TIME_ZONE });
const DAY_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const DAY_NUM = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'UTC' });

/** Pieces for a calendar "date block" of an event, in Pittsburgh time: { month: 'Oct', day: '29', weekday: 'Thu' }. */
export function eventDateParts(startsAt: string): { month: string; day: string; weekday: string } {
  const d = new Date(startsAt);
  return { month: PART_MONTH.format(d), day: PART_DAY.format(d), weekday: PART_WEEKDAY.format(d) };
}

/** Pieces for a calendar day (YYYY-MM-DD): { month: 'Nov', day: '30' }. */
export function dayParts(iso: string): { month: string; day: string } {
  const d = day(iso);
  return { month: DAY_MONTH.format(d), day: DAY_NUM.format(d) };
}

/** True when the event has finished (or started, when it has no end) before `now`. */
export function eventIsPast(ev: { startsAt: string; endsAt?: string }, now: Date = new Date()): boolean {
  return Date.parse(ev.endsAt ?? ev.startsAt) < now.getTime();
}

/** An ISO instant (createdAt, decidedAt…) as the Pittsburgh calendar day: "Oct 12, 2026". */
export function formatInstantDay(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return formatDay(kofiToday(t));
}
