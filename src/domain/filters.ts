import type { ArtworkStatus, ArtworkView, CareerStage, Medium, Unit } from './types';
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
  /** Budget in the viewer's currency. Only applies to works whose price is visible. */
  budgetMax?: number;
  budgetMin?: number;
  /** When true, works whose price is withheld/undisclosed stay in results even with a budget set. */
  includeUndisclosedPrice?: boolean;
  years?: { from?: number; to?: number };
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
  return n;
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
    if (!a.price) {
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
