/**
 * Call ↔ work matching — pure and explainable. A call states what it is looking
 * for in the same tag language as works (CallCriteria); a work either fits each
 * ask or it doesn't, and the reasons are plain sentences a curator or artist can
 * read. No weights to tune, no inference about the artist: only what the artist
 * tagged, allowed and measured.
 *
 * Privacy rule (workbook): matching never uses artist identity, only artwork data
 * and the artist's own opt-in uses.
 */
import type { ArtworkView, CallCriteria, OpenCall } from './types';
import { USE_LABEL } from './types';
import { longestEdge } from './units';
import { categoryLabel, categoryOf, tagLabel } from './taxonomy';

export interface MatchReason {
  /** 'tags.style', 'uses', 'region', 'size' */
  ask: string;
  ok: boolean;
  /** "Style: abstract or minimalism — this work is abstract." */
  text: string;
}

export interface MatchResult {
  /** Asks met / asks made. 0/0 when the call asks nothing (every work fits). */
  met: number;
  of: number;
  /** True only when every ask is met. */
  fits: boolean;
  reasons: MatchReason[];
}

const join = (labels: string[]) => (labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`);

/** Criteria a call implies even when none are written: an auction call needs the auction use. */
export function effectiveCriteria(call: Pick<OpenCall, 'kind' | 'lookingFor' | 'mediums'>): CallCriteria {
  const c: CallCriteria = { ...(call.lookingFor ?? {}) };
  if (call.kind === 'auction' && !c.uses?.length) c.uses = ['auction'];
  if (call.kind === 'exhibition' && !c.uses?.length) c.uses = ['exhibition'];
  if (call.mediums.length && !c.tags?.medium?.length) {
    c.tags = { ...(c.tags ?? {}), medium: call.mediums.map((m) => `medium.${m === 'mixed media' ? 'mixed_media' : m === 'digital' ? 'digital_art' : m}`) };
  }
  return c;
}

export function matchWork(work: ArtworkView, criteria: CallCriteria): MatchResult {
  const reasons: MatchReason[] = [];
  for (const [cat, list] of Object.entries(criteria.tags ?? {})) {
    const ids = list.filter((id) => categoryOf(id) === cat);
    if (!ids.length) continue;
    const hit = ids.filter((id) => work.tagIds.includes(id));
    const ok = hit.length > 0;
    reasons.push({
      ask: `tags.${cat}`,
      ok,
      text: ok
        ? `${categoryLabel(cat)}: ${join(ids.map(tagLabel))}. This work is tagged ${join(hit.map(tagLabel))}.`
        : `${categoryLabel(cat)}: ${join(ids.map(tagLabel))}. This work is not tagged with any of these.`,
    });
  }
  if (criteria.uses?.length) {
    const okUses = criteria.uses.filter((u) => work.uses[u]);
    const ok = okUses.length > 0;
    reasons.push({
      ask: 'uses',
      ok,
      text: ok ? `Available for ${join(okUses.map((u) => USE_LABEL[u].toLowerCase()))}.` : `The artist has not allowed this work for ${join(criteria.uses.map((u) => USE_LABEL[u].toLowerCase()))}.`,
    });
  }
  if (criteria.region?.trim()) {
    const ok = work.locationLabel.toLowerCase().includes(criteria.region.trim().toLowerCase());
    reasons.push({ ask: 'region', ok, text: ok ? `In ${criteria.region.trim()}.` : `Not in ${criteria.region.trim()} (${work.locationLabel || 'location not given'}).` });
  }
  if (criteria.maxLongestEdgeCm !== undefined || criteria.minLongestEdgeCm !== undefined) {
    const edge = longestEdge(work.dimensions, 'cm');
    const ok = (criteria.maxLongestEdgeCm === undefined || edge <= criteria.maxLongestEdgeCm + 1e-9) && (criteria.minLongestEdgeCm === undefined || edge >= criteria.minLongestEdgeCm - 1e-9);
    const bound = criteria.maxLongestEdgeCm !== undefined && criteria.minLongestEdgeCm !== undefined ? `${criteria.minLongestEdgeCm}–${criteria.maxLongestEdgeCm} cm` : criteria.maxLongestEdgeCm !== undefined ? `up to ${criteria.maxLongestEdgeCm} cm` : `at least ${criteria.minLongestEdgeCm} cm`;
    reasons.push({ ask: 'size', ok, text: `${ok ? 'Longest edge' : 'Longest edge is'} ${Math.round(edge)} cm${ok ? '' : ','} ${ok ? 'within' : 'outside'} ${bound}.` });
  }
  const met = reasons.filter((r) => r.ok).length;
  return { met, of: reasons.length, fits: met === reasons.length, reasons };
}

/** Works that fit, best first (fits, then most asks met, then newest). Only works the viewer already may see are passed in. */
export function rankWorks(works: ArtworkView[], criteria: CallCriteria): { work: ArtworkView; match: MatchResult }[] {
  return works
    .map((work) => ({ work, match: matchWork(work, criteria) }))
    .sort((a, b) => Number(b.match.fits) - Number(a.match.fits) || b.match.met - a.match.met || b.work.createdAt.localeCompare(a.work.createdAt));
}

/** Validate criteria written by an organiser. */
export function validateCriteria(c: CallCriteria): { field: string; message: string } | undefined {
  for (const [cat, list] of Object.entries(c.tags ?? {})) {
    if (!Array.isArray(list)) return { field: 'lookingFor', message: 'Tags must be a list.' };
    if (list.some((id) => categoryOf(id) !== cat)) return { field: 'lookingFor', message: `Each tag must belong to its category (${cat}).` };
    if (list.length > 12) return { field: 'lookingFor', message: `Up to 12 ${categoryLabel(cat).toLowerCase()} tags.` };
  }
  if (c.region !== undefined && c.region.length > 80) return { field: 'lookingFor.region', message: 'Keep the region under 80 characters.' };
  for (const k of ['maxLongestEdgeCm', 'minLongestEdgeCm'] as const) {
    const v = c[k];
    if (v !== undefined && (!Number.isFinite(v) || v <= 0 || v > 100000)) return { field: `lookingFor.${k}`, message: 'Enter a size in centimetres.' };
  }
  if (c.minLongestEdgeCm !== undefined && c.maxLongestEdgeCm !== undefined && c.minLongestEdgeCm > c.maxLongestEdgeCm) return { field: 'lookingFor.minLongestEdgeCm', message: 'The smallest size cannot be above the largest.' };
  if ((c.note ?? '').length > 400) return { field: 'lookingFor.note', message: 'Keep the note under 400 characters.' };
  return undefined;
}

/** Matching must never read artist identity: the only artist-derived input is `locationLabel`, which the artist chose the precision of. */
export const MATCHING_INPUTS = ['tagIds', 'uses', 'locationLabel', 'dimensions'] as const;
