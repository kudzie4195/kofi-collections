/**
 * Intake rules — pure, shared by the mock, the Supabase data source, the edge
 * function (re-implemented in Deno with the same tests) and the UI.
 *
 * Links: an artist pastes anything ("@mara.paints", "instagram.com/mara.paints",
 * "https://www.mara-oyelaran.com") and we normalise it to one https URL, a
 * platform and a handle. Verification: the artist's token (kofi-xxxxxx) found on
 * the page, or a link from the page back to their Kofi profile, proves control.
 */
import type { ArtistLink, LinkPlatform, ProfileImport, ProfileImportFields, SignUpInput } from './types';
import { CONSENT_VERSION } from './types';
import type { Problem } from './programme';

export const MAX_LINKS = 6;
export const TOKEN_PREFIX = 'kofi-';
/** Lower-case letters and digits that are easy to read aloud (no 0/o, 1/l). */
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function makeVerificationToken(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += TOKEN_ALPHABET[Math.floor(random() * TOKEN_ALPHABET.length)];
  return TOKEN_PREFIX + out;
}
export const TOKEN_RE = /^kofi-[abcdefghjkmnpqrstuvwxyz23456789]{6}$/;

/* ------------------------------------------------------------------ links */

const PLATFORM_HOSTS: [RegExp, LinkPlatform][] = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'facebook'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
];

/** Hosts that are link hubs rather than the artist's own site. */
const HUB_HOSTS = /(^|\.)(linktr\.ee|beacons\.ai|carrd\.co|bio\.site|lnk\.bio)$/;

export interface NormalizedLink {
  url: string;
  platform: LinkPlatform;
  handle: string;
  label: string;
}

/**
 * Accepts a URL, a bare host, or "@handle" (treated as Instagram). Returns
 * undefined when nothing usable can be made of it. Always https; tracking
 * query strings dropped; trailing slash dropped; host lower-cased.
 */
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
  u.hostname = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!u.hostname.includes('.') || u.username || u.password || u.port) return undefined;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|igsh|igshid|ref|trk|hl|mibextid|si)$/i.test(k) || /^(utm_|igsh)/i.test(k)) u.searchParams.delete(k);
  let platform: LinkPlatform = 'website';
  for (const [re, p] of PLATFORM_HOSTS) if (re.test(u.hostname)) platform = p;
  if (platform === 'website' && HUB_HOSTS.test(u.hostname)) platform = 'other';
  // Social hosts have one canonical form: www. + lower-case path (handles are case-insensitive there).
  if (platform === 'instagram' || platform === 'facebook' || platform === 'linkedin' || platform === 'tiktok') {
    u.hostname = u.hostname.replace(/^(www\.|m\.|mobile\.|web\.)?/, 'www.');
    u.pathname = u.pathname.toLowerCase();
  }
  const path = u.pathname.replace(/\/+$/, '');
  u.pathname = path || '/';
  let handle = '';
  if (platform === 'instagram' || platform === 'facebook' || platform === 'tiktok') {
    const first = path.split('/').filter(Boolean)[0] ?? '';
    if (platform === 'instagram' && ['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct'].includes(first)) return undefined;
    if (platform === 'facebook' && first === 'profile.php') {
      const id = u.searchParams.get('id');
      if (!id || !/^\d+$/.test(id)) return undefined;
      u.search = `?id=${id}`;
      handle = `profile ${id}`;
    } else {
      if (platform === 'facebook') u.search = '';
      handle = first.replace(/^@/, '');
      if (!handle) return undefined;
      handle = '@' + handle;
    }
  } else if (platform === 'linkedin') {
    const parts = path.split('/').filter(Boolean);
    if ((parts[0] !== 'in' && parts[0] !== 'company') || !parts[1]) return undefined;
    u.search = '';
    handle = parts[1];
  } else if (platform === 'youtube') {
    const first = path.split('/').filter(Boolean)[0] ?? '';
    handle = first.startsWith('@') ? first : u.hostname.replace(/^www\./, '');
  } else {
    handle = u.hostname.replace(/^www\./, '');
  }
  if (handle.length > 60) return undefined;
  const url = u.toString().replace(/\/$/, '').replace(/\/\?/, '?');
  if (url.length > 300) return undefined;
  const label = platform === 'website' || platform === 'other' ? handle : `${platformName(platform)} ${handle}`;
  return { url, platform, handle, label };
}

