import { describe, expect, it } from 'vitest';
import {
  BUYER_INQUIRY_DAILY_LIMIT,
  callPhase,
  canMoveApplication,
  canSeeProgramme,
  daysLeft,
  exhibitionPhase,
  formatCalendarDate,
  isIsoDate,
  kofiToday,
  MAX_MESSAGE,
  MAX_STATEMENT,
  sortExhibitions,
  validateApplication,
  validateBuyerInquiry,
  type BuyerInquiryInput,
} from './programme';
import type { ApplicationStatus, Artwork, OpenCall, Role } from './types';
import { APPLICATION_STATUSES, CONSENT_VERSION } from './types';

const call: OpenCall = {
  id: 'call_x',
  sample: true,
  published: true,
  title: 'Test call',
  summary: 's',
  body: 'b',
  eligibility: 'anyone',
  mediums: [],
  opensOn: '2026-10-01',
  deadline: '2026-11-30',
  maxWorks: 2,
  fee: 'No entry fee',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
const artist = { id: 'art_a', status: 'approved' as const, consentVersion: CONSENT_VERSION };
type W = Pick<Artwork, 'id' | 'artistId' | 'visibility' | 'title'>;
const works: W[] = [
  { id: 'w1', artistId: 'art_a', visibility: 'public', title: 'One' },
  { id: 'w2', artistId: 'art_a', visibility: 'kofi', title: 'Two' },
  { id: 'w3', artistId: 'art_a', visibility: 'private', title: 'Three' },
  { id: 'w4', artistId: 'art_b', visibility: 'public', title: 'Someone else' },
];
const statement = 'These two works are about the same street at night.';
const ok = { call, artist, works, requestedIds: ['w1', 'w2'], statement, existing: [], today: '2026-10-20' };

describe('kofiToday — calendar day in Pittsburgh', () => {
  it('23:30 Eastern on Nov 30 is still the 30th', () => {
    expect(kofiToday(new Date('2026-11-30T23:30:00-05:00'))).toBe('2026-11-30');
  });
  it('04:30 UTC on Dec 1 is still Nov 30 in New York', () => {
    expect(kofiToday(new Date('2026-12-01T04:30:00Z'))).toBe('2026-11-30');
  });
  it('05:00 UTC on Dec 1 is Dec 1 in New York', () => {
    expect(kofiToday(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12-01');
  });
  it('follows daylight saving (EDT is UTC-4)', () => {
    expect(kofiToday(new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30');
    expect(kofiToday(new Date('2026-07-01T04:00:00Z'))).toBe('2026-07-01');
  });
  it('is always YYYY-MM-DD', () => {
    expect(kofiToday(new Date('2027-01-05T15:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isIsoDate / formatCalendarDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
  it('formats for people, en-US, without shifting the day', () => {
    expect(formatCalendarDate('2026-11-15')).toBe('Nov 15, 2026');
    expect(formatCalendarDate('2027-01-01')).toBe('Jan 1, 2027');
  });
});

describe('exhibitionPhase', () => {
  const ex = { startsOn: '2026-10-02', endsOn: '2026-11-22' };
  it('upcoming / current (both ends inclusive) / past', () => {
    expect(exhibitionPhase(ex, '2026-10-01')).toBe('upcoming');
    expect(exhibitionPhase(ex, '2026-10-02')).toBe('current');
    expect(exhibitionPhase(ex, '2026-11-22')).toBe('current');
    expect(exhibitionPhase(ex, '2026-11-23')).toBe('past');
  });
  it('a single-day show is current only on its day', () => {
    const one = { startsOn: '2024-09-12' };
    expect(exhibitionPhase(one, '2024-09-11')).toBe('upcoming');
    expect(exhibitionPhase(one, '2024-09-12')).toBe('current');
    expect(exhibitionPhase(one, '2024-09-13')).toBe('past');
  });
});

describe('callPhase', () => {
  it('opens on opensOn; the deadline day is inclusive', () => {
    expect(callPhase(call, '2026-09-30')).toBe('upcoming');
    expect(callPhase(call, '2026-10-01')).toBe('open');
    expect(callPhase(call, '2026-11-30')).toBe('open');
    expect(callPhase(call, '2026-12-01')).toBe('closed');
  });
  it('a call without a deadline stays open', () => {
    expect(callPhase({ opensOn: '2026-09-01' }, '2030-01-01')).toBe('open');
  });
  it('a submission at 23:30 Eastern on the deadline day is in time', () => {
    expect(callPhase(call, kofiToday(new Date('2026-12-01T04:30:00Z')))).toBe('open');
    expect(callPhase(call, kofiToday(new Date('2026-12-01T05:30:00Z')))).toBe('closed');
  });
});

describe('daysLeft', () => {
  it('counts whole days; 0 on the deadline; negative after', () => {
    expect(daysLeft(call, '2026-11-20')).toBe(10);
    expect(daysLeft(call, '2026-11-29')).toBe(1);
    expect(daysLeft(call, '2026-11-30')).toBe(0);
    expect(daysLeft(call, '2026-12-02')).toBe(-2);
  });
  it('crosses the DST change without an off-by-one', () => {
    expect(daysLeft({ deadline: '2026-11-02' }, '2026-10-31')).toBe(2);
    expect(daysLeft({ deadline: '2026-03-09' }, '2026-03-07')).toBe(2);
  });
  it('is undefined with no deadline', () => {
    expect(daysLeft({}, '2026-11-20')).toBeUndefined();
  });
});

describe('sortExhibitions', () => {
  it('current (ending soonest), then upcoming (soonest), then past (most recent first)', () => {
    const list = [
      { id: 'past_old', startsOn: '2024-05-03' },
      { id: 'up_late', startsOn: '2027-03-01', endsOn: '2027-04-01' },
      { id: 'cur_long', startsOn: '2026-09-01', endsOn: '2026-12-31' },
      { id: 'past_new', startsOn: '2025-05-08', endsOn: '2025-10-25' },
      { id: 'up_soon', startsOn: '2027-01-15', endsOn: '2027-03-06' },
      { id: 'cur_short', startsOn: '2026-10-02', endsOn: '2026-11-22' },
    ];
    expect(sortExhibitions(list, '2026-10-20').map((x) => x.id)).toEqual(['cur_short', 'cur_long', 'up_soon', 'up_late', 'past_new', 'past_old']);
  });
  it('does not mutate its input', () => {
    const list = [{ startsOn: '2024-01-01' }, { startsOn: '2030-01-01' }];
    const copy = [...list];
    sortExhibitions(list, '2026-10-20');
    expect(list).toEqual(copy);
  });
});

describe('canSeeProgramme', () => {
  it('published for everyone, drafts for admins only', () => {
    const roles: Role[] = ['public', 'artist', 'curator', 'admin'];
    for (const role of roles) {
      expect(canSeeProgramme({ published: true }, { role })).toBe(true);
      expect(canSeeProgramme({ published: false }, { role })).toBe(role === 'admin');
    }
  });
});

describe('validateApplication', () => {
  it('accepts a valid application (kofi-only works may be attached)', () => {
    expect(validateApplication(ok)).toBeUndefined();
  });
  it('rejects an unpublished call', () => {
    expect(validateApplication({ ...ok, call: { ...call, published: false } })?.field).toBe('call');
  });
  it('rejects a call taken on an external form', () => {
    expect(validateApplication({ ...ok, call: { ...call, externalUrl: 'https://example.org/form' } })?.message).toMatch(/partner/);
  });
  it('rejects before opening, with a human date', () => {
    const p = validateApplication({ ...ok, today: '2026-09-30' });
    expect(p?.field).toBe('call');
    expect(p?.message).toBe('This call opens on Oct 1, 2026.');
  });
  it('accepts on the deadline day and rejects the day after', () => {
    expect(validateApplication({ ...ok, today: '2026-11-30' })).toBeUndefined();
    expect(validateApplication({ ...ok, today: '2026-12-01' })?.message).toBe('This call has closed.');
  });
  it('rejects a paused artist', () => {
    expect(validateApplication({ ...ok, artist: { ...artist, status: 'paused' } })?.field).toBe('artist');
  });
  it('rejects an artist without consent', () => {
    expect(validateApplication({ ...ok, artist: { id: 'art_a', status: 'approved' } })?.message).toMatch(/consent/);
  });
  it('rejects a second live application but allows re-applying after a withdrawal', () => {
    expect(validateApplication({ ...ok, existing: [{ status: 'submitted' }] })?.message).toMatch(/already applied/);
    expect(validateApplication({ ...ok, existing: [{ status: 'declined' }] })?.message).toMatch(/already applied/);
    expect(validateApplication({ ...ok, existing: [{ status: 'withdrawn' }] })).toBeUndefined();
  });
  it('rejects duplicate, empty and too many works', () => {
    expect(validateApplication({ ...ok, requestedIds: ['w1', 'w1'] })?.message).toMatch(/only be attached once/);
    expect(validateApplication({ ...ok, requestedIds: [] })?.message).toMatch(/at least one/);
    expect(validateApplication({ ...ok, requestedIds: ['w1', 'w2', 'w3'] })?.message).toBe('This call accepts up to 2 works.');
    expect(validateApplication({ ...ok, call: { ...call, maxWorks: 1 }, requestedIds: ['w1', 'w2'] })?.message).toBe('This call accepts up to 1 work.');
  });
  it('rejects someone else’s work or an unknown id', () => {
    expect(validateApplication({ ...ok, requestedIds: ['w1', 'w4'] })?.message).toMatch(/your own works/);
    expect(validateApplication({ ...ok, requestedIds: ['nope'] })?.message).toMatch(/your own works/);
  });
  it('rejects a private (Only me) work by name', () => {
    expect(validateApplication({ ...ok, requestedIds: ['w3'] })?.message).toMatch(/“Three” is set to Only me/);
  });
  it('requires a statement of reasonable length (trimmed)', () => {
    expect(validateApplication({ ...ok, statement: '   short   ' })?.field).toBe('statement');
    expect(validateApplication({ ...ok, statement: 'x'.repeat(MAX_STATEMENT + 1) })?.field).toBe('statement');
    expect(validateApplication({ ...ok, statement: 'x'.repeat(MAX_STATEMENT) })).toBeUndefined();
  });
});

describe('canMoveApplication', () => {
  const expected: Record<'artist' | 'admin', [ApplicationStatus, ApplicationStatus][]> = {
    artist: [
      ['submitted', 'withdrawn'],
      ['shortlisted', 'withdrawn'],
    ],
    admin: [
      ['submitted', 'shortlisted'],
      ['submitted', 'accepted'],
      ['submitted', 'declined'],
      ['shortlisted', 'accepted'],
      ['shortlisted', 'declined'],
      ['accepted', 'shortlisted'],
      ['accepted', 'declined'],
      ['declined', 'shortlisted'],
      ['declined', 'accepted'],
    ],
  };
  it('matches the full matrix for every role', () => {
    const roles: Role[] = ['public', 'curator', 'artist', 'admin'];
    for (const role of roles) {
      for (const from of APPLICATION_STATUSES) {
        for (const to of APPLICATION_STATUSES) {
          const allowed = (role === 'artist' || role === 'admin' ? expected[role] : []).some(([f, t]) => f === from && t === to);
          expect(canMoveApplication(from, to, role), `${role}: ${from} → ${to}`).toBe(allowed);
        }
      }
    }
  });
});

describe('validateBuyerInquiry', () => {
  const good: BuyerInquiryInput = { name: 'Dana', email: 'dana@example.com', intent: 'purchase', message: 'Is this still available?', consent: true };
  it('accepts a valid inquiry with or without organisation', () => {
    expect(validateBuyerInquiry(good)).toBeUndefined();
    expect(validateBuyerInquiry({ ...good, organization: 'Riverside Office' })).toBeUndefined();
  });
  it('checks each field in turn', () => {
    expect(validateBuyerInquiry({ ...good, name: ' D ' })?.field).toBe('name');
    expect(validateBuyerInquiry({ ...good, name: 'x'.repeat(121) })?.field).toBe('name');
    expect(validateBuyerInquiry({ ...good, email: 'dana@example' })?.field).toBe('email');
    expect(validateBuyerInquiry({ ...good, email: 'not an email' })?.field).toBe('email');
    expect(validateBuyerInquiry({ ...good, email: `${'a'.repeat(195)}@ex.com` })?.field).toBe('email');
    expect(validateBuyerInquiry({ ...good, organization: 'x'.repeat(161) })?.field).toBe('organization');
    expect(validateBuyerInquiry({ ...good, intent: 'bribe' as never })?.field).toBe('intent');
    expect(validateBuyerInquiry({ ...good, message: '   hi   ' })?.field).toBe('message');
    expect(validateBuyerInquiry({ ...good, message: 'x'.repeat(MAX_MESSAGE + 1) })?.field).toBe('message');
    expect(validateBuyerInquiry({ ...good, consent: false })?.field).toBe('consent');
  });
  it('has a small daily limit', () => {
    expect(BUYER_INQUIRY_DAILY_LIMIT).toBe(5);
  });
});
