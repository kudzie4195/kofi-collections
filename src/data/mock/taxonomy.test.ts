import { describe, expect, it } from 'vitest';
import { MockDataSource, migrateState } from './MockDataSource';
import { buildSeed, MOCK_SCHEMA, SEED_CALL_CRITERIA, SEED_CLASSIFICATION, type MockState } from './seed';
import { ForbiddenError, NotFoundError, ValidationError, type ArtworkInput, type ProgrammeInput } from '../DataSource';
import { tagFacets } from '@/domain/filters';
import { NO_USES, type Artwork, type OpenCall, type Viewer } from '@/domain/types';

const visitor: Viewer = { role: 'public', displayName: 'Visitor' };
const admin: Viewer = { role: 'admin', userId: 'user_quincy', displayName: 'Quincy' };
const mara: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
const tobias: Viewer = { role: 'artist', userId: 'user_tobias', artistId: 'art_tobias', displayName: 'Tobias Reinholt' };
const june: Viewer = { role: 'artist', userId: 'user_june', artistId: 'art_june', displayName: 'June Takahashi-Bell' };
const lena: Viewer = { role: 'curator', userId: 'user_lena', curatorId: 'cur_lena', curatorVerified: true, displayName: 'Lena Marchetti' };
const owen: Viewer = { role: 'curator', userId: 'user_owen', curatorId: 'cur_owen', curatorVerified: true, displayName: 'Owen Blackwood' };

const T = Date.parse('2026-10-20T16:00:00Z');
const make = () => {
  let n = 0;
  return new MockDataSource({ persist: false, now: () => new Date(T), idFactory: (p) => `${p}_t${++n}` });
};

/** The stored seed work as the editor would send it back. */
function inputFor(id: string, over: Partial<ArtworkInput> = {}): ArtworkInput {
  const aw = buildSeed().artworks.find((a) => a.id === id)!;
  const { artistId: _a, createdAt: _c, updatedAt: _u, reviewedAt: _r, ...rest } = aw;
  return { ...rest, ...over };
}

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

