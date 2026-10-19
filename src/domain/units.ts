import type { Dimensions, Unit } from './types';

export const CM_PER_INCH = 2.54;

export function toUnit(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  return from === 'cm' ? value / CM_PER_INCH : value * CM_PER_INCH;
}

export function convertDimensions(d: Dimensions, to: Unit): Dimensions {
  const out: Dimensions = {
    height: round(toUnit(d.height, d.unit, to)),
    width: round(toUnit(d.width, d.unit, to)),
    unit: to,
  };
  if (d.depth !== undefined) out.depth = round(toUnit(d.depth, d.unit, to));
  return out;
}

export function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** "61 × 91.4 cm" or "24 × 36 × 2 in". Height first, the gallery convention. */
export function formatDimensions(d: Dimensions, unit: Unit = d.unit): string {
  const c = convertDimensions(d, unit);
  const parts = [c.height, c.width, ...(c.depth !== undefined ? [c.depth] : [])].map(fmtNum);
  return `${parts.join(' × ')} ${unit}`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

/** Longest edge in the given unit — what curators mean by "under 40 inches". */
export function longestEdge(d: Dimensions, unit: Unit): number {
  const c = convertDimensions(d, unit);
  return Math.max(c.height, c.width, c.depth ?? 0);
}

/** Face area (height × width) in square units — useful for "wall space" comparisons. */
export function faceArea(d: Dimensions, unit: Unit): number {
  const c = convertDimensions(d, unit);
  return c.height * c.width;
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
