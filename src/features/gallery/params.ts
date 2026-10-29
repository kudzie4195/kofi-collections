/**
 * Gallery filter state lives in the URL so back/forward, refresh and shared
 * links all reproduce the same view. This module only translates between
 * `ArtworkFilters` and query params; all matching is done by `applyFilters`.
 */
import type { ArtworkFilters, SortKey } from '@/domain/filters';
import { EMPTY_FILTERS, sizePreset } from '@/domain/filters';
import { FILTER_TAG_CATEGORIES, groupTagIds, mediumTagId, tagDef } from '@/domain/taxonomy';
import type { ArtworkView } from '@/domain/types';
import type { ArtworkStatus, CareerStage, EditionType, Medium, Orientation, Unit, UseKey } from '@/domain/types';
import { ARTWORK_STATUSES, CAREER_STAGES, EDITION_TYPES, MEDIUMS, ORIENTATIONS, USE_KEYS } from '@/domain/types';

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
  tags: 'tags',
  orient: 'orient',
  edition: 'edition',
  uses: 'uses',
  sort: 'sort',
} as const;

/** Comma lists (`tags=style.abstract,theme.joy`); repeated params are accepted too. */
function list(sp: URLSearchParams, key: string): string[] {
  return sp
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Only MVP, artist-selectable tags in a filter category may filter (workbook rule: Phase 2/3 tags never appear in filters). */
export function isFilterTag(id: string): boolean {
  const t = tagDef(id);
  return !!t && t.phase === 'mvp' && t.artistSelectable && (FILTER_TAG_CATEGORIES as readonly string[]).includes(t.category);
}

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
  // v6: medium is a tag group. Old links (`medium=painting`) still work and land on the same tag.
  const legacyMediums = oneOf<Medium>(sp.getAll(K.medium), MEDIUMS).map(mediumTagId);
  const tagIds = [...new Set([...legacyMediums, ...list(sp, K.tags).filter(isFilterTag)])];
  if (tagIds.length) f.tags = groupTagIds(tagIds);
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
  const orient = oneOf<Orientation>(list(sp, K.orient), ORIENTATIONS);
  if (orient.length) f.orientations = orient;
  const editions = oneOf<EditionType>(list(sp, K.edition), EDITION_TYPES);
  if (editions.length) f.editionTypes = editions;
  const uses = oneOf<UseKey>(list(sp, K.uses), USE_KEYS);
  if (uses.length) f.uses = uses;
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
  const tagIds = Object.values(groupTagIds(Object.values(f.tags ?? {}).flat())).flat();
  if (tagIds.length) sp.set(K.tags, tagIds.join(','));
  if (f.orientations?.length) sp.set(K.orient, f.orientations.join(','));
  if (f.editionTypes?.length) sp.set(K.edition, f.editionTypes.join(','));
  if (f.uses?.length) sp.set(K.uses, f.uses.join(','));
  if (f.sort && f.sort !== 'newest') sp.set(K.sort, f.sort);
  return sp;
}

/** The query string for `filters`, with commas left readable (`tags=style.abstract,theme.memory`). */
export function searchFromFilters(f: ArtworkFilters): string {
  return paramsFromFilters(f).toString().replace(/%2C/gi, ',');
}

/**
 * Every work carries its primary medium as a medium.* tag. Records saved before v6 may not
 * yet, so the gallery mirrors it on read and the Medium group always finds them.
 */
export function withMediumTag(w: ArtworkView): ArtworkView {
  const id = mediumTagId(w.medium);
  return w.tagIds.includes(id) ? w : { ...w, tagIds: [id, ...w.tagIds] };
}

/** Link to Works filtered by one tag (artwork page chips). */
export function worksTagHref(id: string): string {
  return `/works?${K.tags}=${encodeURIComponent(id)}`;
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