describe('workbook P0 tests, against the mock data layer', () => {
  it('Painting OR Drawing plus Social Impact = Education Access filters correctly', async () => {
    const ds = make();
    await ds.saveArtwork(mara, inputFor('aw_mara_1', { tagIds: [...SEED_CLASSIFICATION.aw_mara_1!.tagIds, 'social_impact.education_access'] }));
    // A sculpture with the same Social Impact tag: AND across categories keeps it out.
    await ds.saveArtwork(tobias, inputFor('aw_tobias_3', { tagIds: ['social_impact.education_access'] }));
    const filters = { tags: { medium: ['medium.painting', 'medium.drawing'], social_impact: ['social_impact.education_access'] } };
    expect((await ds.listArtworks(visitor, filters)).map((w) => w.id)).toEqual(['aw_mara_1']);
    // OR within a category: Painting alone still finds it; Drawing alone does not.
    expect((await ds.listArtworks(visitor, { tags: { medium: ['medium.painting'], social_impact: ['social_impact.education_access'] } })).map((w) => w.id)).toEqual(['aw_mara_1']);
    expect(await ds.listArtworks(visitor, { tags: { medium: ['medium.drawing'], social_impact: ['social_impact.education_access'] } })).toEqual([]);
    expect((await ds.listArtworks(visitor, { tags: { social_impact: ['social_impact.education_access'] } })).map((w) => w.id).sort()).toEqual(['aw_mara_1', 'aw_tobias_3']);
  });

  it('a 24-inch work appears in an equivalent centimetre range', async () => {
    const ds = make();
    const saved = await ds.saveArtwork(mara, inputFor('aw_mara_2', { id: undefined, title: 'Twenty-four', dimensions: { height: 24, width: 18, unit: 'in' } }));
    const ids = async (min: number, max: number) => (await ds.listArtworks(visitor, { sizeUnit: 'cm', minLongestEdge: min, maxLongestEdge: max })).map((w) => w.id);
    // 24 in = 60.96 cm, compared at the 0.1 cm the catalogue shows (61 cm).
    expect(await ids(60, 61)).toContain(saved.id);
    expect(await ids(55, 65)).toContain(saved.id);
    expect(await ids(61.1, 70)).not.toContain(saved.id);
    expect(await ids(50, 60.9)).not.toContain(saved.id);
    // The same bound in inches agrees.
    expect((await ds.listArtworks(visitor, { sizeUnit: 'in', minLongestEdge: 24, maxLongestEdge: 24 })).map((w) => w.id)).toContain(saved.id);
  });

  it('a work can be not for sale but available for exhibition', async () => {
    const ds = make();
    const w = await ds.saveArtwork(mara, inputFor('aw_mara_3', { visibility: 'public', uses: { ...NO_USES, exhibition: true } }));
    expect(w.status).toBe('not for sale');
    expect(w.uses).toEqual({ ...NO_USES, exhibition: true });
    const forExhibition = await ds.listArtworks(visitor, { uses: ['exhibition'], statuses: ['not for sale'] });
    expect(forExhibition.map((x) => x.id)).toContain('aw_mara_3');
    expect((await ds.listArtworks(visitor, { uses: ['auction'] })).map((x) => x.id)).not.toContain('aw_mara_3');
  });

  it('an artist can select and save 3+ values in a category, and add, change or remove Social Impact', async () => {
    const ds = make();
    const three = ['subject.urban_life', 'subject.people', 'subject.architecture', 'theme.memory', 'theme.belonging', 'theme.resilience', 'theme.joy'];
    let w = await ds.saveArtwork(mara, inputFor('aw_mara_1', { tagIds: [...three, 'social_impact.community_building', 'social_impact.youth_empowerment', 'social_impact.education_access'] }));
    expect(w.tagIds.filter((id) => id.startsWith('subject.'))).toHaveLength(3);
    expect(w.tagIds.filter((id) => id.startsWith('theme.'))).toHaveLength(4);
    expect(w.tagIds.filter((id) => id.startsWith('social_impact.'))).toHaveLength(3);
    expect(w.tagIds).toContain('medium.painting');
    // Change: one Social Impact tag swapped. Remove: all of them.
    w = await ds.saveArtwork(mara, inputFor('aw_mara_1', { tagIds: [...three, 'social_impact.community_building', 'social_impact.healing_wellbeing'] }));
    expect(w.tagIds.filter((id) => id.startsWith('social_impact.'))).toEqual(['social_impact.community_building', 'social_impact.healing_wellbeing']);
    w = await ds.saveArtwork(mara, inputFor('aw_mara_1', { tagIds: three }));
    expect(w.tagIds.some((id) => id.startsWith('social_impact.'))).toBe(false);
    // What was saved is what the public reads back.
    expect((await ds.getArtwork(visitor, 'aw_mara_1'))!.tagIds).toEqual(w.tagIds);
  });

  it('a public user cannot retrieve a private price through listings, facets or matching', async () => {
    const ds = make();
    await ds.saveArtwork(mara, inputFor('aw_mara_2', { price: { amount: 1437, currency: 'USD' }, priceVisibility: 'private' }));
    const list = await ds.listArtworks(visitor);
    const sw = list.find((w) => w.id === 'aw_mara_2')!;
    expect(sw.price).toBeUndefined();
    expect(sw.priceWithheld).toBe(true);
    const facets = tagFacets(list, { tags: { medium: ['medium.painting'] } });
    expect(JSON.stringify({ list, facets })).not.toContain('1437');
    await expect(ds.listMatchingWorks(visitor, 'call_cma_auction')).rejects.toBeInstanceOf(ForbiddenError);
    // Even the call's organiser, who may see institution prices, does not get a private one.
    const lenaMatches = await ds.listMatchingWorks(lena, 'call_cma_auction');
    expect(lenaMatches.find((m) => m.work.id === 'aw_mara_2')?.work.price).toBeUndefined();
    expect(JSON.stringify(lenaMatches)).not.toContain('1437');
  });
});

