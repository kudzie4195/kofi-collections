import { describe, expect, it } from 'vitest';
import { buildSeed, DEMO_IDENTITIES } from '@/data/mock/seed';
import { NEVER_LEAK_ARTIST_KEYS } from '@/domain/visibility';
import { ForbiddenError, NotFoundError, ValidationError } from '../DataSource';
import { DEMO_UUIDS, SUPABASE_DEMO_IDENTITIES, demoEmailForUserUuid, demoUuid } from './demo';
import { mapPgError, SESSION_ENDED_MESSAGE, NETWORK_MESSAGE, SCHEMA_NOT_EXPOSED_MESSAGE } from './errors';
import { blobToDataUrl, dataUrlToBlob, newUuid, parseDataUrl } from './files';
import {
  artistPatchToRow,
  artworkInputToJson,
  eventToRow,
  exhibitionToRow,
  isUuid,
  normalizeImageSrc,
  normalizeProgrammeImageSrc,
  openCallToRow,
  programmePathOf,
  storagePathOf,
  storyToRow,
  toApplicationRow,
  toArtistView,
  toArtworkView,
  toExhibition,
  toKofiOffsetIso,
  toOpenCall,
  toProgrammeEvent,
  toShortlist,
  toStory,
  type ApplicationViewRow,
  type ArtistViewRow,
  type ArtworkViewRow,
  type EventRow,
  type ExhibitionRow,
  type OpenCallRow,
  type StoryRow,
} from './mapping';
import { assembleReport, CHECKER_OFFLINE_MESSAGE, createSupabaseDataSource, READER_OFFLINE_NOTE, SIGNUP_CLOSED_MESSAGE } from './SupabaseDataSource';
import { ConflictError } from '../DataSource';
import { artistLinkToJson, toArtist, type ArtistRow } from './mapping';
import { CONSENT_VERSION } from '@/domain/types';
import { toLotRow, toPayoutRow, lotInputToJson, type LotViewRow, type PayoutViewRow } from './mapping';
import { buildReport } from '@/domain/reports';
import { projectLotForArtist } from '@/domain/sales';

describe('mapPgError', () => {
  it('maps privilege and RLS failures to ForbiddenError with plain language', () => {
    const rls = mapPgError({ code: '42501', message: 'new row violates row-level security policy for table "shortlist_items"' });
    expect(rls).toBeInstanceOf(ForbiddenError);
    expect(rls.message).toBe('You do not have access to this.');
    const perm = mapPgError({ code: '42501', message: 'permission denied for table artworks' });
    expect(perm.message).toBe('You do not have access to this.');
  });

  it('keeps the server message for our own 42501 raises (same text as the mock)', () => {
    const e = mapPgError({ code: '42501', message: 'Kofi staff only.' });
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(e.message).toBe('Kofi staff only.');
  });

  it('maps P0002 / PGRST116 / bad uuid to NotFoundError', () => {
    expect(mapPgError({ code: 'P0002', message: 'Artwork not found.' })).toEqual(new NotFoundError('Artwork not found.'));
    expect(mapPgError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toBeInstanceOf(NotFoundError);
    expect(mapPgError({ code: '22P02', message: 'invalid input syntax for type uuid: "aw_mara_1"' })).toBeInstanceOf(NotFoundError);
  });

  it('maps 22023 to ValidationError with the HINT as the field', () => {
    const e = mapPgError({ code: '22023', message: 'Add at least one image before publishing.', hint: 'images' });
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).field).toBe('images');
    expect(e.message).toBe('Add at least one image before publishing.');
  });

  it('maps known CHECK constraints to the mock message and field', () => {
    const e = mapPgError({
      code: '23514',
      message: 'new row for relation "artworks" violates check constraint "artworks_dimensions_positive"',
    });
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toBe('Height and width must be greater than zero.');
    expect((e as ValidationError).field).toBe('dimensions');
  });

  it('maps JWT problems to a sign-in-again ForbiddenError and network failures to a connection message', () => {
    expect(mapPgError({ code: 'PGRST301', message: 'JWT expired' }).message).toBe(SESSION_ENDED_MESSAGE);
    const net = mapPgError({ message: 'TypeError: Failed to fetch' });
    expect(net).not.toBeInstanceOf(ForbiddenError);
    expect(net.message).toBe(NETWORK_MESSAGE);
  });

  it('names the setup step when the project does not expose the kofi schema (PGRST106)', () => {
    const e = mapPgError({ code: 'PGRST106', message: 'Invalid schema: kofi', hint: 'Only the following schemas are exposed: public, graphql_public' });
    expect(e).not.toBeInstanceOf(ForbiddenError);
    expect(e.message).toBe(SCHEMA_NOT_EXPOSED_MESSAGE);
    expect(mapPgError({ message: 'The schema must be one of the following: public' }).message).toBe(SCHEMA_NOT_EXPOSED_MESSAGE);
  });

  it('passes app errors through unchanged', () => {
    const v = new ValidationError('x', 'title');
    expect(mapPgError(v as never)).toBe(v);
  });
});

