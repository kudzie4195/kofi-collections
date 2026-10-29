import type {
  Application,
  ArtDocument,
  Artist,
  Artwork,
  AuditEvent,
  CallCriteria,
  BuyerInquiry,
  Curator,
  DemoIdentity,
  Exhibition,
  Inquiry,
  Institution,
  Lot,
  OpenCall,
  Payout,
  ProgrammeEvent,
  Shortlist,
  Story,
  Venue,
} from '@/domain/types';
import type { ArtistLink, LinkVerification, ProfileImportRecord } from '@/domain/types';
import { CONSENT_VERSION, NO_USES } from '@/domain/types';
import { normalizeLink } from '@/domain/intake';
import { normalizeTagIds } from '@/domain/taxonomy';
import { placeholderArt } from './placeholderArt';
import { SAMPLE_LINKS, SEED_TOKENS } from './importFixtures';
import bundledArt from 'virtual:bundled-art';

/**
 * All content below is fictional. Names, institutions and works are invented
 * for demonstration (guide §07: "Use fictional test records").
 */

const T0 = '2026-09-01T12:00:00.000Z';
const d = (daysAgo: number) => new Date(Date.parse(T0) - daysAgo * 86_400_000).toISOString();

/** A typed link as the intake stores it (platform and handle derived from the URL). */
function link(label: string, url: string, verification: LinkVerification = 'claimed', checkedAt?: string): ArtistLink {
  const n = normalizeLink(url);
  if (!n) throw new Error(`Bad seed link ${url}`);
  const out: ArtistLink = { label, url: n.url, platform: n.platform, handle: n.handle, verification };
  if (checkedAt) out.checkedAt = checkedAt;
  return out;
}

const strip = (l: ArtistLink): ArtistLink => ({ label: l.label, url: l.url, platform: l.platform, handle: l.handle, verification: 'claimed' });

/**
 * v5 intake fields of the seeded artists: links, verification code and where the
 * profile came from. Also used by migrateState to upgrade a v4 device.
 */
export function seedIntake(): Record<string, { links: ArtistLink[]; verificationToken: string; imports: ProfileImportRecord[] }> {
  const maraIg = link('Instagram', SAMPLE_LINKS.maraInstagram, 'verified', d(40));
  const maraSite = link('Website', SAMPLE_LINKS.maraWebsite);
  const priyaSite = link('Website', SAMPLE_LINKS.priyaWebsite);
  const priyaLi = link('LinkedIn', SAMPLE_LINKS.priyaLinkedIn, 'unreachable', d(6));
  return {
    art_mara: {
      links: [maraSite, maraIg],
      verificationToken: SEED_TOKENS.art_mara,
      imports: [
        { source: strip(maraIg), fetchedAt: d(45), appliedFields: ['workingName'], notes: [] },
        { source: strip(maraSite), fetchedAt: d(45), appliedFields: ['city', 'region', 'country'], notes: [] },
      ],
    },
    art_tobias: { links: [link('Website', 'https://example.com/tobias')], verificationToken: SEED_TOKENS.art_tobias, imports: [] },
    art_june: {
      links: [link('Instagram', SAMPLE_LINKS.juneInstagram)],
      verificationToken: SEED_TOKENS.art_june,
      imports: [],
    },
    art_deshawn: { links: [link('Instagram', SAMPLE_LINKS.deshawnInstagram)], verificationToken: SEED_TOKENS.art_deshawn, imports: [] },
    art_priya: {
      links: [priyaSite, priyaLi],
      verificationToken: SEED_TOKENS.art_priya,
      imports: [
        { source: strip(priyaSite), fetchedAt: d(7), appliedFields: ['workingName', 'bio'], notes: [] },
        { source: strip(priyaLi), fetchedAt: d(7), appliedFields: [], notes: ['We could not read a name from the page, so this comes from the handle.'] },
      ],
    },
  };
}

/** The links v4 seeded (before typed links). migrateState swaps exactly these for the v5 sample links. */
export const V4_SEED_LINKS: Record<string, { label: string; url: string }[]> = {
  art_mara: [
    { label: 'Website', url: 'https://example.com/mara' },
    { label: 'Instagram', url: 'https://instagram.com/example_mara' },
  ],
  art_tobias: [{ label: 'Website', url: 'https://example.com/tobias' }],
  art_june: [{ label: 'Instagram', url: 'https://instagram.com/example_june' }],
  art_deshawn: [],
  art_priya: [{ label: 'Website', url: 'https://example.com/priya' }],
};

export interface MockState {
  artists: Artist[];
  artworks: Artwork[];
  institutions: Institution[];
  curators: Curator[];
  shortlists: Shortlist[];
  inquiries: Inquiry[];
  documents: ArtDocument[];
  /** Private payloads for documents (data URLs), keyed by fileRef. Never returned without authorization. */
  documentPayloads: Record<string, string>;
  audit: AuditEvent[];
  /* ---- programme (added in v3; older persisted states are migrated on load) ---- */
  exhibitions: Exhibition[];
  openCalls: OpenCall[];
  applications: Application[];
  events: ProgrammeEvent[];
  stories: Story[];
  buyerInquiries: BuyerInquiry[];
  /* ---- sales (added in v4; older persisted states are migrated on load) ---- */
  lots: Lot[];
  payouts: Payout[];
  /* ---- intake (added in v5; older persisted states are migrated on load) ---- */
  /** Artists who signed up on this device. Their identities join the demo picker. */
  accounts: MockAccount[];
  /* ---- v6 ---- */
  /** Data version. Absent on states saved before v6; migrateState brings them to MOCK_SCHEMA. */
  schema?: number;
}

/** Current mock data version (v6: tag ids, uses, editions, locations, call criteria). */
export const MOCK_SCHEMA = 6;

/**
 * A mock-mode sign-up. There is no password check in mock mode (the picker signs
 * people in), so the password is never stored. The email is kept only to refuse
 * a second account with the same address.
 */
export interface MockAccount {
  /** Lower-cased. */
  email: string;
  userId: string;
  artistId: string;
  identity: DemoIdentity;
  createdAt: string;
}

/** The collections added in v3. A persisted v2 state lacks them and gets the seeded programme merged in. */
export const PROGRAMME_KEYS = ['exhibitions', 'openCalls', 'applications', 'events', 'stories', 'buyerInquiries'] as const;
/** The collections added in v4. A persisted v3 state lacks them and gets the seeded auction merged in. */
export const SALES_KEYS = ['lots', 'payouts'] as const;
export type ProgrammeState = Pick<MockState, (typeof PROGRAMME_KEYS)[number] | (typeof SALES_KEYS)[number]>;

export const DEMO_USERS = {
  mara: 'user_mara',
  tobias: 'user_tobias',
  june: 'user_june',
  deshawn: 'user_deshawn',
  priya: 'user_priya',
  curatorLena: 'user_lena',
  curatorOwen: 'user_owen',
  admin: 'user_quincy',
} as const;

/**
 * Demo images. Works with a bundled photograph use it (public/art/*.jpg — artwork
 * photography from koficollections.org, re-encoded without metadata); the rest fall
 * back to a deterministic generated placeholder so the demo never depends on the network.
 */
export const BUNDLED_ART = new Set(['mara1', 'mara2', 'mara3', 'tobias1', 'june1', 'june2', 'june3', 'deshawn1', 'deshawn2', 'priya1', 'priya2']);
function img(seed: string, medium: Artwork['medium'], alt: string, isPrimary = true): Artwork['images'][number] {
  const src = BUNDLED_ART.has(seed) ? (bundledArt[`${seed}.jpg`] ?? `/art/${seed}.jpg`) : placeholderArt(seed, medium);
  return { id: `img_${seed}`, src, alt, isPrimary, metadataStripped: true };
}

