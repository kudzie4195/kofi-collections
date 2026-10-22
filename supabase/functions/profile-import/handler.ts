/**
 * The profile-import request handler, with every outside effect injected
 * (index.ts wires Deno + supabase-js; the tests and the local harness wire
 * fakes). Two modes, both POST with a JSON body:
 *
 *   import  { url }
 *     → 200 { source, reachable: true,  signals, status, finalUrl, truncated, fetchedAt }
 *     → 200 { source, reachable: false, reason, signals: {}, fetchedAt }   (page could not be read)
 *   verify  { url, verify: true, artistId?, profileUrl? }   (also: any body with `token`)
 *     → 200 { verification: 'verified' | 'failed' | 'unreachable', checkedAt, reason? }
 *     The artist's code is read on the server through artists_visible with the
 *     caller's JWT (owner or Kofi only) — a `token` in the body is ignored —
 *     and the link must be one of that artist's links. The result is written
 *     with the service role (kofi.set_link_verification) and logged as
 *     artist.links by the caller.
 *
 * Errors: { error, message } with 400 (bad input / not fetchable), 401 (no
 * signed-in user), 403 (not the owner / Kofi), 404 (link not on the profile),
 * 405, 429 (20 calls per user per 10 minutes).
 */
import { extractSignals, isFetchableUrl, normalizeLink, pageTextOf, profileUrlOk, verificationFromPage, type PageSignals } from './parse.ts';
import type { PageResult } from './fetch.ts';

export interface ArtistForCheck {
  id: string;
  token: string;
  links: { url: string }[];
}

export interface HandlerDeps {
  /** The signed-in user behind the Authorization header, or null (anon key, expired, missing). */
  getUser(authorization: string): Promise<{ id: string } | null>;
  /** Token + links as the caller may see them (artists_visible as the caller). undefined: not owner / Kofi. */
  loadArtist(authorization: string, artistId?: string): Promise<ArtistForCheck | undefined>;
  writeVerification(artistId: string, url: string, verification: 'verified' | 'failed' | 'unreachable', checkedAt: string): Promise<void>;
  /** Best effort, as the caller (kofi.log_audit). */
  logAudit(authorization: string, action: 'artist.import' | 'artist.links', artistId: string | undefined, meta: Record<string, unknown>): Promise<void>;
  fetchPage(url: string): Promise<PageResult>;
  /** Exact origins allowed by CORS; '*' allows any. */
  allowedOrigins: string[];
  now?: () => Date;
  rateLimit?: { max: number; windowMs: number };
}

export const RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