describe('row mappers', () => {
  const artworkRow: ArtworkViewRow = {
    id: DEMO_UUIDS.aw_mara_1,
    artist_id: DEMO_UUIDS.art_mara,
    title: 'Doubling (Liberty Avenue, 7:40pm)',
    year: 2025,
    medium: 'painting',
    materials: ['oil on linen'],
    height: '152',
    width: 122,
    depth: null,
    unit: 'cm',
    description: 'A wet street.',
    status: 'available',
    rights_note: '© Mara Oyelaran.',
    price_amount: null,
    price_currency: null,
    price_withheld: true,
    price_visibility: 'institutions',
    visibility: 'public',
    tags: ['night'],
    reviewed_at: '2026-08-12 12:00:00+00',
    created_at: '2026-07-23T12:00:00+00:00',
    updated_at: '2026-08-29T12:00:00+00:00',
    artist_working_name: 'Mara Oyelaran',
    artist_career_stage: 'mid-career',
    artist_experience_commissions: true,
    artist_experience_public_art: true,
    artist_experience_residencies: true,
    artist_experience_institutional_shows: true,
    artist_experience_years_practicing: 14,
    artist_status: 'approved',
    artist_visibility: 'public',
    artist_region_label: 'Pittsburgh, Pennsylvania',
    can_edit: false,
    images: [{ id: DEMO_UUIDS.img_mara1, src: 'storage:artwork-images/a/b.jpg', alt: 'x', isPrimary: true, metadataStripped: true }],
  };

  it('omits price when the view redacted it and flags priceWithheld', () => {
    const v = toArtworkView(artworkRow, (s) => (s.startsWith('storage:') ? 'https://signed/x' : s));
    expect(v.price).toBeUndefined();
    expect('price' in v).toBe(false);
    expect(v.priceWithheld).toBe(true);
    expect(v.dimensions).toEqual({ height: 152, width: 122, unit: 'cm' });
    expect(v.images[0]?.src).toBe('https://signed/x');
    expect(v.reviewedAt).toBe('2026-08-12T12:00:00.000Z');
    expect(v.createdAt).toBe('2026-07-23T12:00:00.000Z');
    expect(v.artistExperience.yearsPracticing).toBe(14);
  });

  it('includes price when visible', () => {
    const v = toArtworkView({ ...artworkRow, price_amount: 9800, price_currency: 'USD', price_withheld: false });
    expect(v.price).toEqual({ amount: 9800, currency: 'USD' });
    expect(v.priceWithheld).toBe(false);
  });

  const artistRow: ArtistViewRow = {
    id: DEMO_UUIDS.art_mara,
    working_name: 'Mara Oyelaran',
    pronouns: 'she/her',
    bio: 'Large-format oil painter.',
    statement: null,
    mediums: ['painting'],
    career_stage: 'mid-career',
    experience_commissions: true,
    experience_public_art: false,
    experience_residencies: true,
    experience_institutional_shows: true,
    experience_years_practicing: null,
    availability_commissions: true,
    availability_sales: true,
    availability_exhibitions: false,
    links: [{ label: 'Website', url: 'https://example.com/mara' }],
    status: 'approved',
    visibility: 'public',
    avatar_color: '#2436F5',
    created_at: '2026-07-18T12:00:00Z',
    updated_at: '2026-08-29T12:00:00Z',
    region_label: 'Pittsburgh, Pennsylvania',
    region_city: null,
    region_region: null,
    region_country: null,
    region_precision: null,
    legal_name: null,
    contact_email: null,
    contact_phone: null,
    contact_studio_address: null,
    kofi_notes: null,
    consent_version: null,
    consent_accepted_at: null,
    can_edit: false,
  };

  it('a redacted artist row never produces private keys', () => {
    const v = toArtistView(artistRow);
    for (const k of NEVER_LEAK_ARTIST_KEYS) expect(k in v).toBe(false);
    expect('region' in v).toBe(false);
    expect(v.regionLabel).toBe('Pittsburgh, Pennsylvania');
  });

  it('an owner row carries contact, full region and consent', () => {
    const v = toArtistView({
      ...artistRow,
      can_edit: true,
      contact_email: 'mara@example.com',
      contact_phone: '+1 412 555 0142',
      region_city: 'Pittsburgh',
      region_region: 'Pennsylvania',
      region_country: 'United States',
      region_precision: 'city',
      consent_version: '2026-10-v1',
      consent_accepted_at: '2026-07-23T12:00:00+00',
    });
    expect(v.contact).toEqual({ email: 'mara@example.com', phone: '+1 412 555 0142' });
    expect(v.region).toEqual({ city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', precision: 'city' });
    expect(v.consentVersion).toBe('2026-10-v1');
    expect(v.canEdit).toBe(true);
  });

  it('maps patches to owner-editable columns only', () => {
    const row = artistPatchToRow({
      workingName: 'M',
      region: { region: 'Ontario', country: 'Canada', precision: 'region' },
      contact: { email: 'a@b.co' },
      experience: { commissions: true, publicArt: false, residencies: false, institutionalShows: true },
    });
    expect(row).toEqual({
      working_name: 'M',
      region_city: null,
      region_region: 'Ontario',
      region_country: 'Canada',
      region_precision: 'region',
      contact_email: 'a@b.co',
      contact_phone: null,
      contact_studio_address: null,
      experience_commissions: true,
      experience_public_art: false,
      experience_residencies: false,
      experience_institutional_shows: true,
      experience_years_practicing: null,
    });
    expect(Object.keys(row)).not.toContain('status');
    expect(Object.keys(row)).not.toContain('kofi_notes');
  });

  it('serializes artwork input for save_artwork', () => {
    const json = artworkInputToJson({
      title: 't',
      year: 2026,
      medium: 'drawing',
      materials: ['ink'],
      dimensions: { height: 1, width: 2, unit: 'in' },
      description: '',
      images: [],
      status: 'available',
      rightsNote: '',
      priceVisibility: 'private',
      visibility: 'private',
      tags: [],
    });
    expect(json.price).toBeNull();
    expect(json.dimensions).toEqual({ height: 1, width: 2, depth: null, unit: 'in' });
    expect('id' in json).toBe(false);
  });

  it('sorts shortlist items by when they were added', () => {
    const s = toShortlist({
      id: 's',
      curator_id: 'c',
      name: 'n',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      shortlist_items: [
        { artwork_id: 'b', added_at: '2026-01-02T00:00:00Z', note: null },
        { artwork_id: 'a', added_at: '2026-01-01T00:00:00Z', note: 'first' },
      ],
    });
    expect(s.items.map((i) => i.artworkId)).toEqual(['a', 'b']);
    expect(s.items[0]?.note).toBe('first');
    expect('note' in s.items[1]!).toBe(false);
  });
});

describe('storage refs', () => {
  it('turns signed URLs back into storage refs so images round-trip into saveArtwork', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/sign/artwork-images/20000000-0000-4000-8000-000000000001/x%20y.jpg?token=eyJ';
    expect(normalizeImageSrc(url)).toBe('storage:artwork-images/20000000-0000-4000-8000-000000000001/x y.jpg');
    expect(normalizeImageSrc('data:image/jpeg;base64,AA')).toBe('data:image/jpeg;base64,AA');
    expect(normalizeImageSrc('https://elsewhere.example/a.jpg')).toBe('https://elsewhere.example/a.jpg');
    expect(storagePathOf('storage:artwork-images/a/b.jpg')).toBe('a/b.jpg');
    expect(storagePathOf('data:image/png;base64,AA')).toBeUndefined();
  });
});

describe('data URL helpers', () => {
  it('parses base64 and percent-encoded data URLs', () => {
    const b64 = parseDataUrl('data:image/jpeg;base64,/9j/');
    expect(b64?.mime).toBe('image/jpeg');
    expect(Array.from(b64!.bytes)).toEqual([0xff, 0xd8, 0xff]);
    const txt = parseDataUrl('data:text/plain;charset=utf-8,' + encodeURIComponent('FICTIONAL — ok'));
    expect(txt?.mime).toBe('text/plain');
    expect(new TextDecoder().decode(txt!.bytes)).toBe('FICTIONAL — ok');
    expect(parseDataUrl('not a data url')).toBeUndefined();
    expect(parseDataUrl('data:text/plain,%E0%A4%A')).toBeUndefined();
  });

  it('round-trips a blob to a data URL', async () => {
    const blob = dataUrlToBlob('data:text/plain;base64,aGVsbG8=');
    expect(blob?.type).toBe('text/plain');
    expect(await blobToDataUrl(blob!)).toBe('data:text/plain;base64,aGVsbG8=');
  });

  it('makes v4 uuids', () => {
    const id = newUuid();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('4');
  });
});

describe('demo identities', () => {
  it('has a fixed UUID for every record in the TypeScript seed', () => {
    const seed = buildSeed();
    const ids = [
      ...seed.artists.flatMap((a) => [a.id, a.userId]),
      ...seed.artworks.flatMap((w) => [w.id, ...w.images.map((i) => i.id)]),
      ...seed.institutions.map((i) => i.id),
      ...seed.curators.flatMap((c) => [c.id, c.userId]),
      ...seed.shortlists.map((s) => s.id),
      ...seed.inquiries.map((q) => q.id),
      ...seed.documents.map((d) => d.id),
      ...seed.audit.map((e) => e.id),
      ...seed.exhibitions.map((e) => e.id),
      ...seed.openCalls.map((c) => c.id),
      ...seed.applications.map((a) => a.id),
      ...seed.events.map((e) => e.id),
      ...seed.stories.map((t) => t.id),
      ...seed.buyerInquiries.map((q) => q.id),
      ...seed.lots.map((l) => l.id),
      ...seed.payouts.map((p) => p.id),
    ];
    for (const id of ids) expect(demoUuid(id), id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(Object.values(DEMO_UUIDS)).size).toBe(Object.values(DEMO_UUIDS).length);
  });

  it('exposes the same identities as mock mode, keyed by UUID', () => {
    expect(SUPABASE_DEMO_IDENTITIES.map((d) => [d.id, d.label, d.caption])).toEqual(DEMO_IDENTITIES.map((d) => [d.id, d.label, d.caption]));
    const lena = SUPABASE_DEMO_IDENTITIES.find((d) => d.id === 'lena')!;
    expect(lena.viewer.userId).toBe(DEMO_UUIDS.user_lena);
    expect(lena.viewer.curatorId).toBe(DEMO_UUIDS.cur_lena);
    expect(demoEmailForUserUuid(DEMO_UUIDS.user_lena)).toBe('demo+lena@example.com');
  });
});

describe('SupabaseDataSource (offline)', () => {
  const make = () =>
    createSupabaseDataSource('http://127.0.0.1:1', 'test-anon-key', {
      demoAutoSignIn: false,
      clientOptions: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    });

  it('reports supabase mode and lists the demo identities without a network call', async () => {
    const ds = make();
    expect(ds.mode).toBe('supabase');
    expect((await ds.listDemoIdentities()).length).toBe(DEMO_IDENTITIES.length);
  });

  it('refuses to act for a signed-in viewer when there is no matching Supabase session', async () => {
    const ds = make();
    const mara = SUPABASE_DEMO_IDENTITIES.find((d) => d.id === 'mara')!.viewer;
    await expect(ds.getMyArtist(mara)).rejects.toThrow(SESSION_ENDED_MESSAGE);
    await expect(ds.saveArtwork(mara, {} as never)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a demo reset without a staff session', async () => {
    await expect(make().resetDemoData()).rejects.toBeInstanceOf(ForbiddenError);
  });

  /** A fetch stand-in that records each request and answers with a canned PostgREST response. */
  function recordingFetch(respond: (url: string) => { status: number; body: unknown }) {
    const calls: { url: string; method: string; headers: Headers }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), headers: new Headers(init?.headers) });
      const r = respond(url);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchImpl };
  }
  const makeWith = (fetchImpl: typeof fetch) =>
    createSupabaseDataSource('http://127.0.0.1:1', 'test-anon-key', {
      demoAutoSignIn: false,
      clientOptions: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchImpl } },
    });
  const visitor = SUPABASE_DEMO_IDENTITIES.find((d) => d.viewer.role === 'public')!.viewer;

  it('reads tables and views from the kofi schema (Accept-Profile: kofi), not public', async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({ status: 200, body: [] }));
    const ds = makeWith(fetchImpl as typeof fetch);
    expect(await ds.listArtists(visitor)).toEqual([]);
    expect(await ds.listArtworks(visitor)).toEqual([]);
    const rest = calls.filter((c) => c.url.includes('/rest/v1/'));
    expect(rest.map((c) => new URL(c.url).pathname)).toEqual(['/rest/v1/artists_visible', '/rest/v1/artworks_visible']);
    for (const c of rest) expect(c.headers.get('Accept-Profile')).toBe('kofi');
  });

  it('calls RPCs in the kofi schema (Content-Profile: kofi)', async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({ status: 200, body: [] }));
    const ds = makeWith(fetchImpl as typeof fetch);
    // rpc() is private; drive it directly so the request shape is checked without a live session.
    const internals = ds as unknown as { rpc: (db: unknown, fn: string, args?: Record<string, unknown>) => Promise<unknown>; anonClient: unknown };
    await internals.rpc(internals.anonClient, 'whoami');
    const rpc = calls.find((c) => c.url.includes('/rest/v1/rpc/whoami'));
    expect(rpc?.method).toBe('POST');
    expect(rpc?.headers.get('Content-Profile')).toBe('kofi');
  });

  it('turns a "schema not exposed" response into the setup instruction', async () => {
    const { fetchImpl } = recordingFetch(() => ({
      status: 406,
      body: { code: 'PGRST106', details: null, hint: 'Only the following schemas are exposed: public, graphql_public', message: 'Invalid schema: kofi' },
    }));
    await expect(makeWith(fetchImpl as typeof fetch).listArtists(visitor)).rejects.toThrow(SCHEMA_NOT_EXPOSED_MESSAGE);
  });
});

