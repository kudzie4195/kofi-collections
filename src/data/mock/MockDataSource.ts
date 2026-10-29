import { applyFilters, type ArtworkFilters } from '@/domain/filters';
import { effectiveCriteria, rankWorks, validateCriteria, type MatchResult } from '@/domain/matching';
import { ARTIST_TAG_CATEGORIES, categoryOf, mediumTagId, normalizeTagIds, tagDef } from '@/domain/taxonomy';
import { artworksToCsv, buildArtistExport } from '@/domain/export';
import type {
  Application,
  ApplicationRow,
  ApplicationStatus,
  ArtDocument,
  Artist,
  ArtistLink,
  ArtistView,
  Artwork,
  ArtworkUses,
  ArtworkView,
  AuditAction,
  AuditEvent,
  BuyerInquiry,
  BuyerInquiryRow,
  BuyerInquiryStatus,
  CallCriteria,
  CallKind,
  Edition,
  CallPhase,
  CallTerms,
  CuratorStatus,
  DemoIdentity,
  Exhibition,
  Inquiry,
  InquiryStatus,
  Institution,
  KofiReport,
  Lot,
  LotRow,
  LotStatus,
  OpenCall,
  Payout,
  PayoutRow,
  PayoutStatus,
  ProfileImport,
  ProfileImportFields,
  ProfileImportRecord,
  ProgrammeEvent,
  ProgrammeImage,
  Region,
  ReportRange,
  SignUpInput,
  SignUpResult,
  Shortlist,
  Story,
  Venue,
  Viewer,
} from '@/domain/types';
import { BUYER_INQUIRY_STATUSES, CALL_KINDS, CONSENT_VERSION, EDITION_TYPES, EVENT_KINDS, LOT_STATUSES, MEDIUMS, NO_USES, PAYOUT_STATUSES, STORY_KINDS, USE_KEYS } from '@/domain/types';
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
  KOFI_TIME_ZONE,
} from '@/domain/programme';
import { importFromSignals, isFetchableUrl, makeVerificationToken, MAX_LINKS, normalizeLink, TOKEN_RE, validateSignUp, verificationFromPage } from '@/domain/intake';
import { canMoveLot, canMovePayout, isCallOrganizer, projectLotForArtist, splitSale, validateCallTerms, validateLot, validateSale, type LotInput, type SaleInput } from '@/domain/sales';
import {
  ConflictError,
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
import { buildProgrammeSeed, buildSeed, criteriaFor, DEMO_IDENTITIES, DEMO_USERS, MOCK_SCHEMA, PROGRAMME_KEYS, SALES_KEYS, SEED_CLASSIFICATION, seedIntake, V4_SEED_LINKS, type MockAccount, type MockState, type ProgrammeState } from './seed';
import { fixtureFor, KOFI_PROFILE_BASE } from './importFixtures';

const STORAGE_KEY = 'kofi.mock.state.v1';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export interface MockOptions {
  /** Persist to localStorage (default true in browser). Tests pass false. */
  persist?: boolean;
  now?: () => Date;
  idFactory?: (prefix: string) => string;
  /**
   * Simulated network time for importProfile / checkMyLinks, [min, max] ms, so the
   * intake's per-link progress line is visible. Default [300, 700]; 0 under vitest.
   */
  ioDelayMs?: [number, number];
}

const IS_TEST = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';

/** Brand avatar colours (same set as ui AVATAR_COLORS; duplicated so the data layer never imports React). */
const AVATAR_PALETTE = ['#c8322b', '#e3b23c', '#7fa344', '#4f6a25', '#f3eee6', '#242424'] as const;
const IMPORT_FIELD_KEYS: (keyof ProfileImportFields)[] = ['workingName', 'bio', 'photoUrl', 'city', 'region', 'country', 'links', 'followers', 'postCount'];
const MAX_IMPORT_RECORDS = 30;

export class MockDataSource implements DataSource {
  readonly mode = 'mock' as const;
  private state: MockState;
  /** Serialized copy of the last state known to be durable; the rollback target when storage fails. */
  private lastPersisted: string;
  private listeners = new Set<() => void>();
  private readonly persist: boolean;
  private readonly now: () => Date;
  private readonly makeId: (prefix: string) => string;
  private readonly ioDelay: [number, number];

  constructor(opts: MockOptions = {}) {
    this.persist = opts.persist ?? typeof localStorage !== 'undefined';
    this.now = opts.now ?? (() => new Date());
    this.makeId = opts.idFactory ?? ((p) => `${p}_${Math.random().toString(36).slice(2, 10)}`);
    this.ioDelay = opts.ioDelayMs ?? (IS_TEST ? [0, 0] : [300, 700]);
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

  /* ---------- partners (verified curators of a call's organiser institution) ---------- */

  /** The institution a viewer can organise for: a verified curator record from the store, never the client's claim. */
  private organiserOf(viewer: Viewer): string | undefined {
    if (viewer.role !== 'curator' || !viewer.userId || !viewer.curatorId) return undefined;
    const c = this.state.curators.find((x) => x.id === viewer.curatorId && x.userId === viewer.userId);
    return c?.status === 'verified' ? c.institutionId : undefined;
  }

  private requireOrganiser(viewer: Viewer): string {
    const inst = this.organiserOf(viewer);
    if (!inst) throw new ForbiddenError(viewer.role === 'curator' ? 'Your institution has not been verified yet.' : 'You do not have access to this.');
    return inst;
  }

  /** A partner of this call (admins are not "partners" — they pass their own checks). */
  private isPartnerOf(viewer: Viewer, call: Pick<OpenCall, 'organizerInstitutionId'> | undefined): boolean {
    if (!call || viewer.role !== 'curator') return false;
    const v = this.resolve(viewer);
    return isCallOrganizer(v, call, this.organiserOf(v));
  }

  /** Admin, or the call's partner. Returns the call. */
  private requireCallManager(v: Viewer, callId: string): OpenCall {
    const call = this.state.openCalls.find((c) => c.id === callId);
    if (v.role === 'admin') {
      if (!call) throw new NotFoundError('Open call not found.');
      return call;
    }
    this.requireOrganiser(v);
    if (!call || !this.isPartnerOf(v, call)) throw new ForbiddenError('You can only manage calls your institution runs.');
    return call;
  }

  /**
   * A work attached to an application, as a reviewer sees it. Applying is consent to the
   * call's reviewers seeing the attached work (never an Only me work), even if it is not
   * on public view; the price still follows its own visibility for this viewer.
   */
  private reviewerWork(aw: Artwork, v: Viewer): ArtworkView | undefined {
    const artist = this.artistById(aw.artistId);
    if (v.role === 'admin') return projectArtwork(aw, artist, v);
    if (!artist || aw.visibility === 'private') return undefined;
    const view = projectArtwork({ ...aw, visibility: 'public' }, { ...artist, status: 'approved', visibility: 'public' }, v);
    if (view) view.visibility = aw.visibility;
    return view;
  }

  /* ---------- identities ---------- */

  /** The fixed demo cast, then everyone who signed up on this device (persisted, so they survive a reload). */
  async listDemoIdentities(): Promise<DemoIdentity[]> {
    return [...DEMO_IDENTITIES, ...this.state.accounts.map((a) => clone(a.identity))];
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

  /** The discovery set listArtworks filters: what this (resolved) viewer may browse. */
  private discoveryWorks(v: Viewer): ArtworkView[] {
    // Discovery lists never include the viewer's own drafts — those live in the studio.
    return this.visibleArtworks(v).filter((a) => {
      if (a.visibility === 'private') return false;
      if (a.visibility === 'kofi' && v.role !== 'admin') return false;
      const artist = this.artistById(a.artistId);
      return artist?.status === 'approved' || v.role === 'admin';
    });
  }

  async listArtworks(viewer: Viewer, filters: ArtworkFilters = {}): Promise<ArtworkView[]> {
    return applyFilters(this.discoveryWorks(this.resolve(viewer)), filters);
  }

  /**
   * Works ranked against a call's effective criteria. The call's partner and Kofi
   * admins get the discovery set (exactly what listArtworks shows them); an artist
   * gets only their own works that could be attached to an application (never Only
   * me), for calls they can see. Everyone else: ForbiddenError.
   */
  async listMatchingWorks(viewer: Viewer, callId: string): Promise<{ work: ArtworkView; match: MatchResult }[]> {
    const v = this.resolve(viewer);
    let call: OpenCall;
    let works: ArtworkView[];
    if (v.role === 'artist' && v.artistId) {
      const found = this.state.openCalls.find((c) => c.id === callId);
      if (!found || !canSeeProgramme(found, v)) throw new NotFoundError('Open call not found.');
      call = found;
      works = this.visibleArtworks(v).filter((w) => w.artistId === v.artistId && w.visibility !== 'private');
    } else if (v.role === 'admin' || v.role === 'curator') {
      call = this.requireCallManager(v, callId);
      works = this.discoveryWorks(v);
    } else {
      throw new ForbiddenError('Only the call’s organiser can see which works fit.');
    }
    return rankWorks(works, effectiveCriteria(call));
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
      const view = viewArtist(a, v);
      if (view) out.push(view);
    }
    return out.sort((x, y) => x.workingName.localeCompare(y.workingName));
  }

  async getArtist(viewer: Viewer, id: string): Promise<ArtistView | undefined> {
    const a = this.artistById(id);
    if (!a) return undefined;
    const v = this.resolve(viewer);
    const view = viewArtist(a, v);
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

  /* ---------- intake (v5) ---------- */

  private async simulateNetwork(): Promise<void> {
    const [min, max] = this.ioDelay;
    if (max <= 0) return;
    await new Promise((r) => setTimeout(r, min + Math.random() * Math.max(0, max - min)));
  }

  private emailTaken(email: string): boolean {
    const e = email.toLowerCase();
    return (
      this.state.accounts.some((x) => x.email === e) ||
      this.state.artists.some((a) => a.contact.email.trim().toLowerCase() === e) ||
      this.state.curators.some((c) => c.workEmail.trim().toLowerCase() === e)
    );
  }

  /** "Flow Tester" → flow_tester, unique across artist ids, user ids and picker ids. */
  private uniqueSlug(name: string): string {
    const base =
      name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24)
        .replace(/_+$/, '') || 'artist';
    const users = new Set<string>([
      ...Object.values(DEMO_USERS),
      ...this.state.artists.map((a) => a.userId),
      ...this.state.curators.map((c) => c.userId),
      ...this.state.accounts.map((x) => x.userId),
    ]);
    const ids = new Set<string>([...DEMO_IDENTITIES.map((i) => i.id), ...this.state.accounts.map((x) => x.identity.id)]);
    const free = (s: string) => !this.artistById(`art_${s}`) && !users.has(`user_${s}`) && !ids.has(`user_${s}`);
    if (free(base)) return base;
    for (let n = 2; ; n++) if (free(`${base}_${n}`)) return `${base}_${n}`;
  }

  private uniqueToken(): string {
    const used = new Set(this.state.artists.map((a) => a.verificationToken).filter(Boolean));
    for (;;) {
      const t = makeVerificationToken();
      if (!used.has(t)) return t;
    }
  }

  async signUpArtist(input: SignUpInput): Promise<SignUpResult> {
    const problem = validateSignUp({
      displayName: String(input?.displayName ?? ''),
      email: String(input?.email ?? ''),
      password: String(input?.password ?? ''),
      consentVersion: String(input?.consentVersion ?? ''),
    });
    if (problem) throw new ValidationError(problem.message, problem.field);
    const email = input.email.trim().toLowerCase();
    if (this.emailTaken(email)) throw new ConflictError();
    const name = input.displayName.trim().replace(/\s+/g, ' ');
    const slug = this.uniqueSlug(name);
    const now = this.iso();
    const userId = `user_${slug}`;
    const artistId = `art_${slug}`;
    const artist: Artist = {
      id: artistId,
      userId,
      workingName: name,
      bio: '',
      region: { region: '', country: '', precision: 'region' }, // same default as kofi.ensure_my_artist()
      mediums: [],
      careerStage: 'emerging',
      experience: { commissions: false, publicArt: false, residencies: false, institutionalShows: false },
      availability: { commissions: false, sales: false, exhibitions: false },
      links: [],
      contact: { email },
      visibility: 'private',
      status: 'draft',
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: now,
      avatarColor: AVATAR_PALETTE[hash(slug) % AVATAR_PALETTE.length]!,
      verificationToken: this.uniqueToken(),
      imports: [],
      createdAt: now,
      updatedAt: now,
    };
    const viewer: Viewer = { role: 'artist', userId, artistId, displayName: name };
    const identity: DemoIdentity = { id: userId, label: name, caption: 'Artist · new profile', viewer };
    const account: MockAccount = { email, userId, artistId, identity, createdAt: now };
    this.state.artists.push(artist);
    this.state.accounts.push(account);
    // Never the email or the code in the trail.
    this.audit(viewer, 'artist.signup', 'artist', artistId, { status: 'draft' });
    this.audit(viewer, 'artist.consent', 'artist', artistId, { version: CONSENT_VERSION });
    this.commit();
    return { viewer: { ...viewer }, identity: clone(identity), emailConfirmationRequired: false };
  }

  /**
   * Mock mode cannot fetch: the sample artists' links return their canned page
   * (importFixtures.ts); anything else gets handle-only suggestions with a note.
   */
  async importProfile(viewer: Viewer, url: string): Promise<ProfileImport> {
    const v = this.resolve(viewer);
    if (v.role !== 'artist' && v.role !== 'admin') throw new ForbiddenError('Sign in as an artist to do this.');
    if (v.role === 'artist') this.requireMyArtist(v); // must have a profile, even a draft
    const n = typeof url === 'string' ? normalizeLink(url) : undefined;
    if (!n) throw new ValidationError('That does not look like a profile or website link. Try the address from your browser.', 'url');
    if (!isFetchableUrl(n.url)) throw new ValidationError('Kofi cannot read that address. Use a public profile or website link.', 'url');
    await this.simulateNetwork();
    const source: ArtistLink = { label: n.label, url: n.url, platform: n.platform, handle: n.handle, verification: 'claimed' };
    const fixture = fixtureFor(n.url);
    const result = importFromSignals(source, fixture?.signals ?? {}, this.iso());
    if (!fixture) result.notes.unshift('The demo cannot read live pages, so we used your handle.');
    // Reading a page is not a profile change: only an applied import (recordImport) is audited.
    return result;
  }

  async recordImport(viewer: Viewer, record: ProfileImportRecord): Promise<ArtistView> {
    const a = this.requireMyArtist(viewer);
    const n = record && typeof record.source?.url === 'string' ? normalizeLink(record.source.url) : undefined;
    if (!n || !isFetchableUrl(n.url)) throw new ValidationError('That import has no usable source link.', 'source');
    const applied = Array.isArray(record.appliedFields) ? [...new Set(record.appliedFields)] : [];
    if (applied.some((f) => !IMPORT_FIELD_KEYS.includes(f))) throw new ValidationError('Unknown imported field.', 'appliedFields');
    const fetchedAt = typeof record.fetchedAt === 'string' && !Number.isNaN(Date.parse(record.fetchedAt)) ? new Date(record.fetchedAt).toISOString() : this.iso();
    const notes = Array.isArray(record.notes) ? record.notes.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 5) : [];
    const row: ProfileImportRecord = {
      source: { label: n.label, url: n.url, platform: n.platform, handle: n.handle, verification: 'claimed' },
      fetchedAt,
      appliedFields: applied,
      notes,
    };
    a.imports = [...(a.imports ?? []), row].slice(-MAX_IMPORT_RECORDS);
    a.updatedAt = this.iso();
    this.audit(viewer, 'artist.import', 'artist', a.id, { platform: n.platform, handle: n.handle, applied: applied.join(',') || 'none' });
    this.commit();
    return viewArtist(a, this.resolve(viewer))!;
  }

  /**
   * Mock rule: a link whose page is in the fixtures is "read"; it verifies when the
   * page text carries the artist's code (or links back to their Kofi page), else
   * 'failed'. Any other link is 'unreachable'. checkedAt is set either way.
   */
  async checkMyLinks(viewer: Viewer, artistId?: string): Promise<ArtistLink[]> {
    const v = this.resolve(viewer);
    let a: Artist;
    if (artistId !== undefined && v.role === 'admin') {
      const found = this.artistById(artistId);
      if (!found) throw new NotFoundError('Artist not found.');
      a = found;
    } else {
      a = this.requireMyArtist(v);
      if (artistId !== undefined && artistId !== a.id) throw new ForbiddenError('You can only check your own links.');
    }
    if (!a.verificationToken || !TOKEN_RE.test(a.verificationToken)) a.verificationToken = this.uniqueToken();
    await this.simulateNetwork();
    const now = this.iso();
    const token = a.verificationToken;
    const counts = { verified: 0, failed: 0, unreachable: 0 };
    a.links = typeLinks(a.links, a.links).map((l) => {
      const page = fixtureFor(l.url);
      const verification = page ? verificationFromPage(page.pageText, token, KOFI_PROFILE_BASE + a.id) : 'unreachable';
      counts[verification]++;
      return { ...l, verification, checkedAt: now };
    });
    a.updatedAt = now;
    this.audit(v, 'artist.links', 'artist', a.id, { links: a.links.length, ...counts });
    this.commit();
    return a.links.map((l) => ({ ...l }));
  }

  /* ---------- artist self-service ---------- */

  async getMyArtist(viewer: Viewer): Promise<ArtistView | undefined> {
    const v = this.resolve(viewer);
    if (v.role !== 'artist' || !v.artistId) return undefined;
    const a = this.artistById(v.artistId);
    return a ? viewArtist(a, v) : undefined;
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
    if (patch.links && patch.links.length > MAX_LINKS) throw new ValidationError(`Up to ${MAX_LINKS} links. Remove one to add another.`, 'links');
    const prevVisibility = a.visibility;
    // Runtime whitelist: status, kofiNotes, consent and identity fields can never arrive through a patch.
    const safe: ArtistPatch = {};
    for (const key of ARTIST_PATCH_KEYS) if (key in patch) (safe as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key];
    // Platform and handle are derived; verification is Kofi's checker's, never the client's.
    if (safe.links) safe.links = typeLinks(safe.links, a.links);
    Object.assign(a, safe, { updatedAt: this.iso() });
    // An approved artist who hides their profile is paused, not deleted; re-publishing needs no re-review.
    if (patch.visibility && patch.visibility !== prevVisibility) {
      this.audit(viewer, 'artist.update', 'artist', a.id, { visibility: patch.visibility });
    } else {
      this.audit(viewer, 'artist.update', 'artist', a.id);
    }
    this.commit();
    return viewArtist(a, this.resolve(viewer))!;
  }

  async acceptConsent(viewer: Viewer, version: string): Promise<ArtistView> {
    const a = this.requireMyArtist(viewer);
    a.consentVersion = version;
    a.consentAcceptedAt = this.iso();
    a.updatedAt = a.consentAcceptedAt;
    this.audit(viewer, 'artist.consent', 'artist', a.id, { version });
    this.commit();
    return viewArtist(a, this.resolve(viewer))!;
  }

  async submitForReview(viewer: Viewer): Promise<ArtistView> {
    const a = this.requireMyArtist(viewer);
    if (a.consentVersion !== CONSENT_VERSION) throw new ValidationError('Accept the current consent terms before submitting.', 'consent');
    if (a.status === 'approved') return viewArtist(a, this.resolve(viewer))!;
    a.status = 'pending';
    a.updatedAt = this.iso();
    this.audit(viewer, 'artist.status', 'artist', a.id, { status: 'pending' });
    this.commit();
    return viewArtist(a, this.resolve(viewer))!;
  }

  async saveArtwork(viewer: Viewer, input: ArtworkInput): Promise<ArtworkView> {
    const a = this.requireMyArtist(viewer);
    validateArtwork(input);
    const now = this.iso();
    if (input.id) {
      const existing = this.state.artworks.find((x) => x.id === input.id);
      if (!existing) throw new NotFoundError('Artwork not found.');
      if (existing.artistId !== a.id) throw new ForbiddenError('You can only edit your own work.');
      const v6 = cleanArtworkV6(input, existing);
      const visibilityChanged = existing.visibility !== input.visibility || existing.priceVisibility !== input.priceVisibility;
      const { id: _id, ...rest } = input as ArtworkInput & { artistId?: string; reviewedAt?: string };
      delete rest.artistId;
      delete rest.reviewedAt;
      Object.assign(existing, rest, v6.fields, { updatedAt: now });
      for (const k of v6.cleared) delete existing[k];
      if (visibilityChanged) {
        this.audit(viewer, 'artwork.visibility', 'artwork', existing.id, {
          visibility: existing.visibility,
          priceVisibility: existing.priceVisibility,
        });
      } else this.audit(viewer, 'artwork.update', 'artwork', existing.id);
      this.commit();
      return projectArtwork(existing, a, this.resolve(viewer))!;
    }
    const v6 = cleanArtworkV6(input);
    const { id: _ignored, ...rest } = input as ArtworkInput & { artistId?: string; reviewedAt?: string };
    delete rest.artistId;
    delete rest.reviewedAt;
    const created: Artwork = { ...rest, ...v6.fields, id: this.makeId('aw'), artistId: a.id, createdAt: now, updatedAt: now };
    for (const k of v6.cleared) delete created[k];
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
      .map((a) => ({ ...viewArtist(a, viewer)!, artworkCount: this.state.artworks.filter((w) => w.artistId === a.id).length }))
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
    return viewArtist(a, viewer)!;
  }

  async setKofiNotes(viewer: Viewer, artistId: string, notes: string): Promise<ArtistView> {
    this.requireAdmin(viewer);
    const a = this.artistById(artistId);
    if (!a) throw new NotFoundError('Artist not found.');
    a.kofiNotes = notes;
    this.audit(viewer, 'artist.update', 'artist', a.id, { field: 'kofiNotes' });
    this.commit();
    return viewArtist(a, viewer)!;
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
      .filter((x) => canSeeProgramme(x, v) || this.isPartnerOf(v, x))
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
    return c && (canSeeProgramme(c, v) || this.isPartnerOf(v, c)) ? this.viewCall(c, v) : undefined;
  }

  /**
   * Admin: any call (kind/terms validated; terms frozen once a lot has sold).
   * Partner: creates a draft for their own institution, and edits it only while
   * Kofi has not published it. Never sets published, sample or the organiser.
   */
  async saveOpenCall(viewer: Viewer, input: ProgrammeInput<OpenCall>): Promise<OpenCall> {
    const v = this.resolve(viewer);
    const existing = input.id ? this.state.openCalls.find((c) => c.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('That item no longer exists.');
    let clean: Omit<OpenCall, 'id' | 'createdAt' | 'updatedAt'>;
    if (v.role === 'admin') {
      clean = cleanOpenCall(input, existing?.kind);
      if (clean.organizerInstitutionId && !this.state.institutions.some((i) => i.id === clean.organizerInstitutionId)) {
        throw new ValidationError('That institution no longer exists.', 'organizerInstitutionId');
      }
    } else {
      const inst = this.organiserOf(v);
      if (!inst) throw new ForbiddenError(v.role === 'curator' ? 'Your institution has not been verified yet.' : 'Kofi staff only.');
      if (existing) {
        if (existing.organizerInstitutionId !== inst) throw new ForbiddenError('You can only edit calls your institution runs.');
        if (existing.published) throw new ForbiddenError('Kofi has published this call. Ask Kofi to make changes.');
      }
      clean = cleanOpenCall({ ...input, organizerInstitutionId: inst }, existing?.kind);
      clean.published = existing?.published ?? false;
      clean.sample = existing?.sample ?? false;
    }
    // An editor that does not send lookingFor (older client) keeps what is stored.
    if (existing?.lookingFor && !Object.prototype.hasOwnProperty.call(input, 'lookingFor')) clean.lookingFor = clone(existing.lookingFor);
    if (existing) this.checkCallLocks(existing, clean);
    this.checkProgrammeRefs(clean);
    const saved = this.upsertProgramme(v, this.state.openCalls, 'open_call', 'call', input.id, clean);
    return this.viewCall(saved, v);
  }

  /** A sale freezes the terms; a call with lots stays an auction. */
  private checkCallLocks(existing: OpenCall, next: Omit<OpenCall, 'id' | 'createdAt' | 'updatedAt'>): void {
    const lots = this.state.lots.filter((l) => l.callId === existing.id);
    if (lots.length > 0 && next.kind !== 'auction' && existing.kind === 'auction') throw new ValidationError('This call has lots, so it stays an auction.', 'kind');
    const sold = lots.some((l) => l.status === 'sold');
    if (sold && canonical(existing.terms) !== canonical(next.terms)) throw new ValidationError('Terms are locked once a lot has sold.', 'terms');
  }

  /** Calls this viewer runs: a partner's own (drafts included); admin: every call with an organiser. */
  async listMyCalls(viewer: Viewer): Promise<OpenCall[]> {
    const v = this.resolve(viewer);
    let calls: OpenCall[];
    if (v.role === 'admin') calls = this.state.openCalls.filter((c) => !!c.organizerInstitutionId);
    else {
      const inst = this.requireOrganiser(v);
      calls = this.state.openCalls.filter((c) => c.organizerInstitutionId === inst);
    }
    return calls.map((c) => this.viewCall(c, v)).sort((a, b) => b.opensOn.localeCompare(a.opensOn) || a.title.localeCompare(b.title));
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
    const reviewer = v.role === 'admin' || this.isPartnerOf(v, call);
    const works: ArtworkView[] = [];
    for (const id of app.artworkIds) {
      const aw = this.state.artworks.find((x) => x.id === id);
      const view = aw ? (reviewer ? this.reviewerWork(aw, v) : projectArtwork(aw, this.artistById(aw.artistId), v)) : undefined;
      if (view) works.push(view);
    }
    const row: ApplicationRow = {
      ...clone(app),
      callTitle: call?.title ?? 'A call that has been removed',
      artistWorkingName: artist?.workingName ?? 'Unknown artist',
      works,
    };
    if (call?.deadline) row.callDeadline = call.deadline;
    // The reviewers' note is shared by Kofi and the call's organiser; the artist sees only the decision note.
    if (!reviewer) delete row.staffNote;
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

  /** Admin: all (optionally one call). Partner: applications to calls its institution runs only. */
  async listApplications(viewer: Viewer, callId?: string): Promise<ApplicationRow[]> {
    const v = this.resolve(viewer);
    if (v.role !== 'admin') {
      this.requireOrganiser(v);
      if (callId) this.requireCallManager(v, callId);
    }
    return this.state.applications
      .filter((x) => !callId || x.callId === callId)
      .filter((x) => v.role === 'admin' || this.isPartnerOf(v, this.state.openCalls.find((c) => c.id === x.callId)))
      .map((x) => this.applicationRow(x, v))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async setApplicationStatus(viewer: Viewer, id: string, status: ApplicationStatus, notes: { decisionNote?: string; staffNote?: string } = {}): Promise<ApplicationRow> {
    const v = this.resolve(viewer);
    if (v.role !== 'admin') this.requireOrganiser(v);
    const app = this.state.applications.find((x) => x.id === id);
    if (!app) throw new NotFoundError('Application not found.');
    if (v.role !== 'admin') this.requireCallManager(v, app.callId);
    // The organiser reviews with Kofi's rules (shortlist, decide, correct); only the artist withdraws.
    if (!canMoveApplication(app.status, status, 'admin')) {
      throw new ValidationError(app.status === 'withdrawn' ? 'The artist withdrew this application.' : `This application cannot be moved from ${app.status} to ${status}.`, 'status');
    }
    if (app.status === 'accepted' && this.state.lots.some((l) => l.applicationId === app.id && l.status !== 'withdrawn')) {
      throw new ValidationError('Works from this selection are lots in the auction. Withdraw or delete the lots first.', 'status');
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
    this.audit(v, 'application.status', 'application', app.id, { status, callId: app.callId });
    this.commit();
    return this.applicationRow(app, v);
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

  /* ---------- lots, sales, payouts ---------- */

  /** The payout that counts for a lot: the live one (due/paid), else the latest voided one. */
  private payoutForLot(lotId: string): Payout | undefined {
    const all = this.state.payouts.filter((p) => p.lotId === lotId);
    return all.find((p) => p.status !== 'void') ?? all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  /**
   * One lot as this viewer may see it. Admin: everything incl. the payout. Partner: the
   * sale incl. buyerRef, never the payout. Artist (own lot): the sale without buyerRef, and
   * their payout.
   */
  private lotRow(lot: Lot, v: Viewer): LotRow {
    const call = this.state.openCalls.find((c) => c.id === lot.callId);
    const aw = this.state.artworks.find((x) => x.id === lot.artworkId);
    const artist = this.artistById(lot.artistId);
    const asArtist = v.role === 'artist';
    let row: LotRow = {
      ...clone(lot),
      callTitle: call?.title ?? 'A call that has been removed',
      callKind: call?.kind ?? 'auction',
      artworkTitle: aw?.title ?? 'A work that has been removed',
      artistWorkingName: artist?.workingName ?? 'Unknown artist',
    };
    const work = aw ? (asArtist ? projectArtwork(aw, this.artistById(aw.artistId), v) : this.reviewerWork(aw, v)) : undefined;
    if (work) row.work = work;
    if (v.role === 'admin' || asArtist) {
      const p = this.payoutForLot(lot.id);
      if (p) row.payout = clone(p);
    }
    if (asArtist) row = projectLotForArtist(row);
    return row;
  }

  private sortLots(rows: LotRow[]): LotRow[] {
    return rows.sort((a, b) => a.callTitle.localeCompare(b.callTitle) || a.callId.localeCompare(b.callId) || a.lotNumber - b.lotNumber);
  }

  /** Admin: all lots. Partner: lots on calls its institution runs. Artists use listMyLots. */
  async listLots(viewer: Viewer, callId?: string): Promise<LotRow[]> {
    const v = this.resolve(viewer);
    if (v.role !== 'admin') {
      this.requireOrganiser(v);
      if (callId) this.requireCallManager(v, callId);
    }
    const rows = this.state.lots
      .filter((l) => !callId || l.callId === callId)
      .filter((l) => v.role === 'admin' || this.isPartnerOf(v, this.state.openCalls.find((c) => c.id === l.callId)))
      .map((l) => this.lotRow(l, v));
    return this.sortLots(rows);
  }

  private requireLot(v: Viewer, id: string): { lot: Lot; call: OpenCall } {
    if (v.role !== 'admin') this.requireOrganiser(v);
    const lot = this.state.lots.find((l) => l.id === id);
    if (!lot) throw new NotFoundError('Lot not found.');
    const call = this.requireCallManager(v, lot.callId);
    return { lot, call };
  }

  async saveLot(viewer: Viewer, input: LotInput & { id?: string }): Promise<LotRow> {
    const v = this.resolve(viewer);
    if (v.role !== 'admin') this.requireOrganiser(v);
    const existing = input.id ? this.state.lots.find((l) => l.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Lot not found.');
    const call = this.requireCallManager(v, String(input.callId ?? ''));
    if (existing) {
      if (existing.callId !== call.id) throw new ValidationError('A lot cannot move to another call.', 'callId');
      if (existing.status === 'sold') throw new ValidationError('This lot is sold. Void the sale before editing it.', 'status');
    }
    const clean: LotInput = {
      callId: call.id,
      applicationId: String(input.applicationId ?? ''),
      artworkId: String(input.artworkId ?? ''),
      lotNumber: input.lotNumber,
    };
    if (input.reserve !== undefined && input.reserve !== null) clean.reserve = input.reserve;
    if (input.startingBid !== undefined && input.startingBid !== null) clean.startingBid = input.startingBid;
    const application = this.state.applications.find((a) => a.id === clean.applicationId);
    if (!application) throw new ValidationError('Choose a selected application.', 'applicationId');
    const artwork = this.state.artworks.find((a) => a.id === clean.artworkId);
    if (!artwork) throw new ValidationError('That work no longer exists.', 'artworkId');
    const problem = validateLot({ call, application, artwork, input: clean, existing: this.state.lots.filter((l) => l.callId === call.id), editingId: existing?.id });
    if (problem) throw new ValidationError(problem.message, problem.field);
    const now = this.iso();
    let lot: Lot;
    if (existing) {
      lot = existing;
      lot.applicationId = clean.applicationId;
      lot.artworkId = clean.artworkId;
      lot.artistId = application.artistId;
      lot.lotNumber = clean.lotNumber;
      if (clean.reserve !== undefined) lot.reserve = clean.reserve;
      else delete lot.reserve;
      if (clean.startingBid !== undefined) lot.startingBid = clean.startingBid;
      else delete lot.startingBid;
      lot.updatedAt = now;
    } else {
      lot = compact({
        id: this.makeId('lot'),
        callId: call.id,
        applicationId: clean.applicationId,
        artworkId: clean.artworkId,
        artistId: application.artistId,
        lotNumber: clean.lotNumber,
        reserve: clean.reserve,
        startingBid: clean.startingBid,
        status: 'planned' as LotStatus,
        createdAt: now,
        updatedAt: now,
      });
      this.state.lots.push(lot);
    }
    this.audit(v, 'lot.save', 'lot', lot.id, { callId: call.id, lotNumber: lot.lotNumber, created: !existing });
    this.commit();
    return this.lotRow(lot, v);
  }

  /** Moves allowed by canMoveLot. sold → unsold voids the sale; its payout is kept as 'void'. */
  async setLotStatus(viewer: Viewer, id: string, status: LotStatus): Promise<LotRow> {
    const v = this.resolve(viewer);
    const { lot } = this.requireLot(v, id);
    if (!LOT_STATUSES.includes(status)) throw new ValidationError('Unknown status.', 'status');
    if (!canMoveLot(lot.status, status)) {
      throw new ValidationError(status === 'sold' ? 'Record the sale to mark a lot sold.' : `This lot cannot move from ${lot.status} to ${status}.`, 'status');
    }
    if (lot.status === 'withdrawn') {
      // Reinstating a withdrawn lot re-checks the rules it was exempt from while withdrawn.
      const call = this.state.openCalls.find((c) => c.id === lot.callId);
      const application = this.state.applications.find((a) => a.id === lot.applicationId);
      const artwork = this.state.artworks.find((a) => a.id === lot.artworkId);
      if (!call || !application || !artwork) throw new ValidationError('The work or its application no longer exists.', 'status');
      const problem = validateLot({ call, application, artwork, input: lot, existing: this.state.lots.filter((l) => l.callId === lot.callId), editingId: lot.id });
      if (problem) throw new ValidationError(problem.message, problem.field);
    }
    const now = this.iso();
    if (lot.status === 'sold') {
      const payout = this.state.payouts.find((p) => p.lotId === lot.id && p.status !== 'void');
      if (payout?.status === 'paid') throw new ValidationError('Payout already paid.', 'status');
      if (payout) {
        payout.status = 'void';
        payout.updatedAt = now;
        this.audit(v, 'payout.status', 'payout', payout.id, { status: 'void', lotId: lot.id });
      }
      delete lot.sale;
      this.audit(v, 'lot.sale', 'lot', lot.id, { voided: true, lotNumber: lot.lotNumber });
    } else {
      this.audit(v, 'lot.save', 'lot', lot.id, { status, from: lot.status, lotNumber: lot.lotNumber });
    }
    lot.status = status;
    lot.updatedAt = now;
    this.commit();
    return this.lotRow(lot, v);
  }

  async recordSale(viewer: Viewer, id: string, input: SaleInput): Promise<LotRow> {
    const v = this.resolve(viewer);
    const { lot, call } = this.requireLot(v, id);
    if (!call.terms) throw new ValidationError('Set the call’s compensation terms before recording a sale.', 'terms');
    const clean: SaleInput = { hammerPrice: input.hammerPrice, soldOn: str(input.soldOn) };
    const buyerRef = typeof input.buyerRef === 'string' ? input.buyerRef.trim() : '';
    if (buyerRef) clean.buyerRef = buyerRef;
    const problem = validateSale(lot, clean, this.today());
    if (problem) throw new ValidationError(problem.message, problem.field);
    if (!isIsoDate(clean.soldOn)) throw new ValidationError('Enter the date of the sale.', 'soldOn');
    const sale = splitSale(clean.hammerPrice, call.terms, kofiNoonIso(clean.soldOn), clean.buyerRef);
    const now = this.iso();
    lot.sale = sale;
    lot.status = 'sold';
    lot.updatedAt = now;
    const payout: Payout = { id: this.makeId('payout'), lotId: lot.id, artistId: lot.artistId, amount: sale.artistAmount, currency: sale.currency, status: 'due', createdAt: now, updatedAt: now };
    this.state.payouts.push(payout);
    // Never the buyer reference in the audit trail.
    this.audit(v, 'lot.sale', 'lot', lot.id, { hammer: sale.hammerPrice, currency: sale.currency, lotNumber: lot.lotNumber });
    this.commit();
    return this.lotRow(lot, v);
  }

  /** Only a lot that has never been sold: a sale (even a voided one) stays on the record. */
  async deleteLot(viewer: Viewer, id: string): Promise<void> {
    const v = this.resolve(viewer);
    const { lot } = this.requireLot(v, id);
    if (lot.status === 'sold' || this.state.payouts.some((p) => p.lotId === lot.id)) {
      throw new ValidationError('This lot has a sale on record, so it cannot be deleted. Withdraw it instead.', 'status');
    }
    this.state.lots = this.state.lots.filter((l) => l.id !== lot.id);
    this.audit(v, 'lot.delete', 'lot', lot.id, { callId: lot.callId, lotNumber: lot.lotNumber });
    this.commit();
  }

  /** Artist: own lots, read-only; the sale never carries the buyer reference. */
  async listMyLots(viewer: Viewer): Promise<LotRow[]> {
    const a = this.requireMyArtist(viewer);
    const v = this.resolve(viewer);
    return this.sortLots(this.state.lots.filter((l) => l.artistId === a.id).map((l) => this.lotRow(l, v)));
  }

  private payoutRow(p: Payout): PayoutRow {
    const lot = this.state.lots.find((l) => l.id === p.lotId);
    const call = lot ? this.state.openCalls.find((c) => c.id === lot.callId) : undefined;
    const aw = lot ? this.state.artworks.find((x) => x.id === lot.artworkId) : undefined;
    return {
      ...clone(p),
      artistWorkingName: this.artistById(p.artistId)?.workingName ?? 'Unknown artist',
      artworkTitle: aw?.title ?? 'A work that has been removed',
      callTitle: call?.title ?? 'A call that has been removed',
      lotNumber: lot?.lotNumber ?? 0,
    };
  }

  /** Admin: all payouts. Artist: own. Everyone else (partners included): ForbiddenError. */
  async listPayouts(viewer: Viewer): Promise<PayoutRow[]> {
    const v = this.resolve(viewer);
    let rows: Payout[];
    if (v.role === 'admin') rows = this.state.payouts;
    else if (v.role === 'artist') {
      const a = this.requireMyArtist(v);
      rows = this.state.payouts.filter((p) => p.artistId === a.id);
    } else throw new ForbiddenError('Kofi staff only.');
    return rows.map((p) => this.payoutRow(p)).sort((x, y) => y.createdAt.localeCompare(x.createdAt) || x.id.localeCompare(y.id));
  }

  async setPayoutStatus(viewer: Viewer, id: string, status: PayoutStatus, details: { method?: string; reference?: string; note?: string; paidOn?: string } = {}): Promise<PayoutRow> {
    this.requireAdmin(viewer);
    const p = this.state.payouts.find((x) => x.id === id);
    if (!p) throw new NotFoundError('Payout not found.');
    if (!PAYOUT_STATUSES.includes(status)) throw new ValidationError('Unknown status.', 'status');
    if (!canMovePayout(p.status, status)) throw new ValidationError(`This payout cannot move from ${p.status} to ${status}.`, 'status');
    if (p.status === 'void' && status === 'due') {
      const lot = this.state.lots.find((l) => l.id === p.lotId);
      const other = this.state.payouts.some((x) => x.lotId === p.lotId && x.id !== p.id && x.status !== 'void');
      if (!lot || lot.status !== 'sold' || other) throw new ValidationError('This sale was voided. Record the sale again instead.', 'status');
    }
    const note = optStr(details.note, 'note', MAX_NOTE, 'Note');
    if (status === 'paid') {
      const method = optStr(details.method, 'method', 80, 'Payment method');
      if (!method) throw new ValidationError('Say how the artist was paid.', 'method');
      const reference = optStr(details.reference, 'reference', 120, 'Reference');
      const paidOn = details.paidOn === undefined || details.paidOn === '' ? this.today() : str(details.paidOn);
      if (!isIsoDate(paidOn)) throw new ValidationError('Payment date must be a valid date.', 'paidOn');
      if (paidOn > this.today()) throw new ValidationError('The payment date cannot be in the future.', 'paidOn');
      p.method = method;
      if (reference) p.reference = reference;
      else delete p.reference;
      p.paidAt = kofiNoonIso(paidOn);
    } else {
      delete p.method;
      delete p.reference;
      delete p.paidAt;
    }
    if (details.note !== undefined) {
      if (note) p.note = note;
      else delete p.note;
    }
    p.status = status;
    p.updatedAt = this.iso();
    const meta: AuditEvent['meta'] = { status, lotId: p.lotId };
    if (p.method) meta.method = p.method;
    this.audit(viewer, 'payout.status', 'payout', p.id, meta);
    this.commit();
    return this.payoutRow(p);
  }

  /* ---------- Kofi reports ---------- */

  async kofiReport(viewer: Viewer, range: ReportRange): Promise<KofiReport> {
    this.requireAdmin(viewer);
    // Reports are an admin-only path; keep the report builder out of the main chunk.
    const { buildReport, validateRange } = await import('@/domain/reports');
    const r: ReportRange = { from: str(range?.from), to: str(range?.to) };
    const problem = validateRange(r, this.today());
    if (problem) throw new ValidationError(problem, 'range');
    const s = this.state;
    const report = buildReport(
      {
        artists: s.artists,
        artworks: s.artworks,
        calls: s.openCalls,
        institutions: s.institutions,
        exhibitions: s.exhibitions,
        applications: s.applications,
        lots: s.lots,
        payouts: s.payouts,
      },
      r,
      this.iso(),
    );
    this.audit(viewer, 'report.export', 'report', `${r.from}_${r.to}`, { from: r.from, to: r.to });
    this.commit(true);
    return clone(report);
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

/**
 * The artist projection plus the v5 intake fields: the verification code and the
 * import trail go to the owner and Kofi admins only; everyone else gets each link's
 * label, url, platform and handle, never its verification state.
 */
export function viewArtist(a: Artist, v: Viewer): ArtistView | undefined {
  const view = projectArtist(a, v);
  if (!view) return undefined;
  if (canEdit(v, a.id)) {
    if (a.verificationToken) view.verificationToken = a.verificationToken;
    view.imports = clone(a.imports ?? []);
  } else {
    view.links = a.links.map((l) => {
      const out: ArtistLink = { label: l.label, url: l.url };
      if (l.platform) out.platform = l.platform;
      if (l.handle) out.handle = l.handle;
      return out;
    });
  }
  return view;
}

/**
 * Give each link its platform and handle (derived from the URL), keeping the
 * verification a link already earned when its URL is unchanged; a new or edited
 * URL starts as 'claimed'. The URL itself is kept as the artist typed it.
 */
export function typeLinks(next: ArtistLink[], prev: ArtistLink[]): ArtistLink[] {
  const before = new Map(prev.map((l) => [l.url.trim().toLowerCase(), l]));
  return next.map((l) => {
    const url = String(l.url ?? '').trim();
    const n = normalizeLink(url);
    const out: ArtistLink = { label: String(l.label ?? '').trim(), url, platform: n?.platform ?? 'other', handle: n?.handle ?? hostOf(url) };
    const old = before.get(url.toLowerCase());
    out.verification = old?.verification ?? 'claimed';
    if (old?.verification && old.checkedAt) out.checkedAt = old.checkedAt;
    return out;
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
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
    if (!im.src.startsWith('data:image/') && !im.src.startsWith('storage:') && !im.src.startsWith('/art/')) throw new ValidationError('Unsupported image.', 'images');
    if (im.src.length > MAX_IMAGE_BYTES * 1.37) throw new ValidationError('Images must be under 6 MB.', 'images');
  }
}

/* ---------- v6: tags, uses, edition, location, keywords ---------- */

export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 40;
const MAX_EDITION = 100_000;

type V6Field = 'tagIds' | 'uses' | 'edition' | 'location' | 'tags';

/**
 * Normalise the v6 fields of an artwork save (server-equivalent; the SQL checks mirror
 * these). A field the client leaves out keeps its stored value on update, so an older
 * client never wipes tags, uses, an edition or a location it does not know about.
 * Returns the fields to set and the optional fields to clear.
 */
export function cleanArtworkV6(input: ArtworkInput, existing?: Artwork): { fields: Pick<Artwork, 'tagIds' | 'uses' | 'tags'> & Partial<Pick<Artwork, 'edition' | 'location'>>; cleared: ('edition' | 'location')[] } {
  const has = (k: V6Field) => Object.prototype.hasOwnProperty.call(input, k);
  // Tags: stable ids from the library, primary medium mirrored, capped per category.
  let rawIds: readonly string[];
  if (input.tagIds !== undefined) {
    if (!Array.isArray(input.tagIds) || input.tagIds.some((x) => typeof x !== 'string')) throw new ValidationError('Tags must be a list.', 'tags');
    rawIds = input.tagIds;
  } else if (existing) {
    // Medium changed without new tags: the old primary medium was only a mirror, so drop it.
    const oldMirror = mediumTagId(existing.medium);
    rawIds = (existing.tagIds ?? []).filter((id) => existing.medium === input.medium || id !== oldMirror);
  } else rawIds = [];
  const { tagIds, problem } = normalizeTagIds(rawIds, input.medium);
  if (problem) throw new ValidationError(problem.message, problem.field);

  const fields: ReturnType<typeof cleanArtworkV6>['fields'] = {
    tagIds,
    uses: input.uses !== undefined ? cleanUses(input.uses) : existing?.uses ? { ...existing.uses } : { ...NO_USES },
    tags: cleanKeywords(input.tags),
  };
  const cleared: ('edition' | 'location')[] = [];
  if (has('edition') || !existing) {
    const e = cleanEdition(input.edition);
    if (e) fields.edition = e;
    else cleared.push('edition');
  }
  if (has('location') || !existing) {
    const l = cleanLocation(input.location);
    if (l) fields.location = l;
    else cleared.push('location');
  }
  return { fields, cleared };
}

function cleanUses(v: unknown): ArtworkUses {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ValidationError('Choose what the work is available for.', 'uses');
  const o = v as Record<string, unknown>;
  const out: ArtworkUses = { ...NO_USES };
  for (const k of USE_KEYS) {
    const x = o[k];
    if (x === undefined) continue;
    if (typeof x !== 'boolean') throw new ValidationError('Choose what the work is available for.', 'uses');
    out[k] = x;
  }
  return out;
}

/** Free-text keywords: trimmed, empties dropped, de-duplicated ignoring case, at most 20 of at most 40 characters. */
export function cleanKeywords(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ValidationError('Keywords must be a list of words.', 'tags');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v as string[]) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t || seen.has(t.toLowerCase())) continue;
    if (t.length > MAX_KEYWORD_LENGTH) throw new ValidationError(`Keep each keyword under ${MAX_KEYWORD_LENGTH} characters.`, 'tags');
    seen.add(t.toLowerCase());
    out.push(t);
  }
  if (out.length > MAX_KEYWORDS) throw new ValidationError(`Up to ${MAX_KEYWORDS} keywords.`, 'tags');
  return out;
}

/**
 * Edition: a known type; number and size are whole numbers of at least 1 and the
 * number cannot exceed the size. A unique work carries neither; an open edition has
 * no size; a limited edition needs its size.
 */
export function cleanEdition(v: unknown): Edition | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('Choose an edition type.', 'edition');
  const e = v as Partial<Record<keyof Edition, unknown>>;
  const type = e.type as Edition['type'];
  if (!EDITION_TYPES.includes(type)) throw new ValidationError('Choose an edition type.', 'edition');
  const whole = (x: unknown, label: string): number | undefined => {
    if (x === undefined || x === null || x === '') return undefined;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > MAX_EDITION) throw new ValidationError(`${label} must be a whole number of 1 or more.`, 'edition');
    return x;
  };
  if (type === 'unique') return { type };
  const number = whole(e.number, 'The edition number');
  const size = type === 'open' ? undefined : whole(e.size, 'The edition size');
  if (type === 'limited' && size === undefined) throw new ValidationError('Enter how many are in the edition.', 'edition');
  if (number !== undefined && size !== undefined && number > size) throw new ValidationError('The edition number cannot be higher than the edition size.', 'edition');
  return compact({ type, number, size });
}

/** Where the work is, when it is not with the artist. Region and country are required once any part is given. */
export function cleanLocation(v: unknown): Region | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('Enter where the work is.', 'location');
  const l = v as Partial<Record<keyof Region, unknown>>;
  const city = optStr(l.city, 'location', 120, 'City');
  const region = optStr(l.region, 'location', 120, 'Region');
  const country = optStr(l.country, 'location', 120, 'Country');
  if (!city && !region && !country) return undefined;
  if (!region || !country) throw new ValidationError('Add the region and country where the work is.', 'location');
  const precision: Region['precision'] = l.precision === 'city' || l.precision === 'region' || l.precision === 'country' ? l.precision : city ? 'city' : 'region';
  return compact({ city, region, country, precision });
}

/**
 * An organiser's "looking for": unknown keys dropped, tags must be library ids an
 * artist can pick (MVP, filter categories) filed under their own category, uses must
 * be known; then validateCriteria. Empty criteria are stored as none.
 */
export function cleanCriteria(v: unknown): CallCriteria | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('The criteria are not valid.', 'lookingFor');
  const c = v as Partial<Record<keyof CallCriteria, unknown>>;
  const out: CallCriteria = {};
  if (c.tags !== undefined && c.tags !== null) {
    if (typeof c.tags !== 'object' || Array.isArray(c.tags)) throw new ValidationError('Tags must be a list.', 'lookingFor');
    const tags: Record<string, string[]> = {};
    for (const [cat, list] of Object.entries(c.tags as Record<string, unknown>)) {
      if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) throw new ValidationError('Tags must be a list.', 'lookingFor');
      const ids = [...new Set((list as string[]).map((x) => x.trim()))];
      for (const id of ids) {
        const t = tagDef(id);
        if (!t || t.phase !== 'mvp' || !t.artistSelectable || !(ARTIST_TAG_CATEGORIES as readonly string[]).includes(t.category)) throw new ValidationError('One of the tags is not in Kofi’s library.', 'lookingFor');
        if (categoryOf(id) !== cat) throw new ValidationError(`Each tag must belong to its category (${cat}).`, 'lookingFor');
      }
      if (ids.length) tags[cat] = ids;
    }
    if (Object.keys(tags).length) out.tags = tags;
  }
  if (c.uses !== undefined && c.uses !== null) {
    if (!Array.isArray(c.uses) || c.uses.some((u) => !USE_KEYS.includes(u as (typeof USE_KEYS)[number]))) throw new ValidationError('Choose what the work must be available for.', 'lookingFor.uses');
    const uses = USE_KEYS.filter((k) => (c.uses as string[]).includes(k));
    if (uses.length) out.uses = uses;
  }
  const region = optStr(c.region, 'lookingFor.region', 1000, 'Region');
  if (region) out.region = region;
  for (const k of ['maxLongestEdgeCm', 'minLongestEdgeCm'] as const) {
    const x = c[k];
    if (x === undefined || x === null || x === '') continue;
    if (typeof x !== 'number') throw new ValidationError('Enter a size in centimetres.', `lookingFor.${k}`);
    out[k] = x;
  }
  const note = optStr(c.note, 'lookingFor.note', 10_000, 'Note');
  if (note) out.note = note;
  const problem = validateCriteria(out);
  if (problem) throw new ValidationError(problem.message, problem.field);
  return Object.keys(out).length ? out : undefined;
}

/* ---------- persisted-state migration ---------- */

/**
 * A state persisted by an older build keeps every row it has; only what is missing is
 * filled from the seed. Collections that exist are never touched.
 * - v2 (no programme collections): the seeded programme is merged in.
 * - v3 (no lots/payouts): calls get `kind: 'exhibition'` where they lack one, and the
 *   seeded auction (call, its applications, lots and payouts) is added by id, skipping
 *   anything that points at an artist or work the user has since deleted.
 */
export function migrateState(parsed: Partial<MockState>): MockState {
  return migrateTaxonomy(migrateIntake(migrateProgramme(parsed)));
}

/**
 * v5 → v6 (idempotent; runs once, then `schema` is set). Every work keeps its old
 * `tags` as keywords and gets `tagIds` = its medium. Seeded works (by id) get the
 * seed's classification instead: tags, the demo artist's uses and edition, as the
 * Supabase live patch does. Any other work gets NO_USES: an opt-in is never guessed.
 * The two seeded calls get their criteria where they have none.
 */
function migrateTaxonomy(out: MockState): MockState {
  if ((out.schema ?? 0) >= MOCK_SCHEMA) return out;
  // The seed's own primary medium per work (a seed may carry a second medium tag, e.g. ceramics on an installation).
  const seedMediumById = new Map<string, string>();
  for (const s of buildSeed().artworks) seedMediumById.set(s.id, mediumTagId(s.medium));
  for (const a of out.artworks ?? []) {
    const seed = SEED_CLASSIFICATION[a.id];
    if (!Array.isArray(a.tags)) a.tags = [];
    a.tags = migrateKeywords(a.tags);
    if (!Array.isArray(a.tagIds)) {
      // The seed's ids minus its primary medium mirror, so a medium the user changed is respected.
      // Secondary medium tags in the seed are kept; only the mirror of the seed's own medium is replaced.
      const seedMedium = seedMediumById.get(a.id);
      const ids = seed ? seed.tagIds.filter((id) => id !== seedMedium || mediumTagId(a.medium) === seedMedium) : [];
      a.tagIds = normalizeTagIds(ids, a.medium).tagIds;
    }
    if (!a.uses || typeof a.uses !== 'object') a.uses = { ...(seed?.uses ?? NO_USES) };
    if (!a.edition && seed?.edition) a.edition = { ...seed.edition };
  }
  for (const c of out.openCalls ?? []) {
    if (c.lookingFor === undefined) {
      const crit = criteriaFor(c.id);
      if (crit) c.lookingFor = crit;
    }
  }
  out.schema = MOCK_SCHEMA;
  return out;
}

/** Old free-text tags become keywords without failing a load: trimmed, de-duplicated, clipped to the limits. */
function migrateKeywords(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_KEYWORD_LENGTH).trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, MAX_KEYWORDS);
}

function migrateProgramme(parsed: Partial<MockState>): MockState {
  const missing = PROGRAMME_KEYS.filter((k) => !Array.isArray(parsed[k]));
  const preV4 = SALES_KEYS.some((k) => !Array.isArray(parsed[k]));
  const kindless = Array.isArray(parsed.openCalls) && parsed.openCalls.some((c) => !c.kind);
  if (missing.length === 0 && !preV4 && !kindless) return parsed as MockState;
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
  // Kindless (v3) calls: seeded ids take the seed's kind, like apply/0009_live_patch.sql; user-made calls were exhibitions.
  const seedKind = new Map(seed.openCalls.map((c) => [c.id, c.kind]));
  for (const c of out.openCalls) if (!c.kind) c.kind = seedKind.get(c.id) ?? 'exhibition';
  if (preV4) mergeSalesSeed(out, seed, workIds, artistIds);
  return out;
}

/**
 * v4 → v5 (idempotent): sign-ups collection; every artist gets a verification code,
 * an import trail and typed links. Seeded artists whose links are still exactly the
 * v4 sample links get the v5 sample links (and their seeded code and import trail);
 * every other link keeps its URL and label and is marked 'claimed'.
 */
function migrateIntake(out: MockState): MockState {
  if (!Array.isArray(out.accounts)) out.accounts = [];
  const seed = seedIntake();
  const used = new Set(out.artists.map((a) => a.verificationToken).filter((t): t is string => !!t && TOKEN_RE.test(t)));
  for (const a of out.artists) {
    const s = seed[a.id];
    const v4 = V4_SEED_LINKS[a.id];
    const untouched = !!s && !!v4 && sameLinks(a.links ?? [], v4);
    if (untouched) a.links = clone(s.links);
    else a.links = typeLinks(Array.isArray(a.links) ? a.links : [], Array.isArray(a.links) ? a.links : []);
    if (!a.verificationToken || !TOKEN_RE.test(a.verificationToken)) {
      let t = s && !used.has(s.verificationToken) ? s.verificationToken : makeVerificationToken();
      while (used.has(t)) t = makeVerificationToken();
      a.verificationToken = t;
      used.add(t);
    }
    if (!Array.isArray(a.imports)) a.imports = untouched ? clone(s.imports) : [];
  }
  return out;
}

function sameLinks(a: ArtistLink[], b: { label: string; url: string }[]): boolean {
  return a.length === b.length && a.every((l, i) => l.label === b[i]!.label && l.url === b[i]!.url && !l.platform);
}

function mergeSalesSeed(out: MockState, seed: ProgrammeState, workIds: Set<string>, artistIds: Set<string>): void {
  out.lots = Array.isArray(out.lots) ? out.lots : [];
  out.payouts = Array.isArray(out.payouts) ? out.payouts : [];
  const has = <T extends { id: string }>(list: T[], id: string) => list.some((x) => x.id === id);
  const instIds = new Set((out.institutions ?? []).map((i) => i.id));
  // Only the sales seed (calls that have lots) is new in v4; other seeded calls are the user's to keep or delete.
  const salesCallIds = new Set(seed.lots.map((l) => l.callId));
  for (const call of seed.openCalls) {
    if (!salesCallIds.has(call.id) || has(out.openCalls, call.id)) continue;
    if (call.organizerInstitutionId && !instIds.has(call.organizerInstitutionId)) delete call.organizerInstitutionId;
    if (call.exhibitionId && !has(out.exhibitions, call.exhibitionId)) delete call.exhibitionId;
    out.openCalls.push(call);
  }
  for (const app of seed.applications) {
    if (!salesCallIds.has(app.callId) || has(out.applications, app.id) || !artistIds.has(app.artistId)) continue;
    app.artworkIds = app.artworkIds.filter((id) => workIds.has(id));
    if (app.artworkIds.length > 0) out.applications.push(app);
  }
  for (const lot of seed.lots) {
    if (has(out.lots, lot.id) || !workIds.has(lot.artworkId)) continue;
    const app = out.applications.find((a) => a.id === lot.applicationId);
    if (!app || app.status !== 'accepted' || !app.artworkIds.includes(lot.artworkId)) continue;
    out.lots.push(lot);
  }
  for (const p of seed.payouts) {
    if (!has(out.payouts, p.id) && has(out.lots, p.lotId)) out.payouts.push(p);
  }
}

/** Noon in Kofi's time zone on a calendar day, as a UTC ISO timestamp (DST-aware). */
export function kofiNoonIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: KOFI_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asUtc - guess)).toISOString();
}

