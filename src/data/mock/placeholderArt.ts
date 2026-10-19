import type { Medium } from '@/domain/types';

/**
 * Deterministic abstract "artwork" images as SVG data URLs so the demo ships
 * with zero external assets and is clearly fictional. Each medium gets its
 * own visual grammar so the gallery doesn't look like one wallpaper.
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

const PALETTES = [
  ['#2436F5', '#FF5C39', '#CFFF4A', '#FFD23F', '#16122B'],
  ['#FF5C39', '#FFD23F', '#2436F5', '#F4F2FA', '#16122B'],
  ['#CFFF4A', '#16122B', '#2436F5', '#FF5C39', '#F4F2FA'],
  ['#FFD23F', '#2436F5', '#16122B', '#CFFF4A', '#FF5C39'],
  ['#16122B', '#F4F2FA', '#FF5C39', '#CFFF4A', '#2436F5'],
  ['#7B61FF', '#FF5C39', '#FFD23F', '#16122B', '#F4F2FA'],
  ['#0FA3B1', '#FFD23F', '#FF5C39', '#16122B', '#F4F2FA'],
];

export function placeholderArt(seed: string, medium: Medium, w = 800, h = 1000): string {
  const r = rng(hash(seed));
  const pal = PALETTES[hash(seed + medium) % PALETTES.length]!;
  const pick = () => pal[Math.floor(r() * pal.length)]!;
  const bg = pick();
  const parts: string[] = [];
  const n = 4 + Math.floor(r() * 6);

  switch (medium) {
    case 'painting':
    case 'mixed media':
      for (let i = 0; i < n; i++) {
        const cx = r() * w;
        const cy = r() * h;
        const rx = 60 + r() * 300;
        const ry = 40 + r() * 260;
        const rot = r() * 180;
        parts.push(
          `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${pick()}" transform="rotate(${rot.toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})" opacity="0.92"/>`,
        );
      }
      break;
    case 'drawing':
    case 'printmaking':
      for (let i = 0; i < n * 3; i++) {
        const x1 = r() * w;
        const y1 = r() * h;
        const x2 = x1 + (r() - 0.5) * 500;
        const y2 = y1 + (r() - 0.5) * 500;
        parts.push(
          `<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="${pick()}" stroke-width="${(4 + r() * 22).toFixed(0)}" stroke-linecap="round"/>`,
        );
      }
      break;
    case 'sculpture':
    case 'ceramics':
    case 'installation': {
      for (let i = 0; i < n; i++) {
        const x = r() * (w - 200);
        const y = r() * (h - 300);
        const bw = 80 + r() * 240;
        const bh = 120 + r() * 400;
        parts.push(
          `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" rx="${(r() * 60).toFixed(0)}" fill="${pick()}"/>`,
        );
      }
      parts.push(`<rect x="0" y="${h - 90}" width="${w}" height="90" fill="${pick()}" opacity="0.5"/>`);
      break;
    }
    case 'textile':
      for (let y = 0; y < h; y += 40) {
        parts.push(`<rect x="0" y="${y}" width="${w}" height="20" fill="${pick()}" opacity="0.85"/>`);
      }
      for (let x = 0; x < w; x += 50) {
        parts.push(`<rect x="${x}" y="0" width="22" height="${h}" fill="${pick()}" opacity="0.45"/>`);
      }
      break;
    case 'photography':
    case 'video': {
      const horizon = h * (0.4 + r() * 0.3);
      parts.push(`<rect x="0" y="0" width="${w}" height="${horizon.toFixed(0)}" fill="${pick()}"/>`);
      parts.push(`<rect x="0" y="${horizon.toFixed(0)}" width="${w}" height="${h}" fill="${pick()}"/>`);
      const sun = pick();
      parts.push(`<circle cx="${(r() * w).toFixed(0)}" cy="${(horizon * 0.5).toFixed(0)}" r="${(60 + r() * 120).toFixed(0)}" fill="${sun}"/>`);
      for (let i = 0; i < 24; i++) {
        parts.push(`<rect x="0" y="${(r() * h).toFixed(0)}" width="${w}" height="2" fill="#000" opacity="0.08"/>`);
      }
      break;
    }
    case 'digital':
      for (let gy = 0; gy < 10; gy++)
        for (let gx = 0; gx < 8; gx++) {
          if (r() > 0.55) continue;
          parts.push(`<rect x="${gx * 100}" y="${gy * 100}" width="100" height="100" fill="${pick()}"/>`);
        }
      break;
    case 'performance':
      for (let i = 0; i < n; i++) {
        const cx = r() * w;
        const cy = r() * h;
        parts.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(40 + r() * 200).toFixed(0)}" fill="none" stroke="${pick()}" stroke-width="${(8 + r() * 30).toFixed(0)}"/>`);
      }
      break;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>${parts.join('')}` +
    `<text x="${w - 16}" y="${h - 16}" text-anchor="end" font-family="sans-serif" font-size="22" fill="#000" opacity="0.35">fictional sample</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
