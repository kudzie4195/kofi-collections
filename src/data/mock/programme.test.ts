import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from './MockDataSource';
import { buildSeed, PROGRAMME_KEYS } from './seed';
import { ForbiddenError, NotFoundError, StorageFullError, ValidationError, type ProgrammeInput } from '../DataSource';
import type { Exhibition, OpenCall, ProgrammeEvent, Story, Viewer } from '@/domain/types';
import type { BuyerInquiryInput } from '@/domain/programme';

const visitor: Viewer = { role: 'public', displayName: 'Visitor' };
const admin: Viewer = { role: 'admin', userId: 'user_quincy', displayName: 'Quincy' };
const mara: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
const june: Viewer = { role: 'artist', userId: 'user_june', artistId: 'art_june', displayName: 'June Takahashi-Bell' };
const deshawn: Viewer = { role: 'artist', userId: 'user_deshawn', artistId: 'art_deshawn', displayName: 'DeShawn Ferris' };
const lena: Viewer = { role: 'curator', userId: 'user_lena', curatorId: 'cur_lena', curatorVerified: true, displayName: 'Lena Marchetti' };
const owen: Viewer = { role: 'curator', userId: 'user_owen', curatorId: 'cur_owen', curatorVerified: true, displayName: 'Owen Blackwood' };

/** 2026-10-20 at noon in Pittsburgh: Night Weather is current, its call is open, Soft Ground is upcoming. */
const T = Date.parse('2026-10-20T16:00:00Z');

function make(opts: { persist?: boolean } = {}) {
  let now = T;
  let n = 0;
  const ds = new MockDataSource({ persist: opts.persist ?? false, now: () => new Date(now), idFactory: (p) => `${p}_t${++n}` });
  return { ds, advance: (ms: number) => (now += ms), setNow: (iso: string) => (now = Date.parse(iso)) };
}

const exInput = (over: Partial<ProgrammeInput<Exhibition>> = {}): ProgrammeInput<Exhibition> => ({
  sample: true,
  published: false,
  title: 'Draft show',
  startsOn: '2027-04-01',
  endsOn: '2027-05-01',
  summary: 'A draft exhibition.',
  body: 'Body.',
  artworkIds: [],
  ...over,
});
const callInput = (over: Partial<ProgrammeInput<OpenCall>> = {}): ProgrammeInput<OpenCall> => ({
  sample: true,
  published: false,
  kind: 'exhibition',
  title: 'Draft call',
  summary: 'A draft call.',
  body: 'Body.',
  eligibility: 'Anyone',
  mediums: [],
  opensOn: '2026-10-01',
  deadline: '2026-12-01',
  maxWorks: 3,
  fee: 'No entry fee',
  ...over,
});
const eventInput = (over: Partial<ProgrammeInput<ProgrammeEvent>> = {}): ProgrammeInput<ProgrammeEvent> => ({
  sample: true,
  published: false,
  title: 'Draft event',
  kind: 'talk',
  startsAt: '2026-12-01T18:00:00-05:00',
  summary: 'A draft event.',
  ...over,
});
const storyInput = (over: Partial<ProgrammeInput<Story>> = {}): ProgrammeInput<Story> => ({
  sample: true,
  published: false,
  title: 'Draft story',
  dek: 'Standfirst.',
  kind: 'essay',
  body: 'Body text.',
  author: 'Kofi Collections editorial',
  publishedOn: '2026-10-20',
  artworkIds: [],
  ...over,
});
const inquiry = (over: Partial<BuyerInquiryInput> = {}): BuyerInquiryInput => ({
  name: 'Sam Visitor',
  email: 'sam@example.com',
  intent: 'purchase',
  message: 'Is this work still available to buy?',
  consent: true,
  ...over,
});