/* ------------------------------------------------------------ programme -- */

describe('programme error mapping', () => {
  it('maps programme CHECK constraints to the mock validators\' messages', () => {
    expect(mapPgError({ code: '23514', message: 'new row for relation "exhibitions" violates check constraint "exhibitions_dates_order"' })).toEqual(
      new ValidationError('The end date is before the start date.', 'endsOn'),
    );
    expect(mapPgError({ code: '23514', message: 'new row for relation "open_calls" violates check constraint "open_calls_max_works_range"' })).toEqual(
      new ValidationError('Allow between 1 and 10 works.', 'maxWorks'),
    );
    expect(mapPgError({ code: '23514', message: 'new row for relation "stories" violates check constraint "stories_image_alt"' })).toEqual(
      new ValidationError('Image description is required.', 'image'),
    );
  });

  it('reports a deleted linked exhibition / artist like checkProgrammeRefs, other FKs as NotFound', () => {
    const fk = mapPgError({ code: '23503', message: 'insert or update on table "open_calls" violates foreign key constraint "open_calls_exhibition_id_fkey"' });
    expect(fk).toEqual(new ValidationError('That exhibition no longer exists.', 'exhibitionId'));
    expect(mapPgError({ code: '23503', message: 'violates foreign key constraint "stories_artist_id_fkey"' })).toEqual(new ValidationError('That artist no longer exists.', 'artistId'));
    expect(mapPgError({ code: '23503', message: 'violates foreign key constraint "shortlist_items_artwork_id_fkey"' })).toBeInstanceOf(NotFoundError);
  });

  it('keeps RPC rule messages and fields (22023 + hint)', () => {
    const e = mapPgError({ code: '22023', message: 'This call has applications. Unpublish it instead.', hint: 'call' });
    expect(e).toEqual(new ValidationError('This call has applications. Unpublish it instead.', 'call'));
  });
});

