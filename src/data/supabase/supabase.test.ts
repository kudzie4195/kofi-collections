import { describe, expect, it } from 'vitest';
import { buildSeed, DEMO_IDENTITIES } from '@/data/mock/seed';
import { NEVER_LEAK_ARTIST_KEYS } from '@/domain/visibility';
import { ForbiddenError, NotFoundError, ValidationError } from '../DataSource';
import { DEMO_UUIDS, SUPABASE_DEMO_IDENTITIES, demoEmailForUserUuid, demoUuid } from './demo';
import { mapPgError, SESSION_ENDED_MESSAGE, NETWORK_MESSAGE } from './errors';
import { blobToDataUrl, dataUrlToBlob, newUuid, parseDataUrl } from './files';
import {
  artistPatchToRow,
  artworkInputToJson,
  isUuid,
  normalizeImageSrc,
  storagePathOf,
  toArtistView,
  toArtworkView,
  toShortlist,
  type ArtistViewRow,
  type ArtworkViewRow,
} from './mapping';
import { createSupabaseDataSource } from './SupabaseDataSource';

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
});