const REASON_TEXT: Record<string, string> = {
  blocked: 'That address is not a public web page.',
  timeout: 'The page took too long to answer.',
  network: 'The page could not be reached.',
  status: 'The page answered with an error (it may be private or need a sign-in).',
  not_html: 'That address is not a web page.',
  redirects: 'The page redirected too many times.',
};

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
  if (allowed.includes('*')) h['access-control-allow-origin'] = '*';
  else if (origin && allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const hits = new Map<string, number[]>();
  const limit = deps.rateLimit ?? RATE_LIMIT;
  const now = deps.now ?? (() => new Date());

  const allow = (userId: string): boolean => {
    const t = now().getTime();
    const recent = (hits.get(userId) ?? []).filter((x) => t - x < limit.windowMs);
    if (recent.length >= limit.max) {
      hits.set(userId, recent);
      return false;
    }
    recent.push(t);
    hits.set(userId, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < limit.windowMs)) hits.delete(k);
    return true;
  };

  const handle = async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    const fail = (status: number, error: string, message: string) => json(status, { error, message });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.');

    const authorization = req.headers.get('authorization') ?? '';
    const user = authorization ? await deps.getUser(authorization).catch(() => null) : null;
    if (!user) return fail(401, 'unauthorized', 'Sign in to do this.');

    let body: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (raw.length > 8192) return fail(400, 'bad_request', 'The request is too large.');
      body = JSON.parse(raw || '{}') as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    } catch {
      return fail(400, 'bad_request', 'Send a JSON body with a url.');
    }
    if (typeof body.url !== 'string' || !body.url.trim()) return fail(400, 'bad_request', 'Send a JSON body with a url.');

    if (!allow(user.id)) return fail(429, 'rate_limited', 'That is a lot of checks in a short time. Try again in a few minutes.');

    const verifyMode = body.verify === true || 'token' in body;
    const fetchedAt = now().toISOString();

    if (!verifyMode) {
      const n = normalizeLink(body.url);
      if (!n || !isFetchableUrl(n.url)) return fail(400, 'not_fetchable', 'That link cannot be read. Use a public http or https address.');
      const source = { label: n.label, url: n.url, platform: n.platform, handle: n.handle };
      const page = await deps.fetchPage(n.url);
      let out: Record<string, unknown>;
      if (page.ok) {
        const signals: PageSignals = extractSignals(page.html, page.finalUrl);
        out = { source, reachable: true, signals, status: page.status, finalUrl: page.finalUrl, truncated: page.truncated, fetchedAt };
      } else {
        out = { source, reachable: false, reason: REASON_TEXT[page.reason] ?? REASON_TEXT.network, signals: {}, fetchedAt };
      }
      await deps
        .logAudit(authorization, 'artist.import', undefined, { stage: 'read', url: n.url, platform: n.platform, reachable: page.ok, ...(page.ok ? {} : { reason: page.reason }) })
        .catch(() => undefined);
      return json(200, out);
    }

    const artistId = typeof body.artistId === 'string' && body.artistId ? body.artistId : undefined;
    if (artistId && !/^[0-9a-f-]{36}$/i.test(artistId)) return fail(404, 'not_found', 'Artist not found.');
    const artist = await deps.loadArtist(authorization, artistId).catch(() => undefined);
    if (!artist || !artist.token) return fail(403, 'forbidden', 'Only the artist or Kofi can check these links.');
    const want = body.url.trim().toLowerCase();
    const link = artist.links.find((l) => l.url.toLowerCase() === want);
    if (!link) return fail(404, 'not_found', 'That link is not on this profile.');

    let verification: 'verified' | 'failed' | 'unreachable';
    let reason: string | undefined;
    const tokenLc = artist.token.toLowerCase();
    if (!isFetchableUrl(link.url)) {
      verification = 'unreachable';
      reason = REASON_TEXT.blocked;
    } else if (decodeURIComponentSafe(link.url).toLowerCase().includes(tokenLc)) {
      // The code in the link's own address would be echoed back by many pages.
      verification = 'failed';
      reason = 'The code is in the link itself. Put it on the page instead.';
    } else {
      const page = await deps.fetchPage(link.url);
      if (!page.ok) {
        verification = 'unreachable';
        reason = REASON_TEXT[page.reason] ?? REASON_TEXT.network;
      } else {
        const profileUrl = profileUrlOk(body.profileUrl, artist.id) ? body.profileUrl : undefined;
        verification = verificationFromPage(pageTextOf(page.html), artist.token, profileUrl);
      }
    }
    await deps.writeVerification(artist.id, link.url, verification, fetchedAt);
    await deps.logAudit(authorization, 'artist.links', artist.id, { url: link.url, verification, ...(reason ? { reason } : {}) }).catch(() => undefined);
    return json(200, { verification, checkedAt: fetchedAt, ...(reason ? { reason } : {}) });
  };

  return async (req: Request): Promise<Response> => {
    try {
      return await handle(req);
    } catch (e) {
      console.error('profile-import:', e instanceof Error ? e.message : e);
      return new Response(JSON.stringify({ error: 'server', message: 'Kofi could not finish that check. Try again later.' }), {
        status: 500,
        headers: { ...corsHeaders(req.headers.get('origin'), deps.allowedOrigins), 'content-type': 'application/json; charset=utf-8' },
      });
    }
  };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