describe('saveArtwork normalisation', () => {
  it('mirrors the medium, drops unknown, Phase 2 and non-selectable ids, keeps library order', async () => {
    const ds = make();
    const w = await ds.saveArtwork(mara, inputFor('aw_mara_2', { tagIds: [' theme.memory ', 'style.abstract', 'nope.nothing', 'curatorial.exhibition_ready', 'acquisition.auction', 'artist_experience.commissions', 'style.abstract'] }));
    expect(w.tagIds).toEqual(['medium.painting', 'style.abstract', 'theme.memory']);
  });

  it('caps a category at 6 and Social Impact at 4, naming the field', async () => {
    const ds = make();
    const styles = ['style.abstract', 'style.realism', 'style.surrealism', 'style.contemporary', 'style.minimalism', 'style.expressionism', 'style.figurative'];
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { tagIds: styles }))).rejects.toMatchObject({ name: 'ValidationError', field: 'tags.style' });
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { tagIds: styles.slice(0, 6) }))).resolves.toBeTruthy();
    const impact = ['social_impact.arts_accessibility', 'social_impact.civic_participation', 'social_impact.community_building', 'social_impact.community_health', 'social_impact.education_access'];
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { tagIds: impact }))).rejects.toMatchObject({ field: 'tags.social_impact' });
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { tagIds: impact.slice(0, 4) }))).resolves.toBeTruthy();
  });

  it('keeps stored tags and uses when an older client leaves them out; a medium change drops the old mirror', async () => {
    const ds = make();
    const { tagIds: _t, uses: _u, ...old } = inputFor('aw_mara_1');
    let w = await ds.saveArtwork(mara, old);
    expect(w.tagIds).toEqual(SEED_CLASSIFICATION.aw_mara_1!.tagIds);
    expect(w.uses).toEqual(SEED_CLASSIFICATION.aw_mara_1!.uses);
    w = await ds.saveArtwork(mara, { ...old, medium: 'drawing' });
    expect(w.tagIds).toContain('medium.drawing');
    expect(w.tagIds).not.toContain('medium.painting');
    expect(w.tagIds).toContain('theme.memory');
  });

  it('uses: default none on a new work, booleans only, unknown keys dropped', async () => {
    const ds = make();
    const { tagIds: _t, uses: _u, ...fresh } = inputFor('aw_mara_2', { id: undefined });
    const created = await ds.saveArtwork(mara, fresh);
    expect(created.uses).toEqual(NO_USES);
    expect(created.tagIds).toEqual(['medium.painting']);
    await expect(ds.saveArtwork(mara, { ...fresh, uses: { ...NO_USES, auction: 'yes' } as never })).rejects.toMatchObject({ field: 'uses' });
    const w = await ds.saveArtwork(mara, { ...fresh, id: created.id, uses: { exhibition: true, resale: true } as never });
    expect(w.uses).toEqual({ ...NO_USES, exhibition: true });
    expect(ds['state'].artworks.find((a: Artwork) => a.id === created.id)!.uses).not.toHaveProperty('resale');
  });

  it('edition rules', async () => {
    const ds = make();
    const save = (edition: unknown) => ds.saveArtwork(mara, inputFor('aw_mara_2', { edition: edition as Artwork['edition'] }));
    expect((await save({ type: 'limited', number: 2, size: 5 })).edition).toEqual({ type: 'limited', number: 2, size: 5 });
    expect((await save({ type: 'artist_proof', number: 1 })).edition).toEqual({ type: 'artist_proof', number: 1 });
    expect((await save({ type: 'unique', number: 3, size: 9 })).edition).toEqual({ type: 'unique' });
    expect((await save({ type: 'open', number: 40, size: 10 })).edition).toEqual({ type: 'open', number: 40 });
    await expect(save({ type: 'limited', number: 6, size: 5 })).rejects.toMatchObject({ field: 'edition', message: expect.stringMatching(/cannot be higher/) });
    await expect(save({ type: 'limited' })).rejects.toMatchObject({ field: 'edition' });
    await expect(save({ type: 'limited', number: 0, size: 5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(save({ type: 'limited', number: 1.5, size: 5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(save({ type: 'numbered' })).rejects.toMatchObject({ field: 'edition' });
    // Sent as undefined: cleared. Left out: kept.
    await save({ type: 'limited', number: 2, size: 5 });
    const { edition: _e, ...noEdition } = inputFor('aw_mara_2');
    expect((await ds.saveArtwork(mara, noEdition)).edition).toEqual({ type: 'limited', number: 2, size: 5 });
    expect((await save(undefined)).edition).toBeUndefined();
  });

  it('location is optional; once given it needs a region and a country, and is shown at the artist’s precision', async () => {
    const ds = make();
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { location: { city: 'Toronto', region: '', country: 'Canada', precision: 'city' } }))).rejects.toMatchObject({ field: 'location' });
    const w = await ds.saveArtwork(mara, inputFor('aw_mara_2', { location: { city: ' Toronto ', region: 'Ontario', country: 'Canada', precision: 'city' } }));
    expect(w.locationLabel).toContain('Ontario');
    const blank = await ds.saveArtwork(mara, inputFor('aw_mara_2', { location: { region: ' ', country: '', precision: 'region' } }));
    expect(blank.locationLabel).toContain('Pennsylvania');
  });

  it('keywords: trimmed, de-duplicated, at most 20 of at most 40 characters', async () => {
    const ds = make();
    const w = await ds.saveArtwork(mara, inputFor('aw_mara_2', { tags: ['  rain ', 'Rain', '', 'wet  glass'] }));
    expect(w.tags).toEqual(['rain', 'wet glass']);
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { tags: Array.from({ length: 21 }, (_, i) => `k${i}`) }))).rejects.toMatchObject({ field: 'tags' });
    await expect(ds.saveArtwork(mara, inputFor('aw_mara_2', { tags: ['x'.repeat(41)] }))).rejects.toMatchObject({ field: 'tags' });
  });

  it('writes the usual artwork.update audit row for a tag change', async () => {
    const ds = make();
    await ds.saveArtwork(mara, inputFor('aw_mara_1', { tagIds: ['style.abstract'] }));
    const audit = await ds.listAudit(admin);
    expect(audit.find((e) => e.entityId === 'aw_mara_1')?.action).toBe('artwork.update');
  });
});

