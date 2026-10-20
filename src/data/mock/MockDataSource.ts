import { applyFilters, type ArtworkFilters } from '@/domain/filters';
import { artworksToCsv, buildArtistExport } from '@/domain/export';
import type {
  Application,
  ApplicationRow,
  ApplicationStatus,
  ArtDocument,
  Artist,
  ArtistView,
  Artwork,
  ArtworkView,
  AuditAction,
  AuditEvent,
  BuyerInquiry,
  BuyerInquiryRow,
  BuyerInquiryStatus,
  CallPhase,
  CuratorStatus,
  DemoIdentity,
  Exhibition,
  Inquiry,
  InquiryStatus,
  Institution,
  OpenCall,
  ProgrammeEvent,
  ProgrammeImage,
  Shortlist,
  Story,
  Venue,
  Viewer,
} from '@/domain/types';
import { BUYER_INQUIRY_STATUSES, CONSENT_VERSION, EVENT_KINDS, MEDIUMS, STORY_KINDS } from '@/domain/types';
import { artistVisibleTo, artworkVisibleTo, canEdit, projectArtist, projectArtwork } from '@/domain/visibility';
import {
  BUYER_INQUIRY_DAILY_LIMIT,
  callPhase,
  canMoveApplication,
  canSeeProgramme,
  isIsoDate,
  kofiToday,
  sortExhibitions,
  validateApplication,
  validateBuyerInquiry,
  type BuyerInquiryInput,
} from '@/domain/programme';
import {
  ForbiddenError,
  NotFoundError,
  StorageFullError,
  ValidationError,
  type AdminArtistRow,
  type ArtistPatch,
  type ArtworkInput,
  type CuratorRequestInput,
  type CuratorRow,
  type DataSource,
  type DocumentInput,
  type ExportResult,
  type InquiryRow,
  type ApplicationInput,
  type ProgrammeInput,
} from '../DataSource';
import { buildProgrammeSeed, buildSeed, DEMO_IDENTITIES, PROGRAMME_KEYS, type MockState } from './seed';

const STORAGE_KEY = 'kofi.mock.state.v1';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export interface MockOptions {
  /** Persist to localStorage (default true in browser). Tests pass false. */
  persist?: boolean;
  now?: () => Date;
  idFactory?: (prefix: string) => string;
}

export class MockDataSource implements DataSource {
  readonly mode = 'mock' as const;
  private state: MockState;
  /** Serialized copy of the last state known to be durable; the rollback target when storage fails. */
  private lastPersisted: string;
  private listeners = new Set<() => void>();
  private readonly persist: boolean;
  private readonly now: () => Date;
  private readonly makeId: (prefix: string) => string;

  constructor(opts: MockOptions = {}) {
    this.persist = opts.persist ?? typeof localStorage !== 'undefined';
    this.now = opts.now ?? (() => new Date());
    this.makeId = opts.idFactory ?? ((p) => `${p}_${Math.random().toString(36).slice(2, 10)}`);
    this.state = this.load() ?? buildSeed();
    this.lastPersisted = JSON.stringify(this.state);
  }

  /* ---------- infrastructure ---------- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Persist and notify. `silent` persists without notifying subscribers — used for
   * audit rows written during reads, so a read never re-triggers itself.
   */
  private commit(silent = false): void {
    const serialized = JSON.stringify(this.state);
    if (this.persist) {
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch (e) {
        // Storage is full (or unavailable). Never let a save look successful when it
        // will not survive a reload: roll back to the last durable state and fail loudly.
        this.state = JSON.parse(this.lastPersisted) as MockState;
        for (const l of this.listeners) l();
        const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        throw new StorageFullError(
          quota
            ? 'On-device storage is full, so this change was not saved. Remove an image or document, or switch to Supabase mode for a real catalog.'
            : 'This device is not allowing the app to store data, so this change was not saved.',
        );
      }
    }
    this.lastPersisted = serialized;
    if (silent) return;
    for (const l of this.listeners) l();
  }

