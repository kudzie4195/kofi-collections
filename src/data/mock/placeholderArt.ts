import type { Medium } from '@/domain/types';

/**
 * Deterministic abstract "artwork" images as SVG data URLs so the demo ships
 * with zero external assets and is clearly fictional. Each medium gets its
 * own visual grammar so the gallery doesn't look like one wallpaper.
 *
 * Colours are the Kofi Noir brand set: gallery black and warm cream grounds,
 * brush strokes in the red / gold / green of the Ghana star.
 */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

const BLACK = '#0a0a0a';
const BLACK_2 = '#141414';
const CREAM = '#f3eee6';
const CREAM_2 = '#e9e2d6';
const DARK_GROUNDS = [BLACK, BLACK_2];
const LIGHT_GROUNDS = [CREAM, CREAM_2];

/** Brush palettes: each a subset of the brand strokes, so works vary but stay on-brand. */
const PALETTES = [
  ['#c8322b', '#e3b23c', '#7fa344'],
  ['#c8322b', '#a8261f', '#e3b23c'],
  ['#e3b23c', '#b98a1c', '#4f6a25'],
  ['#7fa344', '#4f6a25', '#c8322b'],
  ['#a8261f', '#e3b23c', '#4f6a25', '#f3eee6'],
  ['#c8322b', '#b98a1c', '#7fa344', '#0a0a0a'],
];

const f = (n: number) => n.toFixed(0);

