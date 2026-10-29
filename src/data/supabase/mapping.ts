/**
 * Pure mappers between Postgres rows (snake_case, flattened) and the domain
 * types in src/domain/types.ts. No network, no supabase-js — unit-testable.
 */
import { normalizeLink } from '@/domain/intake';
import { orientationOf } from '@/domain/taxonomy';
import type {
  ArtistLink,
  LinkPlatform,
  LinkVerification,
  ProfileImportRecord,
  ApplicationRow,
  ApplicationStatus,
  ArtDocument,
  Artist,
  ArtistView,
  ArtistStatus,
  ArtworkImage,
  ArtworkStatus,
  ArtworkView,
  Artwork,
  AuditEvent,
  BuyerInquiryRow,
  BuyerInquiryStatus,
  BuyerIntent,
  CallCriteria,
  CallKind,
  CallTerms,
  CareerStage,
  Curator,
  CuratorStatus,
  DocumentType,
  Edition,
  EventKind,
  Exhibition,
  Inquiry,
  InquiryStatus,
  Institution,
  InstitutionType,
  Lot,
  LotRow,
  LotStatus,
  Medium,
  OpenCall,
  Orientation,
  Payout,
  PayoutRow,
  PayoutStatus,
  ProgrammeBase,
  ProgrammeEvent,
  ProgrammeImage,
  Region,
  RegionPrecision,
  Role,
  Shortlist,
  Story,
  StoryKind,
  Sale,
  Unit,
  ArtworkUses,
  Venue,
  Visibility,
} from '@/domain/types';
import type { ArtistPatch, ArtworkInput, CuratorRow, InquiryRow } from '../DataSource';

type Num = number | string;
type Ts = string;

/* ------------------------------------------------------------- row types -- */

export interface ImageJson {
  id: string;
  src: string;
  alt: string;
  isPrimary: boolean;
  metadataStripped: boolean;
}

/** kofi.artworks_visible */
export interface ArtworkViewRow {
  id: string;
  artist_id: string;
  title: string;
  year: number;
  medium: Medium;
  materials: string[] | null;
  height: Num;
  width: Num;
  depth: Num | null;
  unit: Unit;
  description: string;
  status: ArtworkStatus;
  rights_note: string;
  price_amount: Num | null;
  price_currency: string | null;
  price_withheld: boolean;
  price_visibility: Visibility;
  visibility: Visibility;
  tags: string[] | null;
  reviewed_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
  artist_working_name: string;
  artist_career_stage: CareerStage;
  artist_experience_commissions: boolean;
  artist_experience_public_art: boolean;
  artist_experience_residencies: boolean;
  artist_experience_institutional_shows: boolean;
  artist_experience_years_practicing: number | null;
  artist_status: ArtistStatus;
  artist_visibility: Visibility;
  artist_region_label: string | null;
  can_edit: boolean;
  images: ImageJson[] | null;
  /** 0011_taxonomy.sql */
  tag_ids?: string[] | null;
  uses?: ArtworkUses | null;
  edition?: Edition | null;
  orientation?: Orientation | null;
  location_label?: string | null;
  /** Owner / Kofi only (NULL for everyone else). */
  location?: RegionJson | null;
}

/** Region as stored in jsonb (artworks.location). */
export interface RegionJson {
  city?: string;
  region: string;
  country: string;
  precision?: RegionPrecision;
}

/** Columns shared by kofi.artists_visible and the full kofi.artists row. */
interface ArtistCommonRow {
  id: string;
  working_name: string;
  pronouns: string | null;
  bio: string;
  statement: string | null;
  mediums: Medium[] | null;
  career_stage: CareerStage;
  experience_commissions: boolean;
  experience_public_art: boolean;
  experience_residencies: boolean;
  experience_institutional_shows: boolean;
  experience_years_practicing: number | null;
  availability_commissions: boolean;
  availability_sales: boolean;
  availability_exhibitions: boolean;
  links: ArtistLinkJson[] | null;
  status: ArtistStatus;
  visibility: Artist['visibility'];
  avatar_color: string;
  created_at: Ts;
  updated_at: Ts;
  region_city: string | null;
  region_region: string | null;
  region_country: string | null;
  region_precision: RegionPrecision | null;
  legal_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_studio_address: string | null;
  kofi_notes: string | null;
  consent_version: string | null;
  consent_accepted_at: Ts | null;
}

/**
 * One element of artists.links (0010_intake.sql): label + url always; the v5
 * keys when set. artists_visible strips verification / checkedAt for anyone but
 * the owner and Kofi.
 */
export interface ArtistLinkJson {
  label: string;
  url: string;
  platform?: LinkPlatform;
  handle?: string;
  verification?: LinkVerification;
  checkedAt?: string;
}

/** kofi.artists_visible */
export interface ArtistViewRow extends ArtistCommonRow {
  region_label: string | null;
  can_edit: boolean;
  /** 0010: owner / Kofi only, NULL otherwise (absent on a pre-0010 project). */
  verification_token?: string | null;
  imports?: ProfileImportRecord[] | null;
}

/** Full kofi.artists row (owner export only). */
export interface ArtistRow extends ArtistCommonRow {
  user_id: string;
  verification_token?: string | null;
  imports?: ProfileImportRecord[] | null;
}

const LINK_PLATFORM_SET = new Set<string>(['instagram', 'website', 'facebook', 'linkedin', 'tiktok', 'youtube', 'other']);
const LINK_VERIFICATION_SET = new Set<string>(['claimed', 'verified', 'failed', 'unreachable']);

