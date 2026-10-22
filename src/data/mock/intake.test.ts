import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockDataSource, migrateState } from './MockDataSource';
import { buildSeed, type MockState } from './seed';
import { fixtureFor, SEED_TOKENS } from './importFixtures';
import { ConflictError, ForbiddenError, ValidationError, type ArtworkInput } from '../DataSource';
import { TOKEN_RE } from '@/domain/intake';
import { CONSENT_VERSION, type Viewer } from '@/domain/types';

const visitor: Viewer = { role: 'public', displayName: 'Visitor' };
const admin: Viewer = { role: 'admin', userId: 'user_quincy', displayName: 'Quincy' };
const mara: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
const lena: Viewer = { role: 'curator', userId: 'user_lena', curatorId: 'cur_lena', curatorVerified: true, displayName: 'Lena Marchetti' };

const T = Date.parse('2026-10-22T16:00:00Z');
const make = (persist = false) => new MockDataSource({ persist, now: () => new Date(T) });
const signUp = { displayName: 'Flow Tester', email: 'Flow@Example.com', password: 'rain on liberty avenue', consentVersion: CONSENT_VERSION };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('signUpArtist', () => {
  it('validates each field and refuses an email that already has an account', async () => {
    const ds = make();
    await expect(ds.signUpArtist({ ...signUp, displayName: 'F' })).rejects.toMatchObject({ field: 'displayName' });
    await expect(ds.signUpArtist({ ...signUp, email: 'flow@' })).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.signUpArtist({ ...signUp, password: 'short' })).rejects.toMatchObject({ field: 'password' });
    await expect(ds.signUpArtist({ ...signUp, consentVersion: 'old' })).rejects.toMatchObject({ field: 'consentVersion' });
    // A seeded artist's contact email and a curator's work email are taken.
    await expect(ds.signUpArtist({ ...signUp, email: 'MARA@example.com' })).rejects.toBeInstanceOf(ConflictError);
    const lenaEmail = ds._raw().curators.find((c) => c.id === 'cur_lena')!.workEmail;
    await expect(ds.signUpArtist({ ...signUp, email: lenaEmail })).rejects.toMatchObject({ code: 'conflict', field: 'email' });
    await ds.signUpArtist(signUp);
    await expect(ds.signUpArtist({ ...signUp, displayName: 'Someone Else' })).rejects.toBeInstanceOf(ConflictError);
    expect(ds._raw().accounts).toHaveLength(1);
  });

  it('creates a draft, private artist with a code and recorded consent, signed in', async () => {
    const ds = make();
    const r = await ds.signUpArtist(signUp);
    expect(r.emailConfirmationRequired).toBe(false);
    expect(r.viewer).toEqual({ role: 'artist', userId: 'user_flow_tester', artistId: 'art_flow_tester', displayName: 'Flow Tester' });
    expect(r.identity).toEqual({ id: 'user_flow_tester', label: 'Flow Tester', caption: 'Artist · new profile', viewer: r.viewer });
    const me = (await ds.getMyArtist(r.viewer))!;
    expect(me).toMatchObject({ id: 'art_flow_tester', workingName: 'Flow Tester', status: 'draft', visibility: 'private', consentVersion: CONSENT_VERSION, consentAcceptedAt: new Date(T).toISOString(), links: [], imports: [] });
    expect(me.contact?.email).toBe('flow@example.com');
    expect(me.verificationToken).toMatch(TOKEN_RE);
    const audit = await ds.listAudit(admin);
    const rows = audit.filter((e) => e.entityId === 'art_flow_tester');
    expect(rows.map((e) => e.action).sort()).toEqual(['artist.consent', 'artist.signup']);
    // Neither the email nor the code is ever written to the trail.
    expect(JSON.stringify(audit)).not.toContain('flow@example.com');
    expect(JSON.stringify(audit)).not.toContain(me.verificationToken);
  });

  it('gives a clashing name its own ids and an avatar from the brand palette', async () => {
    const ds = make();
    const r = await ds.signUpArtist({ ...signUp, displayName: 'Mara', email: 'other.mara@example.org' });
    expect(r.viewer.artistId).toBe('art_mara_2');
    expect(['#c8322b', '#e3b23c', '#7fa344', '#4f6a25', '#f3eee6', '#242424']).toContain(ds._raw().artists.find((a) => a.id === 'art_mara_2')!.avatarColor);
  });

  describe('persistence', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());
    it('the new identity and profile survive a reload', async () => {
      const r = await make(true).signUpArtist(signUp);
      const again = make(true);
      const ids = await again.listDemoIdentities();
      expect(ids.at(-1)).toEqual(r.identity);
      expect(ids.find((i) => i.id === 'admin')).toBeDefined();
      expect((await again.getMyArtist(r.viewer))?.workingName).toBe('Flow Tester');
      await expect(again.signUpArtist(signUp)).rejects.toBeInstanceOf(ConflictError);
      await again.resetDemoData();
      expect((await again.listDemoIdentities()).some((i) => i.id === r.identity!.id)).toBe(false);
    });
  });
});