  private load(): MockState | undefined {
    if (!this.persist) return undefined;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Partial<MockState>;
      if (!parsed || !Array.isArray(parsed.artists)) return undefined;
      return migrateState(parsed);
    } catch {
      return undefined;
    }
  }

  async resetDemoData(): Promise<void> {
    this.state = buildSeed();
    if (this.persist) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    this.commit();
  }

  private iso(): string {
    return this.now().toISOString();
  }

  /**
   * The viewer's claims are re-checked against state — a curator's
   * "verified" flag comes from the curator record, never from the client.
   */
  private resolve(viewer: Viewer): Viewer {
    if (viewer.role === 'curator') {
      // Like artists, a curator claim must match both the record id and the user that owns it.
      const c = this.state.curators.find((x) => x.id === viewer.curatorId && x.userId === viewer.userId);
      if (!c && viewer.curatorId) return { role: 'public', displayName: viewer.displayName };
      return { ...viewer, curatorVerified: c?.status === 'verified' };
    }
    if (viewer.role === 'artist') {
      const a = this.state.artists.find((x) => x.id === viewer.artistId && x.userId === viewer.userId);
      return a ? viewer : { role: 'public', displayName: viewer.displayName };
    }
    return viewer;
  }

  private audit(viewer: Viewer, action: AuditAction, entityType: AuditEvent['entityType'], entityId: string, meta?: AuditEvent['meta']): void {
    const ev: AuditEvent = {
      id: this.makeId('ev'),
      actorId: viewer.userId ?? 'anonymous',
      actorRole: viewer.role,
      actorName: viewer.displayName ?? viewer.role,
      action,
      entityType,
      entityId,
      at: this.iso(),
    };
    if (meta) ev.meta = meta;
    if (action === 'artist.consent') ev.consentVersion = CONSENT_VERSION;
    this.state.audit.push(ev);
  }

  private artistById(id: string): Artist | undefined {
    return this.state.artists.find((a) => a.id === id);
  }

  private requireAdmin(viewer: Viewer): void {
    if (viewer.role !== 'admin') throw new ForbiddenError('Kofi staff only.');
  }

  private requireMyArtist(viewer: Viewer): Artist {
    const v = this.resolve(viewer);
    if (v.role !== 'artist' || !v.artistId) throw new ForbiddenError('Sign in as an artist to do this.');
    const a = this.artistById(v.artistId);
    if (!a) throw new NotFoundError('Artist profile not found.');
    return a;
  }

  private requireMyCurator(viewer: Viewer) {
    if (viewer.role !== 'curator') throw new ForbiddenError('Sign in as a curator to do this.');
    const c = this.state.curators.find((x) => !!viewer.userId && x.userId === viewer.userId && (!viewer.curatorId || x.id === viewer.curatorId));
    if (!c) throw new NotFoundError('Curator record not found.');
    return c;
  }

  private requireVerifiedCurator(viewer: Viewer) {
    const c = this.requireMyCurator(viewer);
    if (c.status !== 'verified') throw new ForbiddenError('Your institution has not been verified yet.');
    return c;
  }

  /* ---------- identities ---------- */

  async listDemoIdentities(): Promise<DemoIdentity[]> {
    return DEMO_IDENTITIES;
  }

  /* ---------- discovery ---------- */

  private visibleArtworks(viewer: Viewer): ArtworkView[] {
    const v = this.resolve(viewer);
    const out: ArtworkView[] = [];
    for (const aw of this.state.artworks) {
      const view = projectArtwork(aw, this.artistById(aw.artistId), v);
      if (view) out.push(view);
    }
    return out;
  }

  async listArtworks(viewer: Viewer, filters: ArtworkFilters = {}): Promise<ArtworkView[]> {
    // Discovery lists never include the viewer's own drafts — those live in the studio.
    const v = this.resolve(viewer);
    const items = this.visibleArtworks(v).filter((a) => {
      if (a.visibility === 'private') return false;
      if (a.visibility === 'kofi' && v.role !== 'admin') return false;
      const artist = this.artistById(a.artistId);
      return artist?.status === 'approved' || v.role === 'admin';
    });
    return applyFilters(items, filters);
  }

  async getArtwork(viewer: Viewer, id: string): Promise<ArtworkView | undefined> {
    const v = this.resolve(viewer);
    const aw = this.state.artworks.find((a) => a.id === id);
    if (!aw) return undefined;
    const view = projectArtwork(aw, this.artistById(aw.artistId), v);
    if (view && v.role === 'admin' && aw.visibility === 'private') {
      this.audit(v, 'private.view', 'artwork', aw.id);
      this.commit(true);
    }
    return view;
  }

  async listArtists(viewer: Viewer): Promise<ArtistView[]> {
    const v = this.resolve(viewer);
    const out: ArtistView[] = [];
    for (const a of this.state.artists) {
      if (a.status !== 'approved' && v.role !== 'admin') continue;
      const view = projectArtist(a, v);
      if (view) out.push(view);
    }
    return out.sort((x, y) => x.workingName.localeCompare(y.workingName));
  }

  async getArtist(viewer: Viewer, id: string): Promise<ArtistView | undefined> {
    const a = this.artistById(id);
    if (!a) return undefined;
    const v = this.resolve(viewer);
    const view = projectArtist(a, v);
    if (view && v.role === 'admin' && (a.visibility === 'private' || a.status !== 'approved')) {
      this.audit(v, 'private.view', 'artist', a.id);
      this.commit(true);
    }
    return view;
  }

  async listArtistArtworks(viewer: Viewer, artistId: string): Promise<ArtworkView[]> {
    const v = this.resolve(viewer);
    const owner = canEdit(v, artistId);
    return this.visibleArtworks(v)
      .filter((a) => a.artistId === artistId)
      .filter((a) => owner || (a.visibility !== 'private' && a.visibility !== 'kofi'))
      .sort((x, y) => y.year - x.year || y.createdAt.localeCompare(x.createdAt));
  }

  /* ---------- artist self-service ---------- */

  async getMyArtist(viewer: Viewer): Promise<ArtistView | undefined> {
    const v = this.resolve(viewer);
    if (v.role !== 'artist' || !v.artistId) return undefined;
    const a = this.artistById(v.artistId);
    return a ? projectArtist(a, v) : undefined;
  }

  async updateMyArtist(viewer: Viewer, patch: ArtistPatch): Promise<ArtistView> {
    const a = this.requireMyArtist(viewer);
    if (patch.workingName !== undefined && !patch.workingName.trim()) throw new ValidationError('Working name is required.', 'workingName');
    if (patch.bio !== undefined && patch.bio.trim().length < 20) throw new ValidationError('Write at least a sentence for your bio.', 'bio');
    if (patch.mediums !== undefined && patch.mediums.length === 0) throw new ValidationError('Pick at least one medium.', 'mediums');
    if (patch.contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.contact.email)) throw new ValidationError('Enter a valid email.', 'contact');
    for (const link of patch.links ?? []) {
      if (!/^https?:\/\//i.test(link.url)) throw new ValidationError(`Link "${link.label || link.url}" must start with http:// or https://`, 'links');
    }
    const prevVisibility = a.visibility;
    // Runtime whitelist: status, kofiNotes, consent and identity fields can never arrive through a patch.
    const safe: ArtistPatch = {};
    for (const key of ARTIST_PATCH_KEYS) if (key in patch) (safe as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key];
    Object.assign(a, safe, { updatedAt: this.iso() });
    // An approved artist who hides their profile is paused, not deleted; re-publishing needs no re-review.
    if (patch.visibility && patch.visibility !== prevVisibility) {
      this.audit(viewer, 'artist.update', 'artist', a.id, { visibility: patch.visibility });
    } else {
      this.audit(viewer, 'artist.update', 'artist', a.id);
    }
    this.commit();
    return projectArtist(a, this.resolve(viewer))!;
  }

  async acceptConsent(viewer: Viewer, version: string): Promise<ArtistView> {
    const a = this.requireMyArtist(viewer);
    a.consentVersion = version;
    a.consentAcceptedAt = this.iso();
    a.updatedAt = a.consentAcceptedAt;
    this.audit(viewer, 'artist.consent', 'artist', a.id, { version });
    this.commit();
    return projectArtist(a, this.resolve(viewer))!;
  }

  async submitForReview(viewer: Viewer): Promise<ArtistView> {
    const a = this.requireMyArtist(viewer);
    if (a.consentVersion !== CONSENT_VERSION) throw new ValidationError('Accept the current consent terms before submitting.', 'consent');
    if (a.status === 'approved') return projectArtist(a, this.resolve(viewer))!;
    a.status = 'pending';
    a.updatedAt = this.iso();
    this.audit(viewer, 'artist.status', 'artist', a.id, { status: 'pending' });
    this.commit();
    return projectArtist(a, this.resolve(viewer))!;
  }

  async saveArtwork(viewer: Viewer, input: ArtworkInput): Promise<ArtworkView> {
    const a = this.requireMyArtist(viewer);
    validateArtwork(input);
    const now = this.iso();
    if (input.id) {
      const existing = this.state.artworks.find((x) => x.id === input.id);
      if (!existing) throw new NotFoundError('Artwork not found.');
      if (existing.artistId !== a.id) throw new ForbiddenError('You can only edit your own work.');
      const visibilityChanged = existing.visibility !== input.visibility || existing.priceVisibility !== input.priceVisibility;
      const { id: _id, ...rest } = input as ArtworkInput & { artistId?: string; reviewedAt?: string };
      delete rest.artistId;
      delete rest.reviewedAt;
      Object.assign(existing, rest, { updatedAt: now });
      if (visibilityChanged) {
        this.audit(viewer, 'artwork.visibility', 'artwork', existing.id, {
          visibility: existing.visibility,
          priceVisibility: existing.priceVisibility,
        });
      } else this.audit(viewer, 'artwork.update', 'artwork', existing.id);
      this.commit();
      return projectArtwork(existing, a, this.resolve(viewer))!;
    }
    const { id: _ignored, ...rest } = input as ArtworkInput & { artistId?: string; reviewedAt?: string };
    delete rest.artistId;
    delete rest.reviewedAt;
    const created: Artwork = { ...rest, id: this.makeId('aw'), artistId: a.id, createdAt: now, updatedAt: now };
    this.state.artworks.push(created);
    this.audit(viewer, 'artwork.create', 'artwork', created.id);
    this.commit();
    return projectArtwork(created, a, this.resolve(viewer))!;
  }

  async deleteArtwork(viewer: Viewer, id: string): Promise<void> {
    const a = this.requireMyArtist(viewer);
    const idx = this.state.artworks.findIndex((x) => x.id === id);
    if (idx < 0) throw new NotFoundError('Artwork not found.');
    if (this.state.artworks[idx]!.artistId !== a.id) throw new ForbiddenError('You can only delete your own work.');
    this.state.artworks.splice(idx, 1);
    // Shortlists referencing it lose the item; documents stay in the vault (retention explained in UI).
    for (const s of this.state.shortlists) s.items = s.items.filter((i) => i.artworkId !== id);
    for (const doc of this.state.documents) if (doc.artworkId === id) delete doc.artworkId;
    this.audit(viewer, 'artwork.delete', 'artwork', id);
    this.commit();
  }

  async listMyDocuments(viewer: Viewer, artworkId?: string): Promise<ArtDocument[]> {
    const v = this.resolve(viewer);
    let docs: ArtDocument[];
    if (v.role === 'admin') {
      docs = this.state.documents.filter((d) => d.visibility === 'kofi' || d.visibility === 'private');
      if (artworkId) {
        this.audit(v, 'private.view', 'artwork', artworkId, { what: 'documents' });
        this.commit(true);
      }
    } else {
      const a = this.requireMyArtist(v);
      docs = this.state.documents.filter((d) => d.artistId === a.id);
    }
    if (artworkId) docs = docs.filter((d) => d.artworkId === artworkId);
    return docs.map((d) => ({ ...d })).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async addDocument(viewer: Viewer, input: DocumentInput): Promise<ArtDocument> {
    const a = this.requireMyArtist(viewer);
    if (!input.title.trim()) throw new ValidationError('Give the document a title.', 'title');
    if (!input.payload.startsWith('data:')) throw new ValidationError('Unsupported file.', 'file');
    if (input.sizeBytes > MAX_DOC_BYTES) throw new ValidationError('Documents must be under 10 MB.', 'file');
    if (input.artworkId && !this.state.artworks.some((x) => x.id === input.artworkId && x.artistId === a.id)) {
      throw new ForbiddenError('You can only attach documents to your own work.');
    }
    const id = this.makeId('doc');
    const fileRef = `vault/${a.id}/${id}`;
    const { payload, ...rest } = input;
    const doc: ArtDocument = { ...rest, id, artistId: a.id, fileRef, createdAt: this.iso() };
    this.state.documents.push(doc);
    this.state.documentPayloads[fileRef] = payload;
    this.audit(viewer, 'document.add', 'document', id, { type: doc.type });
    this.commit();
    return { ...doc };
  }

  async removeDocument(viewer: Viewer, id: string): Promise<void> {
    const a = this.requireMyArtist(viewer);
    const idx = this.state.documents.findIndex((d) => d.id === id);
    if (idx < 0) throw new NotFoundError('Document not found.');
    const doc = this.state.documents[idx]!;
    if (doc.artistId !== a.id) throw new ForbiddenError('You can only remove your own documents.');
    this.state.documents.splice(idx, 1);
    delete this.state.documentPayloads[doc.fileRef];
    this.audit(viewer, 'document.remove', 'document', id);
    this.commit();
  }

  async openDocument(viewer: Viewer, id: string): Promise<string> {
    const v = this.resolve(viewer);
    const doc = this.state.documents.find((d) => d.id === id);
    if (!doc) throw new NotFoundError('Document not found.');
    const owner = v.role === 'artist' && v.artistId === doc.artistId;
    if (!owner && v.role !== 'admin') throw new ForbiddenError('This document is private.');
    const payload = this.state.documentPayloads[doc.fileRef];
    if (!payload) throw new NotFoundError('File is missing from the vault.');
    this.audit(v, 'document.open', 'document', id, { byOwner: owner });
    this.commit();
    return payload;
  }

  async exportMyData(viewer: Viewer): Promise<ExportResult> {
    const a = this.requireMyArtist(viewer);
    const works = this.state.artworks.filter((x) => x.artistId === a.id);
    const docs = this.state.documents.filter((d) => d.artistId === a.id);
    const bundle = buildArtistExport(a, works, docs, this.now());
    this.audit(viewer, 'artist.export', 'artist', a.id, { artworks: works.length, documents: docs.length });
    this.commit();
    const slug = a.workingName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return { json: JSON.stringify(bundle, null, 2), csv: artworksToCsv(works), fileBaseName: `kofi-export-${slug}` };
  }

  /* ---------- curator ---------- */

  private curatorRow(id: string): CuratorRow | undefined {
    const c = this.state.curators.find((x) => x.id === id);
    if (!c) return undefined;
    const institution = this.state.institutions.find((i) => i.id === c.institutionId);
    if (!institution) return undefined;
    return { ...c, institution };
  }

  async getMyCurator(viewer: Viewer): Promise<CuratorRow | undefined> {
    if (viewer.role !== 'curator') return undefined;
    const c = this.state.curators.find((x) => !!viewer.userId && x.userId === viewer.userId && (!viewer.curatorId || x.id === viewer.curatorId));
    return c ? this.curatorRow(c.id) : undefined;
  }

  async requestVerification(viewer: Viewer, input: CuratorRequestInput): Promise<CuratorRow> {
    if (viewer.role !== 'curator' || !viewer.userId) throw new ForbiddenError('Sign in as a curator to request verification.');
    if (!input.name.trim()) throw new ValidationError('Your name is required.', 'name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.workEmail)) throw new ValidationError('Use your institutional work email.', 'workEmail');
    if (!input.institution.name.trim()) throw new ValidationError('Institution name is required.', 'institution');
    if (input.purpose.trim().length < 20) throw new ValidationError('Tell Kofi what you are looking for (a sentence or two).', 'purpose');
    let inst = this.state.institutions.find((i) => i.name.toLowerCase() === input.institution.name.trim().toLowerCase());
    if (!inst) {
      inst = { ...input.institution, id: this.makeId('inst') };
      this.state.institutions.push(inst);
    }
    let c = this.state.curators.find((x) => x.userId === viewer.userId);
    if (c) {
      if (c.status === 'verified') return this.curatorRow(c.id)!;
      Object.assign(c, { name: input.name, title: input.title, workEmail: input.workEmail, purpose: input.purpose, institutionId: inst.id, status: 'pending' as const });
      delete c.verificationNote;
    } else {
      c = {
        id: viewer.curatorId ?? this.makeId('cur'),
        userId: viewer.userId,
        name: input.name,
        title: input.title,
        institutionId: inst.id,
        workEmail: input.workEmail,
        purpose: input.purpose,
        status: 'pending',
        createdAt: this.iso(),
      };
      this.state.curators.push(c);
    }
    this.audit(viewer, 'curator.request', 'curator', c.id);
    this.commit();
    return this.curatorRow(c.id)!;
  }

  async listShortlists(viewer: Viewer): Promise<Shortlist[]> {
    const c = this.requireMyCurator(viewer);
    return this.state.shortlists.filter((s) => s.curatorId === c.id).map(cloneShortlist).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  }

  async createShortlist(viewer: Viewer, name: string): Promise<Shortlist> {
    const c = this.requireMyCurator(viewer);
    if (!name.trim()) throw new ValidationError('Name the shortlist.', 'name');
    const now = this.iso();
    const s: Shortlist = { id: this.makeId('sl'), curatorId: c.id, name: name.trim(), items: [], createdAt: now, updatedAt: now };
    this.state.shortlists.push(s);
    this.audit(viewer, 'shortlist.create', 'shortlist', s.id);
    this.commit();
    return cloneShortlist(s);
  }

  private myShortlist(viewer: Viewer, id: string): Shortlist {
    const c = this.requireMyCurator(viewer);
    const s = this.state.shortlists.find((x) => x.id === id);
    if (!s) throw new NotFoundError('Shortlist not found.');
    if (s.curatorId !== c.id) throw new ForbiddenError('That shortlist belongs to someone else.');
    return s;
  }

  async renameShortlist(viewer: Viewer, id: string, name: string): Promise<Shortlist> {
    const s = this.myShortlist(viewer, id);
    if (!name.trim()) throw new ValidationError('Name the shortlist.', 'name');
    s.name = name.trim();
    s.updatedAt = this.iso();
    this.commit();
    return cloneShortlist(s);
  }

  async deleteShortlist(viewer: Viewer, id: string): Promise<void> {
    const s = this.myShortlist(viewer, id);
    this.state.shortlists = this.state.shortlists.filter((x) => x.id !== s.id);
    this.audit(viewer, 'shortlist.delete', 'shortlist', id);
    this.commit();
  }

  async addToShortlist(viewer: Viewer, shortlistId: string, artworkId: string, note?: string): Promise<Shortlist> {
    const v = this.resolve(viewer);
    const s = this.myShortlist(v, shortlistId);
    const aw = this.state.artworks.find((x) => x.id === artworkId);
    // A curator can only shortlist what they are authorized to see.
    if (!aw || !artworkVisibleTo(aw, this.artistById(aw.artistId), v) || aw.visibility === 'private' || aw.visibility === 'kofi') {
      throw new ForbiddenError('You can only shortlist work you are authorized to see.');
    }
    if (!s.items.some((i) => i.artworkId === artworkId)) {
      const item: Shortlist['items'][number] = { artworkId, addedAt: this.iso() };
      if (note?.trim()) item.note = note.trim();
      s.items.push(item);
      s.updatedAt = this.iso();
      this.audit(v, 'shortlist.add', 'shortlist', s.id, { artworkId });
      this.commit();
    }
    return cloneShortlist(s);
  }

  async removeFromShortlist(viewer: Viewer, shortlistId: string, artworkId: string): Promise<Shortlist> {
    const s = this.myShortlist(viewer, shortlistId);
    s.items = s.items.filter((i) => i.artworkId !== artworkId);
    s.updatedAt = this.iso();
    this.audit(viewer, 'shortlist.remove', 'shortlist', s.id, { artworkId });
    this.commit();
    return cloneShortlist(s);
  }

  async createInquiry(viewer: Viewer, input: { artistId: string; artworkId?: string; message: string }): Promise<Inquiry> {
    const v = this.resolve(viewer);
    const c = this.requireVerifiedCurator(v);
    const artist = this.artistById(input.artistId);
    if (!artist || artist.status !== 'approved' || artist.visibility !== 'public') throw new NotFoundError('Artist not found.');
    if (input.message.trim().length < 20) throw new ValidationError('Write a short message explaining the opportunity.', 'message');
    if (input.artworkId) {
      const aw = this.state.artworks.find((x) => x.id === input.artworkId);
      if (!aw || aw.artistId !== artist.id || !artworkVisibleTo(aw, artist, v) || aw.visibility !== 'public') {
        throw new ForbiddenError('You can only ask about work you are authorized to see.');
      }
    }
    const inq: Inquiry = {
      id: this.makeId('inq'),
      curatorId: c.id,
      artistId: artist.id,
      message: input.message.trim(),
      status: 'pending',
      createdAt: this.iso(),
    };
    if (input.artworkId) inq.artworkId = input.artworkId;
    this.state.inquiries.push(inq);
    this.audit(v, 'inquiry.create', 'inquiry', inq.id, { artistId: artist.id });
    this.commit();
    return { ...inq };
  }

  private inquiryRow(i: Inquiry): InquiryRow {
    const c = this.state.curators.find((x) => x.id === i.curatorId);
    const inst = c ? this.state.institutions.find((x) => x.id === c.institutionId) : undefined;
    const artist = this.artistById(i.artistId);
    const aw = i.artworkId ? this.state.artworks.find((x) => x.id === i.artworkId) : undefined;
    const row: InquiryRow = {
      ...i,
      curatorName: c?.name ?? 'Unknown curator',
      institutionName: inst?.name ?? 'Unknown institution',
      artistWorkingName: artist?.workingName ?? 'Unknown artist',
    };
    if (aw) row.artworkTitle = aw.title;
    return row;
  }

  async listInquiries(viewer: Viewer): Promise<InquiryRow[]> {
    const v = this.resolve(viewer);
    let rows: Inquiry[];
    if (v.role === 'admin') rows = this.state.inquiries;
    else if (v.role === 'curator') {
      const c = this.requireMyCurator(v);
      rows = this.state.inquiries.filter((i) => i.curatorId === c.id);
    } else if (v.role === 'artist') {
      const a = this.requireMyArtist(v);
      // Artists only see inquiries Kofi has forwarded — pending ones are still in review.
      rows = this.state.inquiries.filter((i) => i.artistId === a.id && i.status !== 'pending');
    } else throw new ForbiddenError();
    return rows.map((i) => this.inquiryRow(i)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async setInquiryStatus(viewer: Viewer, id: string, status: InquiryStatus, note?: string): Promise<InquiryRow> {
    const v = this.resolve(viewer);
    const inq = this.state.inquiries.find((i) => i.id === id);
    if (!inq) throw new NotFoundError('Inquiry not found.');
    if (v.role === 'admin') {
      if (status !== 'forwarded' && status !== 'declined') throw new ForbiddenError('Kofi can forward or decline; the artist accepts.');
      if (inq.status !== 'pending') throw new ValidationError('This inquiry has already been decided.');
    } else if (v.role === 'artist') {
      const a = this.requireMyArtist(v);
      if (inq.artistId !== a.id) throw new ForbiddenError();
      if (inq.status !== 'forwarded') throw new ValidationError('Only forwarded inquiries can be answered.');
      if (status !== 'accepted' && status !== 'declined') throw new ForbiddenError('Artists accept or decline.');
    } else throw new ForbiddenError();
    inq.status = status;
    inq.decidedAt = this.iso();
    inq.decidedBy = v.userId ?? v.role;
    if (note?.trim()) {
      if (v.role === 'admin') inq.staffNote = note.trim();
      else inq.artistNote = note.trim();
    }
    this.audit(v, 'inquiry.status', 'inquiry', inq.id, { status });
    this.commit();
    return this.inquiryRow(inq);
  }

  /* ---------- admin ---------- */

  async listAllArtists(viewer: Viewer): Promise<AdminArtistRow[]> {
    this.requireAdmin(viewer);
    return this.state.artists
      .map((a) => ({ ...projectArtist(a, viewer)!, artworkCount: this.state.artworks.filter((w) => w.artistId === a.id).length }))
      .sort((x, y) => statusRank(x.status) - statusRank(y.status) || x.workingName.localeCompare(y.workingName));
  }

  async setArtistStatus(viewer: Viewer, artistId: string, status: Artist['status'], note?: string): Promise<ArtistView> {
    this.requireAdmin(viewer);
    const a = this.artistById(artistId);
    if (!a) throw new NotFoundError('Artist not found.');
    a.status = status;
    a.updatedAt = this.iso();
    if (note?.trim()) a.kofiNotes = [a.kofiNotes, `${this.iso().slice(0, 10)}: ${note.trim()}`].filter(Boolean).join('\n');
    this.audit(viewer, 'artist.status', 'artist', a.id, { status });
    this.commit();
    return projectArtist(a, viewer)!;
  }

  async setKofiNotes(viewer: Viewer, artistId: string, notes: string): Promise<ArtistView> {
    this.requireAdmin(viewer);
    const a = this.artistById(artistId);
    if (!a) throw new NotFoundError('Artist not found.');
    a.kofiNotes = notes;
    this.audit(viewer, 'artist.update', 'artist', a.id, { field: 'kofiNotes' });
    this.commit();
    return projectArtist(a, viewer)!;
  }

  async markArtworkReviewed(viewer: Viewer, artworkId: string): Promise<ArtworkView> {
    this.requireAdmin(viewer);
    const aw = this.state.artworks.find((x) => x.id === artworkId);
    if (!aw) throw new NotFoundError('Artwork not found.');
    aw.reviewedAt = this.iso();
    this.audit(viewer, 'artwork.update', 'artwork', aw.id, { reviewed: true });
    this.commit();
    return projectArtwork(aw, this.artistById(aw.artistId), viewer)!;
  }

  async listCurators(viewer: Viewer): Promise<CuratorRow[]> {
    this.requireAdmin(viewer);
    return this.state.curators
      .map((c) => this.curatorRow(c.id))
      .filter((c): c is CuratorRow => !!c)
      .sort((x, y) => curatorRank(x.status) - curatorRank(y.status) || y.createdAt.localeCompare(x.createdAt));
  }

  async setCuratorStatus(viewer: Viewer, curatorId: string, status: CuratorStatus, note?: string): Promise<CuratorRow> {
    this.requireAdmin(viewer);
    const c = this.state.curators.find((x) => x.id === curatorId);
    if (!c) throw new NotFoundError('Curator not found.');
    c.status = status;
    if (note?.trim()) c.verificationNote = note.trim();
    if (status === 'verified') c.verifiedAt = this.iso();
    else delete c.verifiedAt;
    this.audit(viewer, 'curator.status', 'curator', c.id, { status });
    this.commit();
    return this.curatorRow(c.id)!;
  }

  async listAudit(viewer: Viewer, limit = 200): Promise<AuditEvent[]> {
    this.requireAdmin(viewer);
    // Newest first; rows written in the same millisecond keep their write order (latest first).
    return this.state.audit
      .map((ev, i) => [ev, i] as const)
      .sort(([x, i], [y, j]) => y.at.localeCompare(x.at) || j - i)
      .slice(0, limit)
      .map(([ev]) => ev);
  }

  async listInstitutions(viewer: Viewer): Promise<Institution[]> {
    if (viewer.role !== 'admin' && viewer.role !== 'curator') throw new ForbiddenError();
    return this.state.institutions.map((i) => ({ ...i }));
  }

  /* ---------- programme: shared helpers ---------- */

  private today(): string {
    return kofiToday(this.now());
  }

  /**
   * The gallery's rule (same as listArtworks): whether a work may appear on a
   * discovery surface for this viewer. Admins see every existing work so that
   * editing a programme item never silently drops an attached id.
   */
  private discoverable(aw: Artwork, v: Viewer): boolean {
    if (v.role === 'admin') return true;
    const artist = this.artistById(aw.artistId);
    if (!artworkVisibleTo(aw, artist, v)) return false;
    if (aw.visibility === 'private' || aw.visibility === 'kofi') return false;
    return artist?.status === 'approved';
  }

  private visibleWorkIds(ids: string[], v: Viewer): string[] {
    return ids.filter((id) => {
      const aw = this.state.artworks.find((x) => x.id === id);
      return !!aw && this.discoverable(aw, v);
    });
  }

  private exhibitionVisible(id: string | undefined, v: Viewer): boolean {
    if (!id) return false;
    const ex = this.state.exhibitions.find((x) => x.id === id);
    return !!ex && canSeeProgramme(ex, v);
  }

  private viewExhibition(ex: Exhibition, v: Viewer): Exhibition {
    return { ...clone(ex), artworkIds: this.visibleWorkIds(ex.artworkIds, v) };
  }

  private viewCall(call: OpenCall, v: Viewer): OpenCall {
    const out = clone(call);
    if (out.exhibitionId && !this.exhibitionVisible(out.exhibitionId, v)) delete out.exhibitionId;
    return out;
  }

  private viewEvent(ev: ProgrammeEvent, v: Viewer): ProgrammeEvent {
    const out = clone(ev);
    if (out.exhibitionId && !this.exhibitionVisible(out.exhibitionId, v)) delete out.exhibitionId;
    return out;
  }

  private viewStory(st: Story, v: Viewer): Story {
    const out: Story = { ...clone(st), artworkIds: this.visibleWorkIds(st.artworkIds, v) };
    if (out.artistId) {
      const artist = this.artistById(out.artistId);
      if (!artist || !artistVisibleTo(artist, v)) delete out.artistId;
    }
    return out;
  }

  private checkProgrammeRefs(input: { artworkIds?: string[]; exhibitionId?: string; artistId?: string }): void {
    for (const id of input.artworkIds ?? []) {
      if (!this.state.artworks.some((a) => a.id === id)) throw new ValidationError('One of the attached works no longer exists.', 'artworkIds');
    }
    if (input.exhibitionId && !this.state.exhibitions.some((x) => x.id === input.exhibitionId)) throw new ValidationError('That exhibition no longer exists.', 'exhibitionId');
    if (input.artistId && !this.artistById(input.artistId)) throw new ValidationError('That artist no longer exists.', 'artistId');
  }

  /** Create or update one programme row. Admin only; id/createdAt/updatedAt are set here, never by the client. */
  private upsertProgramme<T extends { id: string; createdAt: string; updatedAt: string; published: boolean; title: string }>(
    viewer: Viewer,
    list: T[],
    entityType: 'exhibition' | 'open_call' | 'event' | 'story',
    idPrefix: string,
    id: string | undefined,
    clean: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
  ): T {
    const now = this.iso();
    if (id) {
      const existing = list.find((x) => x.id === id);
      if (!existing) throw new NotFoundError('That item no longer exists.');
      const publishedChanged = existing.published !== clean.published;
      // Replace every authored field (so a cleared optional field is really cleared), keep identity and createdAt.
      for (const k of Object.keys(existing)) if (k !== 'id' && k !== 'createdAt') delete (existing as Record<string, unknown>)[k];
      Object.assign(existing, clean, { updatedAt: now });
      this.audit(viewer, 'programme.save', entityType, existing.id, { title: existing.title, created: false, published: existing.published, publishedChanged });
      this.commit();
      return existing;
    }
    const created = { ...clean, id: this.makeId(idPrefix), createdAt: now, updatedAt: now } as T;
    list.push(created);
    this.audit(viewer, 'programme.save', entityType, created.id, { title: created.title, created: true, published: created.published, publishedChanged: false });
    this.commit();
    return created;
  }

  private removeProgramme(viewer: Viewer, list: { id: string; title: string }[], entityType: 'exhibition' | 'open_call' | 'event' | 'story', id: string): void {
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new NotFoundError('That item no longer exists.');
    const [gone] = list.splice(idx, 1);
    this.audit(viewer, 'programme.delete', entityType, id, { title: gone!.title });
  }

  /* ---------- programme: exhibitions ---------- */

  async listExhibitions(viewer: Viewer): Promise<Exhibition[]> {
    const v = this.resolve(viewer);
    const list = this.state.exhibitions.filter((x) => canSeeProgramme(x, v)).map((x) => this.viewExhibition(x, v));
    return sortExhibitions(list, this.today());
  }

  async getExhibition(viewer: Viewer, id: string): Promise<Exhibition | undefined> {
    const v = this.resolve(viewer);
    const ex = this.state.exhibitions.find((x) => x.id === id);
    return ex && canSeeProgramme(ex, v) ? this.viewExhibition(ex, v) : undefined;
  }

  async saveExhibition(viewer: Viewer, input: ProgrammeInput<Exhibition>): Promise<Exhibition> {
    this.requireAdmin(viewer);
    const clean = cleanExhibition(input);
    this.checkProgrammeRefs(clean);
    const saved = this.upsertProgramme(viewer, this.state.exhibitions, 'exhibition', 'ex', input.id, clean);
    return this.viewExhibition(saved, viewer);
  }

  async deleteExhibition(viewer: Viewer, id: string): Promise<void> {
    this.requireAdmin(viewer);
    this.removeProgramme(viewer, this.state.exhibitions, 'exhibition', id);
    // Calls and events that pointed at it stay, unlinked.
    for (const c of this.state.openCalls) if (c.exhibitionId === id) delete c.exhibitionId;
    for (const e of this.state.events) if (e.exhibitionId === id) delete e.exhibitionId;
    this.commit();
  }

  /* ---------- programme: open calls ---------- */

  async listOpenCalls(viewer: Viewer): Promise<OpenCall[]> {
    const v = this.resolve(viewer);
    const today = this.today();
    const rank: Record<CallPhase, number> = { open: 0, upcoming: 1, closed: 2 };
    const far = '9999-12-31';
    return this.state.openCalls
      .filter((x) => canSeeProgramme(x, v))
      .map((x) => this.viewCall(x, v))
      .sort((a, b) => {
        const pa = callPhase(a, today);
        const pb = callPhase(b, today);
        if (pa !== pb) return rank[pa] - rank[pb];
        // Open: closing soonest first (no deadline last). Upcoming: opening soonest. Closed: most recently closed first.
        if (pa === 'open') return (a.deadline ?? far).localeCompare(b.deadline ?? far) || a.title.localeCompare(b.title);
        if (pa === 'upcoming') return a.opensOn.localeCompare(b.opensOn) || (a.deadline ?? far).localeCompare(b.deadline ?? far);
        return (b.deadline ?? '').localeCompare(a.deadline ?? '');
      });
  }

  async getOpenCall(viewer: Viewer, id: string): Promise<OpenCall | undefined> {
    const v = this.resolve(viewer);
    const c = this.state.openCalls.find((x) => x.id === id);
    return c && canSeeProgramme(c, v) ? this.viewCall(c, v) : undefined;
  }

  async saveOpenCall(viewer: Viewer, input: ProgrammeInput<OpenCall>): Promise<OpenCall> {
    this.requireAdmin(viewer);
    const clean = cleanOpenCall(input);
    this.checkProgrammeRefs(clean);
    const saved = this.upsertProgramme(viewer, this.state.openCalls, 'open_call', 'call', input.id, clean);
    return this.viewCall(saved, viewer);
  }

  async deleteOpenCall(viewer: Viewer, id: string): Promise<void> {
    this.requireAdmin(viewer);
    if (!this.state.openCalls.some((c) => c.id === id)) throw new NotFoundError('That item no longer exists.');
    if (this.state.applications.some((a) => a.callId === id)) throw new ValidationError('This call has applications. Unpublish it instead.', 'call');
    this.removeProgramme(viewer, this.state.openCalls, 'open_call', id);
    this.commit();
  }

  /* ---------- programme: events ---------- */

  async listEvents(viewer: Viewer): Promise<ProgrammeEvent[]> {
    const v = this.resolve(viewer);
    return this.state.events
      .filter((x) => canSeeProgramme(x, v))
      .map((x) => this.viewEvent(x, v))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title));
  }

  async saveEvent(viewer: Viewer, input: ProgrammeInput<ProgrammeEvent>): Promise<ProgrammeEvent> {
    this.requireAdmin(viewer);
    const clean = cleanEvent(input);
    this.checkProgrammeRefs(clean);
    const saved = this.upsertProgramme(viewer, this.state.events, 'event', 'evt', input.id, clean);
    return this.viewEvent(saved, viewer);
  }

  async deleteEvent(viewer: Viewer, id: string): Promise<void> {
    this.requireAdmin(viewer);
    this.removeProgramme(viewer, this.state.events, 'event', id);
    this.commit();
  }

  /* ---------- programme: journal ---------- */

  async listStories(viewer: Viewer): Promise<Story[]> {
    const v = this.resolve(viewer);
    return this.state.stories
      .filter((x) => canSeeProgramme(x, v))
      .map((x) => this.viewStory(x, v))
      .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || b.createdAt.localeCompare(a.createdAt));
  }

  async getStory(viewer: Viewer, id: string): Promise<Story | undefined> {
    const v = this.resolve(viewer);
    const st = this.state.stories.find((x) => x.id === id);
    return st && canSeeProgramme(st, v) ? this.viewStory(st, v) : undefined;
  }

  async saveStory(viewer: Viewer, input: ProgrammeInput<Story>): Promise<Story> {
    this.requireAdmin(viewer);
    const clean = cleanStory(input);
    this.checkProgrammeRefs(clean);
    const saved = this.upsertProgramme(viewer, this.state.stories, 'story', 'st', input.id, clean);
    return this.viewStory(saved, viewer);
  }

  async deleteStory(viewer: Viewer, id: string): Promise<void> {
    this.requireAdmin(viewer);
    this.removeProgramme(viewer, this.state.stories, 'story', id);
    this.commit();
  }

  /* ---------- applications ---------- */

  private applicationRow(app: Application, v: Viewer): ApplicationRow {
    const call = this.state.openCalls.find((c) => c.id === app.callId);
    const artist = this.artistById(app.artistId);
    const works: ArtworkView[] = [];
    for (const id of app.artworkIds) {
      const aw = this.state.artworks.find((x) => x.id === id);
      const view = aw ? projectArtwork(aw, this.artistById(aw.artistId), v) : undefined;
      if (view) works.push(view);
    }
    const row: ApplicationRow = {
      ...clone(app),
      callTitle: call?.title ?? 'A call that has been removed',
      artistWorkingName: artist?.workingName ?? 'Unknown artist',
      works,
    };
    if (call?.deadline) row.callDeadline = call.deadline;
    // Reviewer notes are Kofi's own; the artist sees only the decision note.
    if (v.role !== 'admin') delete row.staffNote;
    return row;
  }

  /** Artists only (curators, visitors and admins acting as themselves are refused). Ownership comes from the store. */
  private requireApplicant(viewer: Viewer): Artist {
    if (viewer.role !== 'artist') throw new ForbiddenError('Sign in as an artist to apply.');
    return this.requireMyArtist(viewer);
  }

  async listMyApplications(viewer: Viewer): Promise<ApplicationRow[]> {
    const a = this.requireApplicant(viewer);
    const v = this.resolve(viewer);
    return this.state.applications
      .filter((x) => x.artistId === a.id)
      .map((x) => this.applicationRow(x, v))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async submitApplication(viewer: Viewer, input: ApplicationInput): Promise<ApplicationRow> {
    const a = this.requireApplicant(viewer);
    const v = this.resolve(viewer);
    const call = this.state.openCalls.find((c) => c.id === input.callId);
    if (!call || !canSeeProgramme(call, v)) throw new NotFoundError('Open call not found.');
    const requestedIds = Array.isArray(input.artworkIds) ? input.artworkIds.map(String) : [];
    const statement = typeof input.statement === 'string' ? input.statement : '';
    const problem = validateApplication({
      call,
      artist: a,
      works: this.state.artworks.filter((w) => requestedIds.includes(w.id)),
      requestedIds,
      statement,
      existing: this.state.applications.filter((x) => x.callId === call.id && x.artistId === a.id),
      today: this.today(),
    });
    if (problem) throw new ValidationError(problem.message, problem.field);
    const now = this.iso();
    const app: Application = {
      id: this.makeId('app'),
      callId: call.id,
      artistId: a.id,
      artworkIds: [...requestedIds],
      statement: statement.trim(),
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };
    this.state.applications.push(app);
    this.audit(v, 'application.submit', 'application', app.id, { callId: call.id, works: app.artworkIds.length });
    this.commit();
    return this.applicationRow(app, v);
  }

  async withdrawApplication(viewer: Viewer, id: string): Promise<ApplicationRow> {
    const a = this.requireApplicant(viewer);
    const v = this.resolve(viewer);
    const app = this.state.applications.find((x) => x.id === id);
    if (!app) throw new NotFoundError('Application not found.');
    if (app.artistId !== a.id) throw new ForbiddenError('You can only withdraw your own applications.');
    if (!canMoveApplication(app.status, 'withdrawn', 'artist')) throw new ValidationError('This application has been decided and can no longer be withdrawn.', 'status');
    app.status = 'withdrawn';
    app.updatedAt = this.iso();
    this.audit(v, 'application.withdraw', 'application', app.id, { callId: app.callId });
    this.commit();
    return this.applicationRow(app, v);
  }

  async listApplications(viewer: Viewer, callId?: string): Promise<ApplicationRow[]> {
    this.requireAdmin(viewer);
    return this.state.applications
      .filter((x) => !callId || x.callId === callId)
      .map((x) => this.applicationRow(x, viewer))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async setApplicationStatus(viewer: Viewer, id: string, status: ApplicationStatus, notes: { decisionNote?: string; staffNote?: string } = {}): Promise<ApplicationRow> {
    this.requireAdmin(viewer);
    const app = this.state.applications.find((x) => x.id === id);
    if (!app) throw new NotFoundError('Application not found.');
    if (!canMoveApplication(app.status, status, 'admin')) {
      throw new ValidationError(app.status === 'withdrawn' ? 'The artist withdrew this application.' : `This application cannot be moved from ${app.status} to ${status}.`, 'status');
    }
    for (const key of ['decisionNote', 'staffNote'] as const) {
      const val = notes[key];
      if (val === undefined) continue;
      if (val.length > MAX_NOTE) throw new ValidationError(`Keep notes under ${MAX_NOTE} characters.`, key);
      if (val.trim()) app[key] = val.trim();
      else delete app[key];
    }
    app.status = status;
    app.updatedAt = this.iso();
    if (status === 'accepted' || status === 'declined') app.decidedAt = app.updatedAt;
    else delete app.decidedAt;
    this.audit(viewer, 'application.status', 'application', app.id, { status, callId: app.callId });
    this.commit();
    return this.applicationRow(app, viewer);
  }

  /* ---------- collector ("buyer") inquiries ---------- */

  async submitBuyerInquiry(viewer: Viewer, input: BuyerInquiryInput): Promise<{ id: string }> {
    const v = this.resolve(viewer);
    const problem = validateBuyerInquiry(input);
    if (problem) throw new ValidationError(problem.message, problem.field);
    let artistId: string | undefined;
    if (input.artworkId) {
      const aw = this.state.artworks.find((x) => x.id === input.artworkId);
      // A visitor can only ask about a work they can see; the artist is derived here, never taken from the client.
      if (!aw || !this.discoverable(aw, v)) throw new NotFoundError('Artwork not found.');
      artistId = aw.artistId;
    }
    const email = input.email.trim();
    const key = email.toLowerCase();
    const since = this.now().getTime() - 86_400_000;
    const recent = this.state.buyerInquiries.filter((b) => b.email.toLowerCase() === key && Date.parse(b.createdAt) > since).length;
    if (recent >= BUYER_INQUIRY_DAILY_LIMIT) throw new ValidationError('Kofi already has your messages — we’ll reply soon.', 'email');
    const now = this.iso();
    const inq: BuyerInquiry = {
      id: this.makeId('bi'),
      name: input.name.trim(),
      email,
      intent: input.intent,
      message: input.message.trim(),
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };
    if (input.artworkId) inq.artworkId = input.artworkId;
    if (artistId) inq.artistId = artistId;
    if (input.organization?.trim()) inq.organization = input.organization.trim();
    this.state.buyerInquiries.push(inq);
    // The actor is whoever sent it (often a signed-out visitor); no email in the audit trail.
    this.audit({ ...v, displayName: inq.name }, 'buyer_inquiry.submit', 'buyer_inquiry', inq.id, { intent: inq.intent, artworkId: inq.artworkId ?? null });
    this.commit();
    return { id: inq.id };
  }

  private buyerInquiryRow(b: BuyerInquiry): BuyerInquiryRow {
    const row: BuyerInquiryRow = { ...clone(b) };
    const aw = b.artworkId ? this.state.artworks.find((x) => x.id === b.artworkId) : undefined;
    if (aw) row.artworkTitle = aw.title;
    const artist = b.artistId ? this.artistById(b.artistId) : undefined;
    if (artist) row.artistWorkingName = artist.workingName;
    return row;
  }

  async listBuyerInquiries(viewer: Viewer): Promise<BuyerInquiryRow[]> {
    this.requireAdmin(viewer);
    return this.state.buyerInquiries.map((b) => this.buyerInquiryRow(b)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async setBuyerInquiryStatus(viewer: Viewer, id: string, status: BuyerInquiryStatus, staffNote?: string): Promise<BuyerInquiryRow> {
    this.requireAdmin(viewer);
    const b = this.state.buyerInquiries.find((x) => x.id === id);
    if (!b) throw new NotFoundError('Inquiry not found.');
    if (!BUYER_INQUIRY_STATUSES.includes(status)) throw new ValidationError('Unknown status.', 'status');
    if (staffNote !== undefined) {
      if (staffNote.length > MAX_NOTE) throw new ValidationError(`Keep notes under ${MAX_NOTE} characters.`, 'staffNote');
      if (staffNote.trim()) b.staffNote = staffNote.trim();
      else delete b.staffNote;
    }
    const noteOnly = b.status === status;
    b.status = status;
    b.updatedAt = this.iso();
    this.audit(viewer, 'buyer_inquiry.status', 'buyer_inquiry', b.id, { status, noteOnly });
    this.commit();
    return this.buyerInquiryRow(b);
  }

  /** Test-only: peek at raw state. */
  _raw(): MockState {
    return this.state;
  }
}

const ARTIST_PATCH_KEYS = [
  'workingName',
  'legalName',
  'pronouns',
  'bio',
  'statement',
  'region',
  'mediums',
  'careerStage',
  'experience',
  'availability',
  'links',
  'contact',
  'visibility',
  'avatarColor',
] as const satisfies readonly (keyof ArtistPatch)[];

function cloneShortlist(s: Shortlist): Shortlist {
  return { ...s, items: s.items.map((i) => ({ ...i })) };
}

function statusRank(s: Artist['status']): number {
  return { pending: 0, draft: 1, approved: 2, paused: 3 }[s];
}
function curatorRank(s: CuratorStatus): number {
  return { pending: 0, verified: 1, rejected: 2 }[s];
}

export function validateArtwork(input: ArtworkInput): void {
  if (!input.title.trim()) throw new ValidationError('Give the work a title.', 'title');
  const y = input.year;
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(y) || y < 1900 || y > thisYear + 1) throw new ValidationError(`Year must be between 1900 and ${thisYear + 1}.`, 'year');
  const dims = input.dimensions;
  if (!(dims.height > 0) || !(dims.width > 0)) throw new ValidationError('Height and width must be greater than zero.', 'dimensions');
  if (dims.depth !== undefined && !(dims.depth >= 0)) throw new ValidationError('Depth cannot be negative.', 'dimensions');
  if (input.materials.length === 0) throw new ValidationError('List at least one material.', 'materials');
  if (input.price && !(input.price.amount >= 0)) throw new ValidationError('Price cannot be negative.', 'price');
  if (input.price && !/^[A-Z]{3}$/.test(input.price.currency)) throw new ValidationError('Currency must be a 3-letter code (USD, CAD).', 'price');
  if (input.visibility === 'public' && input.images.length === 0) throw new ValidationError('Add at least one image before publishing.', 'images');
  for (const im of input.images) {
    if (!im.src.startsWith('data:image/') && !im.src.startsWith('storage:') && !im.src.startsWith('/art/')) throw new ValidationError('Unsupported image.', 'images');
    if (im.src.length > MAX_IMAGE_BYTES * 1.37) throw new ValidationError('Images must be under 6 MB.', 'images');
  }
}

/* ---------- programme: persisted-state migration ---------- */

/**
 * A state persisted by an older build (v2: no programme collections) keeps every
 * artist, work, document and audit row it has; only the missing collections are
 * filled from the seed. Collections that exist are never touched.
 */
export function migrateState(parsed: Partial<MockState>): MockState {
  const missing = PROGRAMME_KEYS.filter((k) => !Array.isArray(parsed[k]));
  if (missing.length === 0) return parsed as MockState;
  const seed = buildProgrammeSeed();
  const out = { ...parsed } as MockState;
  for (const k of missing) (out as unknown as Record<string, unknown>)[k] = seed[k];
  // Seeded rows must not point at works the user has since deleted.
  const workIds = new Set((out.artworks ?? []).map((a) => a.id));
  const artistIds = new Set((out.artists ?? []).map((a) => a.id));
  if (missing.includes('exhibitions')) for (const x of out.exhibitions) x.artworkIds = x.artworkIds.filter((id) => workIds.has(id));
  if (missing.includes('stories')) {
    for (const x of out.stories) {
      x.artworkIds = x.artworkIds.filter((id) => workIds.has(id));
      if (x.artistId && !artistIds.has(x.artistId)) delete x.artistId;
    }
  }
  if (missing.includes('applications')) out.applications = out.applications.filter((a) => artistIds.has(a.artistId));
  if (missing.includes('buyerInquiries')) {
    for (const b of out.buyerInquiries) {
      if (b.artworkId && !workIds.has(b.artworkId)) {
        delete b.artworkId;
        delete b.artistId;
      }
    }
  }
  return out;
}

/* ---------- programme: input validation (server-equivalent; the SQL RPCs mirror these) ---------- */

const MAX_TITLE = 160;
const MAX_SUMMARY = 600;
const MAX_BODY = 20_000;
const MAX_NOTE = 2000;
const HTTP_URL = /^https?:\/\/[^\s]+$/i;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Drop undefined keys so stored rows serialize the same way they compare. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o)) if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k];
  return o;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optStr(v: unknown, field: string, max: number, label: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ValidationError(`${label} must be text.`, field);
  const t = v.trim();
  if (t.length > max) throw new ValidationError(`Keep the ${label.toLowerCase()} under ${max} characters.`, field);
  return t || undefined;
}

