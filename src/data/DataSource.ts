import type { ArtworkFilters } from '@/domain/filters';
import type {
  ArtDocument,
  Artist,
  ArtistView,
  Artwork,
  ArtworkView,
  AuditEvent,
  Curator,
  CuratorStatus,
  DemoIdentity,
  Inquiry,
  InquiryStatus,
  Institution,
  Shortlist,
  Viewer,
} from '@/domain/types';

/** Thrown by data sources when the viewer is not allowed to do something. */
export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(message = 'You do not have access to this.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'not_found';
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a change could not be persisted (on-device storage full or blocked). The change was rolled back. */
export class StorageFullError extends Error {
  readonly code = 'storage_full';
  constructor(message: string) {
    super(message);
    this.name = 'StorageFullError';
  }
}

export class ValidationError extends Error {
  readonly code = 'validation';
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type ArtistPatch = Partial<
  Pick<
    Artist,
    | 'workingName'
    | 'legalName'
    | 'pronouns'
    | 'bio'
    | 'statement'
    | 'region'
    | 'mediums'
    | 'careerStage'
    | 'experience'
    | 'availability'
    | 'links'
    | 'contact'
    | 'visibility'
    | 'avatarColor'
  >
>;

export type ArtworkInput = Omit<Artwork, 'id' | 'artistId' | 'createdAt' | 'updatedAt' | 'reviewedAt'> & {
  id?: string;
};

export type DocumentInput = Omit<ArtDocument, 'id' | 'artistId' | 'createdAt' | 'fileRef'> & {
  /** Raw bytes as a data URL (mock) or a File (supabase). Stored privately. */
  payload: string;
};

export interface CuratorRequestInput {
  name: string;
  title: string;
  workEmail: string;
  purpose: string;
  institution: Omit<Institution, 'id'>;
}

export interface ExportResult {
  json: string;
  csv: string;
  fileBaseName: string;
}

export interface AdminArtistRow extends ArtistView {
  artworkCount: number;
}

export interface CuratorRow extends Curator {
  institution: Institution;
}

export interface InquiryRow extends Inquiry {
  curatorName: string;
  institutionName: string;
  artistWorkingName: string;
  artworkTitle?: string;
}

/**
 * Everything the UI needs. Both implementations (mock, Supabase) must enforce
 * visibility server-side-equivalent: the UI never filters private fields itself.
 */
export interface DataSource {
  readonly mode: 'mock' | 'supabase';

  /** Subscribe to any change. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;

  /* ---- identities (mock has demo identities; supabase uses auth) ---- */
  listDemoIdentities(): Promise<DemoIdentity[]>;

  /* ---- discovery ---- */
  listArtworks(viewer: Viewer, filters?: ArtworkFilters): Promise<ArtworkView[]>;
  getArtwork(viewer: Viewer, id: string): Promise<ArtworkView | undefined>;
  listArtists(viewer: Viewer): Promise<ArtistView[]>;
  getArtist(viewer: Viewer, id: string): Promise<ArtistView | undefined>;
  listArtistArtworks(viewer: Viewer, artistId: string): Promise<ArtworkView[]>;

  /* ---- artist self-service ---- */
  getMyArtist(viewer: Viewer): Promise<ArtistView | undefined>;
  updateMyArtist(viewer: Viewer, patch: ArtistPatch): Promise<ArtistView>;
  acceptConsent(viewer: Viewer, version: string): Promise<ArtistView>;
  submitForReview(viewer: Viewer): Promise<ArtistView>;
  saveArtwork(viewer: Viewer, input: ArtworkInput): Promise<ArtworkView>;
  deleteArtwork(viewer: Viewer, id: string): Promise<void>;
  listMyDocuments(viewer: Viewer, artworkId?: string): Promise<ArtDocument[]>;
  addDocument(viewer: Viewer, input: DocumentInput): Promise<ArtDocument>;
  removeDocument(viewer: Viewer, id: string): Promise<void>;
  /** Returns the payload (data URL) for an authorized viewer. Access is audited. */
  openDocument(viewer: Viewer, id: string): Promise<string>;
  exportMyData(viewer: Viewer): Promise<ExportResult>;

  /* ---- curator ---- */
  getMyCurator(viewer: Viewer): Promise<CuratorRow | undefined>;
  requestVerification(viewer: Viewer, input: CuratorRequestInput): Promise<CuratorRow>;
  listShortlists(viewer: Viewer): Promise<Shortlist[]>;
  createShortlist(viewer: Viewer, name: string): Promise<Shortlist>;
  renameShortlist(viewer: Viewer, id: string, name: string): Promise<Shortlist>;
  deleteShortlist(viewer: Viewer, id: string): Promise<void>;
  addToShortlist(viewer: Viewer, shortlistId: string, artworkId: string, note?: string): Promise<Shortlist>;
  removeFromShortlist(viewer: Viewer, shortlistId: string, artworkId: string): Promise<Shortlist>;
  createInquiry(viewer: Viewer, input: { artistId: string; artworkId?: string; message: string }): Promise<Inquiry>;
  /** Curator: own inquiries. Artist: inquiries about them (forwarded only). Admin: all. */
  listInquiries(viewer: Viewer): Promise<InquiryRow[]>;
  /** Artist accepts/declines a forwarded inquiry; admin forwards/declines. */
  setInquiryStatus(viewer: Viewer, id: string, status: InquiryStatus, note?: string): Promise<InquiryRow>;

  /* ---- Kofi admin ---- */
  listAllArtists(viewer: Viewer): Promise<AdminArtistRow[]>;
  setArtistStatus(viewer: Viewer, artistId: string, status: Artist['status'], note?: string): Promise<ArtistView>;
  setKofiNotes(viewer: Viewer, artistId: string, notes: string): Promise<ArtistView>;
  markArtworkReviewed(viewer: Viewer, artworkId: string): Promise<ArtworkView>;
  listCurators(viewer: Viewer): Promise<CuratorRow[]>;
  setCuratorStatus(viewer: Viewer, curatorId: string, status: CuratorStatus, note?: string): Promise<CuratorRow>;
  listAudit(viewer: Viewer, limit?: number): Promise<AuditEvent[]>;
  listInstitutions(viewer: Viewer): Promise<Institution[]>;

  /* ---- demo helpers ---- */
  resetDemoData(): Promise<void>;
}
