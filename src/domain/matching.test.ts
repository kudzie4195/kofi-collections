import { describe, expect, it } from 'vitest';
import { effectiveCriteria, matchWork, rankWorks, validateCriteria } from './matching';
import { matchesTags, tagFacets, toggleTag, type ArtworkFilters } from './filters';
import type { ArtworkView } from './types';
import { NO_USES } from './types';

const base: ArtworkView = {
  id: 'w1', artistId: 'a1', artistWorkingName: 'Mara', artistCareerStage: 'mid-career',
  artistExperience: { commissions: false, publicArt: false, residencies: false, institutionalShows: false },
  artistRegionLabel: 'Pittsburgh, Pennsylvania', title: 'Doubling', year: 2026, medium: 'painting', materials: ['oil'],
  dimensions: { height: 120, width: 90, unit: 'cm' }, description: '', images: [], status: 'available', rightsNote: '',
  priceWithheld: false, tags: [], tagIds: ['medium.painting', 'style.abstract', 'theme.memory', 'social_impact.youth_empowerment'],
  uses: { ...NO_USES, auction: true }, orientation: 'portrait', locationLabel: 'Pittsburgh, Pennsylvania',
  visibility: 'public', priceVisibility: 'public', canEdit: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};
const w = (over: Partial<ArtworkView>): ArtworkView => ({ ...base, ...over });

describe('workbook search logic: OR within a category, AND across', () => {
  it('Painting OR Drawing plus Social Impact = Education Access filters correctly (workbook P0 test)', () => {
    const edu = w({ id: 'edu', tagIds: ['medium.drawing', 'social_impact.education_access'] });
    const paintNoEdu = w({ id: 'p', tagIds: ['medium.painting'] });
    const sculptEdu = w({ id: 's', tagIds: ['medium.sculpture', 'social_impact.education_access'] });
    const wanted = { medium: ['medium.painting', 'medium.drawing'], social_impact: ['social_impact.education_access'] };
    expect([edu, paintNoEdu, sculptEdu].filter((x) => matchesTags(x.tagIds, wanted)).map((x) => x.id)).toEqual(['edu']);
  });
  it('ignores empty buckets and ids filed under the wrong category', () => {
    expect(matchesTags(base.tagIds, { style: [], theme: ['style.abstract'] })).toBe(true);
    expect(matchesTags(base.tagIds, undefined)).toBe(true);
  });
  it('toggleTag adds, removes and drops empty buckets', () => {
    let f: ArtworkFilters = {};
    f = toggleTag(f, 'style.abstract');
    expect(f.tags).toEqual({ style: ['style.abstract'] });
    f = toggleTag(f, 'style.realism');
    f = toggleTag(f, 'style.abstract');
    expect(f.tags).toEqual({ style: ['style.realism'] });
    f = toggleTag(f, 'style.realism');
    expect(f.tags).toBeUndefined();
  });
  it('facet counts respect AND across categories but not the tag’s own category', () => {
    const items = [base, w({ id: 'w2', tagIds: ['medium.drawing', 'style.realism', 'theme.memory'] }), w({ id: 'w3', tagIds: ['medium.painting', 'style.realism'] })];
    const counts = tagFacets(items, { tags: { style: ['style.abstract'] } });
    // style counts ignore the active style filter: both styles are offered with their full counts
    expect(counts['style.abstract']).toBe(1);
    expect(counts['style.realism']).toBe(2);
    // theme counts respect the style filter (AND): only the abstract work has theme.memory
    expect(counts['theme.memory']).toBe(1);
    expect(counts['medium.drawing']).toBeUndefined();
  });
});

describe('matchWork: explainable, never about the artist', () => {
  it('counts asks met and explains each one in plain words', () => {
    const r = matchWork(base, { tags: { style: ['style.abstract', 'style.minimalism'], social_impact: ['social_impact.education_access'] }, uses: ['auction'], region: 'Pittsburgh', maxLongestEdgeCm: 100 });
    expect(r.of).toBe(5);
    expect(r.met).toBe(3);
    expect(r.fits).toBe(false);
    expect(r.reasons.map((x) => x.ok)).toEqual([true, false, true, true, false]);
    expect(r.reasons[0]!.text).toBe('Artistic Style: Abstract or Minimalism. This work is tagged Abstract.');
    expect(r.reasons[1]!.text).toMatch(/not tagged with any of these/);
    expect(r.reasons[2]!.text).toBe('Available for auction.');
    expect(r.reasons[4]!.text).toMatch(/outside up to 100 cm/);
  });
  it('a call that asks nothing fits every work; an auction call implies the auction use', () => {
    expect(matchWork(base, {})).toEqual({ met: 0, of: 0, fits: true, reasons: [] });
    const c = effectiveCriteria({ kind: 'auction', mediums: [], lookingFor: undefined });
    expect(c.uses).toEqual(['auction']);
    expect(matchWork(w({ uses: NO_USES }), c).fits).toBe(false);
    const m = effectiveCriteria({ kind: 'exhibition', mediums: ['mixed media', 'digital'], lookingFor: { tags: { theme: ['theme.joy'] } } });
    expect(m.tags?.medium).toEqual(['medium.mixed_media', 'medium.digital_art']);
    expect(m.uses).toEqual(['exhibition']);
  });
  it('ranks fits first, then most asks met, then newest', () => {
    const a = w({ id: 'a', tagIds: ['medium.painting'], createdAt: '2026-01-01T00:00:00Z' });
    const b = w({ id: 'b', createdAt: '2026-02-01T00:00:00Z' });
    const c = w({ id: 'c', tagIds: ['medium.painting', 'style.abstract'], uses: NO_USES, createdAt: '2026-03-01T00:00:00Z' });
    const ranked = rankWorks([a, b, c], { tags: { style: ['style.abstract'] }, uses: ['auction'] });
    expect(ranked.map((x) => x.work.id)).toEqual(['b', 'c', 'a']);
  });
  it('validates organiser criteria', () => {
    expect(validateCriteria({ tags: { style: ['theme.joy'] } })?.message).toMatch(/belong to its category/);
    expect(validateCriteria({ minLongestEdgeCm: 200, maxLongestEdgeCm: 100 })?.field).toBe('lookingFor.minLongestEdgeCm');
    expect(validateCriteria({ tags: { style: ['style.abstract'] }, uses: ['exhibition'], region: 'PA', maxLongestEdgeCm: 300 })).toBeUndefined();
  });
});
