/**
 * "View in a room" geometry — pure, unit-tested. Everything is in centimetres,
 * measured from the floor (y = 0) and the left edge of the wall view (x = 0).
 * The sheet draws this into an SVG whose viewBox is the wall view, so the bench,
 * the figure and the work are all at true relative scale.
 */
import type { Dimensions } from '@/domain/types';

export const CM_PER_IN = 2.54;
export const BENCH_W = 180;
export const BENCH_H = 45;
export const FIGURE_H = 170;
export const FIGURE_W = 46;
/** Museum hanging height: the centre of the work sits 145 cm above the floor. */
export const HANG_CENTRE = 145;
/** The default wall view: about a 4.2 m stretch of wall, 2.8 m to the ceiling line. */
export const VIEW_W = 420;
export const VIEW_H = 280;

const SIDE = 50; // breathing room at either edge of the view
const GAP = 45; // between the work (or bench) and the figure
const TOP = 30; // above the work's top edge

export function toCm(value: number, unit: Dimensions['unit']): number {
  return unit === 'in' ? value * CM_PER_IN : value;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomLayout {
  view: { w: number; h: number };
  work: Box;
  bench: Box;
  figure: Box;
  /** True when the view had to grow beyond the default wall to fit the work. */
  zoomedOut: boolean;
  /** Work size in whole centimetres (height, width). */
  heightCm: number;
  widthCm: number;
}

/**
 * Lay out a work of the given (height × width) on a wall with a 180 cm bench in
 * front of it and a 170 cm standing figure beside it. Depth is ignored: a 3D work
 * is shown by its front face (height × width).
 */
export function roomLayout(d: Pick<Dimensions, 'height' | 'width' | 'unit'>): RoomLayout {
  const h = Math.max(1, toCm(d.height, d.unit));
  const w = Math.max(1, toCm(d.width, d.unit));

  // Centre at 145 cm unless the work is so tall it would reach the floor; then it stands 10 cm off it.
  const centre = Math.max(HANG_CENTRE, h / 2 + 10);
  const groupW = Math.max(w, BENCH_W);
  const neededW = SIDE + groupW + GAP + FIGURE_W + SIDE;
  const neededH = centre + h / 2 + TOP;
  const viewW = Math.max(VIEW_W, neededW);
  const viewH = Math.max(VIEW_H, neededH);
  const zoomedOut = viewW > VIEW_W || viewH > VIEW_H;

  // Centre the work + figure group in the view.
  const left = (viewW - neededW) / 2 + SIDE;
  const groupCentre = left + groupW / 2;
  const work: Box = { x: groupCentre - w / 2, y: centre - h / 2, w, h };
  const bench: Box = { x: groupCentre - BENCH_W / 2, y: 0, w: BENCH_W, h: BENCH_H };
  const figure: Box = { x: left + groupW + GAP, y: 0, w: FIGURE_W, h: FIGURE_H };

  return { view: { w: viewW, h: viewH }, work, bench, figure, zoomedOut, heightCm: Math.round(h), widthCm: Math.round(w) };
}

/** "Bench 180 cm · figure 170 cm · work 152 × 122 cm" */
export function roomCaption(l: RoomLayout): string {
  return `Bench ${BENCH_W} cm · figure ${FIGURE_H} cm · work ${l.heightCm} × ${l.widthCm} cm`;
}
