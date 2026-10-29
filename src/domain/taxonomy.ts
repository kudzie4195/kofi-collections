/**
 * Controlled tag library — pure helpers over the generated data (taxonomy.data.ts,
 * built from Kofi's workbook). Rules from the workbook's START HERE sheet:
 *   · stable IDs are stored; labels may change without breaking search or history
 *   · a work may carry several tags per category
 *   · Social Impact classifies the artwork's stated focus, never a verified outcome,
 *     and never the artist's identity
 *   · artists select descriptive tags; curator assessments are separate and labelled
 */
import type { Dimensions, Medium, Orientation } from './types';
import { TAG_CATEGORY_DEFS, TAG_LIBRARY, type TagCategoryDef, type TagDef, type TaxonomyPhase } from './taxonomy.data';
import type { Problem } from './programme';

export { TAG_CATEGORY_DEFS, TAG_LIBRARY, SOCIAL_IMPACT_BOUNDARY, SOCIAL_IMPACT_NOTE, WORKBOOK_REQUIREMENTS } from './taxonomy.data';
export type { TagCategoryDef, TagDef, TaxonomyPhase } from './taxonomy.data';

const TAG_BY_ID = new Map<string, TagDef>(TAG_LIBRARY.map((t) => [t.id, t]));
const CAT_BY_ID = new Map<string, TagCategoryDef>(TAG_CATEGORY_DEFS.map((c) => [c.id, c]));

/** Categories an artist tags a work with, in the order they appear on the form. MVP only. */
export const ARTIST_TAG_CATEGORIES = ['medium', 'style', 'subject', 'theme', 'social_impact', 'material', 'palette', 'display_format'] as const;
export type ArtistTagCategory = (typeof ARTIST_TAG_CATEGORIES)[number];

/** Categories the Works filters expose, in UI order. Structured ones (size, price, year, orientation, edition, availability) are fields, not tags. */
export const FILTER_TAG_CATEGORIES: readonly ArtistTagCategory[] = ['medium', 'style', 'subject', 'theme', 'social_impact', 'material', 'palette', 'display_format'];

/** Most tags an artist may pick per category. Social Impact is capped lower: a focus, not a list. */
export const MAX_TAGS_PER_CATEGORY = 6;
export const MAX_SOCIAL_IMPACT_TAGS = 4;

export function tagDef(id: string): TagDef | undefined {
  return TAG_BY_ID.get(id);
}
export function categoryDef(id: string): TagCategoryDef | undefined {
  return CAT_BY_ID.get(id);
}
/** Display label for an id; unknown ids fall back to the id's last segment so old records still render. */
export function tagLabel(id: string): string {
  const t = TAG_BY_ID.get(id);
  if (t) return t.label;
  const tail = id.split('.').pop() ?? id;
  return tail.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
export function categoryLabel(id: string): string {
  return CAT_BY_ID.get(id)?.label ?? id;
}
export function categoryOf(id: string): string {
  return id.split('.')[0] ?? '';
}

/** Tags an artist may select in a category, MVP phase only. */
export function selectableTags(category: string): TagDef[] {
  return TAG_LIBRARY.filter((t) => t.category === category && t.artistSelectable && t.phase === 'mvp');
}
export function tagsInPhase(phase: TaxonomyPhase): TagDef[] {
  return TAG_LIBRARY.filter((t) => t.phase === phase);
}

/** Group ids by category, keeping library order within a category and dropping unknown ids. */
export function groupTagIds(ids: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of TAG_LIBRARY) {
    if (!ids.includes(t.id)) continue;
    (out[t.category] ??= []).push(t.id);
  }
  return out;
}

/* ---------------------------------------------------- medium ↔ tag id ---- */

const MEDIUM_TO_TAG: Record<Medium, string> = {
  painting: 'medium.painting',
  drawing: 'medium.drawing',
  printmaking: 'medium.printmaking',
  sculpture: 'medium.sculpture',
  ceramics: 'medium.ceramics',
  textile: 'medium.textile',
  photography: 'medium.photography',
  video: 'medium.video',
  installation: 'medium.installation',
  'mixed media': 'medium.mixed_media',
  digital: 'medium.digital_art',
  performance: 'medium.performance',
};
const TAG_TO_MEDIUM = new Map<string, Medium>(Object.entries(MEDIUM_TO_TAG).map(([m, id]) => [id, m as Medium]));

export function mediumTagId(m: Medium): string {
  return MEDIUM_TO_TAG[m];
}
export function mediumFromTagId(id: string): Medium | undefined {
  return TAG_TO_MEDIUM.get(id);
}

/* ------------------------------------------------------------ validation */

/**
 * Normalise a work's tag ids: dedupe, drop unknown/non-selectable/non-MVP ids,
 * mirror the primary medium, keep library order. Returns the problem that blocks
 * saving (too many in a category), else the clean list.
 */
export function normalizeTagIds(ids: readonly string[], medium: Medium): { tagIds: string[]; problem?: Problem } {
  const wanted = new Set<string>();
  for (const raw of ids) {
    const id = String(raw).trim();
    const t = TAG_BY_ID.get(id);
    if (!t || !t.artistSelectable || t.phase !== 'mvp') continue;
    if (!(ARTIST_TAG_CATEGORIES as readonly string[]).includes(t.category)) continue;
    wanted.add(id);
  }
  wanted.add(mediumTagId(medium));
  const tagIds = TAG_LIBRARY.filter((t) => wanted.has(t.id)).map((t) => t.id);
  const grouped = groupTagIds(tagIds);
  for (const [cat, list] of Object.entries(grouped)) {
    const cap = cat === 'social_impact' ? MAX_SOCIAL_IMPACT_TAGS : MAX_TAGS_PER_CATEGORY;
    if (list.length > cap) return { tagIds, problem: { field: `tags.${cat}`, message: `Pick up to ${cap} ${categoryLabel(cat).toLowerCase()} tags.` } };
  }
  return { tagIds };
}

/* -------------------------------------------------------------- derived */

const THREE_D_MEDIUMS: Medium[] = ['sculpture', 'ceramics', 'installation'];

/** Orientation from the stored dimensions (2D) or the medium/depth (3D). Pure; never stored. */
export function orientationOf(d: Dimensions, medium: Medium): Orientation {
  // A stretcher bar or a frame has depth; a painting is still 2D. Depth counts as 3D only
  // when it is a real third dimension: at least a fifth of the shorter face edge.
  const shorter = Math.min(d.height, d.width);
  const deep = d.depth !== undefined && d.depth > 0 && shorter > 0 && d.depth >= shorter / 5;
  if (THREE_D_MEDIUMS.includes(medium) || deep) return 'three_dimensional';
  const ratio = d.width / d.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return 'square';
  if (ratio >= 2) return 'panoramic';
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}