function reqStr(v: unknown, field: string, max: number, label: string): string {
  const t = optStr(v, field, max, label);
  if (!t) throw new ValidationError(`${label} is required.`, field);
  return t;
}

function title(v: unknown): string {
  return reqStr(v, 'title', MAX_TITLE, 'Title');
}

function optUrl(v: unknown, field: string): string | undefined {
  const t = optStr(v, field, 2000, 'Link');
  if (t && !HTTP_URL.test(t)) throw new ValidationError('Links must start with http:// or https://', field);
  return t;
}

function reqDate(v: unknown, field: string, label: string): string {
  const t = str(v);
  if (!isIsoDate(t)) throw new ValidationError(`${label} must be a valid date.`, field);
  return t;
}

function optDate(v: unknown, field: string, label: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return reqDate(v, field, label);
}

function dateTime(v: unknown, field: string, label: string, required: boolean): string | undefined {
  if (!required && (v === undefined || v === null || v === '')) return undefined;
  const t = str(v);
  if (!ISO_DATETIME.test(t) || Number.isNaN(Date.parse(t)) || !isIsoDate(t.slice(0, 10))) throw new ValidationError(`${label} must be a valid date and time.`, field);
  return t;
}

function image(v: unknown): ProgrammeImage | undefined {
  if (v === undefined || v === null) return undefined;
  const im = v as Partial<ProgrammeImage>;
  const src = typeof im.src === 'string' ? im.src : '';
  if (!src.startsWith('data:image/') && !src.startsWith('storage:') && !src.startsWith('/art/')) throw new ValidationError('Unsupported image.', 'image');
  if (src.length > MAX_IMAGE_BYTES * 1.37) throw new ValidationError('Images must be under 6 MB.', 'image');
  const alt = reqStr(im.alt, 'image', 300, 'Image description');
  return compact({ src, alt, credit: optStr(im.credit, 'image', 160, 'Image credit') });
}

