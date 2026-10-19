import { describe, expect, it } from 'vitest';
import { buildSeed, DEMO_IDENTITIES } from '@/data/mock/seed';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { ForbiddenError } from '@/data/DataSource';
import type { Viewer } from './types';
import { canSee, NEVER_LEAK_ARTIST_KEYS, projectArtist, projectArtwork, regionLabel } from './visibility';

const seed = buildSeed();
const mara = seed.artists.find((a) => a.id === 'art_mara')!;
const doubling = seed.artworks.find((a) => a.id === 'aw_mara_1')!; // price visible to institutions
const smallWeather = seed.artworks.find((a) => a.id === 'aw_mara_2')!; // price public
const bridgeStudy = seed.artworks.find((a) => a.id === 'aw_mara_3')!; // record visibility: kofi

const visitor: Viewer = { role: 'public' };
const verifiedCurator: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_lena', curatorVerified: true };
const pendingCurator: Viewer = { role: 'curator', curatorId: 'cur_owen', userId: 'user_owen', curatorVerified: false };
const owner: Viewer = { role: 'artist', artistId: 'art_mara', userId: 'user_mara' };
const otherArtist: Viewer = { role: 'artist', artistId: 'art_june', userId: 'user_june' };
const admin: Viewer = { role: 'admin', userId: 'user_quincy' };

describe('canSee — the one rule', () => {
  it.each([
    ['public', visitor, true],
    ['institutions', visitor, false],
    ['institutions', pendingCurator, false],
    ['institutions', verifiedCurator, true],
    ['kofi', verifiedCurator, false],
    ['kofi', admin, true],
    ['private', verifiedCurator, false],
    ['private', admin, true],
    ['private', otherArtist, false],
  ] as const)('%s for %o → %s', (level, viewer, expected) => {
    expect(canSee(level, viewer, 'art_mara')).toBe(expected);
  });
  it('owner sees everything on their own records', () => {
    expect(canSee('private', owner, 'art_mara')).toBe(true);
    expect(canSee('kofi', owner, 'art_mara')).toBe(true);
  });
});

describe('projectArtwork — field-level redaction', () => {
  it('hides an institution-only price from the public and flags it withheld', () => {
    const v = projectArtwork(doubling, mara, visitor)!;
    expect(v).toBeDefined();
    expect(v.price).toBeUndefined();
    expect(v.priceWithheld).toBe(true);
  });
  it('shows an institution-only price to a verified curator but not a pending one', () => {
    expect(projectArtwork(doubling, mara, verifiedCurator)!.price?.amount).toBe(9800);
    expect(projectArtwork(doubling, mara, pendingCurator)!.price).toBeUndefined();
  });
  it('shows a public price to everyone', () => {
    expect(projectArtwork(smallWeather, mara, visitor)!.price?.amount).toBe(1400);
  });
  it('hides a kofi-only record from visitors and curators, shows it to admin and owner', () => {
    expect(projectArtwork(bridgeStudy, mara, visitor)).toBeUndefined();
    expect(projectArtwork(bridgeStudy, mara, verifiedCurator)).toBeUndefined();
    expect(projectArtwork(bridgeStudy, mara, admin)).toBeDefined();
    expect(projectArtwork(bridgeStudy, mara, owner)).toBeDefined();
  });
  it('another artist cannot see my private work', () => {
    const priv = { ...doubling, visibility: 'private' as const };
    expect(projectArtwork(priv, mara, otherArtist)).toBeUndefined();
    expect(projectArtwork(priv, mara, owner)?.canEdit).toBe(true);
  });
  it('hides works of non-approved artists from the public', () => {
    const pending = { ...mara, status: 'pending' as const };
    expect(projectArtwork(smallWeather, pending, visitor)).toBeUndefined();
    expect(projectArtwork(smallWeather, pending, admin)).toBeDefined();
  });
  it('never includes owner contact or documents on a projection', () => {
    const v = projectArtwork(doubling, mara, verifiedCurator)! as unknown as Record<string, unknown>;
    expect(v).not.toHaveProperty('contact');
    expect(v).not.toHaveProperty('documents');
    expect(v).not.toHaveProperty('legalName');
  });
});