/** links jsonb element → ArtistLink. Unknown / absent keys are omitted, never undefined. */
export function toArtistLink(l: ArtistLinkJson): ArtistLink {
  const out: ArtistLink = { label: l.label, url: l.url };
  if (l.platform && LINK_PLATFORM_SET.has(l.platform)) out.platform = l.platform;
  if (l.handle) out.handle = l.handle;
  if (l.verification && LINK_VERIFICATION_SET.has(l.verification)) out.verification = l.verification;
  if (l.checkedAt) out.checkedAt = l.checkedAt;
  return out;
}

/**
 * ArtistLink → what an owner write stores. platform / handle are derived from
 * the URL (as the mock does); verification / checkedAt are never sent — the
 * artists_links_guard trigger keeps the checker's result for an unchanged URL
 * and starts a new URL at 'claimed'.
 */
export function artistLinkToJson(l: ArtistLink): ArtistLinkJson {
  const out: ArtistLinkJson = { label: l.label, url: l.url };
  const n = normalizeLink(l.url);
  if (n) {
    out.platform = n.platform;
    out.handle = n.handle;
  } else if (l.platform && LINK_PLATFORM_SET.has(l.platform)) {
    out.platform = l.platform;
    if (l.handle) out.handle = l.handle;
  }
  return out;
}

/** imports jsonb → ProfileImportRecord[] (newest last, as stored). */
export function toImportRecords(rows: ProfileImportRecord[] | null | undefined): ProfileImportRecord[] {
  return (rows ?? []).map((r) => ({
    source: toArtistLink(r.source as ArtistLinkJson),
    fetchedAt: r.fetchedAt,
    appliedFields: [...(r.appliedFields ?? [])],
    notes: [...(r.notes ?? [])],
  }));
}

/** Full kofi.artworks row + images (owner export only). */
export interface ArtworkRow {
  id: string;
  artist_id: string;
  title: string;
  year: number;
  medium: Medium;
  materials: string[] | null;
  height: Num;
  width: Num;
  depth: Num | null;
  unit: Unit;
  description: string;
  status: ArtworkStatus;
  rights_note: string;
  price_amount: Num | null;
  price_currency: string | null;
  price_visibility: Visibility;
  visibility: Visibility;
  tags: string[] | null;
  reviewed_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
  images?: ImageJson[] | null;
  /** 0011_taxonomy.sql */
  tag_ids?: string[] | null;
  uses?: ArtworkUses | null;
  edition?: Edition | null;
  location?: RegionJson | null;
}

export interface DocumentRow {
  id: string;
  artist_id: string;
  artwork_id: string | null;
  type: DocumentType;
  title: string;
  custodian: string;
  date: string | null;
  file_ref?: string | null;
  file_name: string;
  size_bytes: Num;
  visibility: ArtDocument['visibility'];
  created_at: Ts;
}

export interface InstitutionRow {
  id: string;
  name: string;
  type: InstitutionType;
  website: string | null;
  city: string | null;
  country: string;
}

export interface CuratorRowDb {
  id: string;
  user_id: string;
  name: string;
  title: string;
  institution_id: string;
  work_email: string;
  purpose: string;
  status: CuratorStatus;
  verification_note: string | null;
  verified_at: Ts | null;
  created_at: Ts;
  institution?: InstitutionRow | null;
}

export interface InquiryViewRow {
  id: string;
  curator_id: string;
  artist_id: string;
  artwork_id: string | null;
  message: string;
  status: InquiryStatus;
  created_at: Ts;
  decided_at: Ts | null;
  decided_by: string | null;
  staff_note: string | null;
  curator_name?: string | null;
  institution_name?: string | null;
  artist_working_name?: string | null;
  artwork_title?: string | null;
}

export interface ShortlistRowDb {
  id: string;
  curator_id: string;
  name: string;
  created_at: Ts;
  updated_at: Ts;
  shortlist_items?: { artwork_id: string; added_at: Ts; note: string | null }[] | null;
}

export interface AuditRow {
  id: string;
  actor_id: string;
  actor_role: Role;
  actor_name: string;
  action: AuditEvent['action'];
  entity_type: AuditEvent['entityType'];
  entity_id: string;
  at: Ts;
  consent_version: string | null;
  meta: Record<string, string | number | boolean | null> | null;
}

/* --------------------------------------------------------------- helpers -- */

/** Postgres timestamptz → the ISO-8601 'Z' strings the mock uses (so string sorts agree). */
export function iso(ts: Ts): string {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? ts : new Date(t).toISOString();
}

