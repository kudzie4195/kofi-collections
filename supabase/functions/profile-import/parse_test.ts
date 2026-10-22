// deno test supabase/functions/profile-import/
// The link / SSRF / verification cases are the ones in src/domain/intake.test.ts,
// so the Deno re-implementation and the app's rules cannot drift apart unnoticed.
import { decodeEntities, extractSignals, isFetchableUrl, isPrivateAddress, normalizeLink, pageTextOf, profileUrlOk, verificationFromPage } from './parse.ts';
import { fetchPage } from './fetch.ts';
import { createHandler, type HandlerDeps } from './handler.ts';
import type { PageResult } from './fetch.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`);
}
function ok(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/* ------------------------------------------------ same cases as intake.test */

Deno.test('normalizeLink turns a handle into an Instagram link', () => {
  eq(normalizeLink('@mara.paints'), { url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints', label: 'Instagram @mara.paints' });
});

Deno.test('normalizeLink accepts bare hosts, strips tracking and trailing slashes, forces https', () => {
  eq(normalizeLink('instagram.com/mara.paints/?igsh=abc&utm_source=x')?.url, 'https://instagram.com/mara.paints');
  const w = normalizeLink('http://WWW.Mara-Oyelaran.com/')!;
  eq([w.url, w.platform, w.handle, w.label], ['https://www.mara-oyelaran.com', 'website', 'mara-oyelaran.com', 'mara-oyelaran.com']);
});

Deno.test('normalizeLink knows the platforms and their handles', () => {
  const pick = (s: string) => {
    const n = normalizeLink(s);
    return n && [n.platform, n.handle];
  };
  eq(pick('https://www.facebook.com/maraoyelaranart'), ['facebook', '@maraoyelaranart']);
  eq(pick('https://www.linkedin.com/in/mara-oyelaran/'), ['linkedin', 'mara-oyelaran']);
  eq(pick('https://www.tiktok.com/@mara.paints'), ['tiktok', '@mara.paints']);
  eq(pick('https://youtube.com/@marapaints'), ['youtube', '@marapaints']);
  eq(normalizeLink('https://linktr.ee/mara')?.platform, 'other');
});

Deno.test('normalizeLink rejects posts, bad schemes, credentials and nonsense', () => {
  for (const bad of ['https://www.instagram.com/p/Cx12345/', 'ftp://example.com', 'https://user:pw@example.com', 'not a link', 'https://www.linkedin.com/feed', '']) {
    eq(normalizeLink(bad), undefined, bad);
  }
});

Deno.test('verificationFromPage: token or link back, case-insensitive', () => {
  eq(verificationFromPage('Painter in Pittsburgh. KOFI-7F3A2K', 'kofi-7f3a2k'), 'verified');
  eq(verificationFromPage('see https://app.koficollections.org/#/artists/abc', 'kofi-zzzzzz', 'https://app.koficollections.org/#/artists/abc'), 'verified');
  eq(verificationFromPage('nothing here', 'kofi-7f3a2k', 'https://x.org/a'), 'failed');
});

Deno.test('isFetchableUrl never allows private or non-http addresses', () => {
  for (const bad of ['http://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://172.20.1.1/', 'https://192.168.1.1/', 'https://169.254.169.254/latest', 'https://foo.internal/', 'https://[::1]/', 'ftp://a.com', 'nope']) {
    eq(isFetchableUrl(bad), false, bad);
  }
  eq(isFetchableUrl('https://www.instagram.com/mara.paints'), true);
  eq(isFetchableUrl('https://8.8.8.8/'), true);
});

Deno.test('isPrivateAddress covers resolved IPv4 / IPv6 private ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) eq(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2a03:2880:f12f:83:face:b00c:0:25de']) eq(isPrivateAddress(ip), false, ip);
});