function venue(v: unknown): Venue | undefined {
  if (v === undefined || v === null) return undefined;
  const ve = v as Partial<Venue>;
  return compact({
    name: reqStr(ve.name, 'venue', 160, 'Venue name'),
    address: optStr(ve.address, 'venue', 200, 'Venue address'),
    city: reqStr(ve.city, 'venue', 120, 'Venue city'),
  });
}

function ids(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ValidationError('Invalid list of works.', field);
  return [...new Set(v as string[])];
}

function flags(input: { sample?: unknown; published?: unknown }): { sample: boolean; published: boolean } {
  return { sample: input.sample === true, published: input.published === true };
}

export function cleanExhibition(input: ProgrammeInput<Exhibition>): Omit<Exhibition, 'id' | 'createdAt' | 'updatedAt'> {
  const startsOn = reqDate(input.startsOn, 'startsOn', 'Start date');
  const endsOn = optDate(input.endsOn, 'endsOn', 'End date');
  if (endsOn && endsOn < startsOn) throw new ValidationError('The end date is before the start date.', 'endsOn');
  return compact({
    ...flags(input),
    title: title(input.title),
    subtitle: optStr(input.subtitle, 'subtitle', MAX_TITLE, 'Subtitle'),
    startsOn,
    endsOn,
    venue: venue(input.venue),
    summary: reqStr(input.summary, 'summary', MAX_SUMMARY, 'Summary'),
    body: optStr(input.body, 'body', MAX_BODY, 'Body') ?? '',
    image: image(input.image),
    artworkIds: ids(input.artworkIds, 'artworkIds'),
    externalUrl: optUrl(input.externalUrl, 'externalUrl'),
    curatedBy: optStr(input.curatedBy, 'curatedBy', MAX_TITLE, 'Curated by'),
  });
}