describe('importProfile', () => {
  it('reads the sample pages: Instagram og tags, the website JSON-LD', async () => {
    const ds = make();
    const { viewer } = await ds.signUpArtist(signUp);
    const ig = await ds.importProfile(viewer, '@mara.paints');
    expect(ig.source).toMatchObject({ url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints' });
    expect(ig.fields).toMatchObject({ workingName: 'Mara Oyelaran', followers: 2431, postCount: 214 });
    expect(ig.fields.bio).toMatch(/^Oil painter\. Pittsburgh\./);
    expect(ig.fields.photoUrl).toMatch(/^https:\/\//);
    expect(ig.confidence.workingName).toBe(0.5);
    expect(ig.notes).toEqual([]);
    const site = await ds.importProfile(viewer, 'http://mara-oyelaran.com/');
    expect(site.fields).toMatchObject({ workingName: 'Mara Oyelaran', city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States' });
    expect(site.confidence.workingName).toBe(1);
    expect(site.fields.links?.map((l) => l.platform)).toEqual(['instagram', 'linkedin']);
    // Nothing is written to the profile by an import.
    expect((await ds.getMyArtist(viewer))?.bio).toBe('');
  });

  it('falls back to the handle for any other link, with a plain note', async () => {
    const ds = make();
    const r = await ds.importProfile(mara, 'https://www.linkedin.com/in/someone-new');
    expect(r.fields).toEqual({ workingName: 'Someone New' });
    expect(r.confidence.workingName).toBe(0.3);
    expect(r.notes.join(' ')).toMatch(/demo cannot read live pages/);
    expect(r.notes.join(' ')).toMatch(/handle/);
    // Reading a page is not a profile change, so nothing is audited until recordImport.
    expect((await ds.listAudit(admin)).filter((e) => e.action === 'artist.import')).toHaveLength(0);
  });

  it('refuses private addresses and nonsense, and visitors', async () => {
    const ds = make();
    await expect(ds.importProfile(mara, 'http://localhost')).rejects.toMatchObject({ code: 'validation', field: 'url' });
    await expect(ds.importProfile(mara, 'https://192.168.1.4/me')).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.importProfile(mara, 'nope')).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.importProfile(visitor, '@mara.paints')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('recordImport', () => {
  it('appends to the owner’s import trail, normalising the source', async () => {
    const ds = make();
    const { viewer } = await ds.signUpArtist(signUp);
    const imp = await ds.importProfile(viewer, '@mara.paints');
    await ds.recordImport(viewer, { source: imp.source, fetchedAt: imp.fetchedAt, appliedFields: ['workingName', 'bio'], notes: imp.notes });
    const v = await ds.recordImport(viewer, { source: { label: 'x', url: 'mara-oyelaran.com' }, fetchedAt: imp.fetchedAt, appliedFields: ['city'], notes: [] });
    expect(v.imports).toHaveLength(2);
    expect(v.imports![1]!.source).toMatchObject({ url: 'https://mara-oyelaran.com', platform: 'website', verification: 'claimed' });
    await expect(ds.recordImport(viewer, { ...v.imports![0]!, appliedFields: ['status' as never] })).rejects.toBeInstanceOf(ValidationError);
    await expect(ds.recordImport(admin, v.imports![0]!)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('checkMyLinks', () => {
  it('verifies a sample page that carries the code, fails one that does not, and marks unknown links unreachable', async () => {
    const ds = make();
    await ds.updateMyArtist(mara, {
      links: [...ds._raw().artists.find((a) => a.id === 'art_mara')!.links, { label: 'Shop', url: 'https://shop.example.org/mara' }],
    });
    const links = await ds.checkMyLinks(mara);
    const by = Object.fromEntries(links.map((l) => [l.handle, l]));
    expect(by['@mara.paints']).toMatchObject({ verification: 'verified', checkedAt: new Date(T).toISOString() });
    expect(by['mara-oyelaran.com']?.verification).toBe('failed');
    expect(by['shop.example.org']).toMatchObject({ verification: 'unreachable', checkedAt: new Date(T).toISOString() });
    const audit = (await ds.listAudit(admin)).find((e) => e.action === 'artist.links')!;
    expect(audit.meta).toEqual({ links: 3, verified: 1, failed: 1, unreachable: 1 });
  });

  it('a new artist who added Mara’s link does not get it verified (wrong code)', async () => {
    const ds = make();
    const { viewer } = await ds.signUpArtist(signUp);
    await ds.updateMyArtist(viewer, { links: [{ label: 'Instagram', url: 'https://www.instagram.com/mara.paints' }] });
    expect((await ds.checkMyLinks(viewer))[0]?.verification).toBe('failed');
  });

  it('admin may check any artist; artists only their own; the client cannot claim verified', async () => {
    const ds = make();
    const links = await ds.checkMyLinks(admin, 'art_priya');
    expect(links.map((l) => l.verification)).toEqual(['verified', 'unreachable']);
    await expect(ds.checkMyLinks(mara, 'art_priya')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.checkMyLinks(visitor)).rejects.toBeInstanceOf(ForbiddenError);
    const v = await ds.updateMyArtist(mara, { links: [{ label: 'Mine', url: 'https://not-checked.example.net', verification: 'verified' }] });
    expect(v.links[0]).toMatchObject({ verification: 'claimed', platform: 'website', handle: 'not-checked.example.net' });
  });

  it('keeps a verified link verified when the artist saves the profile without changing it', async () => {
    const ds = make();
    const before = ds._raw().artists.find((a) => a.id === 'art_mara')!.links;
    // ProfileEditor sends only label + url.
    const v = await ds.updateMyArtist(mara, { links: before.map((l) => ({ label: l.label, url: l.url })) });
    expect(v.links.find((l) => l.platform === 'instagram')?.verification).toBe('verified');
  });
});

describe('projection of the intake fields', () => {
  const leaks = (o: unknown) => /verificationToken|"imports"|"verification"|"checkedAt"|kofi-[a-z0-9]{6}/.test(JSON.stringify(o));

  it('visitors and curators never see the code, the import trail or link verification', async () => {
    const ds = make();
    for (const v of [visitor, lena]) {
      const list = await ds.listArtists(v);
      expect(list.length).toBeGreaterThan(0);
      expect(leaks(list)).toBe(false);
      const one = (await ds.getArtist(v, 'art_mara'))!;
      expect(leaks(one)).toBe(false);
      expect(one.links.map((l) => Object.keys(l).sort())).toEqual([
        ['handle', 'label', 'platform', 'url'],
        ['handle', 'label', 'platform', 'url'],
      ]);
    }
    // Another artist is not the owner either.
    expect(leaks(await ds.getArtist({ role: 'artist', userId: 'user_june', artistId: 'art_june' }, 'art_mara'))).toBe(false);
  });

  it('the owner and Kofi admins do', async () => {
    const ds = make();
    const mine = (await ds.getMyArtist(mara))!;
    expect(mine.verificationToken).toBe(SEED_TOKENS.art_mara);
    expect(mine.imports?.length).toBeGreaterThan(0);
    expect(mine.links.find((l) => l.platform === 'instagram')?.verification).toBe('verified');
    const rows = await ds.listAllArtists(admin);
    const priya = rows.find((r) => r.id === 'art_priya')!;
    expect(priya.verificationToken).toBe(SEED_TOKENS.art_priya);
    expect(priya.imports).toHaveLength(2);
    expect(priya.links.map((l) => l.verification)).toEqual(['claimed', 'unreachable']);
    expect((await ds.getArtist(admin, 'art_mara'))?.verificationToken).toBe(SEED_TOKENS.art_mara);
  });

  it('seed: every artist has a code and typed links; Mara’s Instagram page carries her code', () => {
    const s = buildSeed();
    for (const a of s.artists) {
      expect(a.verificationToken).toMatch(TOKEN_RE);
      for (const l of a.links) expect(l.platform && l.handle && l.verification).toBeTruthy();
    }
    expect(new Set(s.artists.map((a) => a.verificationToken)).size).toBe(s.artists.length);
    expect(fixtureFor('instagram.com/mara.paints')?.pageText).toContain(SEED_TOKENS.art_mara);
    expect(fixtureFor('https://www.mara-oyelaran.com')?.pageText).not.toContain(SEED_TOKENS.art_mara);
  });
});

describe('migration from a v4 device', () => {
  function v4State(): Partial<MockState> {
    const s = buildSeed() as Partial<MockState>;
    delete s.accounts;
    const v4Links: Record<string, { label: string; url: string }[]> = {
      art_mara: [
        { label: 'Website', url: 'https://example.com/mara' },
        { label: 'Instagram', url: 'https://instagram.com/example_mara' },
      ],
      art_tobias: [{ label: 'Website', url: 'https://example.com/tobias' }],
      art_june: [{ label: 'Instagram', url: 'https://instagram.com/example_june' }],
      art_deshawn: [],
      // Priya edited her links on this device.
      art_priya: [{ label: 'My shop', url: 'https://shop.example.org/priya' }],
    };
    for (const a of s.artists!) {
      delete a.verificationToken;
      delete a.imports;
      a.links = v4Links[a.id]!;
    }
    const user = JSON.parse(JSON.stringify(s.artists![0]!)) as MockState['artists'][number];
    Object.assign(user, { id: 'art_local', userId: 'user_local', workingName: 'Local Artist', links: [{ label: 'Site', url: 'https://local.example.org/' }] });
    s.artists!.push(user);
    s.artworks!.push({ ...s.artworks![0]!, id: 'aw_local', artistId: 'art_local', title: 'Kept' });
    return JSON.parse(JSON.stringify(s)) as Partial<MockState>;
  }

  it('adds codes, typed links and the sign-up list, and keeps the user’s rows', () => {
    const out = migrateState(v4State());
    expect(out.accounts).toEqual([]);
    const by = Object.fromEntries(out.artists.map((a) => [a.id, a]));
    expect(by.art_mara!.verificationToken).toBe(SEED_TOKENS.art_mara);
    expect(by.art_mara!.links.map((l) => l.url)).toEqual(['https://www.mara-oyelaran.com', 'https://www.instagram.com/mara.paints']);
    expect(by.art_priya!.links).toEqual([{ label: 'My shop', url: 'https://shop.example.org/priya', platform: 'website', handle: 'shop.example.org', verification: 'claimed' }]);
    expect(by.art_priya!.imports).toEqual([]);
    expect(by.art_local!.verificationToken).toMatch(TOKEN_RE);
    expect(by.art_local!.links[0]).toMatchObject({ url: 'https://local.example.org/', platform: 'website', verification: 'claimed' });
    expect(new Set(out.artists.map((a) => a.verificationToken)).size).toBe(out.artists.length);
    expect(out.artworks.some((w) => w.id === 'aw_local' && w.title === 'Kept')).toBe(true);
    // Idempotent.
    expect(migrateState(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });

  it('a v4 device loads, and its artists can check links', async () => {
    localStorage.clear();
    localStorage.setItem('kofi.mock.state.v1', JSON.stringify(v4State()));
    const ds = make(true);
    expect((await ds.getMyArtist(mara))?.verificationToken).toBe(SEED_TOKENS.art_mara);
    expect((await ds.checkMyLinks(mara)).find((l) => l.platform === 'instagram')?.verification).toBe('verified');
    localStorage.clear();
  });
});

describe('a new artist goes end to end', () => {
  it('sign up → profile → work → send → approved → listed for the public', async () => {
    const ds = make();
    const { viewer } = await ds.signUpArtist(signUp);
    const imp = await ds.importProfile(viewer, 'https://www.mara-oyelaran.com');
    await ds.updateMyArtist(viewer, {
      workingName: 'Flow Tester',
      bio: 'Paints the river at night, in thin glazes, from a studio above a bakery.',
      region: { city: imp.fields.city!, region: imp.fields.region!, country: imp.fields.country!, precision: 'region' },
      mediums: ['painting'],
      links: [{ label: 'Website', url: imp.source.url }],
      // The intake sets this when the artist sends the profile; sign-up starts private.
      visibility: 'public',
    });
    await ds.recordImport(viewer, { source: imp.source, fetchedAt: imp.fetchedAt, appliedFields: ['city', 'region', 'country'], notes: imp.notes });
    const work: ArtworkInput = {
      title: 'River, 2am',
      year: 2026,
      medium: 'painting',
      materials: ['oil on panel'],
      dimensions: { height: 30, width: 40, unit: 'cm' },
      description: '',
      images: [{ id: 'img_1', src: PNG, alt: 'A dark painting', isPrimary: true, metadataStripped: true }],
      status: 'available',
      rightsNote: '',
      priceVisibility: 'public',
      visibility: 'public',
      tags: [],
    };
    await ds.saveArtwork(viewer, work);
    await ds.checkMyLinks(viewer);
    expect((await ds.submitForReview(viewer)).status).toBe('pending');
    expect((await ds.listArtists(visitor)).some((a) => a.id === 'art_flow_tester')).toBe(false);
    const queue = (await ds.listAllArtists(admin)).find((a) => a.id === 'art_flow_tester')!;
    expect(queue).toMatchObject({ status: 'pending', artworkCount: 1 });
    expect(queue.imports?.[0]?.source.handle).toBe('mara-oyelaran.com');
    expect(queue.links[0]).toMatchObject({ verification: 'failed', checkedAt: new Date(T).toISOString() });
    await ds.setArtistStatus(admin, 'art_flow_tester', 'approved');
    const listed = (await ds.listArtists(visitor)).find((a) => a.id === 'art_flow_tester');
    expect(listed?.regionLabel).toBe('Pennsylvania, United States');
    expect(JSON.stringify(listed)).not.toMatch(/kofi-[a-z0-9]{6}|imports|verification/);
    expect((await ds.listArtworks(visitor)).some((w) => w.title === 'River, 2am')).toBe(true);
  });
});
