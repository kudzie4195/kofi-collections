import { describe, expect, it } from 'vitest';
import { bioFromDescription, countsFromDescription, importFromSignals, isFetchableUrl, makeVerificationToken, mergeLinks, nameFromHandle, nameFromTitle, normalizeLink, profileCompleteness, readyForReview, TOKEN_RE, validateLinkInput, validateSignUp, verificationFromPage } from './intake';
import { CONSENT_VERSION } from './types';

describe('normalizeLink', () => {
  it('turns a handle into an Instagram link', () => {
    expect(normalizeLink('@mara.paints')).toEqual({ url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints', label: 'Instagram @mara.paints' });
  });
  it('accepts bare hosts, strips tracking and trailing slashes, forces https', () => {
    expect(normalizeLink('instagram.com/mara.paints/?igsh=abc&utm_source=x')?.url).toBe('https://www.instagram.com/mara.paints');
    expect(normalizeLink('http://WWW.Mara-Oyelaran.com/')).toMatchObject({ url: 'https://www.mara-oyelaran.com', platform: 'website', handle: 'mara-oyelaran.com', label: 'mara-oyelaran.com' });
  });
  it('knows the platforms and their handles', () => {
    expect(normalizeLink('https://www.facebook.com/maraoyelaranart')).toMatchObject({ platform: 'facebook', handle: '@maraoyelaranart' });
    expect(normalizeLink('https://www.linkedin.com/in/mara-oyelaran/')).toMatchObject({ platform: 'linkedin', handle: 'mara-oyelaran' });
    expect(normalizeLink('https://www.tiktok.com/@mara.paints')).toMatchObject({ platform: 'tiktok', handle: '@mara.paints' });
    expect(normalizeLink('https://youtube.com/@marapaints')).toMatchObject({ platform: 'youtube', handle: '@marapaints' });
    expect(normalizeLink('https://linktr.ee/mara')).toMatchObject({ platform: 'other' });
  });
  it('makes one canonical link for the same social profile, whatever was pasted', () => {
    const urls = ['@mara.paints', 'instagram.com/mara.paints', 'HTTP://INSTAGRAM.COM/Mara.Paints/', 'https://www.instagram.com/mara.paints?hl=en', 'm.instagram.com/mara.paints'].map((u) => normalizeLink(u)?.url);
    expect(new Set(urls).size).toBe(1);
    expect(normalizeLink('https://www.linkedin.com/in/mara-oyelaran?trk=public_profile')?.url).toBe('https://www.linkedin.com/in/mara-oyelaran');
    expect(normalizeLink('https://www.facebook.com/profile.php?id=100012345&mibextid=x')).toMatchObject({ url: 'https://www.facebook.com/profile.php?id=100012345', handle: 'profile 100012345' });
    expect(normalizeLink('https://www.facebook.com/profile.php')).toBeUndefined();
    expect(normalizeLink('https://www.mara-oyelaran.com./about')?.url).toBe('https://www.mara-oyelaran.com/about');
    expect(normalizeLink('https://www.instagram.com/' + 'a'.repeat(70))).toBeUndefined();
    expect(normalizeLink('https://example.com:8443/x')).toBeUndefined();
    expect(normalizeLink('javascript:alert(1)')).toBeUndefined();
    expect(normalizeLink('data:text/html,hi')).toBeUndefined();
  });

  it('rejects posts, bad schemes, credentials and nonsense', () => {
    expect(normalizeLink('https://www.instagram.com/p/Cx12345/')).toBeUndefined();
    expect(normalizeLink('ftp://example.com')).toBeUndefined();
    expect(normalizeLink('https://user:pw@example.com')).toBeUndefined();
    expect(normalizeLink('not a link')).toBeUndefined();
    expect(normalizeLink('https://www.linkedin.com/feed')).toBeUndefined();
    expect(normalizeLink('')).toBeUndefined();
  });
});

describe('validateLinkInput / mergeLinks', () => {
  const existing = [{ label: 'x', url: 'https://www.instagram.com/mara.paints' }];
  it('refuses empty, unusable, duplicate and over-cap links', () => {
    expect(validateLinkInput('', [])?.field).toBe('url');
    expect(validateLinkInput('???', [])?.message).toMatch(/does not look like/);
    expect(validateLinkInput('@mara.paints', existing)?.message).toMatch(/already/);
    const six = Array.from({ length: 6 }, (_, i) => ({ label: String(i), url: `https://site${i}.com` }));
    expect(validateLinkInput('https://seven.com', six)?.message).toMatch(/Up to 6/);
    expect(validateLinkInput('https://new.com', existing)).toBeUndefined();
  });
  it('dedupes case-insensitively and caps at six', () => {
    const merged = mergeLinks(existing, [{ label: 'y', url: 'https://www.Instagram.com/mara.paints' }, { label: 'z', url: 'https://b.com' }]);
    expect(merged.map((l) => l.url)).toEqual(['https://www.instagram.com/mara.paints', 'https://b.com']);
    const many = Array.from({ length: 9 }, (_, i) => ({ label: String(i), url: `https://s${i}.com` }));
    expect(mergeLinks([], many)).toHaveLength(6);
  });
});

describe('verification', () => {
  it('makes readable tokens', () => {
    const t = makeVerificationToken(() => 0.5);
    expect(t).toMatch(TOKEN_RE);
    expect(makeVerificationToken()).toMatch(TOKEN_RE);
  });
  it('verifies by token or by a link back, case-insensitively', () => {
    expect(verificationFromPage('Painter in Pittsburgh. KOFI-7F3A2K', 'kofi-7f3a2k')).toBe('verified');
    expect(verificationFromPage('see https://app.koficollections.org/#/artists/abc', 'kofi-zzzzzz', 'https://app.koficollections.org/#/artists/abc')).toBe('verified');
    expect(verificationFromPage('nothing here', 'kofi-7f3a2k', 'https://x.org/a')).toBe('failed');
  });
  it('never fetches private or non-http addresses', () => {
    for (const bad of ['http://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://172.20.1.1/', 'https://192.168.1.1/', 'https://169.254.169.254/latest', 'https://foo.internal/', 'https://[::1]/', 'ftp://a.com', 'nope']) expect(isFetchableUrl(bad), bad).toBe(false);
    expect(isFetchableUrl('https://www.instagram.com/mara.paints')).toBe(true);
    expect(isFetchableUrl('https://8.8.8.8/')).toBe(true);
  });
});

describe('import parsing', () => {
  it('reads names from titles and handles', () => {
    expect(nameFromTitle('Mara Oyelaran (@mara.paints) • Instagram photos and videos')).toBe('Mara Oyelaran');
    expect(nameFromTitle('Mara Oyelaran — Painter')).toBe('Mara Oyelaran');
    expect(nameFromTitle('Home')).toBeUndefined();
    expect(nameFromHandle('@mara.paints_studio')).toBe('Mara Paints Studio');
  });
  it('reads counts and bio from an Instagram description', () => {
    const d = '1,234 Followers, 56 Following, 78 Posts - See Instagram photos and videos from Mara Oyelaran (@mara.paints)';
    expect(countsFromDescription(d)).toEqual({ followers: 1234, postCount: 78 });
    expect(countsFromDescription('12.5K Followers, 2 Posts')).toEqual({ followers: 12500, postCount: 2 });
    expect(bioFromDescription(d)).toBeUndefined();
    expect(bioFromDescription('1,234 Followers, 56 Following, 78 Posts - Mara Oyelaran (@mara.paints) on Instagram: "Painter. Pittsburgh. Rain, mostly."')).toBe('Painter. Pittsburgh. Rain, mostly.');
  });
  it('prefers structured data, then og tags, then the handle, and says so', () => {
    const source = { label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram' as const, handle: '@mara.paints' };
    const a = importFromSignals(source, { jsonLd: { name: 'Mara Oyelaran', description: 'Painter in Pittsburgh.', image: 'https://img/x.jpg', address: { addressLocality: 'Pittsburgh', addressRegion: 'Pennsylvania', addressCountry: 'United States' }, sameAs: ['https://www.mara-oyelaran.com', 'https://www.instagram.com/mara.paints'] } }, 'T');
    expect(a.fields).toMatchObject({ workingName: 'Mara Oyelaran', bio: 'Painter in Pittsburgh.', photoUrl: 'https://img/x.jpg', city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States' });
    expect(a.confidence.workingName).toBe(1);
    expect(a.fields.links?.map((l) => l.url)).toEqual(['https://www.mara-oyelaran.com']);
    expect(a.notes).toEqual([]);
    const b = importFromSignals(source, { ogTitle: 'Mara Oyelaran (@mara.paints) • Instagram photos and videos', ogDescription: '1,234 Followers, 56 Following, 78 Posts - Mara Oyelaran (@mara.paints) on Instagram: "Painter. Pittsburgh."', ogImage: 'https://img/y.jpg' }, 'T');
    expect(b.fields).toMatchObject({ workingName: 'Mara Oyelaran', bio: 'Painter. Pittsburgh.', followers: 1234, postCount: 78, photoUrl: 'https://img/y.jpg' });
    expect(b.confidence.workingName).toBe(0.5);
    const c = importFromSignals(source, {}, 'T');
    expect(c.fields.workingName).toBe('Mara Paints');
    expect(c.confidence.workingName).toBe(0.3);
    expect(c.notes.join(' ')).toMatch(/handle/);
    expect(c.fields.photoUrl).toBeUndefined();
  });
  it('treats a login wall, a missing page or a bare platform title as nothing, not as a name', () => {
    const ig = { label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram' as const, handle: '@mara.paints' };
    const wall = importFromSignals(ig, { title: 'Login • Instagram', ogTitle: 'Login • Instagram', ogDescription: 'Welcome back to Instagram. Sign in to check out what your friends, family & interests have been capturing & sharing around the world.', ogImage: 'https://static.cdninstagram.com/rsrc.php/logo.png' }, 'T');
    expect(wall.fields.bio).toBeUndefined();
    expect(wall.fields.photoUrl).toBeUndefined();
    expect(wall.fields.workingName).toBe('Mara Paints');
    expect(wall.confidence.workingName).toBe(0.3);
    expect(wall.notes[0]).toMatch(/log in/i);
    const gone = importFromSignals(ig, { ogTitle: 'Instagram', ogDescription: "Sorry, this page isn't available." }, 'T');
    expect(gone.fields.bio).toBeUndefined();
    expect(gone.notes[0]).toMatch(/not available/);
    const site = { label: 'x.com', url: 'https://x.example.com', platform: 'website' as const, handle: 'x.example.com' };
    const nf = importFromSignals(site, { title: 'Page not found', description: 'Error 404' }, 'T');
    expect(nf.fields).toEqual({});
    expect(nf.notes).toHaveLength(1);
  });

  it('drops http images and links to the same site', () => {
    const source = { label: 'mara.com', url: 'https://mara.com', platform: 'website' as const, handle: 'mara.com' };
    const r = importFromSignals(source, { ogImage: 'http://insecure/x.jpg', links: ['https://mara.com/about', 'https://www.mara.com/contact', 'https://www.instagram.com/mara.paints'] }, 'T');
    expect(r.fields.photoUrl).toBeUndefined();
    expect(r.fields.links?.map((l) => l.platform)).toEqual(['instagram']);
  });
});

describe('sign-up and readiness', () => {
  const ok = { displayName: 'Mara Oyelaran', email: 'mara@example.com', password: 'rain on liberty avenue', consentVersion: CONSENT_VERSION };
  it('validates each field with a plain message', () => {
    expect(validateSignUp(ok)).toBeUndefined();
    expect(validateSignUp({ ...ok, displayName: 'M' })?.field).toBe('displayName');
    expect(validateSignUp({ ...ok, email: 'mara@' })?.field).toBe('email');
    expect(validateSignUp({ ...ok, password: 'short' })?.field).toBe('password');
    expect(validateSignUp({ ...ok, password: 'aaaaaaaaaaaa' })?.message).toMatch(/harder to guess/);
    expect(validateSignUp({ ...ok, consentVersion: 'old' })?.field).toBe('consentVersion');
  });
  it('scores completeness and lists what blocks review', () => {
    const empty = { workingName: '', bio: '', region: { region: '', country: '' }, mediums: [], links: [] };
    expect(profileCompleteness(empty, 0)).toBe(0);
    expect(readyForReview(empty, 0)).toHaveLength(6);
    const full = { workingName: 'Mara', bio: 'x'.repeat(40), region: { region: 'Pennsylvania', country: 'United States' }, mediums: ['painting'], links: [{ label: 'a', url: 'https://a', verification: 'verified' as const }], consentVersion: CONSENT_VERSION };
    expect(profileCompleteness(full, 3)).toBe(100);
    expect(profileCompleteness({ ...full, links: [] }, 1)).toBe(70);
    expect(readyForReview(full, 1)).toEqual([]);
  });
});
