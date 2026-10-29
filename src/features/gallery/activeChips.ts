/**
 * One removable chip per active filter value, for the bar above the Works grid.
 * Pure: each chip carries the filters you get when it is removed.
 */
import type { ArtworkFilters } from '@/domain/filters';
import { toggleTag } from '@/domain/filters';
import { categoryLabel, categoryOf, groupTagIds, tagLabel } from '@/domain/taxonomy';
import { EDITION_LABEL, ORIENTATION_LABEL, USE_LABEL } from '@/domain/types';
import { formatPrice } from '@/domain/units';
import { FILTER_COPY as C } from './filterCopy';
import { cap } from './helpers';
import { compact } from './params';

export interface ActiveChip {
  key: string;
  label: string;
  /** Accessible name of the remove button, e.g. "Remove filter: Abstract". */
  name: string;
  /** Filters with this one value removed. */
  without: ArtworkFilters;
  /** Tag chips carry their category so the bar can tint or group them. */
  category?: string;
}

function drop(f: ArtworkFilters, patch: Partial<ArtworkFilters>): ArtworkFilters {
  return compact({ ...f, ...patch });
}

function without<T>(xs: T[] | undefined, x: T): T[] | undefined {
  const next = (xs ?? []).filter((v) => v !== x);
  return next.length ? next : undefined;
}

export function activeChips(f: ArtworkFilters): ActiveChip[] {
  const out: Omit<ActiveChip, 'name'>[] = [];
  const unit = f.sizeUnit ?? 'cm';

  if (f.query?.trim()) out.push({ key: 'q', label: C.chipSearch(f.query.trim()), without: drop(f, { query: undefined }) });

  // Tags in library order, grouped by category.
  const grouped = groupTagIds(Object.values(f.tags ?? {}).flat());
  for (const ids of Object.values(grouped))
    for (const id of ids) out.push({ key: `tag:${id}`, label: tagLabel(id), without: toggleTag(f, id), category: categoryOf(id) });

  for (const m of f.mediums ?? []) out.push({ key: `medium:${m}`, label: cap(m), without: drop(f, { mediums: without(f.mediums, m) }) });
  for (const o of f.orientations ?? []) out.push({ key: `orient:${o}`, label: ORIENTATION_LABEL[o], without: drop(f, { orientations: without(f.orientations, o) }) });
  for (const e of f.editionTypes ?? []) out.push({ key: `edition:${e}`, label: EDITION_LABEL[e], without: drop(f, { editionTypes: without(f.editionTypes, e) }) });
  for (const u of f.uses ?? []) out.push({ key: `uses:${u}`, label: C.chipUse(USE_LABEL[u]), without: drop(f, { uses: without(f.uses, u) }) });
  for (const m of f.materials ?? []) out.push({ key: `material:${m}`, label: C.chipMaterial(m), without: drop(f, { materials: without(f.materials, m) }) });

  const { minLongestEdge: lo, maxLongestEdge: hi } = f;
  if (lo !== undefined || hi !== undefined) {
    const v = (n: number) => `${n} ${unit}`;
    const label = lo !== undefined && hi !== undefined ? C.chipSizeBetween(String(lo), v(hi)) : hi !== undefined ? C.chipSizeUnder(v(hi)) : C.chipSizeOver(v(lo!));
    out.push({ key: 'size', label, without: drop(f, { minLongestEdge: undefined, maxLongestEdge: undefined }) });
  }

  for (const s of f.statuses ?? []) out.push({ key: `status:${s}`, label: cap(s), without: drop(f, { statuses: without(f.statuses, s) }) });
  for (const s of f.careerStages ?? []) out.push({ key: `stage:${s}`, label: cap(s), without: drop(f, { careerStages: without(f.careerStages, s) }) });
  if (f.region?.trim()) out.push({ key: 'region', label: C.chipRegion(f.region.trim()), without: drop(f, { region: undefined }) });
  if (f.commissionsExperience) out.push({ key: 'commissions', label: C.chipCommissions, without: drop(f, { commissionsExperience: undefined }) });
  if (f.publicArtExperience) out.push({ key: 'publicart', label: C.chipPublicArt, without: drop(f, { publicArtExperience: undefined }) });

  const { budgetMin: bmin, budgetMax: bmax } = f;
  if (bmin !== undefined || bmax !== undefined) {
    const cur = f.budgetCurrency ?? 'USD';
    const p = (n: number) => formatPrice(n, cur);
    const label = bmin !== undefined && bmax !== undefined ? C.chipBudgetBetween(p(bmin), p(bmax)) : bmax !== undefined ? C.chipBudgetUnder(p(bmax)) : C.chipBudgetOver(p(bmin!));
    out.push({ key: 'budget', label, without: drop(f, { budgetMin: undefined, budgetMax: undefined, includeUndisclosedPrice: undefined }) });
  }

  const from = f.years?.from;
  const to = f.years?.to;
  if (from !== undefined || to !== undefined) {
    const label = from !== undefined && to !== undefined ? C.chipYearsBetween(from, to) : from !== undefined ? C.chipYearsFrom(from) : C.chipYearsTo(to!);
    out.push({ key: 'years', label, without: drop(f, { years: undefined }) });
  }

  // Same label in two groups (Subject "Identity", Theme "Identity"): name the group so the buttons differ.
  const seen = new Map<string, number>();
  for (const c of out) seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
  return out.map((c) => {
    const label = c.category && (seen.get(c.label) ?? 0) > 1 ? `${c.label} (${categoryLabel(c.category)})` : c.label;
    return { ...c, label, name: C.removeFilter(label) };
  });
}
