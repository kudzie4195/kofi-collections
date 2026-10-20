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

/* ---------- objects photographed in a dark gallery (sculpture / ceramics / installation) ---------- */

/** Glazes and patinas: [highlight, body, shadow-side, accent run]. Brand colours only. */
const GLAZES = [
  ['#e3b23c', '#b98a1c', '#121212', '#4f6a25'], // honey ash
  ['#f3eee6', '#b98a1c', '#121212', '#b98a1c'], // shino, gold flashing
  ['#7fa344', '#4f6a25', '#0a0a0a', '#e3b23c'], // celadon ash
];
const PATINAS = [
  ['#7fa344', '#4f6a25', '#0a0a0a', '#e3b23c'], // verdigris bronze
  ['#e3b23c', '#b98a1c', '#0a0a0a', '#4f6a25'], // polished bronze
];

/** Symmetric thrown-vessel profile, base centred on (cx, by). */
function vesselPath(cx: number, by: number, H: number, rf: number, rb: number, hb: number, rn: number, hn: number, rl: number): string {
  const y = (t: number) => f(by - H * t);
  const R = (dx: number) => f(cx + dx);
  const L = (dx: number) => f(cx - dx);
  const m = hb + (hn - hb) * 0.6;
  const t = hn + (1 - hn) * 0.5;
  return (
    `M${L(rf)} ${f(by)}Q${f(cx)} ${f(by + rf * 0.12)} ${R(rf)} ${f(by)}` +
    `C${R(rb * 0.96)} ${f(by - 2)} ${R(rb)} ${y(hb * 0.4)} ${R(rb)} ${y(hb)}` +
    `C${R(rb)} ${y(m)} ${R(rn)} ${y(hn - 0.08)} ${R(rn)} ${y(hn)}` +
    `C${R(rn)} ${y(t)} ${R(rl)} ${y(0.98)} ${R(rl)} ${y(1)}` +
    `L${L(rl)} ${y(1)}` +
    `C${L(rl)} ${y(0.98)} ${L(rn)} ${y(t)} ${L(rn)} ${y(hn)}` +
    `C${L(rn)} ${y(hn - 0.08)} ${L(rb)} ${y(m)} ${L(rb)} ${y(hb)}` +
    `C${L(rb)} ${y(hb * 0.4)} ${L(rb * 0.96)} ${f(by - 2)} ${L(rf)} ${f(by)}Z`
  );
}

/** A cast or carved form: a rounded, slightly asymmetric squircle (flatter on top, where it bears weight). */
function stonePath(cx: number, cy: number, al: number, ar: number, bt: number, bb: number, kt: number, kb: number): string {
  return (
    `M${f(cx + ar)} ${f(cy)}C${f(cx + ar)} ${f(cy - bt * kt)} ${f(cx + ar * kt)} ${f(cy - bt)} ${f(cx)} ${f(cy - bt)}` +
    `C${f(cx - al * kt)} ${f(cy - bt)} ${f(cx - al)} ${f(cy - bt * kt)} ${f(cx - al)} ${f(cy)}` +
    `C${f(cx - al)} ${f(cy + bb * kb)} ${f(cx - al * kb)} ${f(cy + bb)} ${f(cx)} ${f(cy + bb)}` +
    `C${f(cx + ar * kb)} ${f(cy + bb)} ${f(cx + ar)} ${f(cy + bb * kb)} ${f(cx + ar)} ${f(cy)}Z`
  );
}

