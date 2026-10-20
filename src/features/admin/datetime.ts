/**
 * `<input type="datetime-local">` ↔ ISO-with-offset, always in Kofi's time zone
 * (America/New_York), whatever time zone the editing device is in. Events are
 * stored as e.g. "2026-10-29T18:30:00-04:00" so the offset is explicit and DST
 * is handled at the moment of the event, not at the moment of editing.
 */
import { KOFI_TIME_ZONE } from '@/domain/programme';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: KOFI_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Kofi's UTC offset in minutes at an instant (EDT = -240, EST = -300). */
export function kofiOffsetMinutes(utcMs: number): number {
  const p = PARTS.formatToParts(new Date(utcMs));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(n: number): string {
  return String(Math.abs(n)).padStart(2, '0');
}

function offsetString(min: number): string {
  const sign = min < 0 ? '-' : '+';
  return `${sign}${pad(Math.trunc(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;
}

/** The instant shown as Kofi wall time with its offset: "2026-11-01T01:30:00-04:00". */
function isoAt(utcMs: number): string {
  const off = kofiOffsetMinutes(utcMs);
  const wall = new Date(utcMs + off * 60_000).toISOString().slice(0, 19);
  return `${wall}${offsetString(off)}`;
}

/**
 * "2026-10-29T18:30" (Kofi wall time) → "2026-10-29T18:30:00-04:00".
 * Ambiguous fall-back times (01:00–01:59 on the first Sunday of November) resolve
 * to the first occurrence (EDT). Times skipped by spring-forward move one hour
 * later (02:30 → 03:30 EDT), as a wall clock would. Returns undefined for bad input.
 */
export function localInputToIso(local: string): string | undefined {
  const m = LOCAL.exec(local.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
  const wallMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wallMs);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return undefined;
  const candidates = [...new Set([kofiOffsetMinutes(wallMs - 86_400_000), kofiOffsetMinutes(wallMs + 86_400_000)])];
  const valid = candidates.map((off) => wallMs - off * 60_000).filter((utc) => isoAt(utc).slice(0, 19) === new Date(wallMs).toISOString().slice(0, 19));
  if (valid.length) return isoAt(Math.min(...valid));
  // In the spring-forward gap: read the wall time with the offset in force just before it.
  const before = kofiOffsetMinutes(wallMs - 86_400_000);
  return isoAt(wallMs - before * 60_000);
}

/** Any ISO instant → "YYYY-MM-DDTHH:mm" in Kofi wall time, for a datetime-local input. "" when empty or invalid. */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return isoAt(t).slice(0, 16);
}

/** "EDT" / "EST" for a Kofi wall time, so the editor can say which clock it means. */
export function kofiZoneLabel(local: string): string {
  const iso = localInputToIso(local);
  if (!iso) return 'Pittsburgh time';
  return iso.endsWith('-04:00') ? 'Pittsburgh time (EDT)' : iso.endsWith('-05:00') ? 'Pittsburgh time (EST)' : 'Pittsburgh time';
}
