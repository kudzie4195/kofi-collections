import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { StorageFullError } from '@/data/DataSource';
import { applyFilters } from './filters';
import type { Viewer } from './types';

const admin: Viewer = { role: 'admin', userId: 'user_quincy' };
const priya: Viewer = { role: 'artist', artistId: 'art_priya', userId: 'user_priya' };
const mara: Viewer = { role: 'artist', artistId: 'art_mara', userId: 'user_mara' };
const lena: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_lena', curatorVerified: true };

describe('hardening — catches from independent review', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a spoofed curator claim (someone else’s curatorId) is treated as the public', async () => {
    const ds = new MockDataSource({ persist: false });
    const spoof: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_owen', curatorVerified: true };
    expect((await ds.getArtwork(spoof, 'aw_mara_1'))?.price).toBeUndefined();
    await expect(ds.listShortlists(spoof)).rejects.toThrow();
  });

  it('an artist cannot self-approve or write staff notes through a profile patch', async () => {
    const ds = new MockDataSource({ persist: false });
    await ds.updateMyArtist(priya, { bio: 'A long enough bio for the validation rule.', status: 'approved', kofiNotes: 'hacked' } as never);
    const raw = ds._raw().artists.find((a) => a.id === 'art_priya')!;
    expect(raw.status).toBe('pending');
    expect(raw.kofiNotes).not.toContain('hacked');
  });

  it('an artist cannot reassign a work to another artist or mark it reviewed', async () => {
    const ds = new MockDataSource({ persist: false });
    const raw = ds._raw().artworks.find((a) => a.id === 'aw_mara_2')!;
    await ds.saveArtwork(mara, { ...raw, id: raw.id, artistId: 'art_june', reviewedAt: '2030-01-01T00:00:00.000Z' } as never);
    const after = ds._raw().artworks.find((a) => a.id === 'aw_mara_2')!;
    expect(after.artistId).toBe('art_mara');
    expect(after.reviewedAt).toBe(raw.reviewedAt);
  });

  it('admin opening a pending or private artist profile is audited (silently, no loop)', async () => {
    const ds = new MockDataSource({ persist: false });
    let notified = 0;
    ds.subscribe(() => notified++);
    await ds.getArtist(admin, 'art_priya');
    await ds.getArtist(admin, 'art_mara'); // approved + public: no audit
    const audit = await ds.listAudit(admin);
    expect(audit.filter((e) => e.action === 'private.view' && e.entityType === 'artist').map((e) => e.entityId)).toEqual(['art_priya']);
    expect(notified).toBe(0);
  });

  it('budget filter compares in the chosen currency and treats other currencies as undisclosed', async () => {
    const ds = new MockDataSource({ persist: false });
    const all = await ds.listArtworks(lena);
    const usd = applyFilters(all, { budgetMax: 3000 });
    expect(usd.map((a) => a.id)).not.toContain('aw_june_1'); // CA$2,600 — not a USD price
    const cad = applyFilters(all, { budgetMax: 3000, budgetCurrency: 'CAD' });
    expect(cad.map((a) => a.id)).toEqual(expect.arrayContaining(['aw_june_1', 'aw_june_2']));
    expect(cad.every((a) => a.price?.currency === 'CAD')).toBe(true);
  });

  it('a full device store fails the save loudly and rolls back instead of toasting "Saved"', async () => {
    localStorage.clear();
    const ds = new MockDataSource({ persist: true });
    const before = (await ds.getArtwork(mara, 'aw_mara_2'))!.title;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const raw = ds._raw().artworks.find((a) => a.id === 'aw_mara_2')!;
    await expect(ds.saveArtwork(mara, { ...raw, id: raw.id, title: 'Will not fit' })).rejects.toBeInstanceOf(StorageFullError);
    setItem.mockRestore();
    expect((await ds.getArtwork(mara, 'aw_mara_2'))!.title).toBe(before);
    localStorage.clear();
  });
});
