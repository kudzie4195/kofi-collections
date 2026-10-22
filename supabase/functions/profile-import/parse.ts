/**
 * Pure parts of the profile-import function. No Deno or network APIs here, so
 * the same file runs under `deno test` and inside the local PostgREST harness.
 *
 * normalizeLink / isFetchableUrl / verificationFromPage re-implement
 * src/domain/intake.ts (the app's rules) and are tested against the same cases
 * in parse_test.ts. Keep the two in step.
 */

export type LinkPlatform = 'instagram' | 'website' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'other';

export interface NormalizedLink {
  url: string;
  platform: LinkPlatform;
  handle: string;
  label: string;
}

/** Same shape as PageSignals in src/domain/intake.ts. */
export interface PageSignals {
  title?: string;
  ogTitle?: string;
  description?: string;
  ogDescription?: string;
  ogImage?: string;
  jsonLd?: {
    name?: string;
    description?: string;
    image?: string;
    address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
    sameAs?: string[];
  };
  links?: string[];
}

/* ------------------------------------------------------------------ links */

const PLATFORM_HOSTS: [RegExp, LinkPlatform][] = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'facebook'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
];
const HUB_HOSTS = /(^|\.)(linktr\.ee|beacons\.ai|carrd\.co|bio\.site|lnk\.bio)$/;