describe('programme mappers', () => {
  const seed = buildSeed();
  const U = (id: string) => demoUuid(id) ?? id;
  const meta = { sample: true, published: true, created_at: '2026-10-01T14:00:00+00:00', updated_at: '2026-10-02T14:00:00+00:00' };

  it('formats event times in Kofi\'s offset, like the mock seed', () => {
    expect(toKofiOffsetIso('2026-10-29T22:30:00+00:00')).toBe('2026-10-29T18:30:00-04:00');
    expect(toKofiOffsetIso('2026-11-08T18:00:00Z')).toBe('2026-11-08T13:00:00-05:00');
    expect(toKofiOffsetIso('2027-01-01T04:59:59Z')).toBe('2026-12-31T23:59:59-05:00');
    for (const ev of seed.events) expect(Date.parse(toKofiOffsetIso(ev.startsAt))).toBe(Date.parse(ev.startsAt));
  });

  it('round-trips programme image refs and public URLs', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/public/kofi-programme/exhibitions/1f0e.jpg';
    expect(normalizeProgrammeImageSrc(url)).toBe('storage:kofi-programme/exhibitions/1f0e.jpg');
    expect(programmePathOf('storage:kofi-programme/exhibitions/1f0e.jpg')).toBe('exhibitions/1f0e.jpg');
    expect(normalizeProgrammeImageSrc('/art/hero.jpg')).toBe('/art/hero.jpg');
    expect(normalizeProgrammeImageSrc('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
  });

  it('maps every seeded exhibition / call / event / story to a row and back unchanged', () => {
    for (const ex of seed.exhibitions) {
      const { id, createdAt, updatedAt, ...authored } = ex;
      const row = { id, ...meta, ...exhibitionToRow(authored) } as unknown as ExhibitionRow;
      expect(toExhibition({ ...row, sample: ex.sample, published: ex.published })).toEqual({ ...ex, createdAt: '2026-10-01T14:00:00.000Z', updatedAt: '2026-10-02T14:00:00.000Z' });
      void createdAt;
      void updatedAt;
    }
    for (const c of seed.openCalls) {
      const { id, createdAt: _c, updatedAt: _u, ...authored } = c;
      const row = { id, ...meta, ...openCallToRow(authored) } as unknown as OpenCallRow;
      expect(toOpenCall({ ...row, sample: c.sample, published: c.published })).toEqual({ ...c, createdAt: '2026-10-01T14:00:00.000Z', updatedAt: '2026-10-02T14:00:00.000Z' });
    }
    for (const e of seed.events) {
      const { id, createdAt: _c, updatedAt: _u, ...authored } = e;
      const row = { id, ...meta, ...eventToRow(authored) } as unknown as EventRow;
      expect(toProgrammeEvent({ ...row, sample: e.sample, published: e.published })).toEqual({ ...e, createdAt: '2026-10-01T14:00:00.000Z', updatedAt: '2026-10-02T14:00:00.000Z' });
    }
    for (const t of seed.stories) {
      const { id, createdAt: _c, updatedAt: _u, ...authored } = t;
      const row = { id, ...meta, ...storyToRow(authored) } as unknown as StoryRow;
      expect(toStory({ ...row, sample: t.sample, published: t.published })).toEqual({ ...t, createdAt: '2026-10-01T14:00:00.000Z', updatedAt: '2026-10-02T14:00:00.000Z' });
    }
  });

  it('writes NULL for cleared optional fields so an update really clears them', () => {
    const row = exhibitionToRow({ title: 'T', startsOn: '2027-01-01', summary: 'S', body: '', artworkIds: [], sample: false, published: false });
    expect(row).toMatchObject({ subtitle: null, ends_on: null, venue: null, image: null, external_url: null, curated_by: null });
    expect(Object.keys(row)).not.toContain('id');
    expect(Object.keys(row)).not.toContain('created_at');
  });

  it('builds application rows without the staff note when the view withheld it', () => {
    const app = seed.applications.find((a) => a.staffNote)!;
    const row: ApplicationViewRow = {
      id: U(app.id),
      call_id: U(app.callId),
      artist_id: U(app.artistId),
      artwork_ids: app.artworkIds.map(U),
      statement: app.statement,
      status: app.status,
      decision_note: app.decisionNote ?? null,
      staff_note: null,
      created_at: app.createdAt,
      updated_at: app.updatedAt,
      decided_at: app.decidedAt ?? null,
      call_title: null,
      call_deadline: null,
      artist_working_name: null,
    };
    const out = toApplicationRow(row, []);
    expect(out).not.toHaveProperty('staffNote');
    expect(out.decisionNote).toBe(app.decisionNote);
    expect(out.callTitle).toBe('A call that has been removed');
    expect(out.artistWorkingName).toBe('Unknown artist');
  });
});

describe('SupabaseDataSource programme (offline)', () => {
  function recordingFetch(respond: (url: string, method: string) => { status: number; body: unknown }) {
    const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : '' });
      const r = respond(url, method);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchImpl };
  }
  const makeWith = (fetchImpl: typeof fetch) =>
    createSupabaseDataSource('http://127.0.0.1:1', 'test-anon-key', {
      demoAutoSignIn: false,
      clientOptions: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchImpl } },
    });
  const visitor = SUPABASE_DEMO_IDENTITIES.find((d) => d.viewer.role === 'public')!.viewer;

  it('reads the programme through the kofi *_visible views and serves bucket images by public URL', async () => {
    const ex = {
      id: 'a1000000-0000-4000-8000-000000000004', title: 'Night Weather', subtitle: null, starts_on: '2026-10-02', ends_on: '2026-11-22', venue: null,
      summary: 'S', body: '', image: { src: 'storage:kofi-programme/exhibitions/x.jpg', alt: 'A room' }, artwork_ids: [], external_url: null,
      curated_by: null, sample: true, published: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    };
    const { calls, fetchImpl } = recordingFetch((url) => ({ status: 200, body: url.includes('exhibitions_visible') ? [ex] : [] }));
    const ds = makeWith(fetchImpl as typeof fetch);
    const list = await ds.listExhibitions(visitor);
    expect(list[0]?.image?.src).toBe('http://127.0.0.1:1/storage/v1/object/public/kofi-programme/exhibitions/x.jpg');
    await ds.listOpenCalls(visitor);
    await ds.listEvents(visitor);
    await ds.listStories(visitor);
    const rest = calls.filter((c) => c.url.includes('/rest/v1/'));
    expect(rest.map((c) => new URL(c.url).pathname)).toEqual([
      '/rest/v1/exhibitions_visible', '/rest/v1/open_calls_visible', '/rest/v1/events_visible', '/rest/v1/stories_visible',
    ]);
    for (const c of rest) expect(c.headers.get('Accept-Profile')).toBe('kofi');
  });

  it('validates a collector inquiry client-side with the domain messages, then calls the RPC as anon', async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({ status: 200, body: 'a6ffffff-0000-4000-8000-000000000001' }));
    const ds = makeWith(fetchImpl as typeof fetch);
    const base = { name: 'Ada Visitor', email: 'ada@example.net', intent: 'purchase' as const, message: 'Is this still available?', consent: true };
    await expect(ds.submitBuyerInquiry(visitor, { ...base, consent: false })).rejects.toEqual(new ValidationError('Tick the box so Kofi can reply to you.', 'consent'));
    expect(calls).toHaveLength(0);
    const res = await ds.submitBuyerInquiry(visitor, { ...base, artworkId: DEMO_UUIDS.aw_mara_1 });
    expect(res).toEqual({ id: 'a6ffffff-0000-4000-8000-000000000001' });
    const rpc = calls.find((c) => c.url.endsWith('/rest/v1/rpc/submit_buyer_inquiry'))!;
    expect(rpc.headers.get('Content-Profile')).toBe('kofi');
    expect(JSON.parse(rpc.body)).toEqual({
      p_artwork: DEMO_UUIDS.aw_mara_1, p_name: 'Ada Visitor', p_email: 'ada@example.net', p_org: null, p_intent: 'purchase', p_message: 'Is this still available?', p_consent: true,
    });
  });

  it('refuses applications and admin desks for a visitor without a network call', async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({ status: 200, body: [] }));
    const ds = makeWith(fetchImpl as typeof fetch);
    await expect(ds.listMyApplications(visitor)).rejects.toEqual(new ForbiddenError('Sign in as an artist to apply.'));
    await expect(ds.submitApplication(visitor, { callId: DEMO_UUIDS.call_night_weather, artworkIds: [], statement: '' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listApplications(visitor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listBuyerInquiries(visitor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.saveExhibition(visitor, {} as never)).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toHaveLength(0);
  });
});