describe('programme reads', () => {
  it('seeds the real programme and the sample programme with stable ids, in display order', async () => {
    const { ds } = make();
    expect((await ds.listExhibitions(visitor)).map((x) => x.id)).toEqual(['ex_night_weather', 'ex_soft_ground', 'ex_being_seen', 'ex_spirit_west', 'ex_i_am']);
    // The Art of Advocacy closed on its extended deadline (Sep 11, 2026); closed calls list most recent first.
    expect((await ds.listOpenCalls(visitor)).map((x) => x.id)).toEqual(['call_night_weather', 'call_soft_ground', 'call_cma_auction', 'call_summer_open', 'call_advocacy']);
    expect((await ds.listEvents(visitor)).map((x) => x.id)).toEqual(['ev_nw_opening', 'ev_mara_talk', 'ev_june_open_studio', 'ev_collector_evening']);
    expect((await ds.listStories(visitor)).map((x) => x.id)).toEqual(['st_advocacy_partner', 'st_mara_interview', 'st_june_loom', 'st_artist_record']);
    const real = (await ds.listExhibitions(visitor)).filter((x) => !x.sample).map((x) => x.id);
    expect(real).toEqual(['ex_being_seen', 'ex_spirit_west', 'ex_i_am']);
    // No fictional works on real exhibitions.
    for (const id of real) expect((await ds.getExhibition(admin, id))!.artworkIds).toEqual([]);
  });

  it('drafts are hidden from visitors, curators and artists, and visible to admins', async () => {
    const { ds } = make();
    const ex = await ds.saveExhibition(admin, exInput());
    const call = await ds.saveOpenCall(admin, callInput());
    const ev = await ds.saveEvent(admin, eventInput());
    const st = await ds.saveStory(admin, storyInput());
    for (const v of [visitor, lena, mara]) {
      expect((await ds.listExhibitions(v)).map((x) => x.id)).not.toContain(ex.id);
      expect(await ds.getExhibition(v, ex.id)).toBeUndefined();
      expect((await ds.listOpenCalls(v)).map((x) => x.id)).not.toContain(call.id);
      expect(await ds.getOpenCall(v, call.id)).toBeUndefined();
      expect((await ds.listEvents(v)).map((x) => x.id)).not.toContain(ev.id);
      expect((await ds.listStories(v)).map((x) => x.id)).not.toContain(st.id);
      expect(await ds.getStory(v, st.id)).toBeUndefined();
    }
    expect((await ds.listExhibitions(admin)).map((x) => x.id)).toContain(ex.id);
    expect(await ds.getOpenCall(admin, call.id)).toBeDefined();
    expect((await ds.listEvents(admin)).map((x) => x.id)).toContain(ev.id);
    expect(await ds.getStory(admin, st.id)).toBeDefined();
  });

  it('hidden works are dropped from an exhibition for a visitor but kept for admin', async () => {
    const { ds } = make();
    // aw_priya_1: Priya is pending review. Add aw_mara_3 (Kofi team only) as well.
    const nw = (await ds.getExhibition(admin, 'ex_night_weather'))!;
    await ds.saveExhibition(admin, { ...nw, artworkIds: [...nw.artworkIds, 'aw_mara_3'] });
    const forVisitor = (await ds.getExhibition(visitor, 'ex_night_weather'))!;
    expect(forVisitor.artworkIds).toEqual(['aw_mara_1', 'aw_mara_2', 'aw_june_1', 'aw_deshawn_1']);
    expect((await ds.getExhibition(lena, 'ex_night_weather'))!.artworkIds).not.toContain('aw_mara_3');
    expect((await ds.listExhibitions(visitor)).find((x) => x.id === 'ex_night_weather')!.artworkIds).not.toContain('aw_priya_1');
    expect((await ds.getExhibition(admin, 'ex_night_weather'))!.artworkIds).toEqual(['aw_mara_1', 'aw_mara_2', 'aw_june_1', 'aw_deshawn_1', 'aw_priya_1', 'aw_mara_3']);
    // Stories follow the same rule; a returned object never aliases the store.
    forVisitor.artworkIds.push('tamper');
    expect(ds._raw().exhibitions.find((x) => x.id === 'ex_night_weather')!.artworkIds).not.toContain('tamper');
  });

  it('a link to a draft exhibition is removed from calls and events for non-admins', async () => {
    const { ds } = make();
    const nw = (await ds.getExhibition(admin, 'ex_night_weather'))!;
    await ds.saveExhibition(admin, { ...nw, published: false });
    expect((await ds.getOpenCall(visitor, 'call_night_weather'))!.exhibitionId).toBeUndefined();
    expect((await ds.listEvents(visitor)).find((e) => e.id === 'ev_mara_talk')!.exhibitionId).toBeUndefined();
    expect((await ds.getOpenCall(admin, 'call_night_weather'))!.exhibitionId).toBe('ex_night_weather');
  });
});

