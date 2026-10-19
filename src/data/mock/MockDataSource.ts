import { applyFilters, type ArtworkFilters } from '@/domain/filters';
import { artworksToCsv, buildArtistExport } from '@/domain/export';
import type {
  ArtDocument,
  Artist,
  ArtistView,
  Artwork,
  ArtworkView,
  AuditAction,
  AuditEvent,
  CuratorStatus,
  DemoIdentity,
  Inquiry,
  InquiryStatus,
  Institution,
  Shortlist,
  Viewer,
} from '@/domain/types';
import { CONSENT_VERSION } from '@/domain/types';
import { artworkVisibleTo, canEdit, projectArtist, projectArtwork } from '@/domain/visibility';
import {
  ForbiddenError,
  NotFoundError,
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
} from '../DataSource';
import { buildSeed, DEMO_IDENTITIES, type MockState } from './seed';

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
  private listeners = new Set<() => void>();
  private readonly persist: boolean;
  private readonly now: () => Date;
  private readonly makeId: (prefix: string) => string;

  constructor(opts: MockOptions = {}) {
    this.persist = opts.persist ?? typeof localStorage !== 'undefined';
    this.now = opts.now ?? (() => new Date());
    this.makeId = opts.idFactory ?? ((p) => `${p}_${Math.random().toString(36).slice(2, 10)}`);
    this.state = this.load() ?? buildSeed();
  }

  /* ---------- infrastructure ---------- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(): void {
    if (this.persist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        /* storage full or unavailable — in-memory state still works */
      }
    }
    for (const l of this.listeners) l();
  }

  private load(): MockState | undefined {
    if (!this.persist) return undefined;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as MockState;
      if (!parsed || !Array.isArray(parsed.artists)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  async resetDemoData(): Promise<void> {
    this.state = buildSeed();
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
      const c = this.state.curators.find((x) => x.id === viewer.curatorId);
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
    if (viewer.role !== 'curator' || !viewer.curatorId) throw new ForbiddenError('Sign in as a curator to do this.');
    const c = this.state.curators.find((x) => x.id === viewer.curatorId);
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
      this.commit();
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
    return projectArtist(a, this.resolve(viewer));
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
    Object.assign(a, patch, { updatedAt: this.iso() });
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
    if (!a.consentVersion) throw new ValidationError('Accept the consent terms before submitting.', 'consent');
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
      const { id: _id, ...rest } = input;
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
    const { id: _ignored, ...rest } = input;
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
        this.commit();
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
    if (viewer.role !== 'curator' || !viewer.curatorId) return undefined;
    return this.curatorRow(viewer.curatorId);
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
    if (note?.trim()) inq.staffNote = note.trim();
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
    return [...this.state.audit].sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
  }

  async listInstitutions(viewer: Viewer): Promise<Institution[]> {
    if (viewer.role !== 'admin' && viewer.role !== 'curator') throw new ForbiddenError();
    return this.state.institutions.map((i) => ({ ...i }));
  }

  /** Test-only: peek at raw state. */
  _raw(): MockState {
    return this.state;
  }
}

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
    if (!im.src.startsWith('data:image/') && !im.src.startsWith('storage:')) throw new ValidationError('Unsupported image.', 'images');
    if (im.src.length > MAX_IMAGE_BYTES * 1.37) throw new ValidationError('Images must be under 6 MB.', 'images');
  }
}