export function cleanOpenCall(input: ProgrammeInput<OpenCall>): Omit<OpenCall, 'id' | 'createdAt' | 'updatedAt'> {
  const opensOn = reqDate(input.opensOn, 'opensOn', 'Opening date');
  const deadline = optDate(input.deadline, 'deadline', 'Deadline');
  if (deadline && deadline < opensOn) throw new ValidationError('The deadline is before the call opens.', 'deadline');
  const maxWorks = input.maxWorks;
  if (!Number.isInteger(maxWorks) || maxWorks < 1 || maxWorks > 10) throw new ValidationError('Allow between 1 and 10 works.', 'maxWorks');
  const mediums = Array.isArray(input.mediums) ? [...new Set(input.mediums)] : [];
  if (mediums.some((m) => !MEDIUMS.includes(m))) throw new ValidationError('Unknown medium.', 'mediums');
  return compact({
    ...flags(input),
    title: title(input.title),
    partner: optStr(input.partner, 'partner', MAX_TITLE, 'Partner'),
    summary: reqStr(input.summary, 'summary', MAX_SUMMARY, 'Summary'),
    body: optStr(input.body, 'body', MAX_BODY, 'Body') ?? '',
    eligibility: reqStr(input.eligibility, 'eligibility', MAX_SUMMARY, 'Eligibility'),
    mediums,
    opensOn,
    deadline,
    maxWorks,
    fee: reqStr(input.fee, 'fee', MAX_TITLE, 'Fee'),
    award: optStr(input.award, 'award', MAX_SUMMARY, 'Award'),
    image: image(input.image),
    externalUrl: optUrl(input.externalUrl, 'externalUrl'),
    exhibitionId: optStr(input.exhibitionId, 'exhibitionId', 100, 'Exhibition'),
  });
}

