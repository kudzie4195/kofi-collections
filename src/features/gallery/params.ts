/**
 * Gallery filter state lives in the URL so back/forward, refresh and shared
 * links all reproduce the same view. This module only translates between
 * `ArtworkFilters` and query params; all matching is done by `applyFilters`.
 */
import type { ArtworkFilters, SortKey } from '@/domain/filters';
import { EMPTY_FILTERS, sizePreset } from '@/domain/filters';
import type { ArtworkStatus, CareerStage, Medium, Unit } from '@/domain/types';
import { ARTWORK_STATUSES, CAREER_STAGES, MEDIUMS } from '@/domain/types';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A to Z' },
  { value: 'size-asc', label: 'Smallest first' },
  { value: 'size-desc', label: 'Largest first' },
  { value: 'price-asc', label: 'Price, low to high' },
  { value: 'price-desc', label: 'Price, high to low' },
];
const SORT_KEYS = SORT_OPTIONS.map((o) => o.value);

const K = {
  query: 'q',
  medium: 'medium',
  material: 'material',
  unit: 'unit',
  max: 'max',
  min: 'min',
  status: 'status',
  stage: 'stage',
  region: 'region',
  commissions: 'commissions',
  publicArt: 'publicart',
  budgetMin: 'bmin',
  budgetMax: 'bmax',
  budgetCurrency: 'bcur',
  undisclosed: 'undisclosed',
  yearFrom: 'yfrom',
  yearTo: 'yto',
  sort: 'sort',
} as const;

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function oneOf<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const v of values) if ((allowed as readonly string[]).includes(v) && !out.includes(v as T)) out.push(v as T);
  return out;
}

export function filtersFromParams(sp: URLSearchParams): ArtworkFilters {
  const f: ArtworkFilters = { ...EMPTY_FILTERS };
  const q = sp.get(K.query);
  if (q) f.query = q;
  const mediums = oneOf<Medium>(sp.getAll(K.medium), MEDIUMS);
  if (mediums.length) f.mediums = mediums;
  const materials = sp
    .getAll(K.material)
    .map((m) => m.trim())
    .filter(Boolean);
  if (materials.length) f.materials = [...new Set(materials)];
  const unit = sp.get(K.unit);
  f.sizeUnit = unit === 'in' ? 'in' : 'cm';
  const max = num(sp.get(K.max));
  if (max !== undefined) f.maxLongestEdge = max;
  const min = num(sp.get(K.min));
  if (min !== undefined) f.minLongestEdge = min;
  const statuses = oneOf<ArtworkStatus>(sp.getAll(K.status), ARTWORK_STATUSES);
  if (statuses.length) f.statuses = statuses;
  const stages = oneOf<CareerStage>(sp.getAll(K.stage), CAREER_STAGES);
  if (stages.length) f.careerStages = stages;
  const region = sp.get(K.region);
  if (region) f.region = region;
  if (sp.get(K.commissions) === '1') f.commissionsExperience = true;
  if (sp.get(K.publicArt) === '1') f.publicArtExperience = true;
  const bmin = num(sp.get(K.budgetMin));
  if (bmin !== undefined) f.budgetMin = bmin;
  const bmax = num(sp.get(K.budgetMax));
  if (bmax !== undefined) f.budgetMax = bmax;
  const bcur = sp.get(K.budgetCurrency);
  if (bcur && /^[A-Z]{3}$/.test(bcur)) f.budgetCurrency = bcur;
  if (sp.get(K.undisclosed) === '1') f.includeUndisclosedPrice = true;
  const yfrom = num(sp.get(K.yearFrom));
  const yto = num(sp.get(K.yearTo));
  if (yfrom !== undefined || yto !== undefined) {
    f.years = {};
    if (yfrom !== undefined) f.years.from = yfrom;
    if (yto !== undefined) f.years.to = yto;
  }
  const sort = sp.get(K.sort);
  f.sort = sort && (SORT_KEYS as string[]).includes(sort) ? (sort as SortKey) : 'newest';
  return f;
}

export function paramsFromFilters(f: ArtworkFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.query?.trim()) sp.set(K.query, f.query);
  for (const m of f.mediums ?? []) sp.append(K.medium, m);
  for (const m of f.materials ?? []) if (m.trim()) sp.append(K.material, m.trim());
  if (f.sizeUnit === 'in') sp.set(K.unit, 'in');
  if (f.maxLongestEdge !== undefined) sp.set(K.max, String(f.maxLongestEdge));
  if (f.minLongestEdge !== undefined) sp.set(K.min, String(f.minLongestEdge));
  for (const s of f.statuses ?? []) sp.append(K.status, s);
  for (const s of f.careerStages ?? []) sp.append(K.stage, s);
  if (f.region?.trim()) sp.set(K.region, f.region);
  if (f.commissionsExperience) sp.set(K.commissions, '1');
  if (f.publicArtExperience) sp.set(K.publicArt, '1');
  if (f.budgetMin !== undefined) sp.set(K.budgetMin, String(f.budgetMin));
  if (f.budgetMax !== undefined) sp.set(K.budgetMax, String(f.budgetMax));
  if (f.budgetCurrency && f.budgetCurrency !== 'USD') sp.set(K.budgetCurrency, f.budgetCurrency);
  if (f.includeUndisclosedPrice) sp.set(K.undisclosed, '1');
  if (f.years?.from !== undefined) sp.set(K.yearFrom, String(f.years.from));
  if (f.years?.to !== undefined) sp.set(K.yearTo, String(f.years.to));
  if (f.sort && f.sort !== 'newest') sp.set(K.sort, f.sort);
  return sp;
}

/** Filters with everything cleared except the viewer's display choices (unit, sort). */
export function clearedFilters(f: ArtworkFilters): ArtworkFilters {
  return { ...EMPTY_FILTERS, sizeUnit: f.sizeUnit ?? 'cm', sort: f.sort ?? 'newest' };
}

/** Switch the size unit and carry any size bounds across so the filter means the same thing. */
export function withUnit(f: ArtworkFilters, to: Unit): ArtworkFilters {
  const from = f.sizeUnit ?? 'cm';
  if (from === to) return f;
  const next: ArtworkFilters = { ...f, sizeUnit: to };
  if (f.maxLongestEdge !== undefined) next.maxLongestEdge = sizePreset(f.maxLongestEdge, from, to);
  if (f.minLongestEdge !== undefined) next.minLongestEdge = sizePreset(f.minLongestEdge, from, to);
  return next;
}

/** Toggle a value in an optional list; returns undefined when the list empties. */
export function toggleIn<T>(list: T[] | undefined, value: T): T[] | undefined {
  const cur = list ?? [];
  const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  return next.length ? next : undefined;
}

/** Drop keys whose value is undefined so filter objects stay tidy. */
export function compact(f: ArtworkFilters): ArtworkFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined) out[k] = v;
  return out as ArtworkFilters;
}
