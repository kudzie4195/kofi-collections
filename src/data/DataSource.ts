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
  ApplicationRow,
  ApplicationStatus,
  BuyerInquiryRow,
  BuyerInquiryStatus,
  DemoIdentity,
  Exhibition,
  Inquiry,
  InquiryStatus,
  Institution,
  KofiReport,
  LotRow,
  LotStatus,
  OpenCall,
  PayoutRow,
  PayoutStatus,
  ReportRange,
  ProgrammeEvent,
  Shortlist,
  Story,
  Viewer,
  ProfileImport,
  ProfileImportRecord,
  SignUpInput,
  SignUpResult,
  ArtistLink,
} from '@/domain/types';
import type { BuyerInquiryInput } from '@/domain/programme';
import type { LotInput, SaleInput } from '@/domain/sales';
import type { MatchResult } from '@/domain/matching';

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

/** The email already has an account (sign-up). Field is always 'email'. */
export class ConflictError extends Error {
  readonly code = 'conflict';
  readonly field = 'email';
  constructor(message = 'There is already an account with this email. Sign in instead.') {
    super(message);
    this.name = 'ConflictError';
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

export type ArtworkInput = Omit<Artwork, 'id' | 'artistId' | 'createdAt' | 'updatedAt' | 'reviewedAt' | 'tagIds' | 'uses'> & {
  id?: string;
  /** v6: optional on input; the data layer normalises (normalizeTagIds) and defaults (NO_USES). */
  tagIds?: string[];
  uses?: Artwork['uses'];
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

/** Create (no id) or update (id) a programme item. Server sets id/createdAt/updatedAt. */
export type ProgrammeInput<T extends { id: string; createdAt: string; updatedAt: string }> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export interface ApplicationInput {
  callId: string;
  artworkIds: string[];
  statement: string;
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

  /* ---- intake (v5) ----
   * signUpArtist: creates the account and an empty draft artist (status 'draft',
   * visibility 'private', a fresh verificationToken) and records consent. Mock:
   * returns a signed-in viewer plus a DemoIdentity for the picker. Supabase:
   * auth.signUp with kofi_role=artist; emailConfirmationRequired when the
   * project asks for confirmation. Audited as artist.signup. ValidationError
   * (field) for a bad name/email/password or a consent version mismatch;
   * ConflictError when the email already has an account.
   * importProfile: reads what is public at the link and suggests fields. Never
   * writes the profile — the intake applies what the artist confirms via
   * updateMyArtist, then records the import with recordImport. Audited as
   * artist.import. ValidationError for a URL that is not http(s) or points at a
   * private address.
   * checkMyLinks: re-reads every link looking for the verification token and
   * updates verification/checkedAt. Admin may check any artist. Audited as
   * artist.links. Mock mode cannot fetch: sample links verify, others stay
   * 'unreachable' with the reason in the toast. */
  signUpArtist(input: SignUpInput): Promise<SignUpResult>;
  importProfile(viewer: Viewer, url: string): Promise<ProfileImport>;
  recordImport(viewer: Viewer, record: ProfileImportRecord): Promise<ArtistView>;
  checkMyLinks(viewer: Viewer, artistId?: string): Promise<ArtistLink[]>;

  /* ---- matching (v6) ----
   * listMatchingWorks: works the viewer may already see (same projection as
   * listArtworks) ranked against the call's effective criteria. Callers: the
   * call's organiser (partner), Kofi admins, and the artist for their own works
   * (then only their works are returned). Never reveals a work the viewer could
   * not open on its own. ForbiddenError for everyone else. */
  listMatchingWorks(viewer: Viewer, callId: string): Promise<{ work: ArtworkView; match: MatchResult }[]>;

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

  /* ---- programme: exhibitions, open calls, events, journal ----
   * Reads: published items for everyone, drafts for admins (canSeeProgramme).
   * `artworkIds` are filtered to the works the viewer may see.
   * Writes: admins only (ForbiddenError otherwise); every write is audited.
   * Deleting an open call that has applications throws ValidationError
   * ("Unpublish it instead") so artists never lose a submitted application. */
  listExhibitions(viewer: Viewer): Promise<Exhibition[]>;
  getExhibition(viewer: Viewer, id: string): Promise<Exhibition | undefined>;
  saveExhibition(viewer: Viewer, input: ProgrammeInput<Exhibition>): Promise<Exhibition>;
  deleteExhibition(viewer: Viewer, id: string): Promise<void>;
  listOpenCalls(viewer: Viewer): Promise<OpenCall[]>;
  getOpenCall(viewer: Viewer, id: string): Promise<OpenCall | undefined>;
  saveOpenCall(viewer: Viewer, input: ProgrammeInput<OpenCall>): Promise<OpenCall>;
  deleteOpenCall(viewer: Viewer, id: string): Promise<void>;
  listEvents(viewer: Viewer): Promise<ProgrammeEvent[]>;
  saveEvent(viewer: Viewer, input: ProgrammeInput<ProgrammeEvent>): Promise<ProgrammeEvent>;
  deleteEvent(viewer: Viewer, id: string): Promise<void>;
  listStories(viewer: Viewer): Promise<Story[]>;
  getStory(viewer: Viewer, id: string): Promise<Story | undefined>;
  saveStory(viewer: Viewer, input: ProgrammeInput<Story>): Promise<Story>;
  deleteStory(viewer: Viewer, id: string): Promise<void>;

  /* ---- applications to open calls ----
   * Artist: own applications only, staffNote stripped. Admin: all.
   * Curators/visitors: ForbiddenError. Rules in domain/programme.validateApplication. */
  listMyApplications(viewer: Viewer): Promise<ApplicationRow[]>;
  submitApplication(viewer: Viewer, input: ApplicationInput): Promise<ApplicationRow>;
  withdrawApplication(viewer: Viewer, id: string): Promise<ApplicationRow>;
  /** Admin. Optionally filter to one call. */
  listApplications(viewer: Viewer, callId?: string): Promise<ApplicationRow[]>;
  /** Admin. Moves allowed by domain/programme.canMoveApplication. */
  setApplicationStatus(viewer: Viewer, id: string, status: ApplicationStatus, notes?: { decisionNote?: string; staffNote?: string }): Promise<ApplicationRow>;

  /* ---- collector ("buyer") inquiries, routed through Kofi ----
   * Anyone may submit (validateBuyerInquiry; at most BUYER_INQUIRY_DAILY_LIMIT per
   * email per 24 h). Returns only a receipt — nothing about the artist. Admins list. */
  submitBuyerInquiry(viewer: Viewer, input: BuyerInquiryInput): Promise<{ id: string }>;
  listBuyerInquiries(viewer: Viewer): Promise<BuyerInquiryRow[]>;
  setBuyerInquiryStatus(viewer: Viewer, id: string, status: BuyerInquiryStatus, staffNote?: string): Promise<BuyerInquiryRow>;

  /* ---- partners (verified curators of a call's organiser institution) ----
   * A partner may: create a call as a DRAFT with its institution as organiser
   * (saveOpenCall; published stays false until Kofi publishes), edit it while draft,
   * list and decide applications to its own calls (listApplications / setApplicationStatus
   * scoped to those calls; staffNote is the reviewers' note shared with Kofi), create lots
   * and record sales on its own auction calls. Never: publish, see other calls'
   * applications, artist contact, payouts. Rules: domain/sales.isCallOrganizer. */
  /** Calls this viewer organises (admin: all with an organiser). */
  listMyCalls(viewer: Viewer): Promise<OpenCall[]>;

  /* ---- lots, sales, payouts ----
   * Kofi admins: everything. Organiser: lots + sales on its own auction calls.
   * Artists: own lots (sale without buyerRef) and own payouts. Others: ForbiddenError. */
  listLots(viewer: Viewer, callId?: string): Promise<LotRow[]>;
  saveLot(viewer: Viewer, input: LotInput & { id?: string }): Promise<LotRow>;
  setLotStatus(viewer: Viewer, id: string, status: LotStatus): Promise<LotRow>;
  /** Records the hammer price: freezes the split from the call's terms, creates the artist's payout, audits 'lot.sale'. */
  recordSale(viewer: Viewer, id: string, input: SaleInput): Promise<LotRow>;
  /** Only a lot that has never been sold or whose sale was voided (status != 'sold'). */
  deleteLot(viewer: Viewer, id: string): Promise<void>;
  listMyLots(viewer: Viewer): Promise<LotRow[]>;
  /** Admin: all; artist: own. */
  listPayouts(viewer: Viewer): Promise<PayoutRow[]>;
  /** Admin only. canMovePayout; paid requires method; audits 'payout.status'. */
  setPayoutStatus(viewer: Viewer, id: string, status: PayoutStatus, details?: { method?: string; reference?: string; note?: string; paidOn?: string }): Promise<PayoutRow>;

  /* ---- Kofi reports (admin only) ---- */
  /** Builds domain/reports.buildReport from everything in range; audits 'report.export' with the range. */
  kofiReport(viewer: Viewer, range: ReportRange): Promise<KofiReport>;

  /* ---- demo helpers ---- */
  resetDemoData(): Promise<void>;
}