describe('projectArtist — private identity fields', () => {
  it('strips contact, legal name, staff notes and userId for non-owners', () => {
    for (const viewer of [visitor, verifiedCurator, otherArtist]) {
      const v = projectArtist(mara, viewer)! as unknown as Record<string, unknown>;
      for (const key of NEVER_LEAK_ARTIST_KEYS) expect(v, `${key} leaked to ${viewer.role}`).not.toHaveProperty(key);
    }
  });
  it('keeps contact for the owner, and staff notes only for admin', () => {
    expect(projectArtist(mara, owner)!.contact?.email).toBe('mara@example.com');
    expect(projectArtist(mara, owner)!.kofiNotes).toBeUndefined();
    expect(projectArtist(mara, admin)!.kofiNotes).toContain('Onboarded');
  });
  it('reduces region to the chosen precision', () => {
    expect(regionLabel({ city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', precision: 'city' })).toBe('Pittsburgh, Pennsylvania');
    expect(regionLabel({ city: 'Braddock', region: 'Pennsylvania', country: 'United States', precision: 'region' })).toBe('Pennsylvania, United States');
    expect(regionLabel({ city: 'Philadelphia', region: 'Pennsylvania', country: 'United States', precision: 'country' })).toBe('United States');
    expect(projectArtist(mara, visitor)!.region).toBeUndefined();
  });
});

describe('MockDataSource — server-equivalent enforcement', () => {
  const ds = () => new MockDataSource({ persist: false, now: () => new Date('2026-10-01T00:00:00Z') });

  it('does not trust the client’s curatorVerified flag', async () => {
    const d = ds();
    const spoofed: Viewer = { ...pendingCurator, curatorVerified: true };
    const v = await d.getArtwork(spoofed, 'aw_mara_1');
    expect(v?.price).toBeUndefined();
    expect(v?.priceWithheld).toBe(true);
  });

  it('the 10-minute demo: artist hides price → curator no longer sees it', async () => {
    const d = ds();
    expect((await d.getArtwork(verifiedCurator, 'aw_mara_1'))?.price?.amount).toBe(9800);
    const mine = await d.getArtwork(owner, 'aw_mara_1');
    const raw = d._raw().artworks.find((a) => a.id === 'aw_mara_1')!;
    await d.saveArtwork(owner, { ...raw, id: raw.id, priceVisibility: 'private' });
    expect(mine).toBeDefined();
    const after = await d.getArtwork(verifiedCurator, 'aw_mara_1');
    expect(after?.price).toBeUndefined();
    expect(after?.priceWithheld).toBe(true);
    const audit = await d.listAudit(admin);
    expect(audit.some((e) => e.action === 'artwork.visibility' && e.entityId === 'aw_mara_1')).toBe(true);
  });

  it('artist A cannot edit, delete or read documents of artist B', async () => {
    const d = ds();
    const raw = d._raw().artworks.find((a) => a.id === 'aw_mara_1')!;
    await expect(d.saveArtwork(otherArtist, { ...raw, id: raw.id, title: 'hijacked' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(d.deleteArtwork(otherArtist, 'aw_mara_1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(d.openDocument(otherArtist, 'doc_1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(d.openDocument(verifiedCurator, 'doc_1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(await d.listMyDocuments(otherArtist)).toHaveLength(0);
  });

  it('admin access to private documents is logged', async () => {
    const d = ds();
    await d.openDocument(admin, 'doc_2');
    const audit = await d.listAudit(admin);
    const ev = audit.find((e) => e.action === 'document.open' && e.entityId === 'doc_2');
    expect(ev?.actorRole).toBe('admin');
    expect(ev?.meta?.byOwner).toBe(false);
  });

  it('gallery listing never includes private or kofi-only records, or pending artists', async () => {
    const d = ds();
    const ids = (await d.listArtworks(visitor)).map((a) => a.id);
    expect(ids).not.toContain('aw_mara_3'); // kofi
    expect(ids).not.toContain('aw_june_3'); // private
    expect(ids).not.toContain('aw_priya_1'); // artist pending
    expect(ids).toContain('aw_mara_1');
    const curatorIds = (await d.listArtworks(verifiedCurator)).map((a) => a.id);
    expect(curatorIds).not.toContain('aw_mara_3');
  });

  it('curators can only shortlist and inquire about work they are authorized to see', async () => {
    const d = ds();
    const sl = await d.createShortlist(verifiedCurator, 'Test');
    await expect(d.addToShortlist(verifiedCurator, sl.id, 'aw_june_3')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(d.addToShortlist(verifiedCurator, sl.id, 'aw_mara_3')).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await d.addToShortlist(verifiedCurator, sl.id, 'aw_mara_1');
    expect(ok.items.map((i) => i.artworkId)).toContain('aw_mara_1');
    await expect(d.createInquiry(pendingCurator, { artistId: 'art_mara', message: 'We would like to discuss a loan for our show.' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('inquiries never expose artist contact, and artists only see forwarded ones', async () => {
    const d = ds();
    const curatorRows = await d.listInquiries(verifiedCurator);
    for (const r of curatorRows) expect(JSON.stringify(r)).not.toContain('mara@example.com');
    const artistRows = await d.listInquiries(owner);
    expect(artistRows.every((r) => r.status !== 'pending')).toBe(true);
    const tobias: Viewer = { role: 'artist', artistId: 'art_tobias', userId: 'user_tobias' };
    expect(await d.listInquiries(tobias)).toHaveLength(0); // inq_2 is still pending
  });

  it('export belongs to the artist and includes private fields for them only', async () => {
    const d = ds();
    const out = await d.exportMyData(owner);
    const bundle = JSON.parse(out.json) as { artist: { contact: { email: string } }; artworks: unknown[]; documents: { fileRef?: string }[] };
    expect(bundle.artist.contact.email).toBe('mara@example.com');
    expect(bundle.artworks).toHaveLength(3);
    expect(bundle.documents.every((doc) => doc.fileRef === undefined)).toBe(true);
    expect(out.csv.split('\r\n')[0]).toContain('title,year,medium');
    await expect(d.exportMyData(verifiedCurator)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('demo identities cover every role', async () => {
    const roles = new Set(DEMO_IDENTITIES.map((i) => i.viewer.role));
    expect([...roles].sort()).toEqual(['admin', 'artist', 'curator', 'public']);
  });
});
