import { describe, expect, it } from 'vitest';
import { IMPORT_TEMPLATE_CSV, importArtworksCsv } from './importCsv';
import { artworksToCsv } from './export';
import { buildSeed } from '@/data/mock/seed';
import { MockDataSource } from '@/data/mock/MockDataSource';
import type { Viewer } from './types';

describe('reviewable CSV import', () => {
  it('parses the template into one ready row that becomes a private draft', () => {
    const r = importArtworksCsv(IMPORT_TEMPLATE_CSV);
    expect(r.missingColumns).toEqual([]);
    expect(r.ok).toBe(1);
    const input = r.rows[0]!.input!;
    expect(input.visibility).toBe('private');
    expect(input.images).toEqual([]);
    expect(input.materials).toEqual(['oil on linen', 'gesso']);
    expect(input.price).toEqual({ amount: 1200, currency: 'USD' });
    expect(input.priceVisibility).toBe('institutions');
  });

  it('round-trips the app export and reports problems per row without blocking the others', () => {
    const works = buildSeed().artworks.slice(0, 3);
    const csv = artworksToCsv(works);
    const broken = csv.replace('aw_mara_2,Small Weather No. 4,2024', 'aw_mara_2,Small Weather No. 4,18');
    const r = importArtworksCsv(broken);
    expect(r.rows).toHaveLength(3);
    expect(r.ok).toBe(2);
    const bad = r.rows.find((x) => !x.input)!;
    expect(bad.problems[0]).toMatch(/Year "18"/);
  });

  it('flags missing required columns and unknown mediums', () => {
    const r = importArtworksCsv('title,year\r\nX,2020\r\n');
    expect(r.missingColumns).toEqual(expect.arrayContaining(['medium', 'height', 'width', 'unit']));
    expect(r.ok).toBe(0);
    const r2 = importArtworksCsv('title,year,medium,materials,height,width,unit\r\nX,2020,oil,canvas,10,10,cm\r\n');
    expect(r2.rows[0]!.problems.join(' ')).toMatch(/Medium "oil"/);
  });

  it('imported rows save through the data layer as the artist’s own drafts', async () => {
    const ds = new MockDataSource({ persist: false });
    const june: Viewer = { role: 'artist', artistId: 'art_june', userId: 'user_june' };
    const r = importArtworksCsv(IMPORT_TEMPLATE_CSV);
    const saved = await ds.saveArtwork(june, r.rows[0]!.input!);
    expect(saved.artistId).toBe('art_june');
    expect(saved.visibility).toBe('private');
    expect((await ds.listArtworks({ role: 'public' })).some((a) => a.id === saved.id)).toBe(false);
  });
});
