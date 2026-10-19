/**
 * Pure mappers between Postgres rows (snake_case, flattened) and the domain
 * types in src/domain/types.ts. No network, no supabase-js — unit-testable.
 */
import type {
  ArtDocument,
  Artist,
  ArtistView,
  ArtistStatus,
  ArtworkImage,
  ArtworkStatus,
  ArtworkView,
  Artwork,
  AuditEvent,
  CareerStage,
  Curator,
  CuratorStatus,
  DocumentType,
  Inquiry,
  InquiryStatus,
  Institution,
  InstitutionType,
  Medium,
  Region,
  RegionPrecision,
  Role,
  Shortlist,
  Unit,
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
  links: { label: string; url: string }[] | null;
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

/** kofi.artists_visible */
export interface ArtistViewRow extends ArtistCommonRow {
  region_label: string | null;
  can_edit: boolean;
}

/** Full kofi.artists row (owner export only). */
export interface ArtistRow extends ArtistCommonRow {
  user_id: string;
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
    links: (row.links ?? []).map((l) => ({ label: l.label, url: l.url })),
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
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.depth !== null && row.depth !== undefined) w.dimensions.depth = num(row.depth);
  if (row.price_amount !== null && row.price_amount !== undefined && row.price_currency) {
    w.price = { amount: num(row.price_amount), currency: row.price_currency };
  }
  if (row.reviewed_at) w.reviewedAt = iso(row.reviewed_at);
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
  if (patch.links !== undefined) row.links = patch.links.map((l) => ({ label: l.label, url: l.url }));
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
  return out;
}
