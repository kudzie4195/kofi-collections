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

/** Where a link points. 'website' is any site the artist controls. */
export type LinkPlatform = 'instagram' | 'website' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'other';
export const LINK_PLATFORMS: LinkPlatform[] = ['instagram', 'website', 'facebook', 'linkedin', 'tiktok', 'youtube', 'other'];
export const LINK_PLATFORM_LABEL: Record<LinkPlatform, string> = {
  instagram: 'Instagram',
  website: 'Website',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  other: 'Link',
};

/**
 * How a link was checked. 'verified' means Kofi's checker found the artist's
 * verification code (or a link back to their Kofi profile) on the page, so the
 * person who made this profile controls that page. 'claimed' is the artist's
 * word only. 'failed' means the page was reached and the code was not there;
 * 'unreachable' means it could not be read (private account, blocked, down).
 */
export type LinkVerification = 'claimed' | 'verified' | 'failed' | 'unreachable';

export interface ArtistLink {
  label: string;
  url: string;
  platform?: LinkPlatform;
  /** "@handle" for social platforms, host for websites. Derived, never typed. */
  handle?: string;
  verification?: LinkVerification;
  checkedAt?: string;
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
  /**
   * Six characters after "kofi-" (e.g. kofi-7f3a2k) the artist puts in a bio or
   * on a page to prove a link is theirs. Owner/admin only. Set at sign-up.
   */
  verificationToken?: string;
  /** Where profile fields came from, for Kofi's reviewer. Owner/admin only. */
  imports?: ProfileImportRecord[];
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
  /**
   * Free-text keywords the artist typed (the workbook's tag_custom_keywords). Searchable,
   * never a filter value. Before v6 this field held every tag.
   */
  tags: string[];
  /**
   * Stable tag IDs from the controlled library (domain/taxonomy.data.ts), e.g.
   * "style.abstract", "social_impact.youth_empowerment". The primary `medium` is
   * mirrored here as its medium.* id. Artist-selected only; never inferred.
   */
  tagIds: string[];
  /** Separate from `status` (inventory): what the artist allows this work to be used for. */
  uses: ArtworkUses;
  edition?: Edition;
  /** Where the work physically is, when it differs from the artist's region. Shown at region precision only. */
  location?: Region;
  /** Set by Kofi when the listing has been reviewed. */
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Permitted uses, independent of inventory status: a work can be not-for-sale but available for exhibition. */
export interface ArtworkUses {
  auction: boolean;
  exhibition: boolean;
  licensing: boolean;
  commission: boolean;
}
export const NO_USES: ArtworkUses = { auction: false, exhibition: false, licensing: false, commission: false };
export type UseKey = keyof ArtworkUses;
export const USE_KEYS: UseKey[] = ['auction', 'exhibition', 'licensing', 'commission'];
export const USE_LABEL: Record<UseKey, string> = { auction: 'Auction', exhibition: 'Exhibition', licensing: 'Licensing', commission: 'Commission' };

export type EditionType = 'unique' | 'limited' | 'open' | 'artist_proof' | 'reproduction';
export const EDITION_TYPES: EditionType[] = ['unique', 'limited', 'open', 'artist_proof', 'reproduction'];
export const EDITION_LABEL: Record<EditionType, string> = { unique: 'Unique work', limited: 'Limited edition', open: 'Open edition', artist_proof: 'Artist proof', reproduction: 'Reproduction' };
export interface Edition {
  type: EditionType;
  /** This copy's number within the edition (limited / artist proof). */
  number?: number;
  size?: number;
}

/** Derived, never stored: from dimensions for 2D work, 'three_dimensional' when the work has depth or a 3D medium. */
export type Orientation = 'portrait' | 'landscape' | 'square' | 'panoramic' | 'three_dimensional';
export const ORIENTATIONS: Orientation[] = ['portrait', 'landscape', 'square', 'panoramic', 'three_dimensional'];
export const ORIENTATION_LABEL: Record<Orientation, string> = { portrait: 'Portrait', landscape: 'Landscape', square: 'Square', panoramic: 'Panoramic', three_dimensional: 'Three-dimensional' };

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
  | 'inquiry.status'
  | 'programme.save'
  | 'programme.delete'
  | 'application.submit'
  | 'application.withdraw'
  | 'application.status'
  | 'buyer_inquiry.submit'
  | 'buyer_inquiry.status'
  | 'lot.save'
  | 'lot.sale'
  | 'lot.delete'
  | 'payout.status'
  | 'report.export'
  | 'artist.signup'
  | 'artist.import'
  | 'artist.links';

/** Append-only. */
export interface AuditEvent {
  id: string;
  actorId: string;
  actorRole: Role;
  actorName: string;
  action: AuditAction;
  entityType: 'artist' | 'artwork' | 'document' | 'curator' | 'shortlist' | 'inquiry' | 'exhibition' | 'open_call' | 'event' | 'story' | 'application' | 'buyer_inquiry' | 'lot' | 'payout' | 'report';
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
  tagIds: string[];
  uses: ArtworkUses;
  edition?: Edition;
  /** Derived from dimensions/medium. */
  orientation: Orientation;
  /** Region label of the work's own location when set, else the artist's. */
  locationLabel: string;
  /** The stored location, owner/admin only (so the editor can show it). */
  location?: Region;
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
  /** Owner/admin only. */
  verificationToken?: string;
  imports?: ProfileImportRecord[];
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

/* =====================================================================
   Programme — content Kofi authors (exhibitions, open calls, events,
   journal) and the two flows that hang off it: artist applications to
   open calls, and collector ("buyer") inquiries routed through Kofi.

   Visibility rules (enforced by both data sources, tested in
   src/domain/programme.test.ts and supabase/tests):
   - Programme items: `published` → anyone; unpublished → Kofi admins only.
     Only admins create/edit/delete them.
   - `artworkIds` on any programme item are filtered to the works the
     viewer may see; a hidden work is dropped, never shown as a stub.
   - Applications: the applying artist and Kofi admins only. `staffNote`
     is Kofi-only; `decisionNote` is shown to the artist.
   - Buyer inquiries: anyone may submit (incl. visitors); only admins can
     list or read them. The artist's contact details are never exposed.
   ===================================================================== */

export interface ProgrammeImage {
  /** data:image/*, storage:<bucket>/<path>, or a bundled /art/<file> path. */
  src: string;
  alt: string;
  credit?: string;
}

export interface Venue {
  name: string;
  address?: string;
  city: string;
}

/** Fields every programme item carries. */
export interface ProgrammeBase {
  id: string;
  /** Fictional demo content — rendered with a visible "Sample" tag. */
  sample: boolean;
  /** Unpublished items are drafts visible to Kofi admins only. */
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Exhibition extends ProgrammeBase {
  title: string;
  subtitle?: string;
  /** ISO date (YYYY-MM-DD). */
  startsOn: string;
  /** ISO date; omitted for a single-day show. */
  endsOn?: string;
  venue?: Venue;
  /** One or two sentences for cards. */
  summary: string;
  /** Long text; paragraphs separated by a blank line. */
  body: string;
  image?: ProgrammeImage;
  artworkIds: string[];
  /** Exhibition page on koficollections.org or a partner site. */
  externalUrl?: string;
  curatedBy?: string;
}
export type ExhibitionPhase = 'upcoming' | 'current' | 'past';

/**
 * What a call is looking for, in the same tag language as works. Used to show
 * curators the works that fit and to tell an artist how well a work matches.
 * Every field optional; an empty object means "any work".
 */
export interface CallCriteria {
  /** OR within a category, AND across categories — same as the Works filters. */
  tags?: Record<string, string[]>;
  /** The work must allow at least one of these uses (auction call → 'auction'). */
  uses?: UseKey[];
  /** Case-insensitive substring on the work's location label. */
  region?: string;
  /** Longest edge bounds in cm. */
  maxLongestEdgeCm?: number;
  minLongestEdgeCm?: number;
  /** Plain words the organiser adds, shown to artists next to the criteria. */
  note?: string;
}

export interface OpenCall extends ProgrammeBase {
  title: string;
  /** Partner organisation, e.g. the institution commissioning the show. */
  partner?: string;
  summary: string;
  body: string;
  /** Plain-language eligibility, e.g. "Artists living in Allegheny County". */
  eligibility: string;
  /** Empty = any medium. */
  mediums: Medium[];
  /** v6: what the call is looking for, for matching. Optional. */
  lookingFor?: CallCriteria;
  /** ISO date the call opens. */
  opensOn: string;
  /** ISO date of the last day to apply (inclusive). Omitted = open until filled. */
  deadline?: string;
  /** 1–10. */
  maxWorks: number;
  /** e.g. "No entry fee". Kofi calls never charge artists; free text so partners can state terms. */
  fee: string;
  award?: string;
  image?: ProgrammeImage;
  /** When set, applications are taken on this external form, not in the app. */
  externalUrl?: string;
  exhibitionId?: string;
  /** What the call leads to. 'auction' calls can have lots (see Lot). Default 'exhibition'. */
  kind: CallKind;
  /**
   * The institution running this call, if not Kofi. Verified curators of that
   * institution ("partners") may edit the call while it is a draft, review its
   * applications and record selections; Kofi publishes it and sees everything.
   */
  organizerInstitutionId?: string;
  /** Published money terms. Required for 'auction' calls; optional otherwise. */
  terms?: CallTerms;
}
export type CallPhase = 'upcoming' | 'open' | 'closed';

export type CallKind = 'exhibition' | 'auction' | 'commission' | 'award';
export const CALL_KINDS: CallKind[] = ['exhibition', 'auction', 'commission', 'award'];
export const CALL_KIND_LABEL: Record<CallKind, string> = {
  exhibition: 'Exhibition',
  auction: 'Auction',
  commission: 'Commission',
  award: 'Award',
};

/**
 * How money from a sale is shared. Whole percentages; artist + kofi + partner = 100.
 * buyerPremiumPct is charged on top of the hammer price and kept by the organiser;
 * resaleRoyaltyPct is the artist's share of any later resale (recorded on the sale,
 * from Kofi's open-source seller's contract). Never estimates value — artists set prices.
 */
export interface CallTerms {
  artistSharePct: number;
  kofiSharePct: number;
  partnerSharePct: number;
  buyerPremiumPct: number;
  resaleRoyaltyPct: number;
  currency: string;
  /** Free text shown to artists before they apply, e.g. "Paid within 30 days of the sale." */
  paymentNote?: string;
}

export type ApplicationStatus = 'submitted' | 'shortlisted' | 'accepted' | 'declined' | 'withdrawn';
export const APPLICATION_STATUSES: ApplicationStatus[] = ['submitted', 'shortlisted', 'accepted', 'declined', 'withdrawn'];

export interface Application {
  id: string;
  callId: string;
  artistId: string;
  /** The artist's own works; never 'private' ones (see validateApplication). */
  artworkIds: string[];
  statement: string;
  status: ApplicationStatus;
  /** Shown to the artist with the decision. */
  decisionNote?: string;
  /** Reviewers' note (Kofi and the call's organiser). Never returned to the artist. */
  staffNote?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
}

export interface ApplicationRow extends Application {
  callTitle: string;
  callDeadline?: string;
  artistWorkingName: string;
  /** The attached works as this viewer may see them (artist: own; admin: all). */
  works: ArtworkView[];
}

export type EventKind = 'opening' | 'talk' | 'studio visit' | 'workshop' | 'social';
export const EVENT_KINDS: EventKind[] = ['opening', 'talk', 'studio visit', 'workshop', 'social'];

export interface ProgrammeEvent extends ProgrammeBase {
  title: string;
  kind: EventKind;
  /** ISO datetime with offset. */
  startsAt: string;
  endsAt?: string;
  venue?: Venue;
  summary: string;
  rsvpUrl?: string;
  exhibitionId?: string;
}

export type StoryKind = 'interview' | 'studio visit' | 'essay' | 'news';
export const STORY_KINDS: StoryKind[] = ['interview', 'studio visit', 'essay', 'news'];

export interface Story extends ProgrammeBase {
  title: string;
  /** Standfirst under the headline. */
  dek: string;
  kind: StoryKind;
  /** Paragraphs separated by a blank line. A line starting with "> " is a pull quote. */
  body: string;
  author: string;
  /** ISO date. */
  publishedOn: string;
  artistId?: string;
  artworkIds: string[];
  image?: ProgrammeImage;
}

export type BuyerIntent = 'purchase' | 'commission' | 'placement' | 'exhibition' | 'other';
export const BUYER_INTENTS: BuyerIntent[] = ['purchase', 'commission', 'placement', 'exhibition', 'other'];
export const BUYER_INTENT_LABEL: Record<BuyerIntent, string> = {
  purchase: 'Buying this work',
  commission: 'Commissioning the artist',
  placement: 'Art for a home or workplace',
  exhibition: 'Showing the work',
  other: 'Something else',
};

export type BuyerInquiryStatus = 'new' | 'in progress' | 'closed';
export const BUYER_INQUIRY_STATUSES: BuyerInquiryStatus[] = ['new', 'in progress', 'closed'];

export interface BuyerInquiry {
  id: string;
  artworkId?: string;
  artistId?: string;
  name: string;
  email: string;
  organization?: string;
  intent: BuyerIntent;
  message: string;
  status: BuyerInquiryStatus;
  staffNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuyerInquiryRow extends BuyerInquiry {
  artworkTitle?: string;
  artistWorkingName?: string;
}

/* =====================================================================
   Sales — a selected work on an auction call becomes a Lot. Recording the
   hammer price creates the Sale (the split, computed once from the call's
   terms and frozen) and the artist's Payout. Kofi admins manage lots and
   payouts; the call's organiser may create lots and record sales for its
   own call; artists see their own lots and payouts; nobody else sees them.
   Rules in src/domain/sales.ts.
   ===================================================================== */

export type LotStatus = 'planned' | 'live' | 'sold' | 'unsold' | 'withdrawn';
export const LOT_STATUSES: LotStatus[] = ['planned', 'live', 'sold', 'unsold', 'withdrawn'];

export interface Lot {
  id: string;
  callId: string;
  applicationId: string;
  artworkId: string;
  artistId: string;
  lotNumber: number;
  /** Lowest acceptable hammer price (the artist's floor), in the call's currency. */
  reserve?: number;
  startingBid?: number;
  status: LotStatus;
  sale?: Sale;
  createdAt: string;
  updatedAt: string;
}

/** Frozen at the moment of sale so later changes to the call's terms never rewrite history. */
export interface Sale {
  hammerPrice: number;
  currency: string;
  buyerPremium: number;
  artistAmount: number;
  kofiAmount: number;
  partnerAmount: number;
  terms: CallTerms;
  soldAt: string;
  /** Kofi/organiser-only. e.g. "Paddle 14" or a buyer's organisation. Never shown to artists. */
  buyerRef?: string;
}

export interface LotRow extends Lot {
  callTitle: string;
  callKind: CallKind;
  artworkTitle: string;
  artistWorkingName: string;
  /** The work as this viewer may see it. */
  work?: ArtworkView;
  payout?: Payout;
}

export type PayoutStatus = 'due' | 'paid' | 'void';
export const PAYOUT_STATUSES: PayoutStatus[] = ['due', 'paid', 'void'];

/** What Kofi owes an artist from one lot. Created with the sale; Kofi marks it paid. */
export interface Payout {
  id: string;
  lotId: string;
  artistId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  /** Set when paid: e.g. "Bank transfer", "Check #1042". */
  method?: string;
  reference?: string;
  paidAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutRow extends Payout {
  artistWorkingName: string;
  artworkTitle: string;
  callTitle: string;
  lotNumber: number;
}

/* ---------- Reports (Kofi-wide, admin only) ---------- */

export interface ReportRange {
  /** ISO dates, inclusive, in Kofi's time zone. */
  from: string;
  to: string;
}

export interface ParticipationRow {
  artistId: string;
  artistWorkingName: string;
  callId: string;
  callTitle: string;
  callKind: CallKind;
  organizer: string;
  applicationId: string;
  status: ApplicationStatus;
  worksAttached: number;
  submittedOn: string;
  decidedOn?: string;
}

export type PlacementKind = 'exhibition' | 'selection' | 'lot' | 'sale';
export interface PlacementRow {
  artistId: string;
  artistWorkingName: string;
  artworkId: string;
  artworkTitle: string;
  kind: PlacementKind;
  /** Exhibition or call title. */
  where: string;
  on: string;
  amount?: number;
  currency?: string;
}

export interface PaymentRow {
  payoutId: string;
  artistId: string;
  artistWorkingName: string;
  artworkTitle: string;
  callTitle: string;
  lotNumber: number;
  hammerPrice: number;
  artistAmount: number;
  kofiAmount: number;
  partnerAmount: number;
  buyerPremium: number;
  currency: string;
  status: PayoutStatus;
  soldOn: string;
  paidOn?: string;
  method?: string;
  reference?: string;
}

export interface KofiReport {
  range: ReportRange;
  generatedAt: string;
  participation: ParticipationRow[];
  placements: PlacementRow[];
  payments: PaymentRow[];
  totals: {
    applications: number;
    selected: number;
    artistsParticipating: number;
    lotsSold: number;
    hammerTotal: Record<string, number>;
    artistPaid: Record<string, number>;
    artistDue: Record<string, number>;
  };
}

/* =====================================================================
   v5 — intake: sign-up, profile import from the artist's own links, and
   link verification. Pure rules live in domain/intake.ts.
   ===================================================================== */

/** Fields an import can suggest. Everything is a suggestion the artist confirms. */
export interface ProfileImportFields {
  workingName?: string;
  bio?: string;
  /** A photo URL on the source (never copied without the artist's confirmation). */
  photoUrl?: string;
  city?: string;
  region?: string;
  country?: string;
  /** Other links found on the page (rel=me, bio links). */
  links?: ArtistLink[];
  /** Platform-level signals, shown to the reviewer, never to the public. */
  followers?: number;
  postCount?: number;
}

export interface ProfileImport {
  source: ArtistLink;
  fields: ProfileImportFields;
  /** 0–1 per field: how much to trust the suggestion (1 = structured data, 0.5 = og tags, 0.3 = guessed from the handle). */
  confidence: Partial<Record<keyof ProfileImportFields, number>>;
  fetchedAt: string;
  /** Plain-language notes: "Instagram did not let us read the bio; we used the handle." */
  notes: string[];
}

/** What the reviewer sees about where a profile came from. */
export interface ProfileImportRecord {
  source: ArtistLink;
  fetchedAt: string;
  /** Which fields the artist accepted from this import. */
  appliedFields: (keyof ProfileImportFields)[];
  notes: string[];
}

export interface SignUpInput {
  displayName: string;
  email: string;
  password: string;
  /** Must equal CONSENT_VERSION. */
  consentVersion: string;
}

export interface SignUpResult {
  viewer: Viewer;
  /** Mock mode: the demo identity to add to the picker. */
  identity?: DemoIdentity;
  /** Supabase mode: sign-in is blocked until the email is confirmed. */
  emailConfirmationRequired: boolean;
}

/** One step of the intake, persisted so an artist can leave and come back. */
export type IntakeStep = 'account' | 'links' | 'about' | 'work' | 'verify';
export const INTAKE_STEPS: IntakeStep[] = ['account', 'links', 'about', 'work', 'verify'];
export const INTAKE_STEP_LABEL: Record<IntakeStep, string> = {
  account: 'Your account',
  links: 'Your links',
  about: 'About you',
  work: 'Your work',
  verify: 'Check and send',
};