/** Host without a leading www., for same-site comparisons. */
export function bareHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function platformName(p: LinkPlatform): string {
  return { instagram: 'Instagram', website: 'Website', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', other: 'Link' }[p];
}

/** Dedupe by URL, cap at MAX_LINKS, keep the first occurrence. */
export function mergeLinks(existing: ArtistLink[], added: ArtistLink[]): ArtistLink[] {
  const seen = new Set<string>();
  const out: ArtistLink[] = [];
  for (const l of [...existing, ...added]) {
    const key = l.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length === MAX_LINKS) break;
  }
  return out;
}

/** Problem for a pasted link, or undefined when it is fine to add. */
export function validateLinkInput(raw: string, existing: ArtistLink[]): Problem | undefined {
  if (!raw.trim()) return { field: 'url', message: 'Paste a link or type a handle.' };
  const n = normalizeLink(raw);
  if (!n) return { field: 'url', message: 'That does not look like a profile or website link. Try the address from your browser.' };
  if (existing.some((l) => l.url.toLowerCase() === n.url.toLowerCase())) return { field: 'url', message: 'That link is already on your profile.' };
  if (existing.length >= MAX_LINKS) return { field: 'url', message: `Up to ${MAX_LINKS} links. Remove one to add another.` };
  return undefined;
}

/* ----------------------------------------------------- verification check */

/**
 * Decide a link's verification from the text of its page. Pure: the fetching
 * is the data source's job. `profileUrl` is the artist's public Kofi page.
 */
export function verificationFromPage(pageText: string, token: string, profileUrl?: string): 'verified' | 'failed' {
  const t = pageText.toLowerCase();
  if (token && t.includes(token.toLowerCase())) return 'verified';
  if (profileUrl && t.includes(profileUrl.toLowerCase().replace(/^https?:\/\//, ''))) return 'verified';
  return 'failed';
}

/* -------------------------------------------------- profile import rules */

/** Private/internal hosts the importer must never fetch (SSRF). */
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
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return false;
  }
  if (h.startsWith('[')) return false; // IPv6 literal
  return true;
}

/** Title-case a handle: "mara.paints_studio" → "Mara Paints Studio". */
export function nameFromHandle(handle: string): string {
  if (/^profile \d+$/.test(handle)) return '';
  return handle
    .replace(/^@/, '')
    .split(/[._\-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Instagram/Facebook og:title shapes: "Mara Oyelaran (@mara.paints) • Instagram photos and videos".
 * Websites: "Mara Oyelaran — Painter". Returns the cleaned name or undefined.
 */
export function nameFromTitle(title: string): string | undefined {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*\(@[^)]+\)\s*/, ' ').replace(/\s*[•|·–—-]\s*(Instagram|Facebook|LinkedIn|TikTok|YouTube).*$/i, '');
  t = t.split(/\s[|•·–—-]\s/)[0]!.trim();
  if (!t || t.length > 80 || /^(home|welcome|untitled)$/i.test(t)) return undefined;
  return t;
}

/** "1,234 Followers, 56 Following, 78 Posts - See Instagram photos…" → counts. */
export function countsFromDescription(desc: string): { followers?: number; postCount?: number } {
  const out: { followers?: number; postCount?: number } = {};
  const f = /([\d,.]+)\s*([kKmM])?\s*followers/i.exec(desc);
  const p = /([\d,.]+)\s*([kKmM])?\s*posts/i.exec(desc);
  const num = (m: RegExpExecArray | null) => {
    if (!m) return undefined;
    let n = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(n)) return undefined;
    if (m[2]?.toLowerCase() === 'k') n *= 1000;
    if (m[2]?.toLowerCase() === 'm') n *= 1_000_000;
    return Math.round(n);
  };
  const fo = num(f);
  const po = num(p);
  if (fo !== undefined) out.followers = fo;
  if (po !== undefined) out.postCount = po;
  return out;
}

/** The bio part of an Instagram description comes after the counts and a " - ". */
export function bioFromDescription(desc: string): string | undefined {
  const s = desc.replace(/\s+/g, ' ').trim();
  const idx = s.search(/\s-\s/);
  let bio = idx >= 0 ? s.slice(idx + 3) : s;
  bio = bio.replace(/^See Instagram photos and videos from .*$/i, '').replace(/^.*\(@[^)]+\)\s*(on Instagram:?)?\s*/i, '').replace(/^"|"$/g, '').trim();
  if (bio.length < 8 || /^See Instagram/i.test(bio)) return undefined;
  return bio.slice(0, 600);
}