export function cleanEvent(input: ProgrammeInput<ProgrammeEvent>): Omit<ProgrammeEvent, 'id' | 'createdAt' | 'updatedAt'> {
  if (!EVENT_KINDS.includes(input.kind)) throw new ValidationError('Choose what kind of event this is.', 'kind');
  const startsAt = dateTime(input.startsAt, 'startsAt', 'Start', true)!;
  const endsAt = dateTime(input.endsAt, 'endsAt', 'End', false);
  if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new ValidationError('The event ends before it starts.', 'endsAt');
  return compact({
    ...flags(input),
    title: title(input.title),
    kind: input.kind,
    startsAt,
    endsAt,
    venue: venue(input.venue),
    summary: reqStr(input.summary, 'summary', MAX_SUMMARY, 'Summary'),
    rsvpUrl: optUrl(input.rsvpUrl, 'rsvpUrl'),
    exhibitionId: optStr(input.exhibitionId, 'exhibitionId', 100, 'Exhibition'),
  });
}

export function cleanStory(input: ProgrammeInput<Story>): Omit<Story, 'id' | 'createdAt' | 'updatedAt'> {
  if (!STORY_KINDS.includes(input.kind)) throw new ValidationError('Choose what kind of story this is.', 'kind');
  return compact({
    ...flags(input),
    title: title(input.title),
    dek: reqStr(input.dek, 'dek', MAX_SUMMARY, 'Standfirst'),
    kind: input.kind,
    body: reqStr(input.body, 'body', MAX_BODY, 'Body'),
    author: reqStr(input.author, 'author', MAX_TITLE, 'Author'),
    publishedOn: reqDate(input.publishedOn, 'publishedOn', 'Publication date'),
    artistId: optStr(input.artistId, 'artistId', 100, 'Artist'),
    artworkIds: ids(input.artworkIds, 'artworkIds'),
    image: image(input.image),
  });
}