export function platformName(p: LinkPlatform): string {
  return { instagram: 'Instagram', website: 'Website', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', other: 'Link' }[p];
}

export function normalizeLink(raw: string, assumePlatform: LinkPlatform = 'instagram'): NormalizedLink | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  if (/^@[A-Za-z0-9._]{1,40}$/.test(s)) {
    const handle = s.slice(1);
    const base = assumePlatform === 'tiktok' ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}`;
    return normalizeLink(base, assumePlatform);
  }
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  if (!u.hostname.includes('.') || u.username || u.password) return undefined;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|igsh|igshid|ref)/i.test(k)) u.searchParams.delete(k);
  let platform: LinkPlatform = 'website';
  for (const [re, p] of PLATFORM_HOSTS) if (re.test(u.hostname)) platform = p;
  if (platform === 'website' && HUB_HOSTS.test(u.hostname)) platform = 'other';
  const path = u.pathname.replace(/\/+$/, '');
  u.pathname = path || '/';
  let handle = '';
  if (platform === 'instagram' || platform === 'facebook' || platform === 'tiktok') {
    const first = path.split('/').filter(Boolean)[0] ?? '';
    if (platform === 'instagram' && ['p', 'reel', 'reels', 'explore', 'stories', 'accounts'].includes(first)) return undefined;
    handle = first.replace(/^@/, '');
    if (!handle) return undefined;
    handle = '@' + handle;
  } else if (platform === 'linkedin') {
    const parts = path.split('/').filter(Boolean);
    if ((parts[0] !== 'in' && parts[0] !== 'company') || !parts[1]) return undefined;
    handle = parts[1];
  } else if (platform === 'youtube') {
    const first = path.split('/').filter(Boolean)[0] ?? '';
    handle = first.startsWith('@') ? first : u.hostname.replace(/^www\./, '');
  } else {
    handle = u.hostname.replace(/^www\./, '');
  }
  const url = u.toString().replace(/\/$/, '');
  const label = platform === 'website' || platform === 'other' ? handle : `${platformName(platform)} ${handle}`;
  return { url, platform, handle, label };
}

/* ---------------------------------------------------------------- SSRF */

/** isFetchableUrl() from src/domain/intake.ts: never a private / internal address. */
export function isFetchableUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return !isPrivateAddress(h);
  if (h.startsWith('[')) return false; // IPv6 literal
  return true;
}

/**
 * For resolved addresses (DNS answers), stricter than the literal check above:
 * also 100.64/10 (CGNAT), 198.18/15, multicast/reserved, and the IPv6 private,
 * link-local, loopback and IPv4-mapped forms.
 */
export function isPrivateAddress(ip: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::' || v6 === '::1') return true;
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return false;
}

/* -------------------------------------------------------- verification */

/** verificationFromPage() from src/domain/intake.ts. */
export function verificationFromPage(pageText: string, token: string, profileUrl?: string): 'verified' | 'failed' {
  const t = pageText.toLowerCase();
  if (token && t.includes(token.toLowerCase())) return 'verified';
  if (profileUrl && t.includes(profileUrl.toLowerCase().replace(/^https?:\/\//, ''))) return 'verified';
  return 'failed';
}

/** A profile URL the client may name for the link-back check: …/artists/<this artist's id>. */
export function profileUrlOk(profileUrl: unknown, artistId: string): profileUrl is string {
  if (typeof profileUrl !== 'string' || profileUrl.length > 300) return false;
  const m = /^https?:\/\/[^\s/]+(\/[^\s#?]*)?(#\/)?artists\/([0-9a-f-]{36})$/i.exec(profileUrl);
  return !!m && m[3]!.toLowerCase() === artistId.toLowerCase();
}

/* ---------------------------------------------------------------- HTML */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', middot: '·', bull: '•' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+[0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Attributes of one start tag: lower-cased names, entity-decoded values. */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<\s*[a-z0-9-]+/i, '').replace(/\/?>$/, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1]!.toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function tags(html: string, name: string): Record<string, string>[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
  return [...html.matchAll(re)].map((m) => parseAttrs(m[0]));
}

function absolute(href: string, base: string): string | undefined {
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clean(s: string | undefined, max = 600): string | undefined {
  if (s === undefined) return undefined;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

const SOCIAL_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linkedin\.com|tiktok\.com|youtube\.com|youtu\.be|linktr\.ee|beacons\.ai|bio\.site|lnk\.bio|carrd\.co)$/;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function typesOf(o: { [k: string]: Json }): string[] {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

function flattenLd(v: Json, out: { [k: string]: Json }[], depth = 0): void {
  if (depth > 4 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const x of v) flattenLd(x, out, depth + 1);
    return;
  }
  out.push(v);
  if (v['@graph']) flattenLd(v['@graph'], out, depth + 1);
  if (v.mainEntity) flattenLd(v.mainEntity, out, depth + 1);
}

function str(v: Json | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return str(v[0]);
  if (v && typeof v === 'object') return str(v.url ?? v.name ?? v['@id']);
  return undefined;
}

/** JSON-LD Person (preferred) or Organization → PageSignals['jsonLd']. */
export function jsonLdOf(html: string, base: string): PageSignals['jsonLd'] {
  const nodes: { [k: string]: Json }[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      flattenLd(JSON.parse(m[1]!.trim()) as Json, nodes);
    } catch {
      /* a broken block is skipped */
    }
  }
  const pick = nodes.find((n) => typesOf(n).includes('Person')) ?? nodes.find((n) => typesOf(n).some((t) => /Organization$/.test(t)));
  if (!pick) return undefined;
  const ld: NonNullable<PageSignals['jsonLd']> = {};
  const name = clean(str(pick.name), 80);
  if (name) ld.name = name;
  const description = clean(str(pick.description));
  if (description) ld.description = description;
  const image = str(pick.image);
  const img = image ? absolute(image, base) : undefined;
  if (img) ld.image = img;
  const addr = pick.address;
  if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
    const a: NonNullable<NonNullable<PageSignals['jsonLd']>['address']> = {};
    const loc = clean(str(addr.addressLocality), 120);
    const reg = clean(str(addr.addressRegion), 120);
    const cty = clean(str(addr.addressCountry), 120);
    if (loc) a.addressLocality = loc;
    if (reg) a.addressRegion = reg;
    if (cty) a.addressCountry = cty;
    if (Object.keys(a).length) ld.address = a;
  }
  const same = pick.sameAs;
  const list = (Array.isArray(same) ? same : [same]).map((x) => (typeof x === 'string' ? absolute(x, base) : undefined)).filter((x): x is string => !!x);
  if (list.length) ld.sameAs = list.slice(0, 20);
  return Object.keys(ld).length ? ld : undefined;
}

/**
 * Everything the import can use from one HTML page: og: / twitter: meta,
 * <title>, the description meta, JSON-LD, rel="me" links and anchors to social
 * hosts. Relative URLs are made absolute against `base` (the final URL).
 */
export function extractSignals(html: string, base: string): PageSignals {
  const head = html.slice(0, 600_000);
  const meta: Record<string, string> = {};
  for (const a of tags(head, 'meta')) {
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const sig: PageSignals = {};
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const t = clean(title, 300);
  if (t) sig.title = t;
  const ogTitle = clean(meta['og:title'] ?? meta['twitter:title'], 300);
  if (ogTitle) sig.ogTitle = ogTitle;
  const description = clean(meta['description']);
  if (description) sig.description = description;
  const ogDescription = clean(meta['og:description'] ?? meta['twitter:description'], 1000);
  if (ogDescription) sig.ogDescription = ogDescription;
  const img = meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['twitter:image'] ?? meta['twitter:image:src'];
  const ogImage = img ? absolute(img, base) : undefined;
  if (ogImage) sig.ogImage = ogImage;
  const ld = jsonLdOf(head, base);
  if (ld) sig.jsonLd = ld;
  const links: string[] = [];
  const seen = new Set<string>();
  const add = (href: string | undefined) => {
    const u = href ? absolute(href, base) : undefined;
    if (!u || seen.has(u.toLowerCase()) || links.length >= 20) return;
    seen.add(u.toLowerCase());
    links.push(u);
  };
  for (const a of [...tags(head, 'link'), ...tags(head, 'a')]) {
    if (!a.href) continue;
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('me')) {
      add(a.href);
      continue;
    }
    const u = absolute(a.href, base);
    if (u && SOCIAL_HOSTS.test(new URL(u).hostname.toLowerCase())) add(u);
  }
  if (links.length) sig.links = links;
  return sig;
}

/**
 * What a visitor can read on the page, for the token / link-back search: the
 * visible text, every meta content (Instagram puts the bio in og:description)
 * and every href (a link back to the Kofi profile counts).
 */
export function pageTextOf(html: string): string {
  const parts: string[] = [];
  for (const a of tags(html, 'meta')) if (a.content) parts.push(a.content);
  for (const a of [...tags(html, 'a'), ...tags(html, 'link')]) if (a.href) parts.push(a.href);
  const text = html
    .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  parts.push(decodeEntities(text));
  return parts.join(' ').replace(/\s+/g, ' ');
}
