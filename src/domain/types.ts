/**
 * Kofi Collections — domain model.
 *
 * Visibility is field-specific, not page-specific (guide §04). Every read goes
 * through `projectArtwork` / `projectArtist` in visibility.ts, which redacts
 * fields the viewer is not allowed to see. The Supabase backend enforces the
 * same rules with RLS + security views so the UI is never the only gate.
 */

export type Visibility = 'public' | 'institutions' | 'kofi' | 'private';
export const VISIBILITIES: Visibility[] = ['public', 'institutions', 'kofi', 'private'];

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: 'Public',
  institutions: 'Verified institutions',
  kofi: 'Kofi team only',
  private: 'Only me',
};

export const VISIBILITY_HELP: Record<Visibility, string> = {
  public: 'Anyone browsing the gallery can see this.',
  institutions: 'Only curators Kofi has verified can see this.',
  kofi: 'Only Kofi staff can see this. Used for onboarding and review.',
  private: 'Only you. Kofi admins can open it, and every open is logged.',
};

export type Role = 'public' | 'artist' | 'curator' | 'admin';

export interface Viewer {
  role: Role;
  userId?: string;
  /** Set when role === 'artist'. */
  artistId?: string;
  /** Set when role === 'curator'. */
  curatorId?: string;
  /** Curator has passed Kofi's institution verification. */
  curatorVerified?: boolean;
  displayName?: string;
}

export const PUBLIC_VIEWER: Viewer = { role: 'public', displayName: 'Visitor' };

export type Medium =
  | 'painting'
  | 'drawing'
  | 'printmaking'
  | 'sculpture'
  | 'ceramics'
  | 'textile'
  | 'photography'
  | 'video'
  | 'installation'
  | 'mixed media'
  | 'digital'
  | 'performance';

export const MEDIUMS: Medium[] = [
  'painting',
  'drawing',
  'printmaking',
  'sculpture',
  'ceramics',
  'textile',
  'photography',
  'video',
  'installation',
  'mixed media',
  'digital',
  'performance',
];

export type CareerStage = 'emerging' | 'mid-career' | 'established';
export const CAREER_STAGES: CareerStage[] = ['emerging', 'mid-career', 'established'];

export type ArtworkStatus = 'available' | 'on hold' | 'sold' | 'not for sale' | 'commission sample';
export const ARTWORK_STATUSES: ArtworkStatus[] = [
  'available',
  'on hold',
  'sold',
  'not for sale',
  'commission sample',
];

export type Unit = 'cm' | 'in';

export interface Dimensions {
  height: number;
  width: number;
  depth?: number;
  unit: Unit;
}

export type RegionPrecision = 'city' | 'region' | 'country';

export interface Region {
  city?: string;
  region: string; // e.g. "Pennsylvania", "Ontario"
  country: string; // e.g. "United States"
  /** How precisely the artist wants location shown publicly. */
  precision: RegionPrecision;
}

export interface ArtistLink {
  label: string;
  url: string;
}

export interface ArtistExperience {
  commissions: boolean;
  publicArt: boolean;
  residencies: boolean;
  institutionalShows: boolean;
  yearsPracticing?: number;
}

export interface ArtistAvailability {
  commissions: boolean;
  sales: boolean;
  exhibitions: boolean;
}

export type ArtistStatus = 'draft' | 'pending' | 'approved' | 'paused';

export interface ArtistContact {
  email: string;
  phone?: string;
  studioAddress?: string;
}