export interface PageSignals {
  title?: string;
  ogTitle?: string;
  description?: string;
  ogDescription?: string;
  ogImage?: string;
  /** JSON-LD Person / Organization, already parsed. */
  jsonLd?: { name?: string; description?: string; image?: string; address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string }; sameAs?: string[] };
  /** rel=me and in-page social links. */
  links?: string[];
}

/**
 * Pages that are not the artist's page: a login wall, a "not available" page, a
 * generic platform landing. Their title/description would otherwise become a
 * confident, wrong suggestion ("Login"). Returns the reason, or undefined.
 */
export function pageProblem(sig: PageSignals): string | undefined {
  const title = (sig.ogTitle ?? sig.title ?? '').trim();
  const desc = (sig.ogDescription ?? sig.description ?? '').trim();
  const t = `${title} ${desc}`.toLowerCase();
  if (/^(log ?in|sign ?(in|up)|login\s*[•|·-]|welcome back)/i.test(title) || /welcome back to (instagram|facebook)|log in to (see|continue)|sign in to (see|continue|view)|join linkedin/i.test(t))
    return 'This page asked us to log in, so we could not read it. Your handle is all we have.';
  if (/page isn.?t available|page not found|content isn.?t available|this account is private|404|not found/i.test(t)) return 'That page is not available to visitors. Check the link, or fill in your details by hand.';
  if (/^(instagram|facebook|linkedin|tiktok|youtube)$/i.test(title)) return 'The page only showed the platform name, not your profile.';
  return undefined;
}

