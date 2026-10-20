import { describe, expect, it } from 'vitest';
import { BENCH_W, FIGURE_H, HANG_CENTRE, roomCaption, roomLayout, toCm, VIEW_H, VIEW_W } from './room';

describe('view in a room: scale', () => {
  it('converts inches to centimetres', () => {
    expect(toCm(10, 'in')).toBeCloseTo(25.4);
    expect(toCm(10, 'cm')).toBe(10);
  });

  it('hangs a 152 × 122 cm painting centred at 145 cm in the default wall view', () => {
    const l = roomLayout({ height: 152, width: 122, unit: 'cm' });
    expect(l.zoomedOut).toBe(false);
    expect(l.view).toEqual({ w: VIEW_W, h: VIEW_H });
    expect(l.work.h).toBe(152);
    expect(l.work.w).toBe(122);
    expect(l.work.y + l.work.h / 2).toBe(HANG_CENTRE);
    expect(l.bench.w).toBe(BENCH_W);
    expect(l.figure.h).toBe(FIGURE_H);
    // the bench sits under the work, the figure stands clear of both
    expect(l.bench.x + l.bench.w / 2).toBeCloseTo(l.work.x + l.work.w / 2);
    expect(l.figure.x).toBeGreaterThan(Math.max(l.work.x + l.work.w, l.bench.x + l.bench.w));
    expect(l.figure.x + l.figure.w).toBeLessThanOrEqual(l.view.w);
    expect(roomCaption(l)).toBe('Bench 180 cm · figure 170 cm · work 152 × 122 cm');
  });

  it('uses centimetres for works measured in inches', () => {
    const l = roomLayout({ height: 24, width: 36, unit: 'in' });
    expect(l.work.h).toBeCloseTo(60.96);
    expect(l.work.w).toBeCloseTo(91.44);
    expect(roomCaption(l)).toBe('Bench 180 cm · figure 170 cm · work 61 × 91 cm');
  });

  it('zooms out to fit a work wider than the wall view, keeping everything to scale', () => {
    const l = roomLayout({ height: 110, width: 240, unit: 'cm' });
    expect(l.zoomedOut).toBe(true);
    expect(l.view.w).toBeGreaterThan(VIEW_W);
    expect(l.work.x).toBeGreaterThan(0);
    expect(l.figure.x + l.figure.w).toBeLessThanOrEqual(l.view.w);
    expect(l.work.w).toBe(240);
  });

  it('a very tall work stands just off the floor and the view grows to its top', () => {
    const l = roomLayout({ height: 300, width: 100, unit: 'cm' });
    expect(l.work.y).toBe(10);
    expect(l.view.h).toBeGreaterThanOrEqual(l.work.y + l.work.h);
    expect(l.zoomedOut).toBe(true);
  });
});
