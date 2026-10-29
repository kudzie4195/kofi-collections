import type { ArtworkStatus, ArtworkView, CareerStage, EditionType, Medium, Orientation, Unit, UseKey } from './types';
import { FILTER_TAG_CATEGORIES, categoryOf } from './taxonomy';
import { longestEdge, toUnit } from './units';

export type SortKey = 'newest' | 'oldest' | 'title' | 'size-asc' | 'size-desc' | 'price-asc' | 'price-desc';

export interface ArtworkFilters {
  query?: string;
  mediums?: Medium[];
  /** Any-match on materials, case-insensitive substring. */
  materials?: string[];
  /** Size bounds apply to the longest edge, in `sizeUnit`. */
  sizeUnit?: Unit;
  maxLongestEdge?: number;
  minLongestEdge?: number;
  statuses?: ArtworkStatus[];
  careerStages?: CareerStage[];
  /** Case-insensitive substring on the artist's public region label. */
  region?: string;
  commissionsExperience?: boolean;
  publicArtExperience?: boolean;
  /** Budget bounds. Only applies to works whose price is visible and in `budgetCurrency`. */
  budgetMax?: number;
  budgetMin?: number;
  /** ISO 4217. Works priced in another currency count as undisclosed for the budget filter. Default USD. */
  budgetCurrency?: string;
  /** When true, works whose price is withheld/undisclosed stay in results even with a budget set. */
  includeUndisclosedPrice?: boolean;
  years?: { from?: number; to?: number };
  /**
   * Controlled tags, keyed by category id (workbook: "OR within a category; AND
   * between different categories"). Example: { style: ['style.abstract','style.minimalism'],
   * social_impact: ['social_impact.education_access'] } = (abstract OR minimalism) AND education.
   */
  tags?: Record<string, string[]>;
  orientations?: Orientation[];
  editionTypes?: EditionType[];
  /** The work must allow at least one of these uses. */
  uses?: UseKey[];
  sort?: SortKey;
}

export const EMPTY_FILTERS: ArtworkFilters = { sizeUnit: 'cm', sort: 'newest' };

export function countActiveFilters(f: ArtworkFilters): number {
  let n = 0;
  if (f.query?.trim()) n++;
  if (f.mediums?.length) n++;
  if (f.materials?.length) n++;
  if (f.maxLongestEdge !== undefined || f.minLongestEdge !== undefined) n++;
  if (f.statuses?.length) n++;
  if (f.careerStages?.length) n++;
  if (f.region?.trim()) n++;
  if (f.commissionsExperience) n++;
  if (f.publicArtExperience) n++;
  if (f.budgetMax !== undefined || f.budgetMin !== undefined) n++;
  if (f.years?.from !== undefined || f.years?.to !== undefined) n++;
  for (const list of Object.values(f.tags ?? {})) if (list.length) n++;
  if (f.orientations?.length) n++;
  if (f.editionTypes?.length) n++;
  if (f.uses?.length) n++;
  return n;
}

/** Every selected tag id, flat (for chips). */
export function selectedTagIds(f: ArtworkFilters): string[] {
  return Object.values(f.tags ?? {}).flat();
}

/** Toggle one tag id in the right category bucket; empty buckets are removed. */
export function toggleTag(f: ArtworkFilters, id: string): ArtworkFilters {
  const cat = categoryOf(id);
  const tags = { ...(f.tags ?? {}) };
  const list = tags[cat] ?? [];
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  if (next.length) tags[cat] = next;
  else delete tags[cat];
  const out: ArtworkFilters = { ...f };
  if (Object.keys(tags).length) out.tags = tags;
  else delete out.tags;
  return out;
}

/** OR within a category, AND across categories. Empty/unknown categories are ignored. */
export function matchesTags(tagIds: readonly string[], wanted: Record<string, string[]> | undefined): boolean {
  if (!wanted) return true;
  for (const [cat, list] of Object.entries(wanted)) {
    const ids = list.filter((id) => categoryOf(id) === cat);
    if (!ids.length) continue;
    if (!ids.some((id) => tagIds.includes(id))) return false;
  }
  return true;
}

/**
 * Facet counts for the filter UI: for each tag id, how many of `items` would match if
 * that tag were added to the current filters — so the counts respect AND across
 * categories but ignore the tag's own category (standard faceted-search behaviour).
 */