export interface Artist {
  id: string;
  userId: string;
  workingName: string;
  /** Legal name is always private. */
  legalName?: string;
  pronouns?: string;
  bio: string;
  statement?: string;
  region: Region;
  mediums: Medium[];
  careerStage: CareerStage;
  experience: ArtistExperience;
  availability: ArtistAvailability;
  links: ArtistLink[];
  /** Private — never leaves the owner/admin projection. */
  contact: ArtistContact;
  /** Internal notes written by Kofi staff. Visibility is always 'kofi'. */
  kofiNotes?: string;
  /** Visibility of the profile as a whole. 'private' = draft. */
  visibility: Extract<Visibility, 'public' | 'kofi' | 'private'>;
  status: ArtistStatus;
  consentVersion?: string;
  consentAcceptedAt?: string;
  avatarColor: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtworkImage {
  id: string;
  /** data: URL in mock mode; storage object path in Supabase mode. */
  src: string;
  alt: string;
  isPrimary: boolean;
  /** Set true once sensitive EXIF/GPS metadata has been stripped. */
  metadataStripped: boolean;
}

export interface Price {
  amount: number;
  currency: string; // ISO 4217
}

export interface Artwork {
  id: string;
  artistId: string;
  title: string;
  year: number;
  medium: Medium;
  materials: string[];
  dimensions: Dimensions;
  description: string;
  images: ArtworkImage[];
  status: ArtworkStatus;
  /** Ownership / copyright / licensing note the artist wants shown. */
  rightsNote: string;
  price?: Price;
  priceVisibility: Visibility;
  /** Visibility of the record itself. 'private' = draft. */
  visibility: Visibility;
  tags: string[];
  /** Set by Kofi when the listing has been reviewed. */
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type InstitutionType = 'museum' | 'gallery' | 'university' | 'nonprofit' | 'corporate' | 'municipal' | 'other';

export interface Institution {
  id: string;
  name: string;
  type: InstitutionType;
  website?: string;
  city?: string;
  country: string;
}

export type CuratorStatus = 'pending' | 'verified' | 'rejected';

export interface Curator {
  id: string;
  userId: string;
  name: string;
  title: string;
  institutionId: string;
  /** Work email at the institution — used for verification, never shown to artists. */
  workEmail: string;
  purpose: string;
  status: CuratorStatus;
  verificationNote?: string;
  verifiedAt?: string;
  createdAt: string;
}

export interface ShortlistItem {
  artworkId: string;
  addedAt: string;
  note?: string;
}

export interface Shortlist {
  id: string;
  curatorId: string;
  name: string;
  items: ShortlistItem[];
  createdAt: string;
  updatedAt: string;
}

export type InquiryStatus = 'pending' | 'forwarded' | 'accepted' | 'declined';

/** A controlled introduction request. Artist contact is never included. */
export interface Inquiry {
  id: string;
  curatorId: string;
  artistId: string;
  artworkId?: string;
  message: string;
  status: InquiryStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Optional note from Kofi staff when forwarding or declining. */
  staffNote?: string;
  /** Optional note from the artist when declining. Not shown to the curator. */
  artistNote?: string;
}

export type DocumentType =
  | 'invoice'
  | 'appraisal'
  | 'condition report'
  | 'provenance'
  | 'insurance'
  | 'contract'
  | 'other';

export const DOCUMENT_TYPES: DocumentType[] = [
  'invoice',
  'appraisal',
  'condition report',
  'provenance',
  'insurance',
  'contract',
  'other',
];

/** A restricted document in the artist's private vault. */
export interface ArtDocument {
  id: string;
  artistId: string;
  artworkId?: string;
  type: DocumentType;
  title: string;
  custodian: string;
  date: string;
  /** Opaque reference. Never a permanent public URL. */
  fileRef: string;
  fileName: string;
  sizeBytes: number;
  visibility: Extract<Visibility, 'private' | 'kofi'>;
  createdAt: string;
}

export type AuditAction =
  | 'artist.create'
  | 'artist.update'
  | 'artist.status'
  | 'artist.export'
  | 'artist.consent'
  | 'artwork.create'
  | 'artwork.update'
  | 'artwork.delete'
  | 'artwork.visibility'
  | 'document.add'
  | 'document.remove'
  | 'document.open'
  | 'private.view'
  | 'curator.request'
  | 'curator.status'
  | 'shortlist.create'
  | 'shortlist.add'
  | 'shortlist.remove'
  | 'shortlist.delete'
  | 'inquiry.create'
  | 'inquiry.status';

/** Append-only. */
export interface AuditEvent {
  id: string;
  actorId: string;
  actorRole: Role;
  actorName: string;
  action: AuditAction;
  entityType: 'artist' | 'artwork' | 'document' | 'curator' | 'shortlist' | 'inquiry';
  entityId: string;
  at: string;
  consentVersion?: string;
  meta?: Record<string, string | number | boolean | null>;
}

/* ---------- Viewer-facing projections ---------- */

/** What a given viewer is allowed to see of an artwork. */
export interface ArtworkView {
  id: string;
  artistId: string;
  artistWorkingName: string;
  artistCareerStage: CareerStage;
  artistExperience: ArtistExperience;
  artistRegionLabel: string;
  title: string;
  year: number;
  medium: Medium;
  materials: string[];
  dimensions: Dimensions;
  description: string;
  images: ArtworkImage[];
  status: ArtworkStatus;
  rightsNote: string;
  /** Present only when the viewer may see it. */
  price?: Price;
  /** True when a price exists but is hidden from this viewer. */
  priceWithheld: boolean;
  tags: string[];
  visibility: Visibility;
  priceVisibility: Visibility;
  /** True when the viewer owns the record (or is admin). Enables editing UI. */
  canEdit: boolean;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtistView {
  id: string;
  workingName: string;
  pronouns?: string;
  bio: string;
  statement?: string;
  /** Already reduced to the artist's chosen precision. */
  regionLabel: string;
  mediums: Medium[];
  careerStage: CareerStage;
  experience: ArtistExperience;
  availability: ArtistAvailability;
  links: ArtistLink[];
  status: ArtistStatus;
  visibility: Artist['visibility'];
  avatarColor: string;
  /** Only present for owner / admin. */
  contact?: ArtistContact;
  legalName?: string;
  kofiNotes?: string;
  consentVersion?: string;
  consentAcceptedAt?: string;
  canEdit: boolean;
  /** Full region (owner/admin only). */
  region?: Region;
  createdAt: string;
  updatedAt: string;
}

export interface DemoIdentity {
  id: string;
  label: string;
  caption: string;
  viewer: Viewer;
}

export const CONSENT_VERSION = '2026-10-v1';