function num(v: Num): number {
  return typeof v === 'number' ? v : Number(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Postgres schema holding every Kofi table, view and RPC (supabase/migrations/0000_schema.sql). */
export const DB_SCHEMA = 'kofi';
export const IMAGE_BUCKET = 'artwork-images';
export const VAULT_BUCKET = 'vault';
export const STORAGE_PREFIX = `storage:${IMAGE_BUCKET}/`;

/** 'storage:artwork-images/<path>' → '<path>' (bucket-relative), else undefined. */
export function storagePathOf(src: string): string | undefined {
  return src.startsWith(STORAGE_PREFIX) ? src.slice(STORAGE_PREFIX.length) : undefined;
}

/**
 * Turn a signed/public Storage URL for the artwork-images bucket back into the
 * 'storage:' ref stored in the database, so a view's images can be round-tripped
 * into saveArtwork. Anything else is returned unchanged.
 */
export function normalizeImageSrc(src: string): string {
  if (src.startsWith('storage:') || src.startsWith('data:')) return src;
  const m = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/artwork-images\/([^?#]+)/.exec(src);
  if (!m || !m[1]) return src;
  return STORAGE_PREFIX + decodeURIComponent(m[1]);
}

function images(list: ImageJson[] | null | undefined, resolve: (src: string) => string): ArtworkImage[] {
  return (list ?? []).map((i) => ({
    id: i.id,
    src: resolve(i.src),
    alt: i.alt ?? '',
    isPrimary: !!i.isPrimary,
    metadataStripped: !!i.metadataStripped,
  }));
}

/* --------------------------------------------------------------- mappers -- */

/** jsonb uses → ArtworkUses (missing keys false). */
export function toUses(u: ArtworkUses | null | undefined): ArtworkUses {
  return { auction: !!u?.auction, exhibition: !!u?.exhibition, licensing: !!u?.licensing, commission: !!u?.commission };
}

/** jsonb edition → Edition, optional parts omitted. */
export function toEdition(e: Edition | null | undefined): Edition | undefined {
  if (!e || typeof e !== 'object' || !e.type) return undefined;
  const out: Edition = { type: e.type };
  if (e.number !== null && e.number !== undefined) out.number = Number(e.number);
  if (e.size !== null && e.size !== undefined) out.size = Number(e.size);
  return out;
}

/** jsonb location → Region (precision defaults like cleanLocation: city when there is a city, else region). */
export function toRegion(l: RegionJson | null | undefined): Region | undefined {
  if (!l || typeof l !== 'object' || !l.region || !l.country) return undefined;
  const out: Region = { region: l.region, country: l.country, precision: l.precision ?? (l.city ? 'city' : 'region') };
  if (l.city) out.city = l.city;
  return out;
}

export function toArtworkView(row: ArtworkViewRow, resolve: (src: string) => string = (s) => s): ArtworkView {
  const view: ArtworkView = {
    id: row.id,
    artistId: row.artist_id,
    artistWorkingName: row.artist_working_name ?? 'Unknown artist',
    artistCareerStage: row.artist_career_stage ?? 'emerging',
    artistExperience: {
      commissions: !!row.artist_experience_commissions,
      publicArt: !!row.artist_experience_public_art,
      residencies: !!row.artist_experience_residencies,
      institutionalShows: !!row.artist_experience_institutional_shows,
    },
    artistRegionLabel: row.artist_region_label ?? '',
    title: row.title,
    year: row.year,
    medium: row.medium,
    materials: [...(row.materials ?? [])],
    dimensions: { height: num(row.height), width: num(row.width), unit: row.unit },
    description: row.description ?? '',
    images: images(row.images, resolve),
    status: row.status,
    rightsNote: row.rights_note ?? '',
    priceWithheld: !!row.price_withheld,
    tags: [...(row.tags ?? [])],
    tagIds: [...(row.tag_ids ?? [])],
    uses: toUses(row.uses),
    orientation: 'square',
    locationLabel: row.location_label ?? row.artist_region_label ?? '',
    visibility: row.visibility,
    priceVisibility: row.price_visibility,
    canEdit: !!row.can_edit,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.artist_experience_years_practicing !== null && row.artist_experience_years_practicing !== undefined) {
    view.artistExperience.yearsPracticing = row.artist_experience_years_practicing;
  }
  if (row.depth !== null && row.depth !== undefined) view.dimensions.depth = num(row.depth);
  // The view derives it with the same rule (kofi.orientation_of); derive here for older rows.
  view.orientation = row.orientation ?? orientationOf(view.dimensions, view.medium);
  const edition = toEdition(row.edition);
  if (edition) view.edition = edition;
  const location = toRegion(row.location);
  if (location) view.location = location;
  if (row.price_amount !== null && row.price_amount !== undefined && row.price_currency) {
    view.price = { amount: num(row.price_amount), currency: row.price_currency };
  }
  if (row.reviewed_at) view.reviewedAt = iso(row.reviewed_at);
  return view;
}

function regionOf(row: ArtistCommonRow): Region | undefined {
  if (row.region_country === null || row.region_country === undefined || !row.region_precision) return undefined;
  const region: Region = { region: row.region_region ?? '', country: row.region_country, precision: row.region_precision };
  if (row.region_city) region.city = row.region_city;
  return region;
}

/** artists_visible row → ArtistView. Private keys are omitted (not undefined) when redacted. */
export function toArtistView(row: ArtistViewRow): ArtistView {
  const view: ArtistView = {
    id: row.id,
    workingName: row.working_name,
    bio: row.bio ?? '',
    regionLabel: row.region_label ?? '',
    mediums: [...(row.mediums ?? [])],
    careerStage: row.career_stage,
    experience: {
      commissions: !!row.experience_commissions,
      publicArt: !!row.experience_public_art,
      residencies: !!row.experience_residencies,
      institutionalShows: !!row.experience_institutional_shows,
    },
    availability: {
      commissions: !!row.availability_commissions,
      sales: !!row.availability_sales,
      exhibitions: !!row.availability_exhibitions,
    },
    links: (row.links ?? []).map(toArtistLink),
    status: row.status,
    visibility: row.visibility,
    avatarColor: row.avatar_color,
    canEdit: !!row.can_edit,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.experience_years_practicing !== null && row.experience_years_practicing !== undefined) {
    view.experience.yearsPracticing = row.experience_years_practicing;
  }
  if (row.pronouns) view.pronouns = row.pronouns;
  if (row.statement) view.statement = row.statement;
  if (row.contact_email) {
    view.contact = { email: row.contact_email };
    if (row.contact_phone) view.contact.phone = row.contact_phone;
    if (row.contact_studio_address) view.contact.studioAddress = row.contact_studio_address;
  }
  const region = regionOf(row);
  if (region) view.region = region;
  if (row.legal_name) view.legalName = row.legal_name;
  if (row.kofi_notes) view.kofiNotes = row.kofi_notes;
  if (row.consent_version) view.consentVersion = row.consent_version;
  if (row.consent_accepted_at) view.consentAcceptedAt = iso(row.consent_accepted_at);
  if (row.verification_token) view.verificationToken = row.verification_token;
  if (row.imports && (row.verification_token || row.can_edit)) view.imports = toImportRecords(row.imports);
  return view;
}

/** Full artist row (owner export) → Artist. */
export function toArtist(row: ArtistRow): Artist {
  const view = toArtistView({ ...row, region_label: null, can_edit: true });
  const artist: Artist = {
    id: row.id,
    userId: row.user_id,
    workingName: row.working_name,
    bio: row.bio ?? '',
    region: regionOf(row) ?? { region: row.region_region ?? '', country: row.region_country ?? '', precision: 'country' },
    mediums: view.mediums,
    careerStage: row.career_stage,
    experience: view.experience,
    availability: view.availability,
    links: view.links,
    contact: view.contact ?? { email: row.contact_email ?? '' },
    visibility: row.visibility,
    status: row.status,
    avatarColor: row.avatar_color,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.legal_name) artist.legalName = row.legal_name;
  if (row.pronouns) artist.pronouns = row.pronouns;
  if (row.statement) artist.statement = row.statement;
  if (row.kofi_notes) artist.kofiNotes = row.kofi_notes;
  if (row.consent_version) artist.consentVersion = row.consent_version;
  if (row.consent_accepted_at) artist.consentAcceptedAt = iso(row.consent_accepted_at);
  if (row.verification_token) artist.verificationToken = row.verification_token;
  if (row.imports) artist.imports = toImportRecords(row.imports);
  return artist;
}

/** Full artwork row (owner export) → Artwork. */
export function toArtwork(row: ArtworkRow, resolve: (src: string) => string = (s) => s): Artwork {
  const w: Artwork = {
    id: row.id,
    artistId: row.artist_id,
    title: row.title,
    year: row.year,
    medium: row.medium,
    materials: [...(row.materials ?? [])],
    dimensions: { height: num(row.height), width: num(row.width), unit: row.unit },
    description: row.description ?? '',
    images: images(row.images, resolve),
    status: row.status,
    rightsNote: row.rights_note ?? '',
    priceVisibility: row.price_visibility,
    visibility: row.visibility,
    tags: [...(row.tags ?? [])],
    tagIds: [...(row.tag_ids ?? [])],
    uses: toUses(row.uses),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.depth !== null && row.depth !== undefined) w.dimensions.depth = num(row.depth);
  if (row.price_amount !== null && row.price_amount !== undefined && row.price_currency) {
    w.price = { amount: num(row.price_amount), currency: row.price_currency };
  }
  if (row.reviewed_at) w.reviewedAt = iso(row.reviewed_at);
  const edition = toEdition(row.edition);
  if (edition) w.edition = edition;
  const location = toRegion(row.location);
  if (location) w.location = location;
  return w;
}

export function toDocument(row: DocumentRow): ArtDocument {
  const doc: ArtDocument = {
    id: row.id,
    artistId: row.artist_id,
    type: row.type,
    title: row.title,
    custodian: row.custodian ?? '',
    date: row.date ?? '',
    fileRef: row.file_ref ?? '',
    fileName: row.file_name,
    sizeBytes: num(row.size_bytes),
    visibility: row.visibility,
    createdAt: iso(row.created_at),
  };
  if (row.artwork_id) doc.artworkId = row.artwork_id;
  return doc;
}

export function toInstitution(row: InstitutionRow): Institution {
  const inst: Institution = { id: row.id, name: row.name, type: row.type, country: row.country ?? '' };
  if (row.website) inst.website = row.website;
  if (row.city) inst.city = row.city;
  return inst;
}

export function toCuratorRow(row: CuratorRowDb): CuratorRow | undefined {
  if (!row.institution) return undefined;
  const c: Curator = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    title: row.title ?? '',
    institutionId: row.institution_id,
    workEmail: row.work_email,
    purpose: row.purpose,
    status: row.status,
    createdAt: iso(row.created_at),
  };
  if (row.verification_note) c.verificationNote = row.verification_note;
  if (row.verified_at) c.verifiedAt = iso(row.verified_at);
  return { ...c, institution: toInstitution(row.institution) };
}

export function toInquiry(row: InquiryViewRow): Inquiry {
  const i: Inquiry = {
    id: row.id,
    curatorId: row.curator_id,
    artistId: row.artist_id,
    message: row.message,
    status: row.status,
    createdAt: iso(row.created_at),
  };
  if (row.artwork_id) i.artworkId = row.artwork_id;
  if (row.decided_at) i.decidedAt = iso(row.decided_at);
  if (row.decided_by) i.decidedBy = row.decided_by;
  if (row.staff_note) i.staffNote = row.staff_note;
  return i;
}

export function toInquiryRow(row: InquiryViewRow): InquiryRow {
  const out: InquiryRow = {
    ...toInquiry(row),
    curatorName: row.curator_name ?? 'Unknown curator',
    institutionName: row.institution_name ?? 'Unknown institution',
    artistWorkingName: row.artist_working_name ?? 'Unknown artist',
  };
  if (row.artwork_title) out.artworkTitle = row.artwork_title;
  return out;
}

export function toShortlist(row: ShortlistRowDb): Shortlist {
  const items = [...(row.shortlist_items ?? [])]
    .sort((a, b) => iso(a.added_at).localeCompare(iso(b.added_at)))
    .map((it) => {
      const item: Shortlist['items'][number] = { artworkId: it.artwork_id, addedAt: iso(it.added_at) };
      if (it.note) item.note = it.note;
      return item;
    });
  return {
    id: row.id,
    curatorId: row.curator_id,
    name: row.name,
    items,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toAuditEvent(row: AuditRow): AuditEvent {
  const ev: AuditEvent = {
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    at: iso(row.at),
  };
  if (row.consent_version) ev.consentVersion = row.consent_version;
  if (row.meta) ev.meta = row.meta;
  return ev;
}

/* ------------------------------------------------------ domain → database -- */

/** ArtistPatch → column updates for kofi.artists (owner-editable columns only). */
export function artistPatchToRow(patch: ArtistPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.workingName !== undefined) row.working_name = patch.workingName;
  if (patch.legalName !== undefined) row.legal_name = patch.legalName || null;
  if (patch.pronouns !== undefined) row.pronouns = patch.pronouns || null;
  if (patch.bio !== undefined) row.bio = patch.bio;
  if (patch.statement !== undefined) row.statement = patch.statement || null;
  if (patch.region !== undefined) {
    row.region_city = patch.region.city || null;
    row.region_region = patch.region.region ?? '';
    row.region_country = patch.region.country;
    row.region_precision = patch.region.precision;
  }
  if (patch.mediums !== undefined) row.mediums = patch.mediums;
  if (patch.careerStage !== undefined) row.career_stage = patch.careerStage;
  if (patch.experience !== undefined) {
    row.experience_commissions = patch.experience.commissions;
    row.experience_public_art = patch.experience.publicArt;
    row.experience_residencies = patch.experience.residencies;
    row.experience_institutional_shows = patch.experience.institutionalShows;
    row.experience_years_practicing = patch.experience.yearsPracticing ?? null;
  }
  if (patch.availability !== undefined) {
    row.availability_commissions = patch.availability.commissions;
    row.availability_sales = patch.availability.sales;
    row.availability_exhibitions = patch.availability.exhibitions;
  }
  if (patch.links !== undefined) row.links = patch.links.map(artistLinkToJson);
  if (patch.contact !== undefined) {
    row.contact_email = patch.contact.email;
    row.contact_phone = patch.contact.phone || null;
    row.contact_studio_address = patch.contact.studioAddress || null;
  }
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.avatarColor !== undefined) row.avatar_color = patch.avatarColor;
  return row;
}

/** ArtworkInput → the p_artwork JSON accepted by kofi.save_artwork(). Images travel separately. */
export function artworkInputToJson(input: ArtworkInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: input.title,
    year: input.year,
    medium: input.medium,
    materials: input.materials,
    dimensions: {
      height: input.dimensions.height,
      width: input.dimensions.width,
      depth: input.dimensions.depth ?? null,
      unit: input.dimensions.unit,
    },
    description: input.description,
    status: input.status,
    rightsNote: input.rightsNote,
    price: input.price ? { amount: input.price.amount, currency: input.price.currency } : null,
    priceVisibility: input.priceVisibility,
    visibility: input.visibility,
    tags: input.tags,
  };
  if (input.id) out.id = input.id;
  // v6: a key the caller left out keeps the stored value (server and mock alike);
  // an edition / location key present but undefined clears it (JSON would drop it).
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  if (input.tagIds !== undefined) out.tagIds = input.tagIds;
  if (input.uses !== undefined) out.uses = input.uses;
  if (has('edition')) out.edition = input.edition ?? null;
  if (has('location')) out.location = input.location ?? null;
  return out;
}

/* ============================================================ programme ==
 * supabase/migrations/0008_programme.sql. Reads go through the *_visible
 * views (artwork / artist / exhibition links already filtered for the caller);
 * writes go to the base tables (admin, RLS) or the RPCs (applications,
 * collector inquiries).
 */

/** Public bucket for programme images (exhibition / call / story heroes). */
export const PROGRAMME_BUCKET = 'kofi-programme';
export const PROGRAMME_PREFIX = `storage:${PROGRAMME_BUCKET}/`;

/** 'storage:kofi-programme/<path>' → '<path>', else undefined. */
export function programmePathOf(src: string): string | undefined {
  return src.startsWith(PROGRAMME_PREFIX) ? src.slice(PROGRAMME_PREFIX.length) : undefined;
}

/** A public URL of the programme bucket → its 'storage:' ref (round-trips a read item into a save). */
export function normalizeProgrammeImageSrc(src: string): string {
  if (src.startsWith('storage:') || src.startsWith('data:') || src.startsWith('/art/')) return src;
  const m = /\/storage\/v1\/object\/public\/kofi-programme\/([^?#]+)/.exec(src);
  if (!m || !m[1]) return src;
  return PROGRAMME_PREFIX + decodeURIComponent(m[1]);
}

const KOFI_TZ = 'America/New_York';

/**
 * timestamptz → ISO-8601 with the Kofi (Pittsburgh) offset, the same shape the
 * mock seed uses for events: '2026-10-29T18:30:00-04:00'.
 */
export function toKofiOffsetIso(ts: Ts): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KOFI_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offsetMin = Math.round((wall - Math.floor(t / 1000) * 1000) / 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return (
    `${get('year')}-${pad(get('month'))}-${pad(get('day'))}T${pad(get('hour') % 24)}:${pad(get('minute'))}:${pad(get('second'))}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

interface ProgrammeBaseRow {
  id: string;
  sample: boolean;
  published: boolean;
  created_at: Ts;
  updated_at: Ts;
}

interface ImageRowJson {
  src: string;
  alt: string;
  credit?: string | null;
}

interface VenueRowJson {
  name: string;
  address?: string | null;
  city: string;
}

/** kofi.exhibitions_visible */
export interface ExhibitionRow extends ProgrammeBaseRow {
  title: string;
  subtitle: string | null;
  starts_on: string;
  ends_on: string | null;
  venue: VenueRowJson | null;
  summary: string;
  body: string;
  image: ImageRowJson | null;
  artwork_ids: string[] | null;
  external_url: string | null;
  curated_by: string | null;
}

/** kofi.open_calls_visible */
export interface OpenCallRow extends ProgrammeBaseRow {
  title: string;
  partner: string | null;
  summary: string;
  body: string;
  eligibility: string;
  mediums: Medium[] | null;
  opens_on: string;
  deadline: string | null;
  max_works: number;
  fee: string;
  award: string | null;
  image: ImageRowJson | null;
  external_url: string | null;
  exhibition_id: string | null;
  /** 0009_sales.sql */
  kind?: CallKind | null;
  organizer_institution_id?: string | null;
  terms?: CallTerms | null;
  /** 0011_taxonomy.sql */
  looking_for?: CallCriteria | null;
}

/** kofi.events_visible */
export interface EventRow extends ProgrammeBaseRow {
  title: string;
  kind: EventKind;
  starts_at: Ts;
  ends_at: Ts | null;
  venue: VenueRowJson | null;
  summary: string;
  rsvp_url: string | null;
  exhibition_id: string | null;
}

/** kofi.stories_visible */
export interface StoryRow extends ProgrammeBaseRow {
  title: string;
  dek: string;
  kind: StoryKind;
  body: string;
  author: string;
  published_on: string;
  artist_id: string | null;
  artwork_ids: string[] | null;
  image: ImageRowJson | null;
}

/** kofi.applications_visible (staff_note is NULL unless the caller is a Kofi admin). */
export interface ApplicationViewRow {
  id: string;
  call_id: string;
  artist_id: string;
  artwork_ids: string[] | null;
  statement: string;
  status: ApplicationStatus;
  decision_note: string | null;
  staff_note: string | null;
  created_at: Ts;
  updated_at: Ts;
  decided_at: Ts | null;
  call_title: string | null;
  call_deadline: string | null;
  artist_working_name: string | null;
}

/** kofi.buyer_inquiries_visible (Kofi admins only). */
export interface BuyerInquiryViewRow {
  id: string;
  artwork_id: string | null;
  artist_id: string | null;
  name: string;
  email: string;
  organization: string | null;
  intent: BuyerIntent;
  message: string;
  status: BuyerInquiryStatus;
  staff_note: string | null;
  consented_at?: Ts | null;
  created_at: Ts;
  updated_at: Ts;
  artwork_title: string | null;
  artist_working_name: string | null;
}

function base(row: ProgrammeBaseRow): ProgrammeBase {
  return { id: row.id, sample: !!row.sample, published: !!row.published, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function toImage(im: ImageRowJson | null | undefined, resolve: (src: string) => string): ProgrammeImage | undefined {
  if (!im || typeof im.src !== 'string') return undefined;
  const out: ProgrammeImage = { src: resolve(im.src), alt: im.alt ?? '' };
  if (im.credit) out.credit = im.credit;
  return out;
}

function toVenue(v: VenueRowJson | null | undefined): Venue | undefined {
  if (!v || typeof v.name !== 'string') return undefined;
  const out: Venue = { name: v.name, city: v.city ?? '' };
  if (v.address) out.address = v.address;
  return out;
}

export function toExhibition(row: ExhibitionRow, resolve: (src: string) => string = (s) => s): Exhibition {
  const ex: Exhibition = {
    ...base(row),
    title: row.title,
    startsOn: row.starts_on,
    summary: row.summary,
    body: row.body ?? '',
    artworkIds: [...(row.artwork_ids ?? [])],
  };
  if (row.subtitle) ex.subtitle = row.subtitle;
  if (row.ends_on) ex.endsOn = row.ends_on;
  const venue = toVenue(row.venue);
  if (venue) ex.venue = venue;
  const image = toImage(row.image, resolve);
  if (image) ex.image = image;
  if (row.external_url) ex.externalUrl = row.external_url;
  if (row.curated_by) ex.curatedBy = row.curated_by;
  return ex;
}

export function toOpenCall(row: OpenCallRow, resolve: (src: string) => string = (s) => s): OpenCall {
  const c: OpenCall = {
    ...base(row),
    title: row.title,
    summary: row.summary,
    body: row.body ?? '',
    eligibility: row.eligibility,
    mediums: [...(row.mediums ?? [])],
    opensOn: row.opens_on,
    maxWorks: row.max_works,
    fee: row.fee,
    kind: row.kind ?? 'exhibition',
  };
  if (row.partner) c.partner = row.partner;
  if (row.deadline) c.deadline = row.deadline;
  if (row.award) c.award = row.award;
  const image = toImage(row.image, resolve);
  if (image) c.image = image;
  if (row.external_url) c.externalUrl = row.external_url;
  if (row.exhibition_id) c.exhibitionId = row.exhibition_id;
  if (row.organizer_institution_id) c.organizerInstitutionId = row.organizer_institution_id;
  const terms = toTerms(row.terms);
  if (terms) c.terms = terms;
  const lookingFor = toCriteria(row.looking_for);
  if (lookingFor) c.lookingFor = lookingFor;
  return c;
}

/** looking_for jsonb (camelCase, as CallCriteria; the server stores it cleaned) → CallCriteria. */
export function toCriteria(v: CallCriteria | null | undefined): CallCriteria | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: CallCriteria = {};
  if (v.tags && typeof v.tags === 'object') {
    const tags: Record<string, string[]> = {};
    for (const [cat, list] of Object.entries(v.tags)) if (Array.isArray(list) && list.length) tags[cat] = [...list];
    if (Object.keys(tags).length) out.tags = tags;
  }
  if (Array.isArray(v.uses) && v.uses.length) out.uses = [...v.uses];
  if (typeof v.region === 'string' && v.region) out.region = v.region;
  if (typeof v.maxLongestEdgeCm === 'number') out.maxLongestEdgeCm = v.maxLongestEdgeCm;
  if (typeof v.minLongestEdgeCm === 'number') out.minLongestEdgeCm = v.minLongestEdgeCm;
  if (typeof v.note === 'string' && v.note) out.note = v.note;
  return out;
}

/** terms jsonb (camelCase, as CallTerms) → CallTerms; paymentNote only when set. */
export function toTerms(t: CallTerms | null | undefined): CallTerms | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const out: CallTerms = {
    artistSharePct: num(t.artistSharePct),
    kofiSharePct: num(t.kofiSharePct),
    partnerSharePct: num(t.partnerSharePct),
    buyerPremiumPct: num(t.buyerPremiumPct),
    resaleRoyaltyPct: num(t.resaleRoyaltyPct),
    currency: t.currency,
  };
  if (t.paymentNote) out.paymentNote = t.paymentNote;
  return out;
}

function termsToJson(t: CallTerms | undefined): CallTerms | null {
  if (!t) return null;
  const out: CallTerms = {
    artistSharePct: t.artistSharePct,
    kofiSharePct: t.kofiSharePct,
    partnerSharePct: t.partnerSharePct,
    buyerPremiumPct: t.buyerPremiumPct,
    resaleRoyaltyPct: t.resaleRoyaltyPct,
    currency: t.currency,
  };
  if (t.paymentNote) out.paymentNote = t.paymentNote;
  return out;
}

export function toProgrammeEvent(row: EventRow): ProgrammeEvent {
  const e: ProgrammeEvent = {
    ...base(row),
    title: row.title,
    kind: row.kind,
    startsAt: toKofiOffsetIso(row.starts_at),
    summary: row.summary,
  };
  if (row.ends_at) e.endsAt = toKofiOffsetIso(row.ends_at);
  const venue = toVenue(row.venue);
  if (venue) e.venue = venue;
  if (row.rsvp_url) e.rsvpUrl = row.rsvp_url;
  if (row.exhibition_id) e.exhibitionId = row.exhibition_id;
  return e;
}

export function toStory(row: StoryRow, resolve: (src: string) => string = (s) => s): Story {
  const s: Story = {
    ...base(row),
    title: row.title,
    dek: row.dek,
    kind: row.kind,
    body: row.body,
    author: row.author,
    publishedOn: row.published_on,
    artworkIds: [...(row.artwork_ids ?? [])],
  };
  if (row.artist_id) s.artistId = row.artist_id;
  const image = toImage(row.image, resolve);
  if (image) s.image = image;
  return s;
}

/** applications_visible row → ApplicationRow; `works` are resolved by the caller (artworks_visible). */
export function toApplicationRow(row: ApplicationViewRow, works: ArtworkView[]): ApplicationRow {
  const a: ApplicationRow = {
    id: row.id,
    callId: row.call_id,
    artistId: row.artist_id,
    artworkIds: [...(row.artwork_ids ?? [])],
    statement: row.statement,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    callTitle: row.call_title ?? 'A call that has been removed',
    artistWorkingName: row.artist_working_name ?? 'Unknown artist',
    works,
  };
  if (row.decision_note) a.decisionNote = row.decision_note;
  if (row.staff_note) a.staffNote = row.staff_note;
  if (row.decided_at) a.decidedAt = iso(row.decided_at);
  if (row.call_deadline) a.callDeadline = row.call_deadline;
  return a;
}

export function toBuyerInquiryRow(row: BuyerInquiryViewRow): BuyerInquiryRow {
  const b: BuyerInquiryRow = {
    id: row.id,
    name: row.name,
    email: row.email,
    intent: row.intent,
    message: row.message,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.artwork_id) b.artworkId = row.artwork_id;
  if (row.artist_id) b.artistId = row.artist_id;
  if (row.organization) b.organization = row.organization;
  if (row.staff_note) b.staffNote = row.staff_note;
  if (row.artwork_title) b.artworkTitle = row.artwork_title;
  if (row.artist_working_name) b.artistWorkingName = row.artist_working_name;
  return b;
}

/* -------------------------------------------- programme: domain → database -- */
// Every authored column is written on update (absent optional → NULL), so a
// cleared field is really cleared — the mock replaces the whole item the same way.

type Authored<T extends ProgrammeBase> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

function imageToJson(im: ProgrammeImage | undefined): ImageRowJson | null {
  if (!im) return null;
  const out: ImageRowJson = { src: im.src, alt: im.alt };
  if (im.credit) out.credit = im.credit;
  return out;
}

function venueToJson(v: Venue | undefined): VenueRowJson | null {
  if (!v) return null;
  const out: VenueRowJson = { name: v.name, city: v.city };
  if (v.address) out.address = v.address;
  return out;
}

export function exhibitionToRow(e: Authored<Exhibition>): Record<string, unknown> {
  return {
    title: e.title,
    subtitle: e.subtitle ?? null,
    starts_on: e.startsOn,
    ends_on: e.endsOn ?? null,
    venue: venueToJson(e.venue),
    summary: e.summary,
    body: e.body ?? '',
    image: imageToJson(e.image),
    artwork_ids: e.artworkIds ?? [],
    external_url: e.externalUrl ?? null,
    curated_by: e.curatedBy ?? null,
    sample: !!e.sample,
    published: !!e.published,
  };
}

export function openCallToRow(c: Authored<OpenCall>): Record<string, unknown> {
  return {
    title: c.title,
    partner: c.partner ?? null,
    summary: c.summary,
    body: c.body ?? '',
    eligibility: c.eligibility,
    mediums: c.mediums ?? [],
    opens_on: c.opensOn,
    deadline: c.deadline ?? null,
    max_works: c.maxWorks,
    fee: c.fee,
    award: c.award ?? null,
    image: imageToJson(c.image),
    external_url: c.externalUrl ?? null,
    exhibition_id: c.exhibitionId ?? null,
    sample: !!c.sample,
    published: !!c.published,
    kind: c.kind ?? 'exhibition',
    organizer_institution_id: c.organizerInstitutionId ?? null,
    terms: termsToJson(c.terms),
    looking_for: c.lookingFor && Object.keys(c.lookingFor).length ? c.lookingFor : null,
  };
}

export function eventToRow(e: Authored<ProgrammeEvent>): Record<string, unknown> {
  return {
    title: e.title,
    kind: e.kind,
    starts_at: e.startsAt,
    ends_at: e.endsAt ?? null,
    venue: venueToJson(e.venue),
    summary: e.summary,
    rsvp_url: e.rsvpUrl ?? null,
    exhibition_id: e.exhibitionId ?? null,
    sample: !!e.sample,
    published: !!e.published,
  };
}

export function storyToRow(s: Authored<Story>): Record<string, unknown> {
  return {
    title: s.title,
    dek: s.dek,
    kind: s.kind,
    body: s.body,
    author: s.author,
    published_on: s.publishedOn,
    artist_id: s.artistId ?? null,
    artwork_ids: s.artworkIds ?? [],
    image: imageToJson(s.image),
    sample: !!s.sample,
    published: !!s.published,
  };
}

/* ------------------------------------------------- sales (0009_sales.sql) -- */

/** A kofi.payouts row as JSON (to_jsonb in kofi.lot_extras) or from kofi.payouts_visible. */
export interface PayoutDbRow {
  id: string;
  lot_id: string;
  artist_id: string;
  amount: Num;
  currency: string;
  status: PayoutStatus;
  method: string | null;
  reference: string | null;
  paid_at: Ts | null;
  note: string | null;
  created_at: Ts;
  updated_at: Ts;
}

/** kofi.payouts_visible */
export interface PayoutViewRow extends PayoutDbRow {
  artist_working_name: string | null;
  artwork_title: string | null;
  call_title: string | null;
  lot_number: number | null;
}

/** kofi.lots_visible: `sale` has no buyerRef for the artist; `payout` is NULL for the organiser. */
export interface LotViewRow {
  id: string;
  call_id: string;
  application_id: string;
  artwork_id: string;
  artist_id: string;
  lot_number: number;
  reserve: Num | null;
  starting_bid: Num | null;
  status: LotStatus;
  sale: Sale | null;
  payout: PayoutDbRow | null;
  call_title: string | null;
  call_kind: CallKind | null;
  artwork_title: string | null;
  artist_working_name: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export function toPayout(row: PayoutDbRow): Payout {
  const p: Payout = {
    id: row.id,
    lotId: row.lot_id,
    artistId: row.artist_id,
    amount: num(row.amount),
    currency: row.currency,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.method) p.method = row.method;
  if (row.reference) p.reference = row.reference;
  if (row.paid_at) p.paidAt = iso(row.paid_at);
  if (row.note) p.note = row.note;
  return p;
}

export function toPayoutRow(row: PayoutViewRow): PayoutRow {
  return {
    ...toPayout(row),
    artistWorkingName: row.artist_working_name ?? 'Unknown artist',
    artworkTitle: row.artwork_title ?? 'A work that has been removed',
    callTitle: row.call_title ?? 'A call that has been removed',
    lotNumber: row.lot_number ?? 0,
  };
}

/** The frozen sale exactly as record_sale() wrote it (buyerRef only when the view kept it). */
export function toSale(s: Sale): Sale {
  const out: Sale = {
    hammerPrice: num(s.hammerPrice),
    currency: s.currency,
    buyerPremium: num(s.buyerPremium),
    artistAmount: num(s.artistAmount),
    kofiAmount: num(s.kofiAmount),
    partnerAmount: num(s.partnerAmount),
    terms: toTerms(s.terms) ?? s.terms,
    soldAt: iso(s.soldAt),
  };
  if (s.buyerRef) out.buyerRef = s.buyerRef;
  return out;
}

export function toLot(row: LotViewRow): Lot {
  const l: Lot = {
    id: row.id,
    callId: row.call_id,
    applicationId: row.application_id,
    artworkId: row.artwork_id,
    artistId: row.artist_id,
    lotNumber: row.lot_number,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.reserve !== null && row.reserve !== undefined) l.reserve = num(row.reserve);
  if (row.starting_bid !== null && row.starting_bid !== undefined) l.startingBid = num(row.starting_bid);
  if (row.sale) l.sale = toSale(row.sale);
  return l;
}

/** lots_visible row → LotRow; `work` is resolved by the caller (as this viewer may see it). */
export function toLotRow(row: LotViewRow, work?: ArtworkView): LotRow {
  const out: LotRow = {
    ...toLot(row),
    callTitle: row.call_title ?? 'A call that has been removed',
    callKind: row.call_kind ?? 'auction',
    artworkTitle: row.artwork_title ?? 'A work that has been removed',
    artistWorkingName: row.artist_working_name ?? 'Unknown artist',
  };
  if (work) out.work = work;
  if (row.payout) out.payout = toPayout(row.payout);
  return out;
}

/** LotInput & { id? } → the JSON save_lot() takes (it re-validates everything). */
export function lotInputToJson(input: { id?: string; callId: string; applicationId: string; artworkId: string; lotNumber: number; reserve?: number; startingBid?: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    callId: input.callId,
    applicationId: input.applicationId,
    artworkId: input.artworkId,
    lotNumber: input.lotNumber,
  };
  if (input.id) out.id = input.id;
  if (input.reserve !== undefined && input.reserve !== null) out.reserve = input.reserve;
  if (input.startingBid !== undefined && input.startingBid !== null) out.startingBid = input.startingBid;
  return out;
}
