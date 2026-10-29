import { describe, expect, it } from 'vitest';
import { ARTIST_TAG_CATEGORIES, MAX_SOCIAL_IMPACT_TAGS, TAG_CATEGORY_DEFS, TAG_LIBRARY, WORKBOOK_REQUIREMENTS, categoryLabel, groupTagIds, mediumFromTagId, mediumTagId, normalizeTagIds, orientationOf, selectableTags, tagLabel } from './taxonomy';
import { MEDIUMS } from './types';

describe('tag library (from Kofi’s workbook)', () => {
  it('has the workbook’s 25 categories, 172 tags plus the two app additions, and 14 acceptance tests', () => {
    expect(TAG_CATEGORY_DEFS).toHaveLength(25);
    expect(TAG_LIBRARY.filter((t) => !t.appAddition)).toHaveLength(172);
    expect(TAG_LIBRARY.filter((t) => t.appAddition).map((t) => t.id)).toEqual(['medium.performance', 'medium.video']);
    expect(WORKBOOK_REQUIREMENTS).toHaveLength(14);
  });
  it('uses stable ids: every id is category.slug and unique', () => {
    const ids = TAG_LIBRARY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TAG_LIBRARY) expect(t.id.startsWith(t.category + '.')).toBe(true);
  });
  it('keeps Social Impact as artist-declared focus with the workbook’s definitions', () => {
    const si = selectableTags('social_impact');
    expect(si).toHaveLength(25);
    expect(si.find((t) => t.id === 'social_impact.youth_empowerment')?.definition).toBe('Art centers youth leadership, expression or agency.');
    expect(si.every((t) => t.artistSelectable)).toBe(true);
  });
  it('hides Phase 2/3 and non-selectable tags from artists', () => {
    expect(selectableTags('curatorial')).toEqual([]);
    expect(selectableTags('impact_evidence')).toEqual([]);
    expect(selectableTags('acquisition')).toEqual([]);
    for (const cat of ARTIST_TAG_CATEGORIES) expect(selectableTags(cat).length).toBeGreaterThan(0);
  });
  it('labels survive relabelling: unknown ids still render from the id', () => {
    expect(tagLabel('style.abstract')).toBe('Abstract');
    expect(tagLabel('style.neo_baroque')).toBe('Neo baroque');
    expect(categoryLabel('social_impact')).toBe('Social Impact');
  });
  it('maps every medium to a tag and back', () => {
    for (const m of MEDIUMS) {
      const id = mediumTagId(m);
      expect(TAG_LIBRARY.some((t) => t.id === id), id).toBe(true);
      expect(mediumFromTagId(id)).toBe(m);
    }
  });
});

describe('normalizeTagIds', () => {
  it('dedupes, drops unknown / hidden ids, mirrors the medium and keeps library order', () => {
    const r = normalizeTagIds(['theme.joy', 'style.abstract', 'style.abstract', 'curatorial.exhibition_ready', 'nope.x', 'acquisition.auction', ' theme.joy '], 'painting');
    expect(r.problem).toBeUndefined();
    expect(r.tagIds).toEqual(['medium.painting', 'style.abstract', 'theme.joy']);
  });
  it('caps a category, Social Impact lower', () => {
    const many = selectableTags('style').map((t) => t.id);
    expect(normalizeTagIds(many, 'drawing').problem).toMatchObject({ field: 'tags.style' });
    const si = selectableTags('social_impact').slice(0, MAX_SOCIAL_IMPACT_TAGS + 1).map((t) => t.id);
    expect(normalizeTagIds(si, 'drawing').problem?.message).toBe('Pick up to 4 social impact tags.');
    expect(normalizeTagIds(si.slice(0, 4), 'drawing').problem).toBeUndefined();
  });
  it('groups by category in library order', () => {
    expect(groupTagIds(['theme.joy', 'medium.painting', 'style.abstract'])).toEqual({ medium: ['medium.painting'], style: ['style.abstract'], theme: ['theme.joy'] });
  });
});

describe('orientationOf', () => {
  it('derives 2D orientation from the ratio and 3D from depth or medium', () => {
    expect(orientationOf({ height: 100, width: 60, unit: 'cm' }, 'painting')).toBe('portrait');
    expect(orientationOf({ height: 60, width: 100, unit: 'cm' }, 'painting')).toBe('landscape');
    expect(orientationOf({ height: 50, width: 51, unit: 'cm' }, 'painting')).toBe('square');
    expect(orientationOf({ height: 30, width: 90, unit: 'cm' }, 'photography')).toBe('panoramic');
    expect(orientationOf({ height: 30, width: 30, depth: 10, unit: 'cm' }, 'painting')).toBe('three_dimensional');
    // a stretcher bar is not a third dimension
    expect(orientationOf({ height: 152, width: 122, depth: 4, unit: 'cm' }, 'painting')).toBe('portrait');
    expect(orientationOf({ height: 30, width: 20, unit: 'cm' }, 'sculpture')).toBe('three_dimensional');
  });
});
