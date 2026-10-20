import { describe, expect, it } from 'vitest';
import { isoToLocalInput, kofiOffsetMinutes, kofiZoneLabel, localInputToIso } from './datetime';

describe('datetime-local ↔ ISO in Kofi time (America/New_York)', () => {
  it('uses -04:00 before and -05:00 after the 2026-11-01 fall-back', () => {
    expect(localInputToIso('2026-10-31T18:00')).toBe('2026-10-31T18:00:00-04:00');
    expect(localInputToIso('2026-11-01T00:30')).toBe('2026-11-01T00:30:00-04:00');
    expect(localInputToIso('2026-11-01T03:00')).toBe('2026-11-01T03:00:00-05:00');
    expect(localInputToIso('2026-11-08T13:00')).toBe('2026-11-08T13:00:00-05:00');
    expect(localInputToIso('2026-10-29T18:30')).toBe('2026-10-29T18:30:00-04:00');
  });

  it('resolves the repeated 1:30 am on 2026-11-01 to the first (EDT) occurrence', () => {
    expect(localInputToIso('2026-11-01T01:30')).toBe('2026-11-01T01:30:00-04:00');
    // both real instants read back as the same wall time
    expect(isoToLocalInput('2026-11-01T05:30:00Z')).toBe('2026-11-01T01:30');
    expect(isoToLocalInput('2026-11-01T06:30:00Z')).toBe('2026-11-01T01:30');
  });

  it('moves a time skipped by spring-forward one hour later', () => {
    expect(localInputToIso('2027-03-14T02:30')).toBe('2027-03-14T03:30:00-04:00');
    expect(localInputToIso('2027-03-14T01:59')).toBe('2027-03-14T01:59:00-05:00');
  });

  it('round-trips stored event times whatever offset they were written with', () => {
    for (const iso of ['2026-10-02T18:00:00-04:00', '2026-11-19T18:00:00-05:00', '2026-11-19T23:00:00Z', '2026-07-04T21:15:00.000Z']) {
      const local = isoToLocalInput(iso);
      const back = localInputToIso(local)!;
      expect(Date.parse(back)).toBe(Date.parse(iso));
    }
    expect(isoToLocalInput('2026-11-19T23:00:00Z')).toBe('2026-11-19T18:00');
  });

  it('rejects malformed input and labels the zone', () => {
    expect(localInputToIso('')).toBeUndefined();
    expect(localInputToIso('2026-02-30T10:00')).toBeUndefined();
    expect(localInputToIso('tomorrow')).toBeUndefined();
    expect(isoToLocalInput('nope')).toBe('');
    expect(kofiOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'))).toBe(-240);
    expect(kofiOffsetMinutes(Date.parse('2026-12-01T12:00:00Z'))).toBe(-300);
    expect(kofiZoneLabel('2026-10-29T18:30')).toBe('Pittsburgh time (EDT)');
    expect(kofiZoneLabel('2026-11-19T18:00')).toBe('Pittsburgh time (EST)');
  });
});