describe('listMatchingWorks', () => {
  it('Lena (the CMA partner) gets only works she may already see, ranked against the call', async () => {
    const ds = make();
    const visible = new Set((await ds.listArtworks(lena)).map((w) => w.id));
    const ranked = await ds.listMatchingWorks(lena, 'call_cma_auction');
    expect(ranked.length).toBe(visible.size);
    for (const r of ranked) expect(visible.has(r.work.id)).toBe(true);
    const ids = ranked.map((r) => r.work.id);
    expect(ids).not.toContain('aw_june_3'); // Only me
    expect(ids).not.toContain('aw_mara_3'); // Kofi team only
    expect(ids).not.toContain('aw_priya_1'); // artist not approved yet
    // Mara's two Night Weather works fit 3 of 3 (theme, auction, Pennsylvania) and come first.
    expect(ids.slice(0, 2).sort()).toEqual(['aw_mara_1', 'aw_mara_2']);
    expect(ranked[0]!.match).toMatchObject({ met: 3, of: 3, fits: true });
    // DeShawn shows his region at country precision, so the region ask is not met: honest, 2 of 3.
    expect(ranked.find((r) => r.work.id === 'aw_deshawn_1')!.match).toMatchObject({ met: 2, of: 3, fits: false });
    // Admin sees the same call too.
    expect((await ds.listMatchingWorks(admin, 'call_cma_auction')).length).toBeGreaterThan(0);
  });

  it('an artist gets only their own works (never Only me), for calls they can see', async () => {
    const ds = make();
    const maras = await ds.listMatchingWorks(mara, 'call_night_weather');
    expect(maras.map((r) => r.work.id).sort()).toEqual(['aw_mara_1', 'aw_mara_2', 'aw_mara_3']);
    expect(maras.find((r) => r.work.id === 'aw_mara_1')!.match).toMatchObject({ met: 3, of: 3, fits: true });
    const junes = await ds.listMatchingWorks(june, 'call_cma_auction');
    expect(junes.map((r) => r.work.id).sort()).toEqual(['aw_june_1', 'aw_june_2']);
    expect(junes.every((r) => r.work.artistId === 'art_june')).toBe(true);
  });

  it('refuses everyone else: a partner on a call their institution does not run, an unverified curator, the public', async () => {
    const ds = make();
    await expect(ds.listMatchingWorks(lena, 'call_night_weather')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listMatchingWorks(owen, 'call_cma_auction')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listMatchingWorks(visitor, 'call_cma_auction')).rejects.toBeInstanceOf(ForbiddenError);
    // A partner's unpublished draft is not visible to artists at all.
    const draft = await ds.saveOpenCall(lena, callInput({ lookingFor: { uses: ['exhibition'] } }));
    await expect(ds.listMatchingWorks(june, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ds.listMatchingWorks(lena, draft.id)).resolves.toBeTruthy();
  });
});

describe('saveOpenCall: lookingFor', () => {
  it('validates, drops unknown keys, and stores empty criteria as none', async () => {
    const ds = make();
    const saved = await ds.saveOpenCall(admin, callInput({ lookingFor: { tags: { theme: ['theme.memory', 'theme.memory'], style: [] }, uses: ['exhibition', 'auction'], region: ' Ohio ', maxLongestEdgeCm: 200, secret: 'x' } as never }));
    expect(saved.lookingFor).toEqual({ tags: { theme: ['theme.memory'] }, uses: ['auction', 'exhibition'], region: 'Ohio', maxLongestEdgeCm: 200 });
    expect((await ds.saveOpenCall(admin, callInput({ id: saved.id, lookingFor: { tags: {} } }))).lookingFor).toBeUndefined();
    const bad = (lookingFor: unknown) => ds.saveOpenCall(admin, callInput({ lookingFor: lookingFor as OpenCall['lookingFor'] }));
    await expect(bad({ tags: { style: ['theme.joy'] } })).rejects.toMatchObject({ field: 'lookingFor' });
    await expect(bad({ tags: { theme: ['theme.nonsense'] } })).rejects.toMatchObject({ field: 'lookingFor' });
    await expect(bad({ tags: { curatorial: ['curatorial.exhibition_ready'] } })).rejects.toMatchObject({ field: 'lookingFor' });
    await expect(bad({ uses: ['resale'] })).rejects.toMatchObject({ field: 'lookingFor.uses' });
    await expect(bad({ minLongestEdgeCm: 300, maxLongestEdgeCm: 100 })).rejects.toMatchObject({ field: 'lookingFor.minLongestEdgeCm' });
    await expect(bad({ note: 'x'.repeat(401) })).rejects.toMatchObject({ field: 'lookingFor.note' });
  });

  it('a partner sets it on their own draft; a save that leaves it out keeps it', async () => {
    const ds = make();
    const draft = await ds.saveOpenCall(lena, callInput({ lookingFor: { tags: { subject: ['subject.urban_life'] } } }));
    expect(draft.lookingFor).toEqual({ tags: { subject: ['subject.urban_life'] } });
    const { lookingFor: _l, ...rest } = callInput({ id: draft.id, title: 'Renamed' });
    expect((await ds.saveOpenCall(lena, rest)).lookingFor).toEqual({ tags: { subject: ['subject.urban_life'] } });
    // Published calls stay Kofi's to change.
    const cma = (await ds.getOpenCall(lena, 'call_cma_auction'))!;
    await expect(ds.saveOpenCall(lena, { ...cma, lookingFor: {} })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the seeded calls carry their criteria', async () => {
    const ds = make();
    expect((await ds.getOpenCall(visitor, 'call_cma_auction'))!.lookingFor).toEqual(SEED_CALL_CRITERIA.call_cma_auction);
    expect((await ds.getOpenCall(visitor, 'call_night_weather'))!.lookingFor).toEqual(SEED_CALL_CRITERIA.call_night_weather);
  });
});

describe('seed', () => {
  it('every seeded work is classified with valid, sparse, artist-selectable tags', async () => {
    const seed = buildSeed();
    expect(seed.artworks).toHaveLength(13);
    const ds = make();
    for (const aw of seed.artworks) {
      const c = SEED_CLASSIFICATION[aw.id]!;
      expect(c, aw.id).toBeTruthy();
      // Already normalised: saving it back changes nothing.
      const artist = { role: 'artist', userId: `user_${aw.artistId.slice(4)}`, artistId: aw.artistId, displayName: 'x' } as Viewer;
      const saved = await ds.saveArtwork(artist, inputFor(aw.id));
      expect(saved.tagIds, aw.id).toEqual(aw.tagIds);
      // The table is stored as written (the Supabase live patch copies it by id).
      expect(aw.tagIds, aw.id).toEqual(c.tagIds);
      const nonMedium = aw.tagIds.filter((id) => !id.startsWith('medium.'));
      expect(nonMedium.length, aw.id).toBeGreaterThanOrEqual(3);
      expect(nonMedium.length, aw.id).toBeLessThanOrEqual(6);
    }
    expect(seed.artworks.find((a) => a.id === 'aw_deshawn_1')!.edition).toEqual({ type: 'limited', number: 2, size: 5 });
    expect(seed.schema).toBe(MOCK_SCHEMA);
  });
});

describe('migrateState: v5 → v6', () => {
  function v5State(): Partial<MockState> {
    const s = JSON.parse(JSON.stringify(buildSeed())) as MockState;
    delete s.schema;
    for (const a of s.artworks as Partial<Artwork>[]) {
      delete a.tagIds;
      delete a.uses;
      delete a.edition;
    }
    for (const c of s.openCalls) delete c.lookingFor;
    // The user changed a seeded work's medium and added a work of their own, with tags as free text.
    s.artworks.find((a) => a.id === 'aw_mara_2')!.medium = 'drawing';
    s.artworks.push({ ...s.artworks.find((a) => a.id === 'aw_mara_1')!, id: 'aw_local', title: 'Mine', tags: [' Abstract ', 'abstract', 'x'.repeat(60)] } as Artwork);
    return s;
  }

  it('keeps tags as keywords, gives medium-only ids and no uses to user works, and the seed’s classification to seeded ones', () => {
    const out = migrateState(v5State());
    const by = Object.fromEntries(out.artworks.map((a) => [a.id, a]));
    expect(by.aw_local!.tagIds).toEqual(['medium.painting']);
    expect(by.aw_local!.uses).toEqual(NO_USES);
    expect(by.aw_local!.tags).toEqual(['Abstract', 'x'.repeat(40)]);
    expect(by.aw_mara_1!.tagIds).toEqual(SEED_CLASSIFICATION.aw_mara_1!.tagIds);
    expect(by.aw_mara_1!.uses).toEqual(SEED_CLASSIFICATION.aw_mara_1!.uses);
    expect(by.aw_mara_1!.tags).toEqual(['night', 'city', 'reflection']);
    expect(by.aw_deshawn_1!.edition).toEqual({ type: 'limited', number: 2, size: 5 });
    // The medium the user chose wins over the seed's.
    expect(by.aw_mara_2!.tagIds).toContain('medium.drawing');
    expect(by.aw_mara_2!.tagIds).not.toContain('medium.painting');
    // A seeded work with a second medium tag keeps it: a migrated device equals a fresh install.
    expect(by.aw_tobias_1!.tagIds).toEqual(buildSeed().artworks.find((a) => a.id === 'aw_tobias_1')!.tagIds);
    expect(by.aw_tobias_1!.tagIds).toContain('medium.ceramics');
    expect(out.openCalls.find((c) => c.id === 'call_cma_auction')!.lookingFor).toEqual(SEED_CALL_CRITERIA.call_cma_auction);
    expect(out.schema).toBe(MOCK_SCHEMA);
    // Idempotent, and criteria a user later cleared are not put back.
    expect(migrateState(JSON.parse(JSON.stringify(out)))).toEqual(out);
    delete out.openCalls.find((c) => c.id === 'call_cma_auction')!.lookingFor;
    expect(migrateState(JSON.parse(JSON.stringify(out))).openCalls.find((c) => c.id === 'call_cma_auction')!.lookingFor).toBeUndefined();
  });

  it('a v5 device loads and matching works on it', async () => {
    localStorage.clear();
    localStorage.setItem('kofi.mock.state.v1', JSON.stringify(v5State()));
    const ds = new MockDataSource({ persist: true, now: () => new Date(T) });
    const ranked = await ds.listMatchingWorks(lena, 'call_cma_auction');
    expect(ranked.slice(0, 2).map((r) => r.work.id).sort()).toEqual(['aw_mara_1', 'aw_mara_2']);
    expect((await ds.getArtwork(visitor, 'aw_local'))!.uses).toEqual(NO_USES);
    localStorage.clear();
  });
});