describe('sales (0009)', () => {
  const seed = buildSeed();

  it('maps the auction call’s kind, organiser and terms both ways', () => {
    const cma = seed.openCalls.find((c) => c.id === 'call_cma_auction')!;
    const row = openCallToRow(cma);
    expect(row).toMatchObject({ kind: 'auction', organizer_institution_id: 'inst_cma', terms: cma.terms });
    const nw = openCallToRow(seed.openCalls.find((c) => c.id === 'call_night_weather')!);
    expect(nw).toMatchObject({ kind: 'award', organizer_institution_id: null, terms: null });
    const back = toOpenCall({ ...(row as unknown as OpenCallRow), id: cma.id, created_at: cma.createdAt, updated_at: cma.updatedAt });
    expect(back.kind).toBe('auction');
    expect(back.terms).toEqual(cma.terms);
    expect(toOpenCall({ ...(nw as unknown as OpenCallRow), id: 'x', created_at: cma.createdAt, updated_at: cma.updatedAt, kind: null }).kind).toBe('exhibition');
  });

  const lotRow = (l: (typeof seed.lots)[number], payout: (typeof seed.payouts)[number] | undefined, sale = l.sale): LotViewRow => ({
    id: l.id, call_id: l.callId, application_id: l.applicationId, artwork_id: l.artworkId, artist_id: l.artistId, lot_number: l.lotNumber,
    reserve: l.reserve ?? null, starting_bid: l.startingBid ?? null, status: l.status, sale: sale ?? null,
    payout: payout
      ? { id: payout.id, lot_id: payout.lotId, artist_id: payout.artistId, amount: String(payout.amount), currency: payout.currency, status: payout.status, method: payout.method ?? null,
          reference: payout.reference ?? null, paid_at: payout.paidAt ? payout.paidAt.replace('.000Z', '+00:00') : null, note: null, created_at: payout.createdAt, updated_at: payout.updatedAt }
      : null,
    call_title: 'Night Weather Benefit Auction', call_kind: 'auction', artwork_title: 'Doubling', artist_working_name: 'Mara Oyelaran', created_at: l.createdAt, updated_at: l.updatedAt,
  });

  it('maps lots_visible rows to LotRow (cents as numbers, optional fields omitted, payout attached)', () => {
    const [l1, l2] = seed.lots;
    const r1 = toLotRow(lotRow(l1!, seed.payouts[0]));
    expect(r1).toMatchObject({ id: l1!.id, lotNumber: 1, reserve: 600000, status: 'sold', callKind: 'auction', artworkTitle: 'Doubling' });
    expect(r1.sale).toEqual(l1!.sale);
    expect(r1.payout).toEqual(seed.payouts[0]);
    expect('startingBid' in r1).toBe(false);
    const r2 = toLotRow({ ...lotRow(l2!, undefined), call_title: null, call_kind: null, artwork_title: null, artist_working_name: null });
    expect(r2.sale).toBeUndefined();
    expect(r2.payout).toBeUndefined();
    expect([r2.callTitle, r2.callKind, r2.artworkTitle, r2.artistWorkingName]).toEqual(['A call that has been removed', 'auction', 'A work that has been removed', 'Unknown artist']);
  });

  it('an artist’s lot (the view already removed buyerRef) equals projectLotForArtist of the full lot', () => {
    const l1 = seed.lots[0]!;
    const { buyerRef: _drop, ...artistSale } = l1.sale!;
    const asArtist = toLotRow(lotRow(l1, seed.payouts[0], artistSale as typeof l1.sale));
    const full = toLotRow(lotRow(l1, seed.payouts[0]));
    expect(asArtist).toEqual(projectLotForArtist(full));
    expect(JSON.stringify(asArtist)).not.toContain('buyerRef');
  });

  it('maps payouts_visible rows with the mock fallbacks', () => {
    const p = seed.payouts[1]!;
    const row: PayoutViewRow = {
      id: p.id, lot_id: p.lotId, artist_id: p.artistId, amount: p.amount, currency: p.currency, status: p.status, method: p.method ?? null, reference: p.reference ?? null,
      paid_at: '2026-10-19T12:00:00-04:00', note: null, created_at: p.createdAt, updated_at: p.updatedAt,
      artist_working_name: null, artwork_title: null, call_title: null, lot_number: null,
    };
    expect(toPayoutRow(row)).toEqual({ ...p, artistWorkingName: 'Unknown artist', artworkTitle: 'A work that has been removed', callTitle: 'A call that has been removed', lotNumber: 0 });
  });

  it('serialises LotInput for save_lot without undefined / null money', () => {
    expect(lotInputToJson({ callId: 'c', applicationId: 'a', artworkId: 'w', lotNumber: 2, reserve: undefined, startingBid: null as unknown as number })).toEqual({ callId: 'c', applicationId: 'a', artworkId: 'w', lotNumber: 2 });
    expect(lotInputToJson({ id: 'l', callId: 'c', applicationId: 'a', artworkId: 'w', lotNumber: 2, reserve: 0 })).toEqual({ id: 'l', callId: 'c', applicationId: 'a', artworkId: 'w', lotNumber: 2, reserve: 0 });
  });

  it('assembleReport() puts server rows in buildReport order and computes the same totals', () => {
    const range = { from: '2026-01-01', to: '2026-12-31' };
    const expected = buildReport(
      { artists: seed.artists, artworks: seed.artworks, calls: seed.openCalls, institutions: seed.institutions, exhibitions: seed.exhibitions, applications: seed.applications, lots: seed.lots, payouts: seed.payouts },
      range,
      '2026-10-20T12:00:00.000Z',
    );
    expect(expected.payments).toHaveLength(2);
    const shuffle = <T>(xs: T[]) => [...xs].reverse();
    const got = assembleReport(range, { participation: shuffle(expected.participation), placements: shuffle(expected.placements), payments: shuffle(expected.payments) }, '2026-10-20T12:00:00.000Z');
    expect(got.totals).toEqual(expected.totals);
    expect(got.participation.map((r) => [r.submittedOn, r.artistWorkingName])).toEqual(expected.participation.map((r) => [r.submittedOn, r.artistWorkingName]));
    expect(got.payments).toEqual(expected.payments);
    expect(got.totals).toMatchObject({ lotsSold: 2, hammerTotal: { USD: 980000 }, artistPaid: { USD: 112000 }, artistDue: { USD: 574000 } });
  });

  it('maps the sales constraints and the organiser FK to the mock messages', () => {
    expect(mapPgError({ code: '23503', message: 'insert or update on table "open_calls" violates foreign key constraint "open_calls_organizer_institution_id_fkey"' })).toEqual(
      new ValidationError('That institution no longer exists.', 'organizerInstitutionId'),
    );
    expect(mapPgError({ code: '23514', message: 'new row for relation "lots" violates check constraint "lots_starting_bid_reserve"' })).toEqual(
      new ValidationError('The starting bid cannot be above the reserve.', 'startingBid'),
    );
    expect(mapPgError({ code: '22023', message: 'Payout already paid.', hint: 'status' })).toEqual(new ValidationError('Payout already paid.', 'status'));
  });

  it('refuses partner / sales / report desks for a visitor without a network call', async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      calls.push(String(input));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ds = createSupabaseDataSource('http://127.0.0.1:1', 'test-anon-key', {
      demoAutoSignIn: false,
      clientOptions: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchImpl as typeof fetch } },
    });
    const visitor = SUPABASE_DEMO_IDENTITIES.find((d) => d.viewer.role === 'public')!.viewer;
    const lot = { callId: DEMO_UUIDS.call_cma_auction, applicationId: DEMO_UUIDS.app_mara_cma, artworkId: DEMO_UUIDS.aw_mara_1, lotNumber: 1 };
    await expect(ds.listMyCalls(visitor)).rejects.toEqual(new ForbiddenError('You do not have access to this.'));
    await expect(ds.listApplications(visitor, DEMO_UUIDS.call_cma_auction)).rejects.toEqual(new ForbiddenError('You do not have access to this.'));
    await expect(ds.setApplicationStatus(visitor, DEMO_UUIDS.app_mara_cma, 'accepted')).rejects.toEqual(new ForbiddenError('You do not have access to this.'));
    await expect(ds.listLots(visitor)).rejects.toEqual(new ForbiddenError('You do not have access to this.'));
    await expect(ds.saveLot(visitor, lot)).rejects.toEqual(new ForbiddenError('You do not have access to this.'));
    await expect(ds.setLotStatus(visitor, DEMO_UUIDS.lot_cma_2, 'unsold')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.recordSale(visitor, DEMO_UUIDS.lot_cma_2, { hammerPrice: 100000, soldOn: '2026-10-18' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.deleteLot(visitor, DEMO_UUIDS.lot_cma_2)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listMyLots(visitor)).rejects.toEqual(new ForbiddenError('Sign in as an artist to do this.'));
    await expect(ds.listPayouts(visitor)).rejects.toEqual(new ForbiddenError('Kofi staff only.'));
    await expect(ds.setPayoutStatus(visitor, DEMO_UUIDS.payout_cma_1, 'paid', { method: 'x' })).rejects.toEqual(new ForbiddenError('Kofi staff only.'));
    await expect(ds.kofiReport(visitor, { from: '2026-10-01', to: '2026-10-31' })).rejects.toEqual(new ForbiddenError('Kofi staff only.'));
    await expect(ds.saveOpenCall(visitor, { title: 'x' } as never)).rejects.toEqual(new ForbiddenError('Kofi staff only.'));
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ intake (0010) -- */

describe('intake (0010)', () => {
  const base: ArtistViewRow = {
    id: DEMO_UUIDS.art_mara, working_name: 'Mara Oyelaran', pronouns: null, bio: 'Painter.', statement: null, mediums: ['painting'],
    career_stage: 'mid-career', experience_commissions: false, experience_public_art: false, experience_residencies: false,
    experience_institutional_shows: false, experience_years_practicing: null, availability_commissions: false, availability_sales: false,
    availability_exhibitions: false, links: [], status: 'approved', visibility: 'public', avatar_color: '#2436F5',
    created_at: '2026-07-18T12:00:00Z', updated_at: '2026-08-29T12:00:00Z', region_label: 'Pittsburgh, Pennsylvania', region_city: null,
    region_region: null, region_country: null, region_precision: null, legal_name: null, contact_email: null, contact_phone: null,
    contact_studio_address: null, kofi_notes: null, consent_version: null, consent_accepted_at: null, can_edit: false,
  };
  const record = { source: { label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram' as const, handle: '@mara.paints' }, fetchedAt: '2026-10-22T12:00:00.000Z', appliedFields: ['workingName' as const, 'bio' as const], notes: [] };

  it('an owner row carries the token, the imports and each link’s verification', () => {
    const v = toArtistView({
      ...base,
      can_edit: true,
      links: [
        { label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints', verification: 'verified', checkedAt: '2026-10-22T12:00:00.000Z' },
        { label: 'mara-oyelaran.com', url: 'https://www.mara-oyelaran.com', platform: 'website', handle: 'mara-oyelaran.com', verification: 'claimed' },
      ],
      verification_token: 'kofi-7f3a2k',
      imports: [record],
    });
    expect(v.verificationToken).toBe('kofi-7f3a2k');
    expect(v.imports).toEqual([record]);
    expect(v.links[0]).toEqual({ label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints', verification: 'verified', checkedAt: '2026-10-22T12:00:00.000Z' });
    expect(v.links[1]!.verification).toBe('claimed');
  });

  it('a public row (the view stripped them) has no token, no imports and no verification keys', () => {
    const v = toArtistView({ ...base, links: [{ label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints' }], verification_token: null, imports: null });
    expect('verificationToken' in v).toBe(false);
    expect('imports' in v).toBe(false);
    expect(v.links).toEqual([{ label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints' }]);
    expect(JSON.stringify(v)).not.toMatch(/kofi-|verification|checkedAt/);
    // A pre-0010 project: the columns are absent altogether.
    expect(toArtistView(base).links).toEqual([]);
  });

  it('owner writes derive platform / handle from the URL and never send a verification', () => {
    expect(artistLinkToJson({ label: 'IG', url: 'https://www.instagram.com/mara.paints', verification: 'verified', checkedAt: 'x' })).toEqual({ label: 'IG', url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints' });
    expect(artistLinkToJson({ label: 'Site', url: 'https://www.mara-oyelaran.com/' })).toEqual({ label: 'Site', url: 'https://www.mara-oyelaran.com/', platform: 'website', handle: 'mara-oyelaran.com' });
    const row = artistPatchToRow({ links: [{ label: 'x', url: 'https://www.linkedin.com/in/mara-oyelaran', platform: 'other', handle: 'nope', verification: 'verified' }] });
    expect(row).toEqual({ links: [{ label: 'x', url: 'https://www.linkedin.com/in/mara-oyelaran', platform: 'linkedin', handle: 'mara-oyelaran' }] });
  });

  it('the owner export round-trips token, imports and typed links', () => {
    const row: ArtistRow = { ...base, user_id: DEMO_UUIDS.user_mara, contact_email: 'mara@example.com', region_region: 'Pennsylvania', region_country: 'United States', region_precision: 'region', links: [{ label: 'a', url: 'https://a.example', platform: 'website', handle: 'a.example', verification: 'failed', checkedAt: '2026-10-22T12:00:00.000Z' }], verification_token: 'kofi-7f3a2k', imports: [record] };
    const a = toArtist(row);
    expect(a.verificationToken).toBe('kofi-7f3a2k');
    expect(a.imports).toEqual([record]);
    expect(a.links[0]).toMatchObject({ verification: 'failed', checkedAt: '2026-10-22T12:00:00.000Z' });
  });

  /** fetch stand-in: routes by path; records calls. */
  function stub(routes: Record<string, (body: unknown) => { status: number; body: unknown }>) {
    const calls: { path: string; body: unknown }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      let body: unknown = undefined;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        body = init?.body;
      }
      calls.push({ path: url.pathname, body });
      const r = routes[url.pathname]?.(body) ?? { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchImpl: fetchImpl as typeof fetch };
  }
  const make = (fetchImpl: typeof fetch, signUp: 'on' | 'off' | undefined = 'on') =>
    createSupabaseDataSource('http://127.0.0.1:1', 'test-anon-key', {
      demoAutoSignIn: false,
      ...(signUp ? { signUp } : {}),
      publicAppUrl: 'https://app.koficollections.org/',
      clientOptions: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchImpl } },
    });
  const ok = { displayName: 'Flow Tester', email: 'Flow@Example.com', password: 'rain on liberty avenue', consentVersion: CONSENT_VERSION };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (sub: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const userJson = (id: string, identities: unknown[] = [{ id: 'i' }]) => ({ id, aud: 'authenticated', role: 'authenticated', email: 'flow@example.com', identities, app_metadata: {}, user_metadata: {}, created_at: '2026-10-22T12:00:00Z' });

  it('sign-up is off unless VITE_KOFI_SIGNUP=on, with no network call', async () => {
    const { calls, fetchImpl } = stub({});
    const ds = createSupabaseDataSource('http://127.0.0.1:1', 'k', { demoAutoSignIn: false, clientOptions: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchImpl } } });
    await expect(ds.signUpArtist(ok)).rejects.toEqual(new ValidationError(SIGNUP_CLOSED_MESSAGE, 'email'));
    await expect(make(fetchImpl, 'off').signUpArtist(ok)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('validates before calling GoTrue, then sends kofi_role / display name / consent', async () => {
    const { calls, fetchImpl } = stub({ '/auth/v1/signup': () => ({ status: 200, body: userJson('11111111-1111-4111-8111-111111111111') }) });
    const ds = make(fetchImpl);
    const e = await ds.signUpArtist({ ...ok, password: 'short' }).catch((x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.field).toBe('password');
    expect(calls).toHaveLength(0);
    const res = await ds.signUpArtist(ok);
    expect(res).toEqual({ viewer: { role: 'public', displayName: 'Visitor' }, emailConfirmationRequired: true });
    const sent = calls.find((c) => c.path === '/auth/v1/signup')!.body as { email: string; data: Record<string, string> };
    expect(sent.email).toBe('flow@example.com');
    expect(sent.data).toEqual({ kofi_role: 'artist', display_name: 'Flow Tester', kofi_consent_version: CONSENT_VERSION });
  });

  it('an existing email is a ConflictError (obfuscated user and explicit error)', async () => {
    const a = stub({ '/auth/v1/signup': () => ({ status: 200, body: userJson('22222222-2222-4222-8222-222222222222', []) }) });
    await expect(make(a.fetchImpl).signUpArtist(ok)).rejects.toBeInstanceOf(ConflictError);
    const b = stub({ '/auth/v1/signup': () => ({ status: 422, body: { code: 'user_already_exists', msg: 'User already registered' } }) });
    const err = await make(b.fetchImpl).signUpArtist(ok).catch((x) => x);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.field).toBe('email');
  });

  it('with a session: makes the draft artist (ensure_my_artist) and returns the server’s viewer', async () => {
    const uid = '33333333-3333-4333-8333-333333333333';
    const aid = '44444444-4444-4444-8444-444444444444';
    const { calls, fetchImpl } = stub({
      '/auth/v1/signup': () => ({ status: 200, body: { access_token: jwt(uid), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userJson(uid) } }),
      '/rest/v1/rpc/ensure_my_artist': () => ({ status: 200, body: aid }),
      '/rest/v1/rpc/whoami': () => ({ status: 200, body: [{ user_id: uid, role: 'artist', display_name: 'Flow Tester', artist_id: aid, curator_id: null, curator_verified: false }] }),
    });
    const res = await make(fetchImpl).signUpArtist(ok);
    expect(res.emailConfirmationRequired).toBe(false);
    expect(res.viewer).toEqual({ role: 'artist', userId: uid, displayName: 'Flow Tester', artistId: aid });
    expect(calls.map((c) => c.path)).toEqual(['/auth/v1/signup', '/rest/v1/rpc/ensure_my_artist', '/rest/v1/rpc/whoami']);
  });

  async function signedIn(routes: Parameters<typeof stub>[0], role: 'artist' | 'admin' = 'artist') {
    const uid = role === 'artist' ? DEMO_UUIDS.user_mara : DEMO_UUIDS.user_quincy;
    const s = stub({
      '/auth/v1/user': () => ({ status: 200, body: userJson(uid) }),
      '/rest/v1/rpc/whoami': () => ({ status: 200, body: [{ user_id: uid, role, display_name: 'x', artist_id: role === 'artist' ? DEMO_UUIDS.art_mara : null, curator_id: null, curator_verified: false }] }),
      '/rest/v1/rpc/log_audit': () => ({ status: 200, body: null }),
      ...routes,
    });
    const ds = make(s.fetchImpl);
    await (ds as unknown as { client: { auth: { setSession: (x: { access_token: string; refresh_token: string }) => Promise<unknown> } } }).client.auth.setSession({ access_token: jwt(uid), refresh_token: 'r' });
    const viewer = role === 'artist'
      ? { role: 'artist' as const, userId: uid, displayName: 'Mara', artistId: DEMO_UUIDS.art_mara }
      : { role: 'admin' as const, userId: uid, displayName: 'Quincy' };
    return { ds, viewer, calls: s.calls };
  }

  it('importProfile: refuses visitors and private addresses; falls back to the handle when the reader is not deployed', async () => {
    const visitor = SUPABASE_DEMO_IDENTITIES.find((d) => d.viewer.role === 'public')!.viewer;
    await expect(make(stub({}).fetchImpl).importProfile(visitor, '@mara.paints')).rejects.toBeInstanceOf(ForbiddenError);
    const { ds, viewer, calls } = await signedIn({});
    await expect(ds.importProfile(viewer, 'http://localhost:54321/x')).rejects.toEqual(new ValidationError('That link cannot be read. Use a public http or https address.', 'url'));
    const imp = await ds.importProfile(viewer, '@mara.paints');
    expect(imp.source).toEqual({ label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram', handle: '@mara.paints', verification: 'claimed' });
    expect(imp.fields.workingName).toBe('Mara Paints');
    expect(imp.confidence.workingName).toBe(0.3);
    expect(imp.notes[0]).toBe(READER_OFFLINE_NOTE);
    expect(calls.some((c) => c.path === '/functions/v1/profile-import')).toBe(true);
    expect(calls.find((c) => c.path === '/rest/v1/rpc/log_audit')?.body).toMatchObject({ p_action: 'artist.import', p_entity_id: DEMO_UUIDS.art_mara });
  });

  it('importProfile: turns the reader’s signals into suggestions; an unreadable page keeps the handle and says why', async () => {
    let reachable = true;
    const { ds, viewer } = await signedIn({
      '/functions/v1/profile-import': () => ({
        status: 200,
        body: reachable
          ? { reachable: true, fetchedAt: '2026-10-22T12:00:00.000Z', signals: { ogTitle: 'Mara Oyelaran (@mara.paints) • Instagram photos and videos', ogDescription: '1,234 Followers, 56 Following, 78 Posts - Mara Oyelaran (@mara.paints) on Instagram: "Painter. Pittsburgh."' } }
          : { reachable: false, fetchedAt: '2026-10-22T12:00:00.000Z', reason: 'The page could not be reached.', signals: {} },
      }),
    });
    const imp = await ds.importProfile(viewer, 'instagram.com/mara.paints');
    expect(imp.fields).toMatchObject({ workingName: 'Mara Oyelaran', bio: 'Painter. Pittsburgh.', followers: 1234, postCount: 78 });
    expect(imp.fetchedAt).toBe('2026-10-22T12:00:00.000Z');
    reachable = false;
    const thin = await ds.importProfile(viewer, '@mara.paints');
    expect(thin.notes[0]).toBe('The page could not be reached. We used your handle.');
    expect(thin.fields.workingName).toBe('Mara Paints');
  });

  it('recordImport calls record_import; checkMyLinks says the checker is offline instead of guessing', async () => {
    const { ds, viewer, calls } = await signedIn({
      '/rest/v1/rpc/record_import': () => ({ status: 200, body: null }),
      '/rest/v1/artists_visible': () => ({ status: 200, body: { ...base, can_edit: true, links: [{ label: 'a', url: 'https://www.instagram.com/mara.paints', verification: 'claimed' }], verification_token: 'kofi-7f3a2k', imports: [record] } }),
    });
    const v = await ds.recordImport(viewer, record);
    expect(calls.find((c) => c.path === '/rest/v1/rpc/record_import')?.body).toEqual({ p_record: record });
    expect(v.imports).toEqual([record]);
    await expect(ds.checkMyLinks(viewer)).rejects.toThrow(CHECKER_OFFLINE_MESSAGE);
    const sent = calls.find((c) => c.path === '/functions/v1/profile-import')!.body;
    expect(sent).toEqual({ url: 'https://www.instagram.com/mara.paints', verify: true, profileUrl: `https://app.koficollections.org/#/artists/${DEMO_UUIDS.art_mara}` });
  });

  it('checkMyLinks: an artist cannot check someone else; Kofi passes the artist id', async () => {
    const mara = await signedIn({});
    await expect(mara.ds.checkMyLinks(mara.viewer, DEMO_UUIDS.art_june)).rejects.toEqual(new ForbiddenError('Kofi staff only.'));
    const admin = await signedIn({
      '/rest/v1/artists_visible': () => ({ status: 200, body: { ...base, id: DEMO_UUIDS.art_june, can_edit: true, links: [{ label: 'a', url: 'https://www.instagram.com/june.weaves' }], verification_token: 'kofi-jw4b8t', imports: [] } }),
      '/functions/v1/profile-import': () => ({ status: 200, body: { verification: 'verified', checkedAt: '2026-10-22T12:00:00.000Z' } }),
    }, 'admin');
    const links = await admin.ds.checkMyLinks(admin.viewer, DEMO_UUIDS.art_june);
    expect(links).toHaveLength(1);
    expect(admin.calls.find((c) => c.path === '/functions/v1/profile-import')?.body).toMatchObject({ artistId: DEMO_UUIDS.art_june, verify: true });
  });
});