function objectScene(r: () => number, medium: Medium, w: number, h: number, noiseSeed: number): { defs: string; body: string } {
  const sculpt = medium === 'sculpture';
  const floor = Math.round(h * (0.74 + r() * 0.04));
  const cx = Math.round(w * (0.46 + r() * 0.08));
  const mat = sculpt ? PATINAS[Math.floor(r() * PATINAS.length)]! : GLAZES[Math.floor(r() * GLAZES.length)]!;
  const [hi, mid, lo, run] = mat as [string, string, string, string];
  const C = CREAM;

  // every form is defined once and drawn three times: turned body, specular pool, contact occlusion
  const shapes: string[] = [];
  const form = (d: string) => {
    const id = `p${shapes.length}`;
    shapes.push(`<path id="${id}" d="${d}"/>`);
    return { id, svg: ['sh', 'hl', 'oc'].map((g) => `<use href="#${id}" fill="url(#${g})"/>`).join('') };
  };

  let obj = '';
  let span = 160; // half-width of the footprint, for shadow + floor pool
  if (sculpt) {
    // a cairn of cast forms, each slightly off-axis, smallest on top
    const n = 3 + Math.floor(r() * 2);
    let y = floor;
    let bw = 300 + r() * 70;
    span = bw / 2;
    for (let i = 0; i < n; i++) {
      const bh = (i === 0 ? 130 : 80) + r() * 60;
      const x = cx + (r() - 0.5) * 36;
      const a = bw / 2;
      const d = stonePath(x, y - bh * 0.55, a * (0.92 + r() * 0.1), a * (0.92 + r() * 0.1), bh * 0.55, bh * 0.45, 0.82 + r() * 0.1, 0.7 + r() * 0.1);
      // worn high points of the patina catch the spot as polished metal
      const top = y - bh + 4;
      obj +=
        `<g transform="rotate(${((r() - 0.5) * 8).toFixed(1)} ${f(x)} ${f(y)})">${form(d).svg}` +
        `<path d="M${f(x - a * 0.55)} ${f(top + 12)}Q${f(x - a * 0.2)} ${f(top)} ${f(x + a * 0.15)} ${f(top + 4)}" fill="none" stroke="${run}" stroke-width="4" stroke-linecap="round" opacity=".6" filter="url(#blur)"/></g>`;
      y -= bh - 6;
      bw *= 0.66 + r() * 0.16;
      if (y < h * 0.3) break;
    }
  } else if (medium === 'installation') {
    // a loose crowd of vessels on the floor
    const n = 4 + Math.floor(r() * 3);
    span = 300;
    for (let i = 0; i < n; i++) {
      const vx = cx - 270 + (540 / (n - 1)) * i + (r() - 0.5) * 30;
      const by = floor - (i % 2) * 14;
      const H = 170 + r() * 190;
      const rb = 44 + r() * 30;
      obj += form(vesselPath(vx, by, H, rb * 0.5, rb, 0.3 + r() * 0.2, rb * 0.42, 0.78, rb * 0.55)).svg;
      obj += `<ellipse cx="${f(vx)}" cy="${f(by - H)}" rx="${f(rb * 0.55)}" ry="${f(rb * 0.13)}" fill="${BLACK}" stroke="${mid}" stroke-width="2"/>`;
    }
  } else {
    // one thrown vessel, leaning a little off true
    const H = 440 + r() * 120;
    const rb = 120 + r() * 50;
    const rl = rb * (0.42 + r() * 0.2);
    const lean = ((r() < 0.5 ? -1 : 1) * (3 + r() * 4)).toFixed(1);
    span = rb;
    const v = form(vesselPath(cx, floor, H, rb * 0.52, rb, 0.34 + r() * 0.16, rb * (0.3 + r() * 0.12), 0.8, rl));
    // glaze runs from the lip, stopping short of the raw foot
    let runs = '';
    const nr = 5 + Math.floor(r() * 4);
    for (let i = 0; i < nr; i++) {
      const rw = 4 + r() * 8;
      runs += `<rect x="${f(cx - rb + r() * rb * 2)}" y="${f(floor - H - 10)}" width="${f(rw)}" height="${f(H * (0.25 + r() * 0.4))}" rx="${f(rw / 2)}" fill="${run}" opacity="${(0.3 + r() * 0.3).toFixed(2)}"/>`;
    }
    const foot = floor - H * (0.1 + r() * 0.06);
    obj =
      `<g transform="rotate(${lean} ${f(cx)} ${f(floor)})">${v.svg}` +
      `<clipPath id="vc"><use href="#${v.id}"/></clipPath>` +
      `<g clip-path="url(#vc)"><g filter="url(#blur)">${runs}</g>` +
      `<path d="M${f(cx - rb - 20)} ${f(foot)}Q${f(cx)} ${f(foot + 18)} ${f(cx + rb + 20)} ${f(foot - 6)}V${floor + 30}H${f(cx - rb - 20)}Z" fill="${BLACK}" opacity=".45"/></g>` +
      `<ellipse cx="${f(cx)}" cy="${f(floor - H)}" rx="${f(rl)}" ry="${f(rl * 0.2)}" fill="${BLACK}" stroke="${mid}" stroke-width="3"/>` +
      `</g>`;
  }

  const defs =
    shapes.join('') +
    // wall light pool, floor sweep, spotlight cone
    `<radialGradient id="wl" cx="${f((cx / w) * 100)}%" cy="44%" r="62%"><stop offset="0" stop-color="${C}" stop-opacity=".1"/><stop offset=".55" stop-color="${C}" stop-opacity=".03"/><stop offset="1" stop-color="${C}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BLACK}" stop-opacity="0"/><stop offset=".12" stop-color="${BLACK}" stop-opacity=".5"/><stop offset="1" stop-color="${BLACK}" stop-opacity=".9"/></linearGradient>` +
    `<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C}" stop-opacity=".06"/><stop offset="1" stop-color="${C}" stop-opacity=".035"/></linearGradient>` +
    // turned body: shadow side, lit flank, a thin rim light on the far edge
    (sculpt
      ? // cast forms read as rounded masses: one radial fall-off from the lit shoulder
        `<radialGradient id="sh" cx=".38" cy=".3" r=".78"><stop offset="0" stop-color="${hi}"/><stop offset=".3" stop-color="${mid}"/><stop offset=".78" stop-color="${lo}"/><stop offset="1" stop-color="${mid}" stop-opacity=".5"/></radialGradient>`
      : `<linearGradient id="sh">${[0, 0.17, 0.36, 0.56, 0.9, 1].map((o, i) => `<stop offset="${o}" stop-color="${[lo, mid, hi, mid, lo, mid][i]}"${i === 5 ? ' stop-opacity=".55"' : ''}/>`).join('')}</linearGradient>`) +
    `<radialGradient id="hl" cx=".34" cy=".28" r=".36"><stop offset="0" stop-color="${C}" stop-opacity="${sculpt ? '.3' : '.4'}"/><stop offset="1" stop-color="${C}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="oc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BLACK}" stop-opacity="0"/><stop offset=".6" stop-color="${BLACK}" stop-opacity="${sculpt ? '.15' : '0'}"/><stop offset="1" stop-color="${BLACK}" stop-opacity=".7"/></linearGradient>` +
    `<linearGradient id="rf" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".3"/></linearGradient>` +
    `<mask id="rm" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#rf)"/></mask>` +
    // clay / cast texture: low-frequency wobble of the edge plus fine grog speckle
    `<filter id="clay" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="${sculpt ? '.011' : '.018'}" numOctaves="1" seed="${noiseSeed}" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="${sculpt ? 7 : 0}" result="d"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="${noiseSeed + 3}"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.3 0 0 0 -.8"/><feComposite in2="d" operator="in" result="s"/>` +
    `<feMerge><feMergeNode in="d"/><feMergeNode in="s"/></feMerge></filter>` +
    `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>` +
    `<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>`;

  const coneTop = cx - 40 + (r() - 0.5) * 60;
  const body =
    `<rect width="${w}" height="${h}" fill="url(#wl)"/>` +
    `<rect y="${floor - 40}" width="${w}" height="${h - floor + 40}" fill="url(#fl)"/>` +
    `<path d="M${f(coneTop)} -20h80L${f(cx + span + 170)} ${floor + 40}H${f(cx - span - 170)}Z" fill="url(#cone)" filter="url(#soft)"/>` +
    `<ellipse cx="${f(cx)}" cy="${floor + 10}" rx="${f(span + 160)}" ry="38" fill="${C}" opacity=".05" filter="url(#soft)"/>` +
    `<g id="ob" filter="url(#clay)">${obj}</g>` +
    `<use href="#ob" transform="matrix(1 0 0 -1 0 ${floor * 2 + 4})" mask="url(#rm)" opacity=".6"/>` +
    `<ellipse cx="${f(cx)}" cy="${floor + 2}" rx="${f(span * 1.05)}" ry="10" fill="${BLACK}" opacity=".8" filter="url(#blur)"/>`;
  return { defs, body };
}

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
      const scene = objectScene(r, medium, w, h, noiseSeed);
      filter = scene.defs;
      parts.push(scene.body);
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
  // single-quoted attributes + minimal escaping keeps each data URL small (~30% under encodeURIComponent)
  return `data:image/svg+xml;utf8,${svg.replace(/"/g, "'").replace(/[<>#%]/g, encodeURIComponent)}`;
}