/** Stable JSON for comparing terms (key order and undefined keys ignored). */
function canonical(t: CallTerms | undefined): string {
  if (!t) return '';
  const o = t as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, o[k]]));
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

/**
 * `fallbackKind` is the stored kind when an older client sends no kind (kind is required, so
 * it can never be "cleared"). Validates kind and terms (validateCallTerms: an auction must
 * carry terms; any terms must be valid).
 */
export function cleanOpenCall(input: ProgrammeInput<OpenCall>, fallbackKind?: CallKind): Omit<OpenCall, 'id' | 'createdAt' | 'updatedAt'> {
  const opensOn = reqDate(input.opensOn, 'opensOn', 'Opening date');
  const deadline = optDate(input.deadline, 'deadline', 'Deadline');
  if (deadline && deadline < opensOn) throw new ValidationError('The deadline is before the call opens.', 'deadline');
  const maxWorks = input.maxWorks;
  if (!Number.isInteger(maxWorks) || maxWorks < 1 || maxWorks > 10) throw new ValidationError('Allow between 1 and 10 works.', 'maxWorks');
  const mediums = Array.isArray(input.mediums) ? [...new Set(input.mediums)] : [];
  if (mediums.some((m) => !MEDIUMS.includes(m))) throw new ValidationError('Unknown medium.', 'mediums');
  const kind = (input.kind ?? fallbackKind ?? 'exhibition') as CallKind;
  if (!CALL_KINDS.includes(kind)) throw new ValidationError('Choose what kind of call this is.', 'kind');
  const out = compact({
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
    kind,
    organizerInstitutionId: optStr(input.organizerInstitutionId, 'organizerInstitutionId', 100, 'Organiser'),
    terms: callTerms(input.terms),
    lookingFor: cleanCriteria(input.lookingFor),
  });
  const problem = validateCallTerms(out);
  if (problem) throw new ValidationError(problem.message, problem.field);
  return out;
}

function callTerms(v: unknown): CallTerms | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('The terms are not valid.', 'terms');
  const t = v as Partial<Record<keyof CallTerms, unknown>>;
  const pct = (x: unknown) => (typeof x === 'number' ? x : Number.NaN);
  return compact({
    artistSharePct: pct(t.artistSharePct),
    kofiSharePct: pct(t.kofiSharePct),
    partnerSharePct: pct(t.partnerSharePct),
    buyerPremiumPct: pct(t.buyerPremiumPct),
    resaleRoyaltyPct: pct(t.resaleRoyaltyPct),
    currency: str(t.currency),
    paymentNote: optStr(t.paymentNote, 'paymentNote', MAX_SUMMARY, 'Payment note'),
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