describe('programme writes', () => {
  it('every write is admin-only (a partner drafting its own call is covered in sales.test.ts)', async () => {
    const { ds } = make();
    for (const v of [visitor, mara, lena, owen]) {
      await expect(ds.saveExhibition(v, exInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.deleteExhibition(v, 'ex_night_weather')).rejects.toBeInstanceOf(ForbiddenError);
      if (v !== lena) await expect(ds.saveOpenCall(v, callInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.saveOpenCall(v, { ...callInput(), id: 'call_soft_ground' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.deleteOpenCall(v, 'call_soft_ground')).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.saveEvent(v, eventInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.deleteEvent(v, 'ev_mara_talk')).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.saveStory(v, storyInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.deleteStory(v, 'st_mara_interview')).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(ds._raw().exhibitions).toHaveLength(5);
  });

  it('the server sets id and timestamps and writes an audit row', async () => {
    const { ds, advance } = make();
    const ex = await ds.saveExhibition(admin, { ...exInput(), createdAt: '1999-01-01T00:00:00Z' } as never);
    expect(ex.id).toBe('ex_t1');
    expect(ex.createdAt).toBe(new Date(T).toISOString());
    advance(60_000);
    const updated = await ds.saveExhibition(admin, { ...exInput({ title: '  Renamed  ', published: true }), id: ex.id });
    expect(updated.title).toBe('Renamed');
    expect(updated.createdAt).toBe(ex.createdAt);
    expect(updated.updatedAt).toBe(new Date(T + 60_000).toISOString());
    const audit = (await ds.listAudit(admin)).filter((e) => e.action === 'programme.save');
    expect(audit.map((e) => [e.entityType, e.entityId, e.meta?.created, e.meta?.publishedChanged])).toEqual([
      ['exhibition', ex.id, false, true],
      ['exhibition', ex.id, true, false],
    ]);
    await ds.deleteExhibition(admin, ex.id);
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'programme.delete', entityType: 'exhibition', entityId: ex.id });
  });

  it('an update replaces the record, so clearing an optional field really clears it', async () => {
    const { ds } = make();
    const nw = (await ds.getExhibition(admin, 'ex_night_weather'))!;
    const { subtitle: _s, ...rest } = nw;
    const saved = await ds.saveExhibition(admin, rest);
    expect(saved.subtitle).toBeUndefined();
    expect('subtitle' in ds._raw().exhibitions.find((x) => x.id === nw.id)!).toBe(false);
  });

  it('validates required fields, dates, limits, links and images', async () => {
    const { ds } = make();
    const bad: [Promise<unknown>, string][] = [
      [ds.saveExhibition(admin, exInput({ title: '  ' })), 'title'],
      [ds.saveExhibition(admin, exInput({ title: 'x'.repeat(161) })), 'title'],
      [ds.saveExhibition(admin, exInput({ startsOn: '2027-02-30' })), 'startsOn'],
      [ds.saveExhibition(admin, exInput({ endsOn: '2027-03-31' })), 'endsOn'],
      [ds.saveExhibition(admin, exInput({ externalUrl: 'javascript:alert(1)' })), 'externalUrl'],
      [ds.saveExhibition(admin, exInput({ image: { src: 'https://evil.example/x.png', alt: 'x' } })), 'image'],
      [ds.saveExhibition(admin, exInput({ image: { src: '/art/hero.jpg', alt: ' ' } })), 'image'],
      [ds.saveExhibition(admin, exInput({ artworkIds: ['aw_missing'] })), 'artworkIds'],
      [ds.saveOpenCall(admin, callInput({ deadline: '2026-09-30' })), 'deadline'],
      [ds.saveOpenCall(admin, callInput({ maxWorks: 0 })), 'maxWorks'],
      [ds.saveOpenCall(admin, callInput({ maxWorks: 11 })), 'maxWorks'],
      [ds.saveOpenCall(admin, callInput({ maxWorks: 2.5 })), 'maxWorks'],
      [ds.saveOpenCall(admin, callInput({ externalUrl: 'ftp://example.org' })), 'externalUrl'],
      [ds.saveOpenCall(admin, callInput({ mediums: ['basketry' as never] })), 'mediums'],
      [ds.saveOpenCall(admin, callInput({ exhibitionId: 'ex_missing' })), 'exhibitionId'],
      [ds.saveEvent(admin, eventInput({ startsAt: '2026-12-01 18:00' })), 'startsAt'],
      [ds.saveEvent(admin, eventInput({ endsAt: '2026-12-01T17:00:00-05:00' })), 'endsAt'],
      [ds.saveEvent(admin, eventInput({ kind: 'rave' as never })), 'kind'],
      [ds.saveEvent(admin, eventInput({ rsvpUrl: 'mailto:a@b.co' })), 'rsvpUrl'],
      [ds.saveStory(admin, storyInput({ publishedOn: 'yesterday' })), 'publishedOn'],
      [ds.saveStory(admin, storyInput({ author: '' })), 'author'],
      [ds.saveStory(admin, storyInput({ artistId: 'art_nobody' })), 'artistId'],
    ];
    for (const [p, field] of bad) {
      const err = await p.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, field).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).field).toBe(field);
    }
    // Valid image sources and a same-day single show pass.
    await expect(ds.saveExhibition(admin, exInput({ endsOn: '2027-04-01', image: { src: 'data:image/png;base64,AAAA', alt: 'A grey square' } }))).resolves.toBeDefined();
    await expect(ds.saveExhibition(admin, exInput({ externalUrl: 'https://www.koficollections.org/', image: { src: 'storage:programme/x.jpg', alt: 'x' } }))).resolves.toBeDefined();
  });

  it('a call with applications cannot be deleted; one without can', async () => {
    const { ds } = make();
    await expect(ds.deleteOpenCall(admin, 'call_summer_open')).rejects.toThrow('This call has applications. Unpublish it instead.');
    await expect(ds.deleteOpenCall(admin, 'call_summer_open')).rejects.toBeInstanceOf(ValidationError);
    await ds.deleteOpenCall(admin, 'call_soft_ground');
    expect(await ds.getOpenCall(admin, 'call_soft_ground')).toBeUndefined();
    await expect(ds.deleteOpenCall(admin, 'call_soft_ground')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deleting an exhibition unlinks its calls and events', async () => {
    const { ds } = make();
    await ds.deleteExhibition(admin, 'ex_night_weather');
    expect((await ds.getOpenCall(admin, 'call_night_weather'))!.exhibitionId).toBeUndefined();
    expect((await ds.listEvents(admin)).filter((e) => e.exhibitionId === 'ex_night_weather')).toEqual([]);
  });

  it('a full device store rolls the programme write back', async () => {
    localStorage.clear();
    const { ds } = make({ persist: true });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await expect(ds.saveExhibition(admin, exInput())).rejects.toBeInstanceOf(StorageFullError);
    setItem.mockRestore();
    expect((await ds.listExhibitions(admin)).map((x) => x.title)).not.toContain('Draft show');
    localStorage.clear();
  });
});

describe('applications', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an artist applies with their own works; kofi-only works may be attached', async () => {
    const { ds } = make();
    const row = await ds.submitApplication(mara, { callId: 'call_night_weather', artworkIds: ['aw_mara_1', 'aw_mara_3'], statement: 'Two works from the same rainy week on Liberty Avenue.' });
    expect(row).toMatchObject({ callId: 'call_night_weather', artistId: 'art_mara', status: 'submitted', callTitle: 'Night Weather Studio Award', callDeadline: '2026-11-30', artistWorkingName: 'Mara Oyelaran' });
    expect(row.works.map((w) => w.id)).toEqual(['aw_mara_1', 'aw_mara_3']);
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'application.submit', entityType: 'application', entityId: row.id });
  });

  it('a spoofed artist claim cannot apply, and nobody can attach another artist’s works', async () => {
    const { ds } = make();
    const spoof: Viewer = { role: 'artist', userId: 'user_june', artistId: 'art_mara' };
    await expect(ds.submitApplication(spoof, { callId: 'call_night_weather', artworkIds: ['aw_mara_1'], statement: 'x'.repeat(40) })).rejects.toBeInstanceOf(ForbiddenError);
    const err = await ds.submitApplication(june, { callId: 'call_night_weather', artworkIds: ['aw_mara_1'], statement: 'x'.repeat(40) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe('artworkIds');
    expect(ds._raw().applications.filter((a) => a.artistId === 'art_june' && a.callId === 'call_night_weather')).toEqual([]);
  });

  it('a private (Only me) work is rejected', async () => {
    const { ds } = make();
    await expect(ds.submitApplication(june, { callId: 'call_night_weather', artworkIds: ['aw_june_3'], statement: 'x'.repeat(40) })).rejects.toThrow(/Only me/);
  });

  it('a second application to the same call is rejected; re-applying after withdrawing is allowed', async () => {
    const { ds } = make();
    const input = { callId: 'call_night_weather', artworkIds: ['aw_deshawn_1'], statement: 'Night-shift work, again, for the record.' };
    await expect(ds.submitApplication(deshawn, input)).rejects.toThrow(/already applied/);
    await ds.withdrawApplication(deshawn, 'app_deshawn_night');
    const again = await ds.submitApplication(deshawn, input);
    expect(again.status).toBe('submitted');
  });

  it('calls that are upcoming, closed, external or drafts refuse applications', async () => {
    const { ds } = make();
    const st = 'A statement long enough to pass the rule.';
    await expect(ds.submitApplication(mara, { callId: 'call_soft_ground', artworkIds: ['aw_mara_1'], statement: st })).rejects.toThrow('This call opens on Nov 15, 2026.');
    await expect(ds.submitApplication(mara, { callId: 'call_summer_open', artworkIds: ['aw_mara_1'], statement: st })).rejects.toThrow(/closed/);
    await expect(ds.submitApplication(mara, { callId: 'call_advocacy', artworkIds: ['aw_mara_1'], statement: st })).rejects.toThrow(/partner/);
    const draft = await ds.saveOpenCall(admin, callInput());
    await expect(ds.submitApplication(mara, { callId: draft.id, artworkIds: ['aw_mara_1'], statement: st })).rejects.toBeInstanceOf(NotFoundError);
    await expect(ds.submitApplication(mara, { callId: 'call_nope', artworkIds: ['aw_mara_1'], statement: st })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the deadline day is inclusive in Kofi’s time zone', async () => {
    const { ds, setNow } = make();
    const input = { callId: 'call_night_weather', artworkIds: ['aw_mara_1'], statement: 'Submitted late on the last evening.' };
    setNow('2026-12-01T04:30:00Z'); // 23:30 in Pittsburgh on Nov 30
    await expect(ds.submitApplication(mara, input)).resolves.toBeDefined();
    setNow('2026-12-01T05:30:00Z');
    await expect(ds.submitApplication(june, { ...input, artworkIds: ['aw_june_1'] })).rejects.toThrow(/closed/);
  });

  it('the artist never sees the staff note', async () => {
    const { ds } = make();
    const mine = await ds.listMyApplications(june);
    const summer = mine.find((a) => a.id === 'app_june_summer')!;
    expect(summer.decisionNote).toBe('Thank you — we would love to see the new loom work next time.');
    expect('staffNote' in summer).toBe(false);
    const adminRow = (await ds.listApplications(admin)).find((a) => a.id === 'app_june_summer')!;
    expect(adminRow.staffNote).toBe('Strong; space-limited.');
    await ds.setApplicationStatus(admin, 'app_deshawn_night', 'shortlisted', { staffNote: 'Print is the stronger work.' });
    const back = (await ds.listMyApplications(deshawn))[0]!;
    expect(back.status).toBe('shortlisted');
    expect(JSON.stringify(back)).not.toContain('stronger');
    const withdrawn = await ds.withdrawApplication(deshawn, 'app_deshawn_night');
    expect('staffNote' in withdrawn).toBe(false);
  });

  it('artists list only their own applications', async () => {
    const { ds } = make();
    expect((await ds.listMyApplications(mara)).map((a) => a.id)).toEqual(['app_mara_cma', 'app_mara_summer']);
    expect((await ds.listMyApplications(deshawn)).map((a) => a.id)).toEqual(['app_deshawn_night', 'app_deshawn_cma']);
  });

  it('withdraw: owner only, and only before a decision', async () => {
    const { ds } = make();
    await expect(ds.withdrawApplication(june, 'app_deshawn_night')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.withdrawApplication(mara, 'app_mara_summer')).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.withdrawApplication(mara, 'app_missing')).rejects.toBeInstanceOf(NotFoundError);
    const row = await ds.withdrawApplication(deshawn, 'app_deshawn_night');
    expect(row.status).toBe('withdrawn');
    await expect(ds.withdrawApplication(deshawn, 'app_deshawn_night')).rejects.toBeInstanceOf(ValidationError);
    // Once withdrawn, Kofi cannot move it either.
    await expect(ds.setApplicationStatus(admin, 'app_deshawn_night', 'accepted')).rejects.toThrow(/withdrew/);
    expect((await ds.listAudit(admin)).some((e) => e.action === 'application.withdraw' && e.entityId === 'app_deshawn_night')).toBe(true);
  });

  it('admins review: filter by call, decide with decidedAt, correct a decision, audited', async () => {
    const { ds, advance } = make();
    expect((await ds.listApplications(admin, 'call_summer_open')).map((a) => a.id).sort()).toEqual(['app_june_summer', 'app_mara_summer']);
    expect((await ds.listApplications(admin)).length).toBe(6);
    const shortlisted = await ds.setApplicationStatus(admin, 'app_deshawn_night', 'shortlisted');
    expect(shortlisted.decidedAt).toBeUndefined();
    advance(1000);
    const accepted = await ds.setApplicationStatus(admin, 'app_deshawn_night', 'accepted', { decisionNote: '  Welcome to the show.  ' });
    expect(accepted.decidedAt).toBe(new Date(T + 1000).toISOString());
    expect(accepted.decisionNote).toBe('Welcome to the show.');
    expect(accepted.works.map((w) => w.id)).toEqual(['aw_deshawn_1', 'aw_deshawn_2']);
    const corrected = await ds.setApplicationStatus(admin, 'app_deshawn_night', 'shortlisted', { decisionNote: '' });
    expect(corrected.decidedAt).toBeUndefined();
    expect(corrected.decisionNote).toBeUndefined();
    await expect(ds.setApplicationStatus(admin, 'app_deshawn_night', 'shortlisted')).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.setApplicationStatus(admin, 'app_deshawn_night', 'withdrawn')).rejects.toBeInstanceOf(ValidationError);
    const statusRows = (await ds.listAudit(admin)).filter((e) => e.action === 'application.status');
    expect(statusRows.map((e) => e.meta?.status)).toEqual(['shortlisted', 'accepted', 'shortlisted']); // newest first
  });

  it('curators, visitors and admins-as-applicants are refused on every artist method; non-admins on review', async () => {
    const { ds } = make();
    const input = { callId: 'call_night_weather', artworkIds: ['aw_mara_1'], statement: 'x'.repeat(40) };
    for (const v of [lena, visitor]) {
      await expect(ds.listMyApplications(v)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.submitApplication(v, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.withdrawApplication(v, 'app_deshawn_night')).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(ds.submitApplication(admin, input)).rejects.toBeInstanceOf(ForbiddenError);
    for (const v of [owen, visitor, mara]) {
      await expect(ds.listApplications(v)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.setApplicationStatus(v, 'app_deshawn_night', 'accepted')).rejects.toBeInstanceOf(ForbiddenError);
    }
    // A partner reviews only its own calls (see sales.test.ts).
    await expect(ds.setApplicationStatus(lena, 'app_deshawn_night', 'accepted')).rejects.toBeInstanceOf(ForbiddenError);
    expect((await ds.listApplications(lena)).every((a) => a.callId === 'call_cma_auction')).toBe(true);
  });
});

describe('collector inquiries', () => {
  it('a visitor can ask about a visible work; the receipt carries nothing else', async () => {
    const { ds } = make();
    const res = await ds.submitBuyerInquiry(visitor, { ...inquiry({ artworkId: 'aw_june_1' }), artistId: 'art_mara' } as never);
    expect(Object.keys(res)).toEqual(['id']);
    const stored = ds._raw().buyerInquiries.find((b) => b.id === res.id)!;
    expect(stored.artistId).toBe('art_june'); // derived from the work, not from the client
    expect(stored.status).toBe('new');
    const ev = (await ds.listAudit(admin))[0]!;
    expect(ev).toMatchObject({ action: 'buyer_inquiry.submit', entityType: 'buyer_inquiry', entityId: res.id, actorRole: 'public', actorName: 'Sam Visitor', actorId: 'anonymous' });
    expect(JSON.stringify(ev)).not.toContain('sam@example.com');
  });

  it('a general inquiry needs no artwork', async () => {
    const { ds } = make();
    const res = await ds.submitBuyerInquiry(visitor, inquiry({ intent: 'placement', organization: '  Riverside Office ' }));
    const row = (await ds.listBuyerInquiries(admin)).find((b) => b.id === res.id)!;
    expect(row.artworkId).toBeUndefined();
    expect(row.artistId).toBeUndefined();
    expect(row.organization).toBe('Riverside Office');
  });

  it('a work the viewer cannot see is NotFound', async () => {
    const { ds } = make();
    for (const artworkId of ['aw_priya_1', 'aw_mara_3', 'aw_june_3', 'aw_missing']) {
      await expect(ds.submitBuyerInquiry(visitor, inquiry({ artworkId }))).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(ds._raw().buyerInquiries).toHaveLength(2);
  });

  it('invalid input is rejected with the field', async () => {
    const { ds } = make();
    const err = await ds.submitBuyerInquiry(visitor, inquiry({ consent: false })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe('consent');
  });

  it('the sixth inquiry from one email in 24 hours is refused (case-insensitive); it resets after a day', async () => {
    const { ds, advance } = make();
    for (let i = 0; i < 5; i++) {
      await ds.submitBuyerInquiry(visitor, inquiry({ email: i % 2 ? 'Sam@Example.com' : 'sam@example.com' }));
      advance(60_000);
    }
    const err = await ds.submitBuyerInquiry(visitor, inquiry({ email: 'SAM@example.com ' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe('email');
    expect((err as ValidationError).message).toBe('Kofi already has your messages — we’ll reply soon.');
    await expect(ds.submitBuyerInquiry(visitor, inquiry({ email: 'other@example.com' }))).resolves.toBeDefined();
    advance(24 * 3_600_000);
    await expect(ds.submitBuyerInquiry(visitor, inquiry())).resolves.toBeDefined();
  });

  it('only admins list and update; rows name the work and artist but never the artist’s contact', async () => {
    const { ds } = make();
    for (const v of [visitor, mara, lena]) {
      await expect(ds.listBuyerInquiries(v)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.setBuyerInquiryStatus(v, 'bi_doubling', 'closed')).rejects.toBeInstanceOf(ForbiddenError);
    }
    const rows = await ds.listBuyerInquiries(admin);
    expect(rows.map((r) => r.id)).toEqual(['bi_doubling', 'bi_office_placement']);
    expect(rows[0]).toMatchObject({ artworkTitle: 'Doubling (Liberty Avenue, 7:40pm)', artistWorkingName: 'Mara Oyelaran' });
    expect(JSON.stringify(rows)).not.toContain('mara@example.com');
    const row = await ds.setBuyerInquiryStatus(admin, 'bi_doubling', 'in progress', 'Called back; viewing Thursday.');
    expect(row).toMatchObject({ status: 'in progress', staffNote: 'Called back; viewing Thursday.' });
    await expect(ds.setBuyerInquiryStatus(admin, 'bi_doubling', 'archived' as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.setBuyerInquiryStatus(admin, 'bi_missing', 'closed')).rejects.toBeInstanceOf(NotFoundError);
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'buyer_inquiry.status', entityId: 'bi_doubling', meta: { status: 'in progress', noteOnly: false } });
  });
});

describe('persisted state from v2', () => {
  afterEach(() => localStorage.clear());

  it('loads a v2 state, keeps the user’s works and merges in the seeded programme', async () => {
    localStorage.clear();
    const v2 = buildSeed() as unknown as Record<string, unknown>;
    for (const k of PROGRAMME_KEYS) delete v2[k];
    const artworks = v2.artworks as { id: string; title: string }[];
    artworks.find((a) => a.id === 'aw_mara_1')!.title = 'Renamed by Mara';
    v2.artworks = artworks.filter((a) => a.id !== 'aw_mara_2'); // Mara deleted this one in v2
    localStorage.setItem('kofi.mock.state.v1', JSON.stringify(v2));

    const { ds } = make({ persist: true });
    expect((await ds.getArtwork(mara, 'aw_mara_1'))!.title).toBe('Renamed by Mara');
    expect(await ds.getArtwork(mara, 'aw_mara_2')).toBeUndefined();
    expect(ds._raw().artworks).toHaveLength(artworks.length - 1);
    expect((await ds.listExhibitions(visitor)).map((x) => x.id)).toContain('ex_being_seen');
    expect((await ds.getExhibition(admin, 'ex_night_weather'))!.artworkIds).not.toContain('aw_mara_2');
    expect((await ds.listOpenCalls(visitor)).length).toBe(5);
    expect((await ds.listMyApplications(deshawn)).length).toBe(2);
    expect((await ds.listBuyerInquiries(admin)).length).toBe(2);
    // The migrated state is written on the next change and survives a reload.
    await ds.submitBuyerInquiry(visitor, inquiry());
    const reloaded = make({ persist: true }).ds;
    expect((await reloaded.listBuyerInquiries(admin)).length).toBe(3);
    expect((await reloaded.getArtwork(mara, 'aw_mara_1'))!.title).toBe('Renamed by Mara');
  });

  it('a v3 state whose programme Kofi emptied is not reseeded', async () => {
    localStorage.clear();
    const v3 = buildSeed();
    v3.exhibitions = [];
    localStorage.setItem('kofi.mock.state.v1', JSON.stringify(v3));
    const { ds } = make({ persist: true });
    expect(await ds.listExhibitions(admin)).toEqual([]);
    expect((await ds.listStories(visitor)).length).toBe(4);
  });
});

describe('activity log wording for programme rows', () => {
  it('every new action reads as a sentence', async () => {
    const { describeAudit } = await import('@/features/admin/format');
    const { ds } = make();
    const ex = await ds.saveExhibition(admin, exInput());
    await ds.saveExhibition(admin, { ...exInput({ published: true }), id: ex.id });
    await ds.saveStory(admin, storyInput({ published: true }));
    await ds.deleteEvent(admin, 'ev_mara_talk');
    await ds.setApplicationStatus(admin, 'app_deshawn_night', 'shortlisted');
    await ds.submitBuyerInquiry(visitor, inquiry());
    await ds.setBuyerInquiryStatus(admin, 'bi_doubling', 'new', 'Left a voicemail.');
    const lines = (await ds.listAudit(admin, 7)).map((e) => describeAudit(e));
    expect(lines).toEqual([
      'added a staff note to a collector inquiry',
      'sent a collector inquiry',
      'shortlisted an application',
      'deleted an event',
      'published a journal story',
      'published an exhibition',
      'drafted an exhibition',
    ]);
    expect(describeAudit({ action: 'application.submit' })).toBe('applied to an open call');
    expect(describeAudit({ action: 'buyer_inquiry.status', meta: { status: 'closed' } })).toBe('closed a collector inquiry');
  });
});