Deno.test('profileUrlOk only accepts …/artists/<this artist>', () => {
  const id = '20000000-0000-4000-8000-000000000001';
  eq(profileUrlOk(`https://app.koficollections.org/#/artists/${id}`, id), true);
  eq(profileUrlOk(`https://kofi.example/app/#/artists/${id}`, id), true);
  eq(profileUrlOk('https://app.koficollections.org/#/artists/20000000-0000-4000-8000-000000000002', id), false);
  eq(profileUrlOk('kofi', id), false);
  eq(profileUrlOk(undefined, id), false);
});

/* -------------------------------------------------------------- parsing */

const INSTAGRAM_HTML = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Mara Oyelaran (&#064;mara.paints) &bull; Instagram photos and videos</title>
<meta property="og:title" content="Mara Oyelaran (@mara.paints) &#x2022; Instagram photos and videos" />
<meta property="og:description" content="2,431 Followers, 388 Following, 214 Posts - Mara Oyelaran (@mara.paints) on Instagram: &quot;Oil painter. Pittsburgh. kofi-7f3a2k&quot;" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/profile_320.jpg?x=1&amp;y=2" />
<script>window.__x = "kofi-zzzzzz";</script>
</head><body><a href="https://l.instagram.com/?u=https%3A%2F%2Fwww.mara-oyelaran.com">mara-oyelaran.com</a></body></html>`;

const WEBSITE_HTML = `<html><head>
<title>Mara Oyelaran — Painter, Pittsburgh</title>
<meta name="description" content="Large-format oil paintings of the city after rain.">
<meta name=twitter:image content=/images/og.jpg>
<link rel="me" href="https://www.instagram.com/mara.paints/">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Mara's site"},
 {"@type":["Person"],"name":"Mara Oyelaran","description":"Painter working from a converted print shop.",
  "image":{"@type":"ImageObject","url":"/images/portrait.jpg"},
  "address":{"@type":"PostalAddress","addressLocality":"Pittsburgh","addressRegion":"Pennsylvania","addressCountry":{"@type":"Country","name":"United States"}},
  "sameAs":["https://www.linkedin.com/in/mara-oyelaran","notaurl::"]}]}