/** Turn page signals into suggestions with per-field confidence. Pure. */
export function importFromSignals(source: ArtistLink, sig: PageSignals, fetchedAt: string): ProfileImport {
  const fields: ProfileImportFields = {};
  const confidence: ProfileImport['confidence'] = {};
  const notes: string[] = [];
  const problem = pageProblem(sig);
  if (problem) {
    if (source.handle && source.platform !== 'website' && source.platform !== 'other') {
      fields.workingName = nameFromHandle(source.handle);
      confidence.workingName = 0.3;
    }
    return { source, fields, confidence, fetchedAt, notes: [problem] };
  }
  const ld = sig.jsonLd;
  if (ld?.name) {
    fields.workingName = ld.name.trim().slice(0, 80);
    confidence.workingName = 1;
  } else {
    const n = nameFromTitle(sig.ogTitle ?? sig.title ?? '');
    if (n) {
      fields.workingName = n;
      confidence.workingName = 0.5;
    } else if (source.handle) {
      fields.workingName = nameFromHandle(source.handle);
      confidence.workingName = 0.3;
      notes.push('We could not read a name from the page, so this comes from the handle.');
    }
  }
  const desc = sig.ogDescription ?? sig.description ?? '';
  if (ld?.description) {
    fields.bio = ld.description.trim().slice(0, 600);
    confidence.bio = 1;
  } else if (desc) {
    const bio = source.platform === 'instagram' || source.platform === 'facebook' ? bioFromDescription(desc) : desc.trim().slice(0, 600);
    if (bio) {
      fields.bio = bio;
      confidence.bio = 0.5;
    }
  }
  const counts = countsFromDescription(desc);
  if (counts.followers !== undefined) fields.followers = counts.followers;
  if (counts.postCount !== undefined) fields.postCount = counts.postCount;
  const img = ld?.image ?? sig.ogImage;
  if (img && /^https:\/\//.test(img)) {
    fields.photoUrl = img;
    confidence.photoUrl = ld?.image ? 1 : 0.5;
  }
  if (ld?.address) {
    if (ld.address.addressLocality) fields.city = ld.address.addressLocality;
    if (ld.address.addressRegion) fields.region = ld.address.addressRegion;
    if (ld.address.addressCountry) fields.country = ld.address.addressCountry;
    confidence.city = 1;
  }
  const found: ArtistLink[] = [];
  for (const raw of [...(ld?.sameAs ?? []), ...(sig.links ?? [])]) {
    const n = normalizeLink(raw);
    if (!n || n.url.toLowerCase() === source.url.toLowerCase()) continue;
    if (n.platform === 'website' && bareHost(n.url) === bareHost(source.url)) continue;
    found.push({ label: n.label, url: n.url, platform: n.platform, handle: n.handle, verification: 'claimed' });
  }
  if (found.length) {
    fields.links = mergeLinks([], found);
    confidence.links = 0.5;
  }
  if (!fields.workingName && !fields.bio && !fields.photoUrl) notes.push('The page did not give us anything we could use. Fill in your details by hand.');
  return { source, fields, confidence, fetchedAt, notes };
}

/* --------------------------------------------------------------- sign-up */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignUp(input: SignUpInput): Problem | undefined {
  const name = input.displayName.trim();
  if (name.length < 2) return { field: 'displayName', message: 'Tell us your name, as you would sign it.' };
  if (name.length > 80) return { field: 'displayName', message: 'Keep the name under 80 characters.' };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { field: 'email', message: 'Enter an email address we can reach you at.' };
  if (input.password.length < 10) return { field: 'password', message: 'Use at least 10 characters. A short sentence works well.' };
  if (input.password.length > 200) return { field: 'password', message: 'That password is too long.' };
  if (/^(.)\1+$/.test(input.password) || /^(password|1234567890|qwertyuiop)/i.test(input.password)) return { field: 'password', message: 'Pick something harder to guess.' };
  if (input.consentVersion !== CONSENT_VERSION) return { field: 'consentVersion', message: 'Please read and accept how Kofi handles your data.' };
  return undefined;
}

/** How complete a draft profile is, for the progress line. 0–100. */
export function profileCompleteness(a: { workingName: string; bio: string; region: { region: string; country: string }; mediums: unknown[]; links: ArtistLink[] }, workCount: number): number {
  let score = 0;
  if (a.workingName.trim()) score += 15;
  if (a.bio.trim().length >= 40) score += 20;
  if (a.region.region && a.region.country) score += 15;
  if (a.mediums.length) score += 10;
  if (a.links.length) score += 10;
  if (a.links.some((l) => l.verification === 'verified')) score += 10;
  score += Math.min(workCount, 3) * 10;
  return Math.min(100, score);
}

/** What still blocks "Send for review". Empty when the profile can go. */
export function readyForReview(a: { workingName: string; bio: string; region: { region: string; country: string }; mediums: unknown[]; consentVersion?: string }, workCount: number): string[] {
  const out: string[] = [];
  if (!a.workingName.trim()) out.push('Add the name you work under.');
  if (a.bio.trim().length < 40) out.push('Write a few sentences about your work (at least 40 characters).');
  if (!a.region.region || !a.region.country) out.push('Tell us where you are based.');
  if (!a.mediums.length) out.push('Pick at least one medium.');
  if (workCount < 1) out.push('Add at least one work. Three is better.');
  if (a.consentVersion !== CONSENT_VERSION) out.push('Accept how Kofi handles your data.');
  return out;
}
