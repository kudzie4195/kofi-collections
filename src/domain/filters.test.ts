import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/data/mock/seed';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { applyFilters, countActiveFilters, materialFacets, matchesFilters } from './filters';
import { convertDimensions, formatDimensions, longestEdge, toUnit } from './units';
import { artworksToCsv, parseCsv } from './export';
import type { Viewer } from './types';

const visitor: Viewer = { role: 'public' };
const curator: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_lena', curatorVerified: true };

describe('units', () => {
  it('converts cm ↔ in both ways', () => {
    expect(toUnit(2.54, 'cm', 'in')).toBeCloseTo(1);
    expect(toUnit(1, 'in', 'cm')).toBeCloseTo(2.54);
    expect(toUnit(10, 'cm', 'cm')).toBe(10);
  });
  it('formats dimensions in the requested unit, height first', () => {
    expect(formatDimensions({ height: 152, width: 122, depth: 4, unit: 'cm' })).toBe('152 × 122 × 4 cm');
    expect(formatDimensions({ height: 24, width: 36, unit: 'in' }, 'cm')).toBe('61 × 91.4 cm');
    expect(convertDimensions({ height: 24, width: 36, unit: 'in' }, 'cm').height).toBe(61);
  });
  it('longest edge accounts for depth and unit', () => {
    expect(longestEdge({ height: 110, width: 240, depth: 90, unit: 'cm' }, 'in')).toBeCloseTo(94.5, 1);
  });
});

describe('filters against seed data', () => {
  const ds = new MockDataSource({ persist: false });

  it('medium + size under 40 in returns only small paintings', async () => {
    const all = await ds.listArtworks(visitor);
    const out = applyFilters(all, { mediums: ['painting'], sizeUnit: 'in', maxLongestEdge: 40 });
    expect(out.map((a) => a.id)).toEqual(['aw_mara_2']); // 30 × 24 cm; Doubling is 152 cm (~60 in)
  });

  it('materials match any term, case-insensitive substring', async () => {
    const all = await ds.listArtworks(visitor);
    const ids = applyFilters(all, { materials: ['Stoneware'] }).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['aw_tobias_1', 'aw_tobias_2']));
    expect(ids).not.toContain('aw_mara_1');
  });

  it('budget filter excludes withheld prices unless asked to include them', async () => {
    const all = await ds.listArtworks(visitor);
    const strict = applyFilters(all, { budgetMax: 3000 });
    expect(strict.every((a) => a.price && a.price.amount <= 3000)).toBe(true);
    expect(strict.map((a) => a.id)).not.toContain('aw_mara_1'); // 9800, institutions-only → withheld for visitor
    const loose = applyFilters(all, { budgetMax: 3000, includeUndisclosedPrice: true });
    expect(loose.map((a) => a.id)).toContain('aw_mara_1');
    // Verified curator sees 9800 so it is now excluded by the number, not by withholding.
    const curatorAll = await ds.listArtworks(curator);
    expect(applyFilters(curatorAll, { budgetMax: 3000, includeUndisclosedPrice: true }).map((a) => a.id)).not.toContain('aw_mara_1');
  });

  it('career stage, experience and region filters', async () => {
    const all = await ds.listArtworks(visitor);
    expect(applyFilters(all, { careerStages: ['established'] }).every((a) => a.artistWorkingName === 'Tobias Reinholt')).toBe(true);
    expect(applyFilters(all, { publicArtExperience: true }).map((a) => a.artistWorkingName)).not.toContain('June Takahashi-Bell');
    expect(applyFilters(all, { region: 'ottawa' }).every((a) => a.artistWorkingName === 'June Takahashi-Bell')).toBe(true);
    // DeShawn chose country-level precision, so a city search must not find him.
    expect(applyFilters(all, { region: 'philadelphia' })).toHaveLength(0);
  });

  it('text query searches title, artist, materials and tags', async () => {
    const all = await ds.listArtworks(visitor);
    expect(applyFilters(all, { query: 'night' }).map((a) => a.id)).toEqual(expect.arrayContaining(['aw_mara_1', 'aw_deshawn_1', 'aw_deshawn_2']));
    expect(applyFilters(all, { query: 'oil on linen' }).map((a) => a.id)).toEqual(['aw_mara_1']);
  });

  it('sorting by size and price', async () => {
    const all = await ds.listArtworks(curator);
    const bySize = applyFilters(all, { sort: 'size-desc' });
    expect(bySize[0]!.id).toBe('aw_deshawn_2'); // 98 in ≈ 249 cm, the widest edge in the seed
    expect(bySize[1]!.id).toBe('aw_tobias_1'); // 240 cm
    const byPrice = applyFilters(all, { sort: 'price-asc' });
    expect(byPrice[0]!.price?.amount).toBe(900);
    expect(byPrice[byPrice.length - 1]!.price).toBeUndefined(); // no-price last
  });

  it('counts active filters and builds material facets', () => {
    expect(countActiveFilters({ mediums: ['painting'], maxLongestEdge: 40, query: ' ' })).toBe(2);
    const facets = materialFacets([
      { materials: ['oil on linen', 'oil on panel'] } as never,
      { materials: ['oil on panel'] } as never,
    ]);
    expect(facets[0]).toEqual({ name: 'oil on panel', count: 2 });
  });

  it('matchesFilters is a pure predicate', () => {
    const work = buildSeed().artworks[0]!;
    const view = { ...work, artistWorkingName: 'x', artistCareerStage: 'emerging', artistExperience: work ? { commissions: true, publicArt: false, residencies: false, institutionalShows: false } : undefined, artistRegionLabel: 'Pittsburgh, Pennsylvania', priceWithheld: false, canEdit: false } as never;
    expect(matchesFilters(view, { years: { from: 2025 } })).toBe(true);
    expect(matchesFilters(view, { years: { to: 2024 } })).toBe(false);
  });
});

describe('csv export round-trips', () => {
  it('escapes commas and quotes and parses back', () => {
    const works = buildSeed().artworks.slice(0, 3);
    works[0]!.description = 'Has, a comma and "quotes"\nand a newline';
    const csv = artworksToCsv(works);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4); // header + 3
    const header = rows[0]!;
    const descIdx = header.indexOf('description');
    expect(rows[1]![descIdx]).toBe('Has, a comma and "quotes"\nand a newline');
    expect(rows[1]![header.indexOf('dimensions_display')]).toBe('152 × 122 × 4 cm');
  });
});