export function placeholderArt(seed: string, medium: Medium, w = 800, h = 1000): string {
  const r = rng(hash(seed));
  const pal = PALETTES[hash(seed + medium) % PALETTES.length]!;
  const pick = () => pal[Math.floor(r() * pal.length)]!;
  const from = (xs: string[]) => xs[Math.floor(r() * xs.length)]!;
  const noiseSeed = hash(seed) % 997;
  const parts: string[] = [];
  let bg = from(DARK_GROUNDS);
  // rough, dry-brush edges for the hand-made mediums
  let filter = '';

  switch (medium) {
    case 'painting':
    case 'mixed media': {
      const light = r() < 0.35;
      bg = light ? from(LIGHT_GROUNDS) : from(DARK_GROUNDS);
      filter = `<filter id="brush" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.09" numOctaves="3" seed="${noiseSeed}"/><feDisplacementMap in="SourceGraphic" scale="26"/></filter>`;
      const strokes = pal.filter((c) => (light ? c !== CREAM : c !== BLACK));
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const sw = 320 + r() * 420;
        const sh = 46 + r() * 130;
        const cx = 80 + r() * (w - 160);
        const cy = 80 + r() * (h - 160);
        const rot = (r() - 0.5) * 50;
        const c = strokes[Math.floor(r() * strokes.length)]!;
        const op = (0.85 + r() * 0.1).toFixed(2);
        const x = cx - sw / 2;
        const y = cy - sh / 2;
        // the stroke, plus a few bristle streaks in the ground colour
        let streaks = '';
        for (let k = 0; k < 3; k++) {
          const sy = y + sh * (0.2 + r() * 0.6);
          streaks += `<line x1="${f(x + sw * 0.08)}" y1="${f(sy)}" x2="${f(x + sw * (0.55 + r() * 0.4))}" y2="${f(sy)}" stroke="${bg}" stroke-width="${f(2 + r() * 4)}" opacity="0.28" stroke-linecap="round"/>`;
        }
        parts.push(
          `<g transform="rotate(${rot.toFixed(1)} ${f(cx)} ${f(cy)})" opacity="${op}" filter="url(#brush)">` +
            `<rect x="${f(x)}" y="${f(y)}" width="${f(sw)}" height="${f(sh)}" rx="${f(sh / 2)}" fill="${c}"/>${streaks}</g>`,
        );
      }
      break;
    }
    case 'drawing':
    case 'printmaking': {
      bg = from(LIGHT_GROUNDS);
      filter = `<filter id="brush" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${noiseSeed}"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>`;
      const n = 10 + Math.floor(r() * 10);
      for (let i = 0; i < n; i++) {
        const x1 = r() * w;
        const y1 = r() * h;
        const x2 = x1 + (r() - 0.5) * 560;
        const y2 = y1 + (r() - 0.5) * 560;
        const qx = (x1 + x2) / 2 + (r() - 0.5) * 240;
        const qy = (y1 + y2) / 2 + (r() - 0.5) * 240;
        const c = r() < 0.78 ? BLACK : r() < 0.6 ? '#c8322b' : '#a8261f';
        parts.push(
          `<path d="M${f(x1)} ${f(y1)} Q${f(qx)} ${f(qy)} ${f(x2)} ${f(y2)}" fill="none" stroke="${c}" stroke-width="${f(2 + r() * (c === BLACK ? 10 : 22))}" stroke-linecap="round" opacity="0.92" filter="url(#brush)"/>`,
        );
      }
      break;
    }
    case 'sculpture':
    case 'ceramics':
    case 'installation': {
      bg = BLACK_2;
      // a pool of light on the plinth, so the object reads as photographed
      filter = `<radialGradient id="lit" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="${CREAM}" stop-opacity="0.12"/><stop offset="1" stop-color="${CREAM}" stop-opacity="0"/></radialGradient>`;
      parts.push(`<rect width="${w}" height="${h}" fill="url(#lit)"/>`);
      const blocks = ['#e3b23c', '#b98a1c', '#7fa344', '#4f6a25'];
      const floor = h - 110 - r() * 60;
      const axis = w * (0.35 + r() * 0.3);
      let y = floor;
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const bw = 200 + r() * 260;
        const bh = 120 + r() * 170;
        y -= bh;
        if (y < 60) break;
        const x = axis - bw / 2 + (r() - 0.5) * 60;
        parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(bh)}" rx="${f(r() * 18)}" fill="${from(blocks)}"/>`);
        y -= 6;
      }
      parts.push(`<rect x="0" y="${f(floor)}" width="${w}" height="2" fill="${CREAM}" opacity="0.35"/>`);
      parts.push(`<ellipse cx="${f(axis)}" cy="${f(floor + 26)}" rx="${f(220)}" ry="14" fill="${CREAM}" opacity="0.06"/>`);
      break;
    }
    case 'textile': {
      bg = BLACK;
      const threads = ['#c8322b', '#e3b23c', '#7fa344', '#4f6a25', '#a8261f'];
      let y = 0;
      while (y < h) {
        const bh = 14 + Math.floor(r() * 4) * 12;
        parts.push(`<rect x="0" y="${y}" width="${w}" height="${bh}" fill="${from(threads)}" opacity="0.9"/>`);
        y += bh + 8 + Math.floor(r() * 3) * 8;
      }
      for (let x = 0; x < w; x += 48 + Math.floor(r() * 3) * 16) {
        parts.push(`<rect x="${x}" y="0" width="${14 + Math.floor(r() * 2) * 10}" height="${h}" fill="${from(threads)}" opacity="0.5"/>`);
      }
      for (let x = 0; x < w; x += 6) parts.push(`<rect x="${x}" y="0" width="1" height="${h}" fill="${BLACK}" opacity="0.18"/>`);
      break;
    }
    case 'photography':
    case 'video': {
      const swap = r() < 0.4;
      const top = swap ? BLACK : from(LIGHT_GROUNDS);
      const bottom = swap ? from(LIGHT_GROUNDS) : BLACK_2;
      bg = top;
      const horizon = h * (0.42 + r() * 0.24);
      parts.push(`<rect x="0" y="${f(horizon)}" width="${w}" height="${f(h - horizon)}" fill="${bottom}"/>`);
      parts.push(`<circle cx="${f(w * (0.25 + r() * 0.5))}" cy="${f(horizon * (0.45 + r() * 0.3))}" r="${f(60 + r() * 110)}" fill="#c8322b"/>`);
      for (let i = 0; i < 28; i++) {
        parts.push(`<rect x="0" y="${f(r() * h)}" width="${w}" height="2" fill="${i % 2 ? BLACK : CREAM}" opacity="0.06"/>`);
      }
      break;
    }
    case 'digital':
      bg = BLACK;
      for (let gy = 0; gy < 10; gy++)
        for (let gx = 0; gx < 8; gx++) {
          if (r() > 0.45) continue;
          parts.push(`<rect x="${gx * 100 + 4}" y="${gy * 100 + 4}" width="92" height="92" fill="${pick()}" opacity="${(0.55 + r() * 0.4).toFixed(2)}"/>`);
        }
      break;
    case 'performance': {
      bg = from(DARK_GROUNDS);
      const n = 4 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const c = pick();
        parts.push(
          `<circle cx="${f(r() * w)}" cy="${f(r() * h)}" r="${f(40 + r() * 200)}" fill="none" stroke="${c === BLACK ? CREAM : c}" stroke-width="${f(8 + r() * 30)}" opacity="0.9"/>`,
        );
      }
      break;
    }
  }

  const light = LIGHT_GROUNDS.includes(bg);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    (filter ? `<defs>${filter}</defs>` : '') +
    `<rect width="${w}" height="${h}" fill="${bg}"/>${parts.join('')}` +
    `<text x="${w - 16}" y="${h - 16}" text-anchor="end" font-family="sans-serif" font-size="22" fill="${light ? BLACK : CREAM}" opacity="0.35">fictional sample</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