</script>
<script type="application/ld+json">{ broken json </script>
</head><body>
<a href="/contact">Contact</a>
<a href="https://www.tiktok.com/@mara.paints">TikTok</a>
<a rel="me noopener" href="https://app.koficollections.org/#/artists/20000000-0000-4000-8000-000000000001">On Kofi</a>
<p>Studio visits by appointment &amp; open studios in May.</p>
<style>.x{content:"kofi-yyyyyy"}</style>
</body></html>`;

Deno.test('extractSignals reads og tags, title and entity-encoded values', () => {
  const s = extractSignals(INSTAGRAM_HTML, 'https://www.instagram.com/mara.paints/');
  eq(s.title, 'Mara Oyelaran (@mara.paints) • Instagram photos and videos');
  eq(s.ogTitle, 'Mara Oyelaran (@mara.paints) • Instagram photos and videos');
  ok(s.ogDescription?.endsWith('on Instagram: "Oil painter. Pittsburgh. kofi-7f3a2k"'), 'og:description decoded');
  eq(s.ogImage, 'https://scontent.cdninstagram.com/v/profile_320.jpg?x=1&y=2');
  eq(s.links, ['https://l.instagram.com/?u=https%3A%2F%2Fwww.mara-oyelaran.com']);
  eq(s.jsonLd, undefined);
});

Deno.test('extractSignals prefers JSON-LD Person in @graph, resolves relative URLs, collects rel=me and social anchors', () => {
  const s = extractSignals(WEBSITE_HTML, 'https://www.mara-oyelaran.com/');
  eq(s.jsonLd, {
    name: 'Mara Oyelaran',
    description: 'Painter working from a converted print shop.',
    image: 'https://www.mara-oyelaran.com/images/portrait.jpg',
    address: { addressLocality: 'Pittsburgh', addressRegion: 'Pennsylvania', addressCountry: 'United States' },
    sameAs: ['https://www.linkedin.com/in/mara-oyelaran'],
  });
  eq(s.description, 'Large-format oil paintings of the city after rain.');
  eq(s.ogImage, 'https://www.mara-oyelaran.com/images/og.jpg');
  eq(s.links, [
    'https://www.instagram.com/mara.paints/',
    'https://www.tiktok.com/@mara.paints',
    'https://app.koficollections.org/#/artists/20000000-0000-4000-8000-000000000001',
  ]);
});

Deno.test('pageTextOf has visible text, meta contents and hrefs, never scripts or styles', () => {
  const ig = pageTextOf(INSTAGRAM_HTML);
  ok(ig.includes('kofi-7f3a2k'), 'bio in og:description counts');
  ok(!ig.includes('kofi-zzzzzz'), 'script text is ignored');
  const site = pageTextOf(WEBSITE_HTML);
  ok(site.includes('Studio visits by appointment & open studios'), 'visible text decoded');
  ok(!site.includes('kofi-yyyyyy'), 'style text is ignored');
  eq(verificationFromPage(site, 'kofi-7f3a2k', 'https://app.koficollections.org/#/artists/20000000-0000-4000-8000-000000000001'), 'verified');
  eq(decodeEntities('&lt;a&gt; &#39;x&#39; &unknown;'), "<a> 'x' &unknown;");
});

/* ------------------------------------------------------------ fetchPage */

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const r = routes[url];
    return r ? Promise.resolve(r()) : Promise.reject(new TypeError('connection refused'));
  }) as typeof fetch;
}
const html = (body: string, status = 200) => () => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

Deno.test('fetchPage follows up to 3 redirects and re-checks every hop', async () => {
  const f = fakeFetch({
    'https://a.example/': redirect('/b'),
    'https://a.example/b': redirect('https://c.example/'),
    'https://c.example/': html('<title>C</title>'),
    'https://evil.example/': redirect('http://169.254.169.254/latest/meta-data'),
    'https://loop.example/': redirect('https://loop.example/'),
  });
  const r = await fetchPage('https://a.example/', { fetchImpl: f });
  ok(r.ok && r.finalUrl === 'https://c.example/' && r.html.includes('<title>C'), 'followed to c');
  eq(await fetchPage('https://evil.example/', { fetchImpl: f }), { ok: false, reason: 'blocked', finalUrl: 'http://169.254.169.254/latest/meta-data' });
  eq((await fetchPage('https://loop.example/', { fetchImpl: f })).ok === false && (await fetchPage('https://loop.example/', { fetchImpl: f })), { ok: false, reason: 'redirects', finalUrl: 'https://loop.example/' });
});

Deno.test('fetchPage refuses hosts that resolve to private addresses', async () => {
  const f = fakeFetch({ 'https://rebind.example/': html('secret') });
  const r = await fetchPage('https://rebind.example/', { fetchImpl: f, resolve: () => Promise.resolve(['10.0.0.7']) });
  eq(r, { ok: false, reason: 'blocked', finalUrl: 'https://rebind.example/' });
  const p = await fetchPage('https://rebind.example/', { fetchImpl: f, resolve: () => Promise.resolve(['93.184.216.34']) });
  eq(p.ok, true);
});

Deno.test('fetchPage caps the body, refuses non-HTML and error pages, and times out', async () => {
  const big = 'x'.repeat(3000);
  const f = fakeFetch({
    'https://big.example/': html(big),
    'https://pdf.example/': () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    'https://gone.example/': html('no', 404),
  });
  const r = await fetchPage('https://big.example/', { fetchImpl: f, maxBytes: 1000 });
  ok(r.ok && r.html.length === 1000 && r.truncated, 'truncated at the cap');
  eq((await fetchPage('https://pdf.example/', { fetchImpl: f })), { ok: false, reason: 'not_html', status: 200, finalUrl: 'https://pdf.example/' });
  eq((await fetchPage('https://gone.example/', { fetchImpl: f })), { ok: false, reason: 'status', status: 404, finalUrl: 'https://gone.example/' });
  const slow = ((_u: string, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
  eq((await fetchPage('https://slow.example/', { fetchImpl: slow, timeoutMs: 50 })), { ok: false, reason: 'timeout', finalUrl: 'https://slow.example/' });
});

/* --------------------------------------------------------------- handler */

const ARTIST = '20000000-0000-4000-8000-000000000001';
const TOKEN = 'kofi-7f3a2k';

function makeDeps(over: Partial<HandlerDeps> = {}) {
  const writes: unknown[] = [];
  const audits: unknown[] = [];
  const pages: Record<string, PageResult> = {
    'https://www.instagram.com/mara.paints': { ok: true, status: 200, finalUrl: 'https://www.instagram.com/mara.paints/', html: INSTAGRAM_HTML, truncated: false },
    'https://www.mara-oyelaran.com': { ok: true, status: 200, finalUrl: 'https://www.mara-oyelaran.com/', html: WEBSITE_HTML, truncated: false },
    'https://www.linkedin.com/in/mara-oyelaran': { ok: false, reason: 'status', status: 999 },
  };
  const deps: HandlerDeps = {
    allowedOrigins: ['https://app.koficollections.org'],
    getUser: (a) => Promise.resolve(a === 'Bearer user' || a === 'Bearer admin' ? { id: a.slice(7) } : null),
    loadArtist: (a, id) =>
      Promise.resolve(
        (a === 'Bearer user' && !id) || (a === 'Bearer admin' && id === ARTIST)
          ? {
              id: ARTIST,
              token: TOKEN,
              links: [
                { url: 'https://www.instagram.com/mara.paints' },
                { url: 'https://www.mara-oyelaran.com' },
                { url: 'https://www.linkedin.com/in/mara-oyelaran' },
                { url: `https://www.example.com/search?q=${TOKEN}` },
              ],
            }
          : undefined,
      ),
    writeVerification: (...args) => {
      writes.push(args);
      return Promise.resolve();
    },
    logAudit: (_a, action, id, meta) => {
      audits.push([action, id, meta]);
      return Promise.resolve();
    },
    fetchPage: (u) => Promise.resolve(pages[u] ?? { ok: false, reason: 'network' }),
    now: () => new Date('2026-10-22T12:00:00.000Z'),
    ...over,
  };
  return { deps, writes, audits };
}
const post = (body: unknown, auth = 'Bearer user', origin = 'https://app.koficollections.org') =>
  new Request('https://fn.example/profile-import', { method: 'POST', headers: { authorization: auth, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

Deno.test('handler: CORS preflight, method, auth', async () => {
  const { deps } = makeDeps();
  const h = createHandler(deps);
  const pre = await h(new Request('https://fn.example/', { method: 'OPTIONS', headers: { origin: 'https://app.koficollections.org' } }));
  eq([pre.status, pre.headers.get('access-control-allow-origin')], [204, 'https://app.koficollections.org']);
  const other = await h(new Request('https://fn.example/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  eq(other.headers.get('access-control-allow-origin'), null);
  eq((await h(new Request('https://fn.example/', { method: 'GET' }))).status, 405);
  const anon = await h(post({ url: '@mara.paints' }, 'Bearer anon-key'));
  eq([anon.status, (await anon.json()).error], [401, 'unauthorized']);
});

Deno.test('handler import: signals for a readable page, a reason for an unreadable one, 400 for private addresses', async () => {
  const { deps, audits } = makeDeps();
  const h = createHandler(deps);
  const r = await h(post({ url: '@mara.paints' }));
  const b = await r.json();
  eq([r.status, b.reachable, b.source.platform, b.source.handle, b.signals.ogTitle], [200, true, 'instagram', '@mara.paints', 'Mara Oyelaran (@mara.paints) • Instagram photos and videos']);
  eq(r.headers.get('access-control-allow-origin'), 'https://app.koficollections.org');
  const li = await (await h(post({ url: 'https://www.linkedin.com/in/mara-oyelaran/' }))).json();
  eq([li.reachable, li.signals, typeof li.reason], [false, {}, 'string']);
  const bad = await h(post({ url: 'http://localhost:54321/rest/v1/' }));
  eq([bad.status, (await bad.json()).error], [400, 'not_fetchable']);
  eq((await h(post({ url: 'https://169.254.169.254/latest' }))).status, 400);
  eq(audits.length, 2);
  eq((audits[0] as unknown[])[0], 'artist.import');
});

Deno.test('handler verify: server-side token, link must be on the profile, results written', async () => {
  const { deps, writes, audits } = makeDeps();
  const h = createHandler(deps);
  const v = await (await h(post({ url: 'https://www.instagram.com/mara.paints', verify: true }))).json();
  eq(v, { verification: 'verified', checkedAt: '2026-10-22T12:00:00.000Z' });
  // A token in the body is ignored: the website has no code on it, only the link back (needs a valid profileUrl).
  eq((await (await h(post({ url: 'https://www.mara-oyelaran.com', token: 'Studio' }))).json()).verification, 'failed');
  eq((await (await h(post({ url: 'https://www.mara-oyelaran.com', verify: true, profileUrl: `https://app.koficollections.org/#/artists/${ARTIST}` }))).json()).verification, 'verified');
  eq((await (await h(post({ url: 'https://www.linkedin.com/in/mara-oyelaran', verify: true }))).json()).verification, 'unreachable');
  const echo = await (await h(post({ url: `https://www.example.com/search?q=${TOKEN}`, verify: true }))).json();
  eq(echo.verification, 'failed');
  const missing = await h(post({ url: 'https://someone-else.example', verify: true }));
  eq(missing.status, 404);
  eq(writes.length, 5);
  eq(writes[0], [ARTIST, 'https://www.instagram.com/mara.paints', 'verified', '2026-10-22T12:00:00.000Z']);
  eq(audits.filter((a) => (a as unknown[])[0] === 'artist.links').length, 5);
});

Deno.test('handler verify: only the owner or Kofi', async () => {
  const { deps } = makeDeps();
  const h = createHandler(deps);
  eq((await h(post({ url: 'https://www.instagram.com/mara.paints', verify: true, artistId: ARTIST }, 'Bearer user'))).status, 403);
  eq((await (await h(post({ url: 'https://www.instagram.com/mara.paints', verify: true, artistId: ARTIST }, 'Bearer admin'))).json()).verification, 'verified');
  eq((await h(post({ url: 'https://www.instagram.com/mara.paints', verify: true, artistId: 'x' }, 'Bearer admin'))).status, 404);
});

Deno.test('handler: 20 calls per user per window, then 429', async () => {
  let t = Date.parse('2026-10-22T12:00:00Z');
  const { deps } = makeDeps({ now: () => new Date(t) });
  const h = createHandler(deps);
  for (let i = 0; i < 20; i++) eq((await h(post({ url: '@mara.paints' }))).status, 200);
  const r = await h(post({ url: '@mara.paints' }));
  eq([r.status, (await r.json()).error], [429, 'rate_limited']);
  eq((await h(post({ url: '@mara.paints' }, 'Bearer admin'))).status, 200);
  t += 10 * 60 * 1000 + 1;
  eq((await h(post({ url: '@mara.paints' }))).status, 200);
});

Deno.test('handler: a failing write is a 500 with CORS, not a crash', async () => {
  const { deps } = makeDeps({ writeVerification: () => Promise.reject(new Error('db down')) });
  const h = createHandler(deps);
  const r = await h(post({ url: 'https://www.instagram.com/mara.paints', verify: true }));
  eq([r.status, (await r.json()).error, r.headers.get('access-control-allow-origin')], [500, 'server', 'https://app.koficollections.org']);
});