/**
 * v6 classification of the demo works, as their (fictional) artists would tag them:
 * stable ids from the workbook library, sparse and descriptive. Social Impact is the
 * work's stated focus, chosen by the artist, never a claim about the artist. Uses are
 * the artist's opt-ins and are separate from sale status (the bridge study is not for
 * sale but may be exhibited). Migration (migrateState) and the Supabase live patch
 * apply the same table by work id.
 */
export const SEED_CLASSIFICATION: Record<string, Pick<Artwork, 'tagIds' | 'uses'> & Pick<Partial<Artwork>, 'edition'>> = {
  aw_mara_1: {
    tagIds: ['medium.painting', 'style.expressionism', 'style.figurative', 'subject.urban_life', 'theme.memory', 'material.oil', 'palette.warm'],
    uses: { auction: true, exhibition: true, licensing: false, commission: false },
  },
  aw_mara_2: {
    tagIds: ['medium.painting', 'style.figurative', 'subject.people', 'subject.urban_life', 'theme.memory', 'material.oil', 'palette.cool'],
    uses: { auction: true, exhibition: true, licensing: false, commission: false },
  },
  aw_mara_3: {
    tagIds: ['medium.drawing', 'style.figurative', 'subject.architecture', 'subject.urban_life', 'material.charcoal', 'material.paper'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
  },
  aw_tobias_1: {
    tagIds: ['medium.ceramics', 'medium.installation', 'style.contemporary', 'theme.community', 'material.clay', 'display_format.freestanding'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
  },
  aw_tobias_2: {
    tagIds: ['medium.ceramics', 'style.minimalism', 'theme.transformation', 'material.clay', 'palette.earth_tones'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
  },
  aw_tobias_3: {
    tagIds: ['medium.sculpture', 'style.abstract', 'social_impact.community_building', 'material.bronze', 'display_format.freestanding'],
    uses: { auction: false, exhibition: true, licensing: false, commission: true },
  },
  aw_june_1: {
    tagIds: ['medium.textile', 'style.contemporary', 'theme.heritage', 'social_impact.cultural_preservation', 'material.fabric', 'display_format.wall_mounted'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
  },
  aw_june_2: {
    tagIds: ['medium.textile', 'style.abstract', 'theme.heritage', 'social_impact.cultural_preservation', 'material.fabric', 'palette.vibrant'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
  },
  aw_june_3: {
    tagIds: ['medium.mixed_media', 'theme.heritage', 'material.fabric', 'material.found_objects'],
    uses: { auction: false, exhibition: false, licensing: false, commission: false },
  },
  aw_deshawn_1: {
    tagIds: ['medium.photography', 'style.realism', 'subject.people', 'subject.urban_life', 'theme.community', 'social_impact.workforce_development'],
    uses: { auction: true, exhibition: false, licensing: true, commission: false },
    edition: { type: 'limited', number: 2, size: 5 },
  },
  aw_deshawn_2: {
    // medium.video is an app addition, so it sorts after the workbook's tags.
    tagIds: ['subject.urban_life', 'subject.culture', 'theme.community', 'display_format.digital_display', 'medium.video'],
    uses: { auction: false, exhibition: false, licensing: true, commission: false },
  },
  aw_priya_1: {
    tagIds: ['medium.printmaking', 'medium.digital_art', 'style.abstract', 'material.ink', 'material.paper', 'palette.cool'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
    edition: { type: 'limited', size: 20 },
  },
  aw_priya_2: {
    tagIds: ['medium.printmaking', 'medium.digital_art', 'style.abstract', 'material.ink', 'material.paper', 'palette.multicolored'],
    uses: { auction: false, exhibition: true, licensing: false, commission: false },
    edition: { type: 'limited', size: 20 },
  },
};

/** What the two seeded calls are looking for (also applied by migrateState and the live patch where unset). */
export const SEED_CALL_CRITERIA: Record<string, CallCriteria> = {
  call_cma_auction: {
    tags: { theme: ['theme.community', 'theme.memory'] },
    uses: ['auction'],
    region: 'Pennsylvania',
    note: 'Work about the city at night and the people who keep it running.',
  },
  call_night_weather: {
    tags: { theme: ['theme.memory'], subject: ['subject.urban_life'] },
    uses: ['exhibition'],
  },
};

export function criteriaFor(callId: string): CallCriteria | undefined {
  const c = SEED_CALL_CRITERIA[callId];
  return c ? (JSON.parse(JSON.stringify(c)) as CallCriteria) : undefined;
}

function withClassification(a: Omit<Artwork, 'tagIds' | 'uses'>): Artwork {
  const c = SEED_CLASSIFICATION[a.id];
  // Library order, primary medium mirrored: exactly what saveArtwork would store.
  const out: Artwork = { ...a, tagIds: normalizeTagIds(c?.tagIds ?? [], a.medium).tagIds, uses: { ...(c?.uses ?? NO_USES) } };
  if (c?.edition) out.edition = { ...c.edition };
  return out;
}

export function buildSeed(): MockState {
  const artists: Artist[] = [
    {
      id: 'art_mara',
      userId: DEMO_USERS.mara,
      workingName: 'Mara Oyelaran',
      legalName: 'Omolara Oyelaran-Whitfield',
      pronouns: 'she/her',
      bio: 'Large-format oil painter working from a converted print shop in Pittsburgh. Mara builds surfaces in thin, repeated glazes until the color reads as light rather than pigment.',
      statement:
        'I paint the hour after a storm, when the city is wet enough to double itself. The work is slow because the light is fast.',
      region: { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', precision: 'city' },
      mediums: ['painting', 'drawing'],
      careerStage: 'mid-career',
      experience: { commissions: true, publicArt: true, residencies: true, institutionalShows: true, yearsPracticing: 14 },
      availability: { commissions: true, sales: true, exhibitions: true },
      links: [],
      contact: { email: 'mara@example.com', phone: '+1 412 555 0142', studioAddress: '19 Foundry St, Pittsburgh, PA' },
      kofiNotes: 'Onboarded Sept 2026. Strong fit for the airport commission call.',
      visibility: 'public',
      status: 'approved',
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: d(40),
      avatarColor: '#2436F5',
      createdAt: d(45),
      updatedAt: d(3),
    },
    {
      id: 'art_tobias',
      userId: DEMO_USERS.tobias,
      workingName: 'Tobias Reinholt',
      pronouns: 'he/him',
      bio: 'Ceramicist and installation artist. Tobias fires stoneware vessels at the edge of collapse and shows them in groups that behave like crowds.',
      region: { city: 'Braddock', region: 'Pennsylvania', country: 'United States', precision: 'region' },
      mediums: ['ceramics', 'sculpture', 'installation'],
      careerStage: 'established',
      experience: { commissions: true, publicArt: true, residencies: true, institutionalShows: true, yearsPracticing: 22 },
      availability: { commissions: true, sales: true, exhibitions: true },
      links: [],
      contact: { email: 'tobias@example.com' },
      visibility: 'public',
      status: 'approved',
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: d(38),
      avatarColor: '#FF5C39',
      createdAt: d(44),
      updatedAt: d(10),
    },
    {
      id: 'art_june',
      userId: DEMO_USERS.june,
      workingName: 'June Takahashi-Bell',
      pronouns: 'they/them',
      bio: 'Textile artist weaving with reclaimed industrial thread and hand-dyed wool. June’s wall works are built to be touched.',
      region: { city: 'Ottawa', region: 'Ontario', country: 'Canada', precision: 'city' },
      mediums: ['textile', 'mixed media'],
      careerStage: 'emerging',
      experience: { commissions: false, publicArt: false, residencies: true, institutionalShows: false, yearsPracticing: 4 },
      availability: { commissions: true, sales: true, exhibitions: true },
      links: [],
      contact: { email: 'june@example.com' },
      visibility: 'public',
      status: 'approved',
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: d(30),
      avatarColor: '#CFFF4A',
      createdAt: d(33),
      updatedAt: d(5),
    },
    {
      id: 'art_deshawn',
      userId: DEMO_USERS.deshawn,
      workingName: 'DeShawn Ferris',
      pronouns: 'he/him',
      bio: 'Photographer documenting the night shift — bakeries, hospitals, transit yards. Archival pigment prints in small editions.',
      region: { city: 'Philadelphia', region: 'Pennsylvania', country: 'United States', precision: 'country' },
      mediums: ['photography', 'video'],
      careerStage: 'mid-career',
      experience: { commissions: true, publicArt: false, residencies: false, institutionalShows: true, yearsPracticing: 11 },
      availability: { commissions: true, sales: true, exhibitions: false },
      links: [],
      contact: { email: 'deshawn@example.com' },
      visibility: 'public',
      status: 'approved',
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: d(25),
      avatarColor: '#FFD23F',
      createdAt: d(28),
      updatedAt: d(2),
    },
    {
      id: 'art_priya',
      userId: DEMO_USERS.priya,
      workingName: 'Priya Venkataraman',
      pronouns: 'she/her',
      bio: 'Printmaker and digital artist. Screen prints that start as code and end as ink.',
      region: { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', precision: 'city' },
      mediums: ['printmaking', 'digital'],
      careerStage: 'emerging',
      experience: { commissions: false, publicArt: false, residencies: false, institutionalShows: false, yearsPracticing: 2 },
      availability: { commissions: true, sales: true, exhibitions: true },
      links: [],
      contact: { email: 'priya@example.com' },
      kofiNotes: 'Submitted for review. Need two more documented works before approval.',
      visibility: 'public',
      status: 'pending',
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: d(6),
      avatarColor: '#5b41e6',
      createdAt: d(7),
      updatedAt: d(1),
    },
  ];

  const rawArtworks: Omit<Artwork, 'tagIds' | 'uses'>[] = [
    {
      id: 'aw_mara_1',
      artistId: 'art_mara',
      title: 'Doubling (Liberty Avenue, 7:40pm)',
      year: 2025,
      medium: 'painting',
      materials: ['oil on linen'],
      dimensions: { height: 152, width: 122, depth: 4, unit: 'cm' },
      description: 'A face drawn twice over itself in black brush and red spray, on a ground the colour of wet brick. Eleven passes until the second face reads as the reflection of the first.',
      images: [img('mara1', 'painting', 'Face painted in black brush strokes and red spray over a brown ground')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a painting by Clarence James (from koficollections.org); it is not by this sample artist.',
      price: { amount: 9800, currency: 'USD' },
      priceVisibility: 'institutions',
      visibility: 'public',
      tags: ['night', 'city', 'reflection'],
      reviewedAt: d(20),
      createdAt: d(40),
      updatedAt: d(3),
    },
    {
      id: 'aw_mara_2',
      artistId: 'art_mara',
      title: 'Small Weather No. 4',
      year: 2024,
      medium: 'painting',
      materials: ['oil on panel'],
      dimensions: { height: 30, width: 24, unit: 'cm' },
      description: 'A figure submerged in turquoise, painted wet-into-wet in the studio doorway during rain. One of a series.',
      images: [img('mara2', 'painting', 'Figure in deep blue against a turquoise ground')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 1400, currency: 'USD' },
      priceVisibility: 'public',
      visibility: 'public',
      tags: ['study', 'rain'],
      reviewedAt: d(20),
      createdAt: d(39),
      updatedAt: d(12),
    },
    {
      id: 'aw_mara_3',
      artistId: 'art_mara',
      title: 'Charcoal: Bridge Study',
      year: 2026,
      medium: 'drawing',
      materials: ['charcoal on paper', 'fixative'],
      dimensions: { height: 22, width: 30, unit: 'in' },
      description: 'Preparatory drawing for a public-art proposal. Not for sale.',
      images: [img('mara3', 'drawing', 'Line drawing of two figures with washes of yellow and blue')],
      status: 'not for sale',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      priceVisibility: 'private',
      visibility: 'kofi',
      tags: ['study', 'bridge', 'public art'],
      createdAt: d(4),
      updatedAt: d(4),
    },
    {
      id: 'aw_tobias_1',
      artistId: 'art_tobias',
      title: 'Crowd (Twelve Vessels)',
      year: 2023,
      medium: 'installation',
      materials: ['stoneware', 'ash glaze', 'steel plinth'],
      dimensions: { height: 110, width: 240, depth: 90, unit: 'cm' },
      description: 'Installation view: a painted mask in a hand-finished frame, one of twelve staged on easels so they stand like a crowd.',
      images: [img('tobias1', 'installation', 'Installation view: a painted mask in a hand-finished frame on an easel')],
      status: 'on hold',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 24000, currency: 'USD' },
      priceVisibility: 'institutions',
      visibility: 'public',
      tags: ['vessel', 'group', 'wood-fired'],
      reviewedAt: d(21),
      createdAt: d(41),
      updatedAt: d(10),
    },
    {
      id: 'aw_tobias_2',
      artistId: 'art_tobias',
      title: 'Lean II',
      year: 2025,
      medium: 'ceramics',
      materials: ['stoneware', 'shino glaze'],
      dimensions: { height: 46, width: 28, depth: 28, unit: 'cm' },
      description: 'A single vessel fired past the point of standing straight.',
      images: [img('tobias2', 'ceramics', 'A single thrown vessel in gold glaze, leaning, under a spotlight')],
      status: 'available',
      rightsNote: '© Tobias Reinholt.',
      price: { amount: 3200, currency: 'USD' },
      priceVisibility: 'public',
      visibility: 'public',
      tags: ['vessel'],
      reviewedAt: d(21),
      createdAt: d(35),
      updatedAt: d(11),
    },
    {
      id: 'aw_tobias_3',
      artistId: 'art_tobias',
      title: 'Threshold (maquette)',
      year: 2026,
      medium: 'sculpture',
      materials: ['bronze', 'patina'],
      dimensions: { height: 18, width: 12, depth: 8, unit: 'in' },
      description: 'Maquette for a municipal commission. Full-scale version in progress.',
      images: [img('tobias3', 'sculpture', 'A cairn of green bronze forms under a spotlight')],
      status: 'commission sample',
      rightsNote: '© Tobias Reinholt. Commission sample — not for sale.',
      priceVisibility: 'private',
      visibility: 'public',
      tags: ['public art', 'commission', 'maquette'],
      reviewedAt: d(8),
      createdAt: d(9),
      updatedAt: d(8),
    },
    {
      id: 'aw_june_1',
      artistId: 'art_june',
      title: 'Warp / Weft / Wait',
      year: 2025,
      medium: 'textile',
      materials: ['reclaimed industrial thread', 'hand-dyed wool', 'cedar batten'],
      dimensions: { height: 180, width: 95, depth: 6, unit: 'cm' },
      description: 'A dress built from hundreds of hand-stitched feathers over a printed ground. It changes as it is touched; the quills lift and settle.',
      images: [img('june1', 'textile', 'A dress built from hundreds of hand-stitched feathers over a printed ground')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 2600, currency: 'CAD' },
      priceVisibility: 'public',
      visibility: 'public',
      tags: ['wall hanging', 'tactile', 'wool'],
      reviewedAt: d(15),
      createdAt: d(30),
      updatedAt: d(5),
    },
    {
      id: 'aw_june_2',
      artistId: 'art_june',
      title: 'Small Loom Studies I–IV',
      year: 2024,
      medium: 'textile',
      materials: ['cotton', 'linen', 'copper wire'],
      dimensions: { height: 12, width: 12, unit: 'in' },
      description: 'Dye studies on wet silk: magenta, olive and gold bleeding into one another. Four studies, sold as a set.',
      images: [img('june2', 'textile', 'Ink bleeding across wet paper in magenta, olive and gold')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 900, currency: 'CAD' },
      priceVisibility: 'institutions',
      visibility: 'public',
      tags: ['study', 'set'],
      reviewedAt: d(15),
      createdAt: d(29),
      updatedAt: d(5),
    },
    {
      id: 'aw_june_3',
      artistId: 'art_june',
      title: 'Untitled (in progress)',
      year: 2026,
      medium: 'mixed media',
      materials: ['wool', 'found plastic'],
      dimensions: { height: 60, width: 60, unit: 'cm' },
      description: 'Figure in a green beaded headdress and patterned robe. Not ready to show yet.',
      images: [img('june3', 'mixed media', 'Figure in a green beaded headdress and patterned robe, in progress')],
      status: 'not for sale',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      priceVisibility: 'private',
      visibility: 'private',
      tags: [],
      createdAt: d(1),
      updatedAt: d(1),
    },
    {
      id: 'aw_deshawn_1',
      artistId: 'art_deshawn',
      title: 'Night Shift: Bakery, 3:10am',
      year: 2024,
      medium: 'photography',
      materials: ['archival pigment print', 'Hahnemühle Photo Rag'],
      dimensions: { height: 24, width: 36, unit: 'in' },
      description: 'A red canvas on its easel at 3am, photographed after the room had emptied. Edition of 5, print 2/5 available.',
      images: [img('deshawn1', 'photography', 'Photograph of a red and white abstract canvas on an easel under gallery light')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 2200, currency: 'USD' },
      priceVisibility: 'public',
      visibility: 'public',
      tags: ['night', 'work', 'edition'],
      reviewedAt: d(14),
      createdAt: d(27),
      updatedAt: d(2),
    },
    {
      id: 'aw_deshawn_2',
      artistId: 'art_deshawn',
      title: 'Transit Yard (loop)',
      year: 2025,
      medium: 'video',
      materials: ['single-channel video', '4K', '11 min loop'],
      dimensions: { height: 55, width: 98, unit: 'in' },
      description: 'A slow pan across a painted mural, looped. Displayed on a 110-inch screen; dimensions are the projection size.',
      images: [img('deshawn2', 'video', 'Video still of a mural: a figure in a red hat and blue jeans surrounded by the painted words Black Cowboy')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 6500, currency: 'USD' },
      priceVisibility: 'institutions',
      visibility: 'public',
      tags: ['video', 'night', 'loop'],
      reviewedAt: d(14),
      createdAt: d(26),
      updatedAt: d(2),
    },
    {
      id: 'aw_priya_1',
      artistId: 'art_priya',
      title: 'Grid Drift 03',
      year: 2026,
      medium: 'printmaking',
      materials: ['screen print', 'Stonehenge paper'],
      dimensions: { height: 70, width: 50, unit: 'cm' },
      description: 'A profile in grey against cyan, butterflies lifting from the mouth. Edition of 20.',
      images: [img('priya1', 'digital', 'Digital painting of a profile in grey against cyan, butterflies lifting from the mouth')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 450, currency: 'USD' },
      priceVisibility: 'public',
      visibility: 'public',
      tags: ['grid', 'generative', 'edition'],
      createdAt: d(6),
      updatedAt: d(6),
    },
    {
      id: 'aw_priya_2',
      artistId: 'art_priya',
      title: 'Grid Drift 04',
      year: 2026,
      medium: 'printmaking',
      materials: ['screen print', 'Stonehenge paper'],
      dimensions: { height: 70, width: 50, unit: 'cm' },
      description: 'Soft-ground print in peach, blue and gold; two curved figures folding into one another. Edition of 20.',
      images: [img('priya2', 'printmaking', 'Soft print in peach, blue and gold of two curved figures folding into one another')],
      status: 'available',
      rightsNote: 'Sample listing. The photograph shows a work exhibited with Kofi Collections (from koficollections.org); it is not by this sample artist.',
      price: { amount: 450, currency: 'USD' },
      priceVisibility: 'public',
      visibility: 'public',
      tags: ['grid', 'generative', 'edition'],
      createdAt: d(5),
      updatedAt: d(5),
    },
  ];
  const artworks: Artwork[] = rawArtworks.map((a) => withClassification(a));

  const institutions: Institution[] = [
    { id: 'inst_cma', name: 'Carnegie Museum of Art', type: 'museum', website: 'https://example.org/cma', city: 'Pittsburgh', country: 'United States' },
    { id: 'inst_oag', name: 'Ottawa Art Gallery', type: 'gallery', website: 'https://example.org/oag', city: 'Ottawa', country: 'Canada' },
    { id: 'inst_pit', name: 'Pittsburgh International Airport Arts Program', type: 'municipal', city: 'Pittsburgh', country: 'United States' },
  ];

  const curators: Curator[] = [
    {
      id: 'cur_lena',
      userId: DEMO_USERS.curatorLena,
      name: 'Lena Marchetti',
      title: 'Associate Curator, Contemporary',
      institutionId: 'inst_cma',
      workEmail: 'l.marchetti@example.org',
      purpose: 'Scouting regional artists for a 2027 group show on weather and infrastructure.',
      status: 'verified',
      verificationNote: 'Confirmed via institution staff directory.',
      verifiedAt: d(20),
      createdAt: d(22),
    },
    {
      id: 'cur_owen',
      userId: DEMO_USERS.curatorOwen,
      name: 'Owen Blackwood',
      title: 'Public Art Coordinator',
      institutionId: 'inst_pit',
      workEmail: 'o.blackwood@example.org',
      purpose: 'Identifying artists for a terminal commission call.',
      status: 'pending',
      createdAt: d(2),
    },
  ];

  const shortlists: Shortlist[] = [
    {
      id: 'sl_lena_1',
      curatorId: 'cur_lena',
      name: 'Weather & Infrastructure — longlist',
      items: [
        { artworkId: 'aw_mara_1', addedAt: d(18), note: 'Anchor piece if budget allows.' },
        { artworkId: 'aw_deshawn_2', addedAt: d(17) },
      ],
      createdAt: d(18),
      updatedAt: d(17),
    },
  ];

  const inquiries: Inquiry[] = [
    {
      id: 'inq_1',
      curatorId: 'cur_lena',
      artistId: 'art_mara',
      artworkId: 'aw_mara_1',
      message: 'We are planning a group show for spring 2027 and would like to discuss loaning Doubling. Could Kofi make an introduction?',
      status: 'forwarded',
      createdAt: d(16),
      decidedAt: d(15),
      decidedBy: DEMO_USERS.admin,
      staffNote: 'Verified curator; forwarded to Mara.',
    },
    {
      id: 'inq_2',
      curatorId: 'cur_lena',
      artistId: 'art_tobias',
      message: 'Interested in Crowd for the same show. Is the hold firm?',
      status: 'pending',
      createdAt: d(1),
    },
  ];

  const documents: ArtDocument[] = [
    {
      id: 'doc_1',
      artistId: 'art_mara',
      artworkId: 'aw_mara_1',
      type: 'condition report',
      title: 'Condition report — Doubling',
      custodian: 'Artist studio',
      date: d(30).slice(0, 10),
      fileRef: 'vault/art_mara/doc_1',
      fileName: 'doubling-condition-2026.txt',
      sizeBytes: 412,
      visibility: 'private',
      createdAt: d(30),
    },
    {
      id: 'doc_2',
      artistId: 'art_mara',
      artworkId: 'aw_mara_1',
      type: 'appraisal',
      title: 'Appraisal letter (human appraiser)',
      custodian: 'Example Appraisals LLC',
      date: d(28).slice(0, 10),
      fileRef: 'vault/art_mara/doc_2',
      fileName: 'appraisal-letter.txt',
      sizeBytes: 388,
      visibility: 'private',
      createdAt: d(28),
    },
  ];

  const documentPayloads: Record<string, string> = {
    'vault/art_mara/doc_1':
      'data:text/plain;charset=utf-8,' +
      encodeURIComponent(
        'FICTIONAL SAMPLE — Condition report\nWork: Doubling (Liberty Avenue, 7:40pm)\nSurface stable. Minor abrasion lower-left corner of stretcher bar, not affecting paint layer.\nExamined by artist studio.',
      ),
    'vault/art_mara/doc_2':
      'data:text/plain;charset=utf-8,' +
      encodeURIComponent(
        'FICTIONAL SAMPLE — Appraisal letter\nPrepared by a qualified human appraiser for insurance purposes.\nThis document is stored by the artist; Kofi Collections does not generate or estimate appraised values.',
      ),
  };

  const audit: AuditEvent[] = [
    { id: 'ev_1', actorId: DEMO_USERS.admin, actorRole: 'admin', actorName: 'Quincy (Kofi)', action: 'artist.status', entityType: 'artist', entityId: 'art_mara', at: d(40), meta: { status: 'approved' } },
    { id: 'ev_2', actorId: DEMO_USERS.admin, actorRole: 'admin', actorName: 'Quincy (Kofi)', action: 'curator.status', entityType: 'curator', entityId: 'cur_lena', at: d(20), meta: { status: 'verified' } },
    { id: 'ev_3', actorId: DEMO_USERS.curatorLena, actorRole: 'curator', actorName: 'Lena Marchetti', action: 'inquiry.create', entityType: 'inquiry', entityId: 'inq_1', at: d(16) },
    { id: 'ev_4', actorId: DEMO_USERS.admin, actorRole: 'admin', actorName: 'Quincy (Kofi)', action: 'inquiry.status', entityType: 'inquiry', entityId: 'inq_1', at: d(15), meta: { status: 'forwarded' } },
  ];

  const intake = seedIntake();
  for (const a of artists) {
    const v5 = intake[a.id];
    if (v5) Object.assign(a, v5);
  }

  return { artists, artworks, institutions, curators, shortlists, inquiries, documents, documentPayloads, audit, ...buildProgrammeSeed(), accounts: [], schema: MOCK_SCHEMA };
}

export const DEMO_IDENTITIES: DemoIdentity[] = [
  { id: 'visitor', label: 'Public visitor', caption: 'Sees only published work', viewer: { role: 'public', displayName: 'Visitor' } },
  {
    id: 'mara',
    label: 'Mara Oyelaran',
    caption: 'Artist · painter, approved',
    viewer: { role: 'artist', userId: DEMO_USERS.mara, artistId: 'art_mara', displayName: 'Mara Oyelaran' },
  },
  {
    id: 'june',
    label: 'June Takahashi-Bell',
    caption: 'Artist · textile, approved',
    viewer: { role: 'artist', userId: DEMO_USERS.june, artistId: 'art_june', displayName: 'June Takahashi-Bell' },
  },
  {
    id: 'priya',
    label: 'Priya Venkataraman',
    caption: 'Artist · pending review',
    viewer: { role: 'artist', userId: DEMO_USERS.priya, artistId: 'art_priya', displayName: 'Priya Venkataraman' },
  },
  {
    id: 'lena',
    label: 'Lena Marchetti',
    caption: 'Curator · verified institution',
    viewer: { role: 'curator', userId: DEMO_USERS.curatorLena, curatorId: 'cur_lena', curatorVerified: true, displayName: 'Lena Marchetti' },
  },
  {
    id: 'owen',
    label: 'Owen Blackwood',
    caption: 'Curator · verification pending',
    viewer: { role: 'curator', userId: DEMO_USERS.curatorOwen, curatorId: 'cur_owen', curatorVerified: false, displayName: 'Owen Blackwood' },
  },
  { id: 'admin', label: 'Quincy (Kofi staff)', caption: 'Admin · reviews & verification', viewer: { role: 'admin', userId: DEMO_USERS.admin, displayName: 'Quincy' } },
];

/* =====================================================================
   Programme seed.
   - `sample: false` items are Kofi Collections' real programme, paraphrased
     from koficollections.org (2026-10-20). Dates are the site's; where the
     site states none, the assumption is marked below. No fictional works are
     attached to real exhibitions.
   - `sample: true` items are fictional and use the fictional artists above.
   All dates are absolute (not relative to "now"), so phases move with the
   real calendar exactly as they would for live content.
   ===================================================================== */

const KOFI_VENUE: Venue = { name: 'Kofi Collections', address: '213 Smithfield St.', city: 'Pittsburgh, PA' };
const bundled = (file: string) => bundledArt[file] ?? `/art/${file}`;

export function buildProgrammeSeed(): ProgrammeState {
  const exhibitions: Exhibition[] = [
    {
      id: 'ex_being_seen',
      sample: false,
      published: true,
      title: 'Being/Seen',
      startsOn: '2025-05-08',
      endsOn: '2025-10-25',
      summary: 'A group exhibition of 36 Pittsburgh artists of colour working across four modalities.',
      body:
        'Being/Seen brought together 36 Pittsburgh artists of colour working across four modalities.\n\n' +
        'The exhibition looked at how Black art and history have been erased or undervalued in exhibitions, and at what it feels like when that history is recognised and celebrated instead.',
      artworkIds: [],
      externalUrl: 'https://www.koficollections.org/upcoming-exhibitions',
      curatedBy: 'Kofi Collections',
      createdAt: '2026-10-20T13:00:00.000Z',
      updatedAt: '2026-10-20T13:00:00.000Z',
    },
    {
      id: 'ex_spirit_west',
      sample: false,
      published: true,
      title: 'The Spirit of the West',
      startsOn: '2024-09-12',
      summary: 'An exhibition honouring Black and Indigenous heritage in the American West.',
      body:
        'The Spirit of the West honoured Black and Indigenous heritage.\n\n' +
        'Kofi Collections invited artists to submit works about the histories of these communities and their contributions to the American West, including ranching and Western traditions.',
      artworkIds: [],
      externalUrl: 'https://www.koficollections.org/prior-exhibitions',
      curatedBy: 'Kofi Collections',
      createdAt: '2026-10-20T13:00:00.000Z',
      updatedAt: '2026-10-20T13:00:00.000Z',
    },
    {
      id: 'ex_i_am',
      sample: false,
      published: true,
      title: 'I Am',
      startsOn: '2024-05-03',
      summary: 'Overlooked narratives of marginalised groups in the Pittsburgh region, from painting to sculpture.',
      body:
        'I Am gave space to narratives of marginalised groups in the Pittsburgh region that are often overlooked.\n\n' +
        'The work on show ranged from paintings to sculpture.',
      artworkIds: [],
      externalUrl: 'https://www.koficollections.org/prior-exhibitions',
      curatedBy: 'Kofi Collections',
      createdAt: '2026-10-20T13:00:00.000Z',
      updatedAt: '2026-10-20T13:00:00.000Z',
    },
    {
      id: 'ex_night_weather',
      sample: true,
      published: true,
      title: 'Night Weather',
      subtitle: 'Four artists on the city after dark',
      startsOn: '2026-10-02',
      endsOn: '2026-11-22',
      venue: KOFI_VENUE,
      summary: 'Paintings, textile, photography and print made at night or about it: wet streets, late shifts, rooms after everyone has gone.',
      body:
        'Night Weather gathers work by four artists who keep late hours. Mara Oyelaran paints Liberty Avenue in the hour after rain. DeShawn Ferris photographs bakeries and transit yards on the night shift. June Takahashi-Bell weaves with thread salvaged from a closed mill.\n\n' +
        'The show is hung low and close, so the textile can be touched and the photographs read at arm’s length. Prices are listed on the wall where the artist has chosen to share them.\n\n' +
        'Every work in the exhibition is documented in the artists’ own records on Kofi Collections. Ask Kofi about any piece and the team will put you in touch.',
      image: { src: bundled('mara1.jpg'), alt: 'Face painted in black brush strokes and red spray over a brown ground', credit: 'Painting by Clarence James · photograph from koficollections.org' },
      artworkIds: ['aw_mara_1', 'aw_mara_2', 'aw_june_1', 'aw_deshawn_1', 'aw_priya_1'],
      curatedBy: 'Kofi Collections',
      createdAt: '2026-09-15T14:00:00.000Z',
      updatedAt: '2026-10-01T14:00:00.000Z',
    },
    {
      id: 'ex_soft_ground',
      sample: true,
      published: true,
      title: 'Soft Ground',
      subtitle: 'Printmaking and textile',
      startsOn: '2027-01-15',
      endsOn: '2027-03-06',
      venue: KOFI_VENUE,
      summary: 'Prints and woven work that share a process: layers laid down slowly, one pass at a time.',
      body:
        'Soft Ground takes its name from the etching ground that stays tacky, recording anything pressed into it. The exhibition pairs screen prints by Priya Venkataraman with wall textiles by June Takahashi-Bell.\n\n' +
        'Both artists build an image in passes. The show will add works selected through the Soft Ground open call.',
      artworkIds: ['aw_priya_2', 'aw_june_1', 'aw_june_2'],
      curatedBy: 'Kofi Collections',
      createdAt: '2026-10-05T14:00:00.000Z',
      updatedAt: '2026-10-05T14:00:00.000Z',
    },
  ];

  const openCalls: OpenCall[] = [
    {
      id: 'call_advocacy',
      sample: false,
      published: true,
      kind: 'exhibition',
      title: 'The Art of Advocacy: Giving Form and Voice to Justice',
      partner: 'Neighborhood Legal Services',
      summary: 'An exhibition for Neighborhood Legal Services’ 60th anniversary, ending in an auction on October 6, 2026. Kofi Collections led artist selection.',
      body:
        'Neighborhood Legal Services marked its 60th anniversary with The Art of Advocacy: Giving Form and Voice to Justice, an exhibition about how artists and lawyers use storytelling, interpretation and advocacy to bring lived experiences to light and to inspire change.\n\n' +
        'Kofi Collections was the curatorial partner and led the selection of artists. Artists could apply themselves or be nominated; nominated artists completed a full application by the extended deadline of September 11, 2026. The exhibition culminated in an auction on October 6, 2026.',
      eligibility: 'Artists could apply themselves or be nominated by someone else. Nominated artists completed a full application.',
      mediums: [],
      // Source: koficollections.org/artists (checked 2026-10-20) states the extended deadline and the
      // auction date only. No opening date, work limit or medium list is published, so the call page
      // hides those rows for external calls; opensOn is set to the deadline purely so the phase is right.
      opensOn: '2026-09-11',
      deadline: '2026-09-11',
      maxWorks: 1,
      fee: 'See the call',
      externalUrl: 'https://www.koficollections.org/artists',
      createdAt: '2026-10-20T13:00:00.000Z',
      updatedAt: '2026-10-20T13:00:00.000Z',
    },
    {
      id: 'call_night_weather',
      sample: true,
      published: true,
      kind: 'award',
      title: 'Night Weather Studio Award',
      partner: 'Kofi Collections',
      summary: 'Show us work made at night or about it. One artist receives a solo wall next spring and a studio grant.',
      body:
        'The Night Weather Studio Award is open to artists in any medium whose work deals with the city after dark: late shifts, weather, light, the rooms people leave behind.\n\n' +
        'Attach up to three works from your Kofi portfolio and write a short statement on why they belong together. Works set to Only me cannot be attached; change them to Kofi team only if you want us to see them without publishing.\n\n' +
        'Kofi reads every application. Shortlisted artists will hear from us within three weeks of the deadline.',
      eligibility: 'Artists living or working in Western Pennsylvania',
      mediums: [],
      opensOn: '2026-10-01',
      deadline: '2026-11-30',
      maxWorks: 3,
      fee: 'No entry fee',
      award: 'A solo wall in Kofi’s spring 2027 programme and a $1,500 studio grant (sample)',
      exhibitionId: 'ex_night_weather',
      lookingFor: criteriaFor('call_night_weather'),
      createdAt: '2026-09-20T14:00:00.000Z',
      updatedAt: '2026-10-01T14:00:00.000Z',
    },
    {
      id: 'call_soft_ground',
      sample: true,
      published: true,
      kind: 'exhibition',
      title: 'Soft Ground: Printmakers & Weavers',
      partner: 'Kofi Collections',
      summary: 'Printmakers and textile artists: apply to show alongside Soft Ground this winter.',
      body:
        'Soft Ground will add a small number of works chosen through this call. We are looking for prints and woven or stitched work where the process is visible in the finished piece.\n\n' +
        'Editions are welcome; tell us the edition size in the work’s record.',
      eligibility: 'Printmakers and textile artists in the United States and Canada',
      mediums: ['printmaking', 'textile'],
      opensOn: '2026-11-15',
      deadline: '2027-01-10',
      maxWorks: 4,
      fee: 'No entry fee',
      exhibitionId: 'ex_soft_ground',
      createdAt: '2026-10-05T14:00:00.000Z',
      updatedAt: '2026-10-05T14:00:00.000Z',
    },
    {
      id: 'call_summer_open',
      sample: true,
      published: true,
      kind: 'exhibition',
      title: 'Late Summer Open 2026',
      partner: 'Kofi Collections',
      summary: 'Kofi’s open call for the autumn hang. Selected works are showing now in Night Weather.',
      body:
        'The Late Summer Open is Kofi’s call for new work in any medium. Selected works are hung together in the autumn exhibition.\n\n' +
        'This call has closed. Thank you to everyone who applied.',
      eligibility: 'Any artist with an approved Kofi profile',
      mediums: [],
      opensOn: '2026-08-20',
      deadline: '2026-09-20',
      maxWorks: 3,
      fee: 'No entry fee',
      createdAt: '2026-08-12T14:00:00.000Z',
      updatedAt: '2026-09-21T14:00:00.000Z',
    },
    {
      id: 'call_cma_auction',
      sample: true,
      published: true,
      kind: 'auction',
      title: 'Night Weather Benefit Auction',
      partner: 'Carnegie Museum of Art',
      organizerInstitutionId: 'inst_cma',
      summary: 'A benefit auction of works from Night Weather, run with Carnegie Museum of Art. Artists receive 70% of the hammer price.',
      body:
        'Carnegie Museum of Art and Kofi Collections are holding a benefit auction of works selected from artists in the Night Weather programme. Proceeds support the Night Weather programme: Kofi’s share and the museum’s share fund next year’s studio award and the artists’ talks.\n\n' +
        'Artists set their own reserve, the lowest hammer price they will accept. Artists receive 70% of the hammer price, Kofi 20% and the museum 10%. A 10% buyer’s premium is charged on top of the hammer price. If a work is resold later, the artist is owed a 5% resale royalty under Kofi’s open seller’s contract.\n\n' +
        'Attach up to two works from your Kofi portfolio. Selected works become lots in the auction.',
      eligibility: 'Artists with an approved Kofi profile',
      mediums: [],
      opensOn: '2026-08-15',
      deadline: '2026-09-30',
      maxWorks: 2,
      fee: 'No entry fee',
      exhibitionId: 'ex_night_weather',
      terms: {
        artistSharePct: 70,
        kofiSharePct: 20,
        partnerSharePct: 10,
        buyerPremiumPct: 10,
        resaleRoyaltyPct: 5,
        currency: 'USD',
        paymentNote: 'Artists are paid within 30 days of the auction.',
      },
      lookingFor: criteriaFor('call_cma_auction'),
      createdAt: '2026-08-10T14:00:00.000Z',
      updatedAt: '2026-08-14T14:00:00.000Z',
    },
  ];

  const applications: Application[] = [
    {
      id: 'app_mara_summer',
      callId: 'call_summer_open',
      artistId: 'art_mara',
      artworkIds: ['aw_mara_1', 'aw_mara_2'],
      statement: 'Two paintings from the same week of rain: one large, one small. I would like them hung on facing walls so the small one reads as a note on the large one.',
      status: 'accepted',
      decisionNote: 'Selected for Night Weather, opening October 2.',
      createdAt: '2026-09-02T15:10:00.000Z',
      updatedAt: '2026-09-25T16:00:00.000Z',
      decidedAt: '2026-09-25T16:00:00.000Z',
    },
    {
      id: 'app_june_summer',
      callId: 'call_summer_open',
      artistId: 'art_june',
      artworkIds: ['aw_june_1'],
      statement: 'A wall textile woven from thread salvaged from a closed mill. It is meant to be touched, and it changes shape a little each time it is.',
      status: 'declined',
      decisionNote: 'Thank you — we would love to see the new loom work next time.',
      staffNote: 'Strong; space-limited.',
      createdAt: '2026-09-09T18:40:00.000Z',
      updatedAt: '2026-09-25T16:05:00.000Z',
      decidedAt: '2026-09-25T16:05:00.000Z',
    },
    {
      id: 'app_deshawn_night',
      callId: 'call_night_weather',
      artistId: 'art_deshawn',
      artworkIds: ['aw_deshawn_1', 'aw_deshawn_2'],
      statement: 'Both pieces were made between 2 and 5am in workplaces that run all night. The print is a single frame; the video is the same kind of room, held for eleven minutes.',
      status: 'submitted',
      createdAt: '2026-10-12T02:15:00.000Z',
      updatedAt: '2026-10-12T02:15:00.000Z',
    },
    {
      id: 'app_mara_cma',
      callId: 'call_cma_auction',
      artistId: 'art_mara',
      artworkIds: ['aw_mara_1', 'aw_mara_2'],
      statement: 'Doubling and Small Weather No. 4 were painted in the same week of rain. I would like both offered, the large one with a reserve I have agreed with Kofi.',
      status: 'accepted',
      decisionNote: 'Selected. Both works will be offered as lots; Kofi will confirm your reserves with you.',
      staffNote: 'Reserves agreed by phone: $6,000 and $1,000.',
      createdAt: '2026-09-14T15:00:00.000Z',
      updatedAt: '2026-10-05T15:00:00.000Z',
      decidedAt: '2026-10-05T15:00:00.000Z',
    },
    {
      id: 'app_deshawn_cma',
      callId: 'call_cma_auction',
      artistId: 'art_deshawn',
      artworkIds: ['aw_deshawn_1'],
      statement: 'Print 2/5 of Night Shift: Bakery. The edition is otherwise held back, so this is the only print offered this year.',
      status: 'accepted',
      decisionNote: 'Selected. Your print will be offered as a lot.',
      createdAt: '2026-09-21T19:30:00.000Z',
      updatedAt: '2026-10-05T15:05:00.000Z',
      decidedAt: '2026-10-05T15:05:00.000Z',
    },
    {
      id: 'app_priya_cma',
      callId: 'call_cma_auction',
      artistId: 'art_priya',
      artworkIds: ['aw_priya_1'],
      statement: 'A screen print from the Grid Drift series, edition of 20. It started as a few lines of code and ended as ink.',
      status: 'declined',
      decisionNote: 'Thank you. This auction was open to artists with an approved Kofi profile; we would be glad to see your work again once your profile is approved.',
      staffNote: 'Profile still in review at the deadline.',
      createdAt: '2026-09-28T13:45:00.000Z',
      updatedAt: '2026-10-05T15:10:00.000Z',
      decidedAt: '2026-10-05T15:10:00.000Z',
    },
  ];

  const events: ProgrammeEvent[] = [
    {
      id: 'ev_nw_opening',
      sample: true,
      published: true,
      title: 'Night Weather: opening reception',
      kind: 'opening',
      startsAt: '2026-10-02T18:00:00-04:00',
      endsAt: '2026-10-02T21:00:00-04:00',
      venue: KOFI_VENUE,
      summary: 'The first evening of Night Weather, with the artists in the room.',
      exhibitionId: 'ex_night_weather',
      createdAt: '2026-09-15T14:00:00.000Z',
      updatedAt: '2026-09-15T14:00:00.000Z',
    },
    {
      id: 'ev_mara_talk',
      sample: true,
      published: true,
      title: 'Artist talk: Mara Oyelaran on glazing',
      kind: 'talk',
      startsAt: '2026-10-29T18:30:00-04:00',
      endsAt: '2026-10-29T20:00:00-04:00',
      venue: KOFI_VENUE,
      summary: 'Mara walks through how a painting is built from thin layers, in front of the two works in the show.',
      exhibitionId: 'ex_night_weather',
      createdAt: '2026-10-01T14:00:00.000Z',
      updatedAt: '2026-10-01T14:00:00.000Z',
    },
    {
      id: 'ev_june_open_studio',
      sample: true,
      published: true,
      title: 'Open studio: June Takahashi-Bell',
      kind: 'studio visit',
      startsAt: '2026-11-08T13:00:00-05:00',
      endsAt: '2026-11-08T17:00:00-05:00',
      venue: KOFI_VENUE,
      summary: 'June sets up a working loom in the gallery for the afternoon. Drop in, ask questions, try the shuttle.',
      exhibitionId: 'ex_soft_ground',
      createdAt: '2026-10-05T14:00:00.000Z',
      updatedAt: '2026-10-05T14:00:00.000Z',
    },
    {
      id: 'ev_collector_evening',
      sample: true,
      published: true,
      title: 'Collector evening',
      kind: 'social',
      startsAt: '2026-11-19T18:00:00-05:00',
      endsAt: '2026-11-19T20:30:00-05:00',
      venue: KOFI_VENUE,
      summary: 'A quiet evening in Night Weather for people thinking about buying or commissioning work. Kofi staff on hand to answer questions.',
      exhibitionId: 'ex_night_weather',
      createdAt: '2026-10-10T14:00:00.000Z',
      updatedAt: '2026-10-10T14:00:00.000Z',
    },
  ];

  const stories: Story[] = [
    {
      id: 'st_mara_interview',
      sample: true,
      published: true,
      title: 'Mara Oyelaran paints the hour after a storm',
      dek: 'The Pittsburgh painter on thin glazes, wet streets, and why her work is slow.',
      kind: 'interview',
      body:
        'Mara Oyelaran works from a converted print shop in Pittsburgh. The old press is still there; she uses its bed as a table for mixing glazes.\n\n' +
        'Her paintings start in the street. After rain she walks Liberty Avenue with a small sketchbook and notes where the reflections fall. Back in the studio she lays down a first thin layer and waits for it to dry before the next. A large canvas can take eleven passes.\n\n' +
        '> I paint the hour after a storm, when the city is wet enough to double itself.\n\n' +
        'Doubling (Liberty Avenue, 7:40pm) is the clearest example. A face is painted twice, the second pass slightly offset, so that one reads as the reflection of the other. Small Weather No. 4 was painted in the studio doorway while it was raining, wet-into-wet, in a single afternoon.\n\n' +
        'Both works are in Night Weather at Kofi Collections until November 22. Mara gives a talk on glazing at the gallery on October 29.',
      author: 'Kofi Collections editorial',
      publishedOn: '2026-10-14',
      artistId: 'art_mara',
      artworkIds: ['aw_mara_1', 'aw_mara_2'],
      image: { src: bundled('mara2.jpg'), alt: 'Figure in deep blue against a turquoise ground', credit: 'Photograph from koficollections.org' },
      createdAt: '2026-10-14T13:00:00.000Z',
      updatedAt: '2026-10-14T13:00:00.000Z',
    },
    {
      id: 'st_june_loom',
      sample: true,
      published: true,
      title: 'Inside June Takahashi-Bell’s loom room',
      dek: 'Reclaimed mill thread, hand-dyed wool, and wall works built to be touched.',
      kind: 'studio visit',
      body:
        'June Takahashi-Bell’s studio is one room with a floor loom, a dye bench and a wall of thread on cones. Most of the thread came from a mill that closed; June bought what was left on the shelves.\n\n' +
        'The wool is dyed by hand in small batches, so no two lots match. June treats that as part of the work rather than a problem to solve.\n\n' +
        'Warp / Weft / Wait is made to be handled. Visitors are encouraged to touch it, and the surface shifts a little each time. Small Loom Studies I–IV are dye tests on silk, sold as a set.\n\n' +
        'June will run an open studio afternoon at Kofi Collections on November 8, ahead of Soft Ground in January.',
      author: 'Kofi Collections editorial',
      publishedOn: '2026-09-30',
      artistId: 'art_june',
      artworkIds: ['aw_june_1', 'aw_june_2'],
      image: { src: bundled('june1.jpg'), alt: 'A dress built from hundreds of hand-stitched feathers over a printed ground', credit: 'Photograph from koficollections.org' },
      createdAt: '2026-09-30T13:00:00.000Z',
      updatedAt: '2026-09-30T13:00:00.000Z',
    },
    {
      id: 'st_artist_record',
      sample: true,
      published: true,
      title: 'What an artist-owned record changes',
      dek: 'Every field in a Kofi profile has its own visibility. Here is how that works, and why.',
      kind: 'essay',
      body:
        'On Kofi Collections the artist owns the record. Each work, each price and each document has its own setting for who can see it, and the artist can change it at any time.\n\n' +
        'There are four levels. Public means anyone. Verified institutions means curators whose institution Kofi has checked. Kofi team only means Kofi staff and the artist. Only me means the artist alone.\n\n' +
        '> A price can be shared with a museum without being published to everyone.\n\n' +
        'Settings apply to fields, not pages. A painting can be public while its price is shown only to verified institutions. Condition reports and appraisal letters are stored privately and are never shown to the public; when Kofi staff open one, the access is logged and the artist can see it.\n\n' +
        'Artists can export everything they have entered, as a spreadsheet and as a full data file, whenever they like.',
      author: 'Kofi Collections editorial',
      publishedOn: '2026-09-16',
      artworkIds: [],
      createdAt: '2026-09-16T13:00:00.000Z',
      updatedAt: '2026-09-16T13:00:00.000Z',
    },
    {
      id: 'st_advocacy_partner',
      sample: false,
      published: true,
      title: 'The Art of Advocacy: Kofi Collections leads artist selection for Neighborhood Legal Services at 60',
      dek: 'An exhibition on storytelling and justice, ending in an auction on October 6, 2026.',
      kind: 'news',
      body:
        'Neighborhood Legal Services marked its 60th anniversary with The Art of Advocacy: Giving Form and Voice to Justice, an exhibition about how artists and lawyers use storytelling, interpretation and advocacy to bring lived experiences to light and inspire change.\n\n' +
        'Kofi Collections served as the curatorial partner, leading the selection of artists. Artists could apply themselves or nominate another artist, and nominated artists completed a full application by the extended deadline of September 11, 2026. The exhibition culminated in an auction on October 6, 2026.',
      author: 'Kofi Collections',
      // The date this summary was written from koficollections.org/artists; Kofi has not dated an announcement.
      publishedOn: '2026-10-20',
      artworkIds: [],
      createdAt: '2026-10-20T13:00:00.000Z',
      updatedAt: '2026-10-20T13:00:00.000Z',
    },
  ];

  const buyerInquiries: BuyerInquiry[] = [
    {
      id: 'bi_doubling',
      artworkId: 'aw_mara_1',
      artistId: 'art_mara',
      name: 'Dana Whitcomb',
      email: 'dana.whitcomb@example.com',
      intent: 'purchase',
      message: 'I saw Doubling at the opening of Night Weather. Is it still available, and could I see it again on a weekday before deciding? (Sample inquiry.)',
      status: 'new',
      createdAt: '2026-10-18T15:20:00.000Z',
      updatedAt: '2026-10-18T15:20:00.000Z',
    },
    {
      id: 'bi_office_placement',
      name: 'Ray Castellano',
      email: 'ray@example.org',
      organization: 'Riverside Design Office (sample)',
      intent: 'placement',
      message: 'We are moving into a new office on the North Shore and want three or four works for the reception and meeting rooms, ideally by local artists. Budget to be discussed.',
      status: 'in progress',
      staffNote: 'Sent three options from Night Weather; site visit to be booked.',
      createdAt: '2026-10-09T14:05:00.000Z',
      updatedAt: '2026-10-11T17:30:00.000Z',
    },
  ];

  const cmaTerms = openCalls.find((c) => c.id === 'call_cma_auction')!.terms!;
  // Sold at noon Kofi time on Oct 18, 2026 (EDT, UTC-4). Amounts are whole cents.
  const soldAt = '2026-10-18T16:00:00.000Z';
  const lots: Lot[] = [
    {
      id: 'lot_cma_1',
      callId: 'call_cma_auction',
      applicationId: 'app_mara_cma',
      artworkId: 'aw_mara_1',
      artistId: 'art_mara',
      lotNumber: 1,
      reserve: 600000,
      status: 'sold',
      sale: { hammerPrice: 820000, currency: 'USD', buyerPremium: 82000, artistAmount: 574000, kofiAmount: 164000, partnerAmount: 82000, terms: { ...cmaTerms }, soldAt, buyerRef: 'Paddle 14' },
      createdAt: '2026-10-08T14:00:00.000Z',
      updatedAt: soldAt,
    },
    {
      id: 'lot_cma_2',
      callId: 'call_cma_auction',
      applicationId: 'app_mara_cma',
      artworkId: 'aw_mara_2',
      artistId: 'art_mara',
      lotNumber: 2,
      reserve: 100000,
      status: 'live',
      createdAt: '2026-10-08T14:05:00.000Z',
      updatedAt: '2026-10-18T14:00:00.000Z',
    },
    {
      id: 'lot_cma_3',
      callId: 'call_cma_auction',
      applicationId: 'app_deshawn_cma',
      artworkId: 'aw_deshawn_1',
      artistId: 'art_deshawn',
      lotNumber: 3,
      reserve: 150000,
      status: 'sold',
      sale: { hammerPrice: 160000, currency: 'USD', buyerPremium: 16000, artistAmount: 112000, kofiAmount: 32000, partnerAmount: 16000, terms: { ...cmaTerms }, soldAt, buyerRef: 'Paddle 3' },
      createdAt: '2026-10-08T14:10:00.000Z',
      updatedAt: soldAt,
    },
  ];

  const payouts: Payout[] = [
    { id: 'payout_cma_1', lotId: 'lot_cma_1', artistId: 'art_mara', amount: 574000, currency: 'USD', status: 'due', createdAt: soldAt, updatedAt: soldAt },
    {
      id: 'payout_cma_3',
      lotId: 'lot_cma_3',
      artistId: 'art_deshawn',
      amount: 112000,
      currency: 'USD',
      status: 'paid',
      method: 'Bank transfer',
      reference: 'KC-2026-0031',
      paidAt: '2026-10-19T16:00:00.000Z',
      createdAt: soldAt,
      updatedAt: '2026-10-19T16:00:00.000Z',
    },
  ];

  return { exhibitions, openCalls, applications, events, stories, buyerInquiries, lots, payouts };
}