export function tagFacets(items: ArtworkView[], f: ArtworkFilters): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cat of FILTER_TAG_CATEGORIES) {
    const without: ArtworkFilters = { ...f, tags: { ...(f.tags ?? {}) } };
    delete without.tags![cat];
    const pool = items.filter((a) => matchesFilters(a, without));
    for (const a of pool) for (const id of a.tagIds) if (categoryOf(id) === cat) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function matchesFilters(a: ArtworkView, f: ArtworkFilters): boolean {
  const unit = f.sizeUnit ?? 'cm';

  if (f.query?.trim()) {
    const q = norm(f.query);
    const hay = [
      a.title,
      a.artistWorkingName,
      a.medium,
      a.description,
      ...a.materials,
      ...a.tags,
      ...a.tagIds.map((id) => id.split('.').pop()?.replace(/_/g, ' ') ?? ''),
      String(a.year),
    ]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }

  if (f.mediums?.length && !f.mediums.includes(a.medium)) return false;

  if (f.materials?.length) {
    const wanted = f.materials.map(norm).filter(Boolean);
    if (wanted.length) {
      const mats = a.materials.map(norm);
      const any = wanted.some((w) => mats.some((m) => m.includes(w)));
      if (!any) return false;
    }
  }

  if (f.maxLongestEdge !== undefined || f.minLongestEdge !== undefined) {
    const edge = longestEdge(a.dimensions, unit);
    if (f.maxLongestEdge !== undefined && edge > f.maxLongestEdge + 1e-9) return false;
    if (f.minLongestEdge !== undefined && edge < f.minLongestEdge - 1e-9) return false;
  }

  if (f.statuses?.length && !f.statuses.includes(a.status)) return false;
  if (f.careerStages?.length && !f.careerStages.includes(a.artistCareerStage)) return false;

  if (f.region?.trim() && !norm(a.artistRegionLabel).includes(norm(f.region))) return false;

  if (f.commissionsExperience && !a.artistExperience.commissions) return false;
  if (f.publicArtExperience && !a.artistExperience.publicArt) return false;

  if (f.budgetMax !== undefined || f.budgetMin !== undefined) {
    const cur = (f.budgetCurrency ?? 'USD').toUpperCase();
    if (!a.price || a.price.currency.toUpperCase() !== cur) {
      if (!f.includeUndisclosedPrice) return false;
    } else {
      if (f.budgetMax !== undefined && a.price.amount > f.budgetMax) return false;
      if (f.budgetMin !== undefined && a.price.amount < f.budgetMin) return false;
    }
  }

  if (f.years) {
    if (f.years.from !== undefined && a.year < f.years.from) return false;
    if (f.years.to !== undefined && a.year > f.years.to) return false;
  }

  if (!matchesTags(a.tagIds, f.tags)) return false;
  if (f.orientations?.length && !f.orientations.includes(a.orientation)) return false;
  if (f.editionTypes?.length && (!a.edition || !f.editionTypes.includes(a.edition.type))) return false;
  if (f.uses?.length && !f.uses.some((u) => a.uses[u])) return false;

  return true;
}

export function sortArtworks(items: ArtworkView[], sort: SortKey = 'newest'): ArtworkView[] {
  const arr = [...items];
  const edgeCm = (a: ArtworkView) => longestEdge(a.dimensions, 'cm');
  switch (sort) {
    case 'newest':
      return arr.sort((a, b) => b.year - a.year || b.createdAt.localeCompare(a.createdAt));
    case 'oldest':
      return arr.sort((a, b) => a.year - b.year || a.createdAt.localeCompare(b.createdAt));
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'size-asc':
      return arr.sort((a, b) => edgeCm(a) - edgeCm(b));
    case 'size-desc':
      return arr.sort((a, b) => edgeCm(b) - edgeCm(a));
    case 'price-asc':
      return arr.sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));
    case 'price-desc':
      return arr.sort((a, b) => (b.price?.amount ?? -Infinity) - (a.price?.amount ?? -Infinity));
  }
}

export function applyFilters(items: ArtworkView[], f: ArtworkFilters): ArtworkView[] {
  return sortArtworks(items.filter((a) => matchesFilters(a, f)), f.sort);
}

/** Distinct materials across a set of works, most common first. */
export function materialFacets(items: ArtworkView[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of items) for (const m of a.materials) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

/** Convenience: translate a size preset ("under 40 in") into the filter's unit. */
export function sizePreset(maxEdge: number, from: Unit, to: Unit): number {
  return Math.round(toUnit(maxEdge, from, to) * 10) / 10;
}
