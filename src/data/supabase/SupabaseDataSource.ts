import { createClient, FunctionsHttpError, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import { importFromSignals, isFetchableUrl, normalizeLink, validateSignUp, type PageSignals } from '@/domain/intake';
import { applyFilters, sortArtworks, type ArtworkFilters } from '@/domain/filters';
import { effectiveCriteria, rankWorks, type MatchResult } from '@/domain/matching';
import { artworksToCsv, buildArtistExport } from '@/domain/export';
import type {
  ApplicationRow,
  ApplicationStatus,
  ArtDocument,
  Artist,
  ArtistView,
  ArtworkView,
  AuditEvent,
  BuyerInquiryRow,
  BuyerInquiryStatus,
  CallPhase,
  CuratorStatus,
  DemoIdentity,
  Exhibition,
  Inquiry,
  InquiryStatus,
  Institution,
  KofiReport,
  LotRow,
  LotStatus,
  OpenCall,
  ParticipationRow,
  PaymentRow,
  PayoutRow,
  PayoutStatus,
  PlacementRow,
  ReportRange,
  ProgrammeBase,
  ProgrammeEvent,
  ProgrammeImage,
  Role,
  Shortlist,
  Story,
  Viewer,
  ArtistLink,
  ProfileImport,
  ProfileImportRecord,
  SignUpInput,
  SignUpResult,
} from '@/domain/types';
import { BUYER_INQUIRY_STATUSES } from '@/domain/types';
import { callPhase, kofiToday, sortExhibitions, validateBuyerInquiry, type BuyerInquiryInput } from '@/domain/programme';
import { validateRange } from '@/domain/reports';
import type { LotInput, SaleInput } from '@/domain/sales';
import { cleanArtworkV6, cleanEvent, cleanExhibition, cleanOpenCall, cleanStory, validateArtwork } from '../mock/MockDataSource';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type AdminArtistRow,
  type ApplicationInput,
  type ArtistPatch,
  type ArtworkInput,
  type CuratorRequestInput,
  type CuratorRow,
  type DataSource,
  type DocumentInput,
  type ExportResult,
  type InquiryRow,
  type ProgrammeInput,
} from '../DataSource';
import { DEMO_PASSWORD, SUPABASE_DEMO_IDENTITIES, demoEmailForUserUuid } from './demo';
import { mapPgError, SESSION_ENDED_MESSAGE, type PgErrorLike } from './errors';
import { blobToDataUrl, dataUrlToBlob, newUuid, parseDataUrl, UPLOADABLE_IMAGE_EXT } from './files';
import {
  artistPatchToRow,
  artworkInputToJson,
  DB_SCHEMA,
  eventToRow,
  exhibitionToRow,
  IMAGE_BUCKET,
  isUuid,
  lotInputToJson,
  normalizeImageSrc,
  normalizeProgrammeImageSrc,
  openCallToRow,
  PROGRAMME_BUCKET,
  PROGRAMME_PREFIX,
  programmePathOf,
  STORAGE_PREFIX,
  storagePathOf,
  storyToRow,
  toApplicationRow,
  toBuyerInquiryRow,
  toExhibition,
  toOpenCall,
  toProgrammeEvent,
  toStory,
  toArtist,
  toArtistView,
  toArtwork,
  toArtworkView,
  toAuditEvent,
  toCuratorRow,
  toDocument,
  toInquiry,
  toInquiryRow,
  toInstitution,
  toLotRow,
  toPayoutRow,
  toShortlist,
  VAULT_BUCKET,
  type ApplicationViewRow,
  type ArtistRow,
  type ArtistViewRow,
  type ArtworkRow,
  type ArtworkViewRow,
  type AuditRow,
  type BuyerInquiryViewRow,
  type CuratorRowDb,
  type DocumentRow,
  type EventRow,
  type ExhibitionRow,
  type OpenCallRow,
  type StoryRow,
  type InquiryViewRow,
  type InstitutionRow,
  type LotViewRow,
  type PayoutViewRow,
  type ShortlistRowDb,
} from './mapping';

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const IMAGE_URL_TTL_S = 3600;
const VAULT_URL_TTL_S = 60;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Tables whose changes the app reacts to (published in schema `kofi` by supabase/migrations/0006_realtime.sql and 0008_programme.sql). */
const REALTIME_TABLES = [
  'artists', 'artworks', 'artwork_images', 'curators', 'shortlists', 'shortlist_items', 'inquiries', 'documents',
  'exhibitions', 'open_calls', 'events', 'stories', 'applications', 'buyer_inquiries',
  'lots', 'payouts',
] as const;
const GONE = 'That item no longer exists.';

/** Programme tables, the view each is read through, and its folder in the kofi-programme bucket. */
const PROGRAMME = {
  exhibition: { table: 'exhibitions', view: 'exhibitions_visible', folder: 'exhibitions' },
  open_call: { table: 'open_calls', view: 'open_calls_visible', folder: 'open-calls' },
  event: { table: 'events', view: 'events_visible', folder: 'events' },
  story: { table: 'stories', view: 'stories_visible', folder: 'stories' },
} as const;
type ProgrammeKind = keyof typeof PROGRAMME;

/** Who the server says the caller is (kofi.whoami()). Never taken from the client's Viewer. */
interface Me {
  userId?: string;
  role: Role;
  displayName: string;
  artistId?: string;
  curatorId?: string;
  curatorVerified: boolean;
  /** A verified curator's institution (kofi.my_verified_institution_id()) — what makes them a call's partner. */
  institutionId?: string;
}
const PUBLIC_ME: Me = { role: 'public', displayName: 'Visitor', curatorVerified: false };

interface Ctx {
  db: SupabaseClient;
  me: Me;
}

interface Result<T> {
  data: T | null;
  error: PgErrorLike | null;
}

export interface SupabaseDataSourceOptions {
  /**
   * When the UI hands us a demo identity's Viewer but the Supabase session is a
   * different (or no) user, sign in as that demo user with the documented demo
   * password. Lets the existing identity switcher drive Supabase mode on a demo
   * project. Default: VITE_SUPABASE_DEMO_LOGIN === 'true'. Never enable on a
   * project with real users.
   */
  demoAutoSignIn?: boolean;
  /** Passed through to createClient (tests use this to disable session persistence). */
  clientOptions?: SupabaseClientOptions<'public'>;
  /**
   * Artist self sign-up (signUpArtist). Default: VITE_KOFI_SIGNUP, and 'off'
   * when that is not set. On a project shared with another product every
   * auth.signUp also fires that product's own auth.users trigger, so keep it
   * 'off' there until Kofi has its own project (docs/SUPABASE.md §11).
   */
  signUp?: 'on' | 'off';
  /**
   * Base of the public artist page, for the link-back check ("…/#/artists/<id>").
   * Default: VITE_KOFI_PUBLIC_URL, else the current page's origin + path.
   */
  publicAppUrl?: string;
}

/** Messages for the intake (kept here so the mock's wording can be matched in one place). */
export const SIGNUP_CLOSED_MESSAGE = 'Sign-up is not open on this demo yet. Ask Kofi for an invite.';
export const READER_OFFLINE_NOTE = "Kofi's reader is offline; we used your handle.";
export const CHECKER_OFFLINE_MESSAGE = "Kofi's link checker is offline right now. Your links keep their last result.";
const IMPORT_FUNCTION = 'profile-import';

/**
 * Every table, view and RPC lives in the `kofi` Postgres schema (see
 * supabase/migrations/0000_schema.sql), so the backend can share a Supabase
 * project with other products. Storage buckets are not schema-scoped.
 */
function kofi(db: SupabaseClient) {
  return db.schema(DB_SCHEMA);
}

const SCHEMA_ARTWORKS = 'artworks_visible';
const SCHEMA_ARTISTS = 'artists_visible';
const SCHEMA_INQUIRIES = 'inquiries_visible';
const SCHEMA_APPLICATIONS = 'applications_visible';
const SCHEMA_BUYER_INQUIRIES = 'buyer_inquiries_visible';

export class SupabaseDataSource implements DataSource {
  readonly mode = 'supabase' as const;
  /** Session-bearing client (the signed-in user). */
  readonly client: SupabaseClient;
  /** Session-less client used for the public visitor, so "Visitor" really is anon. */
  private readonly anonClient: SupabaseClient;
  private readonly demoAutoSignIn: boolean;
  private readonly signUpMode: 'on' | 'off';
  private readonly publicAppUrl: string | undefined;
  private listeners = new Set<() => void>();
  private channel: ReturnType<SupabaseClient['channel']> | undefined;
  private emitTimer: ReturnType<typeof setTimeout> | undefined;
  private meCache = new Map<string, Promise<Me>>();
  private signInFlight: Promise<void> | undefined;
  /** storage path → signed URL + expiry (ms) */
  private signedUrls = new Map<string, { url: string; exp: number }>();
  /** signed URL → 'storage:' ref, for round-tripping view images into saveArtwork */
  private urlToRef = new Map<string, string>();

  constructor(url: string, key: string, opts: SupabaseDataSourceOptions = {}) {
    this.client = createClient(url, key, opts.clientOptions);
    this.anonClient = createClient(url, key, {
      ...opts.clientOptions,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'kofi-anon' },
    });
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    this.demoAutoSignIn = opts.demoAutoSignIn ?? env?.VITE_SUPABASE_DEMO_LOGIN === 'true';
    this.signUpMode = opts.signUp ?? (env?.VITE_KOFI_SIGNUP?.trim().toLowerCase() === 'on' ? 'on' : 'off');
    this.publicAppUrl = opts.publicAppUrl ?? env?.VITE_KOFI_PUBLIC_URL ?? undefined;
    this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        this.meCache.clear();
        this.emit();
      }
    });
  }

  /* ------------------------------------------------------- infrastructure -- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.channel) this.startRealtime();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopRealtime();
    };
  }

  private startRealtime(): void {
    let ch = this.client.channel('db-changes');
    for (const table of REALTIME_TABLES) {
      ch = ch.on('postgres_changes', { event: '*', schema: DB_SCHEMA, table }, () => {
        this.meCache.clear();
        this.emit();
      });
    }
    this.channel = ch.subscribe();
  }

  private stopRealtime(): void {
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = undefined;
  }

  /** Debounced: a save touches several tables and realtime replays each. */
  private emit(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      for (const l of this.listeners) l();
    }, 60);
  }

  private async run<T>(p: PromiseLike<Result<T>>): Promise<T> {
    let res: Result<T>;
    try {
      res = await p;
    } catch (e) {
      throw mapPgError({ message: e instanceof Error ? e.message : String(e) });
    }
    if (res.error) throw mapPgError(res.error);
    return res.data as T;
  }

  private async rpc<T>(db: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
    return this.run<T>(kofi(db).rpc(fn, args) as unknown as PromiseLike<Result<T>>);
  }

  /**
   * Resolve the caller. The public visitor always uses the session-less client.
   * Any other Viewer must match the Supabase session; the server's whoami() —
   * not the Viewer object — decides role, artist/curator ids and verification.
   */
  private async ctx(viewer: Viewer): Promise<Ctx> {
    if (viewer.role === 'public' || !viewer.userId) return { db: this.anonClient, me: PUBLIC_ME };
    let session = (await this.client.auth.getSession()).data.session;
    if (!session || session.user.id !== viewer.userId) {
      const email = demoEmailForUserUuid(viewer.userId);
      if (this.demoAutoSignIn && email) {
        await this.signInWithPassword(email, DEMO_PASSWORD);
        session = (await this.client.auth.getSession()).data.session;
      }
      if (!session || session.user.id !== viewer.userId) throw new ForbiddenError(SESSION_ENDED_MESSAGE);
    }
    return { db: this.client, me: await this.whoami(session.user.id) };
  }

  private whoami(userId: string): Promise<Me> {
    const hit = this.meCache.get(userId);
    if (hit) return hit;
    const p = (async (): Promise<Me> => {
      const rows = await this.rpc<
        { user_id: string | null; role: Role; display_name: string; artist_id: string | null; curator_id: string | null; curator_verified: boolean }[]
      >(this.client, 'whoami');
      const r = rows[0];
      if (!r || !r.user_id) return PUBLIC_ME;
      const me: Me = { userId: r.user_id, role: r.role, displayName: r.display_name, curatorVerified: !!r.curator_verified };
      if (r.artist_id) me.artistId = r.artist_id;
      else if (r.role === 'artist') {
        // A Kofi sign-up has a profile but no artists row until its first sign-in (0010 ensure_my_artist).
        const id = await this.rpc<string | null>(this.client, 'ensure_my_artist').catch(() => null);
        if (id) me.artistId = id;
      }
      if (r.curator_id) me.curatorId = r.curator_id;
      if (me.role === 'curator' && me.curatorVerified) {
        const inst = await this.rpc<string | null>(this.client, 'my_verified_institution_id');
        if (inst) me.institutionId = inst;
      }
      return me;
    })();
    this.meCache.set(userId, p);
    p.catch(() => this.meCache.delete(userId));
    return p;
  }

  /** Signs the session-bearing client in. Serialized so parallel queries don't race. */
  async signInWithPassword(email: string, password: string): Promise<void> {
    if (this.signInFlight) return this.signInFlight;
    this.signInFlight = (async () => {
      const { error } = await this.client.auth.signInWithPassword({ email, password });
      this.meCache.clear();
      if (error) throw new ForbiddenError(`Could not sign in: ${error.message}`);
    })();
    try {
      await this.signInFlight;
    } finally {
      this.signInFlight = undefined;
    }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.meCache.clear();
  }

  /** The Viewer the server sees for the current session (for the shell after sign-in). */
  async currentViewer(): Promise<Viewer> {
    const session = (await this.client.auth.getSession()).data.session;
    if (!session) return { role: 'public', displayName: 'Visitor' };
    const me = await this.whoami(session.user.id);
    const v: Viewer = { role: me.role, userId: session.user.id, displayName: me.displayName };
    if (me.artistId) v.artistId = me.artistId;
    if (me.curatorId) {
      v.curatorId = me.curatorId;
      v.curatorVerified = me.curatorVerified;
    }
    return v;
  }

  private requireMyArtist(me: Me): string {
    if (me.role !== 'artist') throw new ForbiddenError('Sign in as an artist to do this.');
    if (!me.artistId) throw new NotFoundError('Artist profile not found.');
    return me.artistId;
  }

  private requireMyCurator(me: Me): string {
    if (me.role !== 'curator') throw new ForbiddenError('Sign in as a curator to do this.');
    if (!me.curatorId) throw new NotFoundError('Curator record not found.');
    return me.curatorId;
  }

  private requireAdmin(me: Me): void {
    if (me.role !== 'admin') throw new ForbiddenError('Kofi staff only.');
  }

  /** requireOrganiser(): a verified curator's institution (the server re-checks in every RPC / policy). */
  private requireOrganiser(me: Me): string {
    if (me.role === 'curator' && me.institutionId) return me.institutionId;
    throw new ForbiddenError(me.role === 'curator' ? 'Your institution has not been verified yet.' : 'You do not have access to this.');
  }

  /** requireCallManager() for a partner: the call must be one its institution runs. */
  private async requirePartnerCall(db: SupabaseClient, me: Me, callId: string): Promise<void> {
    const inst = this.requireOrganiser(me);
    const call = isUuid(callId)
      ? await this.run<{ organizer_institution_id: string | null } | null>(
          kofi(db).from(PROGRAMME.open_call.view).select('organizer_institution_id').eq('id', callId).maybeSingle(),
        )
      : null;
    if (!call || call.organizer_institution_id !== inst) throw new ForbiddenError('You can only manage calls your institution runs.');
  }

  private async access(db: SupabaseClient, kind: 'artwork' | 'document' | 'shortlist', id: string): Promise<'owner' | 'other' | 'not_found'> {
    if (!isUuid(id)) return 'not_found';
    return this.rpc<'owner' | 'other' | 'not_found'>(db, 'describe_access', { p_kind: kind, p_id: id });
  }

  /* ------------------------------------------------------------- images -- */

  /** Sign every 'storage:' image in the rows (batched, cached) and return a resolver. */
  private async imageResolver(db: SupabaseClient, rows: { images: { src: string }[] | null }[]): Promise<(src: string) => string> {
    const now = Date.now();
    const needed = new Set<string>();
    for (const r of rows) {
      for (const im of r.images ?? []) {
        const path = storagePathOf(im.src);
        if (!path) continue;
        const hit = this.signedUrls.get(path);
        if (!hit || hit.exp - 60_000 < now) needed.add(path);
      }
    }
    if (needed.size) {
      const paths = [...needed];
      const { data, error } = await db.storage.from(IMAGE_BUCKET).createSignedUrls(paths, IMAGE_URL_TTL_S);
      if (!error && data) {
        for (const item of data) {
          if (item.path && item.signedUrl && !item.error) {
            this.signedUrls.set(item.path, { url: item.signedUrl, exp: now + IMAGE_URL_TTL_S * 1000 });
            this.urlToRef.set(item.signedUrl, STORAGE_PREFIX + item.path);
          }
        }
      }
    }
    return (src: string) => {
      const path = storagePathOf(src);
      if (!path) return src;
      return this.signedUrls.get(path)?.url ?? src;
    };
  }

  private toRef(src: string): string {
    return this.urlToRef.get(src) ?? normalizeImageSrc(src);
  }

  private async projectArtworks(db: SupabaseClient, rows: ArtworkViewRow[]): Promise<ArtworkView[]> {
    const resolve = await this.imageResolver(db, rows);
    return rows.map((r) => toArtworkView(r, resolve));
  }

  private async fetchArtwork(db: SupabaseClient, id: string): Promise<ArtworkView | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.run<ArtworkViewRow | null>(kofi(db).from(SCHEMA_ARTWORKS).select('*').eq('id', id).maybeSingle());
    if (!row) return undefined;
    return (await this.projectArtworks(db, [row]))[0];
  }

  private async fetchArtist(db: SupabaseClient, id: string): Promise<ArtistView | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.run<ArtistViewRow | null>(kofi(db).from(SCHEMA_ARTISTS).select('*').eq('id', id).maybeSingle());
    return row ? toArtistView(row) : undefined;
  }

  private async removeObjects(db: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      await db.storage.from(bucket).remove(paths);
    } catch {
      /* best effort — an orphaned object is unreachable without a matching row */
    }
  }

  /* ----------------------------------------------------------- identities -- */

  async listDemoIdentities(): Promise<DemoIdentity[]> {
    return SUPABASE_DEMO_IDENTITIES;
  }

  /* ------------------------------------------------------------ discovery -- */

  async listArtworks(viewer: Viewer, filters: ArtworkFilters = {}): Promise<ArtworkView[]> {
    const { db, me } = await this.ctx(viewer);
    if (usesSearchRpc(filters)) {
      // v6 filters run in SQL (kofi.search_artworks, same rules as domain/filters.ts, over the
      // caller's own artworks_visible rows). The client re-sorts with sortArtworks so the order
      // is exactly mock mode's.
      const res = await this.rpc<SearchResult | null>(db, 'search_artworks', { p_filters: filters, p_limit: null, p_offset: 0 });
      return sortArtworks(await this.projectArtworks(db, res?.rows ?? []), filters.sort);
    }
    let q = kofi(db).from(SCHEMA_ARTWORKS).select('*').neq('visibility', 'private');
    if (filters.mediums?.length) q = q.in('medium', filters.mediums);
    const rows = await this.run<ArtworkViewRow[]>(q);
    // Discovery never includes drafts; Kofi-only records only for staff; only approved artists unless staff.
    const visible = rows.filter((r) => (r.visibility !== 'kofi' || me.role === 'admin') && (r.artist_status === 'approved' || me.role === 'admin'));
    return applyFilters(await this.projectArtworks(db, visible), filters);
  }

  async getArtwork(viewer: Viewer, id: string): Promise<ArtworkView | undefined> {
    const { db, me } = await this.ctx(viewer);
    const view = await this.fetchArtwork(db, id);
    if (view && me.role === 'admin' && view.visibility === 'private') {
      // Staff opening an artist's private record is logged (not emitted: it is a read).
      await this.rpc(db, 'log_audit', { p_action: 'private.view', p_entity_type: 'artwork', p_entity_id: id, p_meta: null });
    }
    return view;
  }

  async listArtists(viewer: Viewer): Promise<ArtistView[]> {
    const { db, me } = await this.ctx(viewer);
    const rows = await this.run<ArtistViewRow[]>(kofi(db).from(SCHEMA_ARTISTS).select('*'));
    return rows
      .filter((r) => r.status === 'approved' || me.role === 'admin')
      .map(toArtistView)
      .sort((x, y) => x.workingName.localeCompare(y.workingName));
  }

  async getArtist(viewer: Viewer, id: string): Promise<ArtistView | undefined> {
    const { db } = await this.ctx(viewer);
    return this.fetchArtist(db, id);
  }

  async listArtistArtworks(viewer: Viewer, artistId: string): Promise<ArtworkView[]> {
    const { db, me } = await this.ctx(viewer);
    if (!isUuid(artistId)) return [];
    const owner = me.role === 'admin' || (me.role === 'artist' && me.artistId === artistId);
    const rows = await this.run<ArtworkViewRow[]>(kofi(db).from(SCHEMA_ARTWORKS).select('*').eq('artist_id', artistId));
    const visible = rows.filter((r) => owner || (r.visibility !== 'private' && r.visibility !== 'kofi'));
    return (await this.projectArtworks(db, visible)).sort((x, y) => y.year - x.year || y.createdAt.localeCompare(x.createdAt));
  }

  /* ----------------------------------------------------- matching (v6) -- */

  /**
   * Organiser / Kofi: kofi.match_works (the server checks the caller runs the call and
   * returns their discovery rows). Artist: their own works except Only me ones, for a
   * call they can see. Ranking is domain/matching.rankWorks over effectiveCriteria(call),
   * the same code as mock mode, so wording and order never differ.
   */
  async listMatchingWorks(viewer: Viewer, callId: string): Promise<{ work: ArtworkView; match: MatchResult }[]> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'artist' && me.role !== 'admin' && me.role !== 'curator') throw new ForbiddenError('Only the call’s organiser can see which works fit.');
    if (me.role === 'artist' && !me.artistId) throw new NotFoundError('Artist profile not found.');
    const callRow = await this.fetchProgramme<OpenCallRow>(db, 'open_call', callId);
    let rows: ArtworkViewRow[];
    if (me.role === 'artist') {
      if (!callRow) throw new NotFoundError('Open call not found.');
      rows = await this.run<ArtworkViewRow[]>(kofi(db).from(SCHEMA_ARTWORKS).select('*').eq('artist_id', me.artistId!).neq('visibility', 'private'));
    } else {
      if (!isUuid(callId)) {
        if (me.role === 'admin') throw new NotFoundError('Open call not found.');
        this.requireOrganiser(me);
        throw new ForbiddenError('You can only manage calls your institution runs.');
      }
      rows = (await this.rpc<ArtworkViewRow[] | null>(db, 'match_works', { p_call: callId })) ?? [];
      if (!callRow) throw new NotFoundError('Open call not found.');
    }
    const works = await this.projectArtworks(db, rows);
    return rankWorks(works, effectiveCriteria(toOpenCall(callRow)));
  }

  /* ------------------------------------------------------- intake (v5) -- */

  /** Base URL of the public artist page (link-back check), or undefined on a non-web shell. */
  private publicBase(): string | undefined {
    const configured = this.publicAppUrl?.trim();
    if (configured) return configured.replace(/#.*$/, '');
    const loc = (globalThis as { location?: { origin?: string; pathname?: string } }).location;
    if (!loc?.origin || !/^https?:\/\//.test(loc.origin)) return undefined;
    return loc.origin + (loc.pathname ?? '/');
  }

  private profileUrlFor(artistId: string): string | undefined {
    const base = this.publicBase();
    return base ? `${base}#/artists/${artistId}` : undefined;
  }

  /** Calls the profile-import edge function; 'offline' when it is not deployed or cannot be reached. */
  private async invokeImport(
    db: SupabaseClient,
    body: Record<string, unknown>,
  ): Promise<{ kind: 'ok'; data: Record<string, unknown> } | { kind: 'offline' } | { kind: 'http'; status: number; error?: string; message?: string }> {
    try {
      const { data, error } = await db.functions.invoke(IMPORT_FUNCTION, { body });
      if (!error) return data && typeof data === 'object' ? { kind: 'ok', data: data as Record<string, unknown> } : { kind: 'offline' };
      if (error instanceof FunctionsHttpError) {
        const resp = error.context as Response | undefined;
        let payload: { error?: string; message?: string } = {};
        try {
          payload = ((await resp?.json()) ?? {}) as typeof payload;
        } catch {
          /* not our JSON */
        }
        const status = resp?.status ?? 500;
        // The platform's own 404 ("Requested function was not found") and any 5xx mean the reader is not there.
        if ((status === 404 && !payload.error) || status >= 500 || (status === 401 && !payload.error)) return { kind: 'offline' };
        const out: { kind: 'http'; status: number; error?: string; message?: string } = { kind: 'http', status };
        if (payload.error) out.error = payload.error;
        if (payload.message) out.message = payload.message;
        return out;
      }
      return { kind: 'offline' };
    } catch {
      return { kind: 'offline' };
    }
  }

  async signUpArtist(input: SignUpInput): Promise<SignUpResult> {
    if (this.signUpMode !== 'on') throw new ValidationError(SIGNUP_CLOSED_MESSAGE, 'email');
    const problem = validateSignUp(input);
    if (problem) throw new ValidationError(problem.message, problem.field);
    const email = input.email.trim().toLowerCase();
    const redirect = this.publicBase();
    let res: Awaited<ReturnType<SupabaseClient['auth']['signUp']>>;
    try {
      res = await this.client.auth.signUp({
        email,
        password: input.password,
        options: {
          // kofi.handle_new_user makes the kofi.profiles row (role artist); ensure_my_artist makes the
          // draft artist with the consent recorded from kofi_consent_version.
          data: { kofi_role: 'artist', display_name: input.displayName.trim(), kofi_consent_version: input.consentVersion },
          ...(redirect ? { emailRedirectTo: redirect } : {}),
        },
      });
    } catch (e) {
      throw mapPgError({ message: e instanceof Error ? e.message : String(e) });
    }
    if (res.error) throw signUpError(res.error);
    const { user, session } = res.data;
    // With email confirmation on, GoTrue answers an existing address with a user that has no identities.
    if (user && Array.isArray(user.identities) && user.identities.length === 0) throw new ConflictError();
    this.meCache.clear();
    if (!session) return { viewer: { role: 'public', displayName: 'Visitor' }, emailConfirmationRequired: true };
    await this.rpc(this.client, 'ensure_my_artist');
    this.meCache.clear();
    this.emit();
    return { viewer: await this.currentViewer(), emailConfirmationRequired: false };
  }

  async importProfile(viewer: Viewer, url: string): Promise<ProfileImport> {
    const { db, me } = await this.ctx(viewer);
    if (me.role === 'public') throw new ForbiddenError('Sign in to do this.');
    const n = normalizeLink(url);
    if (!n || !isFetchableUrl(n.url)) throw new ValidationError('That link cannot be read. Use a public http or https address.', 'url');
    const source: ArtistLink = { label: n.label, url: n.url, platform: n.platform, handle: n.handle, verification: 'claimed' };
    const handleOnly = (note: string, at = new Date().toISOString()): ProfileImport => {
      const imp = importFromSignals(source, {}, at);
      imp.notes = [note, ...imp.notes.filter((x) => !/comes from the handle/.test(x))];
      return imp;
    };
    const res = await this.invokeImport(db, { url: n.url });
    if (res.kind === 'offline') {
      if (me.role === 'artist' || me.role === 'admin') {
        await this.rpc(db, 'log_audit', {
          p_action: 'artist.import',
          p_entity_type: 'artist',
          p_entity_id: me.artistId ?? null,
          p_meta: { stage: 'read', url: n.url, platform: n.platform, reachable: false, reason: 'reader offline' },
        }).catch(() => undefined);
      }
      return handleOnly(READER_OFFLINE_NOTE);
    }
    if (res.kind === 'http') {
      if (res.status === 400) throw new ValidationError(res.message ?? 'That link cannot be read. Use a public http or https address.', 'url');
      if (res.status === 401) throw new ForbiddenError(SESSION_ENDED_MESSAGE);
      if (res.status === 429) return handleOnly(`${res.message ?? 'Kofi\'s reader is busy.'} We used your handle for now.`);
      return handleOnly(READER_OFFLINE_NOTE);
    }
    const fetchedAt = typeof res.data.fetchedAt === 'string' ? res.data.fetchedAt : new Date().toISOString();
    if (res.data.reachable !== true) {
      const reason = typeof res.data.reason === 'string' ? res.data.reason : 'We could not open that page.';
      return handleOnly(`${reason} We used your handle.`, fetchedAt);
    }
    return importFromSignals(source, (res.data.signals ?? {}) as PageSignals, fetchedAt);
  }

  async recordImport(viewer: Viewer, record: ProfileImportRecord): Promise<ArtistView> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireMyArtist(me);
    await this.rpc(db, 'record_import', { p_record: record });
    this.emit();
    const view = await this.fetchArtist(db, artistId);
    if (!view) throw new NotFoundError('Artist profile not found.');
    return view;
  }

  async checkMyLinks(viewer: Viewer, artistId?: string): Promise<ArtistLink[]> {
    const { db, me } = await this.ctx(viewer);
    let target: string;
    if (artistId && !(me.role === 'artist' && me.artistId === artistId)) {
      this.requireAdmin(me);
      if (!isUuid(artistId)) throw new NotFoundError('Artist not found.');
      target = artistId;
    } else {
      target = this.requireMyArtist(me);
    }
    const view = await this.fetchArtist(db, target);
    if (!view) throw new NotFoundError('Artist not found.');
    const profileUrl = this.profileUrlFor(target);
    for (const link of view.links) {
      const res = await this.invokeImport(db, {
        url: link.url,
        verify: true,
        ...(me.role === 'admin' ? { artistId: target } : {}),
        ...(profileUrl ? { profileUrl } : {}),
      });
      if (res.kind === 'offline') throw new Error(CHECKER_OFFLINE_MESSAGE);
      if (res.kind === 'http') {
        if (res.status === 404) continue; // the link was removed meanwhile
        if (res.status === 401) throw new ForbiddenError(SESSION_ENDED_MESSAGE);
        if (res.status === 403) throw new ForbiddenError(res.message ?? 'You do not have access to this.');
        throw new Error(res.message ?? CHECKER_OFFLINE_MESSAGE);
      }
    }
    this.emit();
    const after = await this.fetchArtist(db, target);
    return after?.links ?? [];
  }

  /* ------------------------------------------------- artist self-service -- */

  async getMyArtist(viewer: Viewer): Promise<ArtistView | undefined> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'artist' || !me.artistId) return undefined;
    return this.fetchArtist(db, me.artistId);
  }

  async updateMyArtist(viewer: Viewer, patch: ArtistPatch): Promise<ArtistView> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireMyArtist(me);
    if (patch.workingName !== undefined && !patch.workingName.trim()) throw new ValidationError('Working name is required.', 'workingName');
    if (patch.bio !== undefined && patch.bio.trim().length < 20) throw new ValidationError('Write at least a sentence for your bio.', 'bio');
    if (patch.mediums !== undefined && patch.mediums.length === 0) throw new ValidationError('Pick at least one medium.', 'mediums');
    if (patch.contact && !EMAIL_RE.test(patch.contact.email)) throw new ValidationError('Enter a valid email.', 'contact');
    for (const link of patch.links ?? []) {
      if (!/^https?:\/\//i.test(link.url)) throw new ValidationError(`Link "${link.label || link.url}" must start with http:// or https://`, 'links');
    }
    const row = artistPatchToRow(patch);
    if (Object.keys(row).length) await this.run(kofi(db).from('artists').update(row).eq('id', artistId));
    this.emit();
    const view = await this.fetchArtist(db, artistId);
    if (!view) throw new NotFoundError('Artist profile not found.');
    return view;
  }

  async acceptConsent(viewer: Viewer, version: string): Promise<ArtistView> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireMyArtist(me);
    await this.rpc(db, 'accept_consent', { p_version: version });
    this.emit();
    const view = await this.fetchArtist(db, artistId);
    if (!view) throw new NotFoundError('Artist profile not found.');
    return view;
  }

  async submitForReview(viewer: Viewer): Promise<ArtistView> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireMyArtist(me);
    await this.rpc(db, 'submit_for_review');
    this.emit();
    const view = await this.fetchArtist(db, artistId);
    if (!view) throw new NotFoundError('Artist profile not found.');
    return view;
  }

  async saveArtwork(viewer: Viewer, input: ArtworkInput): Promise<ArtworkView> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireMyArtist(me);
    const normalized: ArtworkInput = { ...input, images: input.images.map((im) => ({ ...im, src: this.toRef(im.src) })) };
    validateArtwork(normalized);
    // v6 fields: the mock's rules and messages before any network call (save_artwork and
    // the artworks_taxonomy trigger apply the same rules server-side).
    cleanArtworkV6(normalized);

    const existing = new Map<string, string>(); // image id → src currently stored
    if (input.id) {
      const access = await this.access(db, 'artwork', input.id);
      if (access === 'not_found') throw new NotFoundError('Artwork not found.');
      if (access !== 'owner') throw new ForbiddenError('You can only edit your own work.');
      const rows = await this.run<{ id: string; src: string }[]>(kofi(db).from('artwork_images').select('id, src').eq('artwork_id', input.id));
      for (const r of rows) existing.set(r.id, r.src);
    }

    const uploaded: string[] = [];
    const images: Record<string, unknown>[] = [];
    try {
      for (const im of normalized.images) {
        const id = existing.has(im.id) ? im.id : newUuid();
        let src = im.src;
        if (existing.get(id) !== src && src.startsWith('data:image/')) {
          const parsed = parseDataUrl(src);
          const ext = parsed ? UPLOADABLE_IMAGE_EXT[parsed.mime] : undefined;
          if (parsed && ext) {
            const path = `${artistId}/${id}.${ext}`;
            const { error } = await db.storage
              .from(IMAGE_BUCKET)
              .upload(path, new Blob([parsed.bytes], { type: parsed.mime }), { contentType: parsed.mime, upsert: true });
            if (error) throw mapPgError(error, 'Could not upload the image. Try again.');
            uploaded.push(path);
            src = STORAGE_PREFIX + path;
          }
          // Other data: images (e.g. the seeded SVG placeholders) stay inline.
        }
        images.push({ id, src, alt: im.alt, isPrimary: im.isPrimary, metadataStripped: im.metadataStripped });
      }
      const id = await this.rpc<string>(db, 'save_artwork', { p_artwork: artworkInputToJson(normalized), p_images: images });
      // Remove stored objects that are no longer referenced by this work.
      const kept = new Set(images.map((i) => String(i.src)));
      const stale = [...existing.values()].filter((src) => !kept.has(src)).map(storagePathOf).filter((p): p is string => !!p);
      await this.removeObjects(db, IMAGE_BUCKET, stale);
      this.emit();
      const view = await this.fetchArtwork(db, id);
      if (!view) throw new NotFoundError('Artwork not found.');
      return view;
    } catch (e) {
      await this.removeObjects(db, IMAGE_BUCKET, uploaded);
      throw e;
    }
  }

  async deleteArtwork(viewer: Viewer, id: string): Promise<void> {
    const { db, me } = await this.ctx(viewer);
    this.requireMyArtist(me);
    const access = await this.access(db, 'artwork', id);
    if (access === 'not_found') throw new NotFoundError('Artwork not found.');
    if (access !== 'owner') throw new ForbiddenError('You can only delete your own work.');
    const imgs = await this.run<{ src: string }[]>(kofi(db).from('artwork_images').select('src').eq('artwork_id', id));
    // Shortlist items cascade; vault documents are kept and detached (FK ON DELETE SET NULL).
    await this.run(kofi(db).from('artworks').delete().eq('id', id));
    await this.removeObjects(db, IMAGE_BUCKET, imgs.map((i) => storagePathOf(i.src)).filter((p): p is string => !!p));
    this.emit();
  }

  async listMyDocuments(viewer: Viewer, artworkId?: string): Promise<ArtDocument[]> {
    const { db, me } = await this.ctx(viewer);
    let q = kofi(db).from('documents').select('*');
    if (me.role === 'admin') {
      if (artworkId) {
        await this.rpc(db, 'log_audit', { p_action: 'private.view', p_entity_type: 'artwork', p_entity_id: artworkId, p_meta: { what: 'documents' } });
      }
    } else {
      q = q.eq('artist_id', this.requireMyArtist(me));
    }
    if (artworkId) {
      if (!isUuid(artworkId)) return [];
      q = q.eq('artwork_id', artworkId);
    }
    const rows = await this.run<DocumentRow[]>(q);
    return rows.map(toDocument).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async addDocument(viewer: Viewer, input: DocumentInput): Promise<ArtDocument> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireMyArtist(me);
    if (!input.title.trim()) throw new ValidationError('Give the document a title.', 'title');
    if (!input.payload.startsWith('data:')) throw new ValidationError('Unsupported file.', 'file');
    if (input.sizeBytes > MAX_DOC_BYTES) throw new ValidationError('Documents must be under 10 MB.', 'file');
    if (input.artworkId && (await this.access(db, 'artwork', input.artworkId)) !== 'owner') {
      throw new ForbiddenError('You can only attach documents to your own work.');
    }
    const blob = dataUrlToBlob(input.payload);
    if (!blob) throw new ValidationError('Unsupported file.', 'file');
    const id = newUuid();
    const path = `${artistId}/${id}`;
    const up = await db.storage.from(VAULT_BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (up.error) throw mapPgError(up.error, 'Could not upload the document. Try again.');
    try {
      const row = await this.run<DocumentRow>(
        kofi(db)
          .from('documents')
          .insert({
            id,
            artist_id: artistId,
            artwork_id: input.artworkId ?? null,
            type: input.type,
            title: input.title,
            custodian: input.custodian,
            date: input.date || null,
            file_ref: path,
            file_name: input.fileName,
            size_bytes: input.sizeBytes,
            visibility: input.visibility,
          })
          .select('*')
          .single(),
      );
      this.emit();
      return toDocument(row);
    } catch (e) {
      await this.removeObjects(db, VAULT_BUCKET, [path]);
      throw e;
    }
  }

  async removeDocument(viewer: Viewer, id: string): Promise<void> {
    const { db, me } = await this.ctx(viewer);
    this.requireMyArtist(me);
    const access = await this.access(db, 'document', id);
    if (access === 'not_found') throw new NotFoundError('Document not found.');
    if (access !== 'owner') throw new ForbiddenError('You can only remove your own documents.');
    const row = await this.run<{ file_ref: string } | null>(kofi(db).from('documents').select('file_ref').eq('id', id).maybeSingle());
    await this.run(kofi(db).from('documents').delete().eq('id', id));
    if (row?.file_ref) await this.removeObjects(db, VAULT_BUCKET, [row.file_ref]);
    this.emit();
  }

  /**
   * open_document() authorizes and writes the audit row first; only then can a
   * signed URL be created (the vault's admin read policy requires that row).
   * Returns the file as a data: URL, like the mock.
   */
  async openDocument(viewer: Viewer, id: string): Promise<string> {
    const { db, me } = await this.ctx(viewer);
    if (!isUuid(id)) throw new NotFoundError('Document not found.');
    if (me.role === 'public') throw new ForbiddenError('This document is private.');
    const path = await this.rpc<string>(db, 'open_document', { p_doc_id: id });
    const signed = await db.storage.from(VAULT_BUCKET).createSignedUrl(path, VAULT_URL_TTL_S);
    if (signed.error || !signed.data?.signedUrl) throw new NotFoundError('File is missing from the vault.');
    let res: Response;
    try {
      res = await fetch(signed.data.signedUrl);
    } catch (e) {
      throw mapPgError({ message: e instanceof Error ? e.message : String(e) });
    }
    if (!res.ok) throw new NotFoundError('File is missing from the vault.');
    return blobToDataUrl(await res.blob());
  }

  async exportMyData(viewer: Viewer): Promise<ExportResult> {
    const { db, me } = await this.ctx(viewer);
    this.requireMyArtist(me);
    const bundle = await this.rpc<{ artist: ArtistRow; artworks: ArtworkRow[]; documents: DocumentRow[] }>(db, 'export_my_data');
    const artist: Artist = toArtist(bundle.artist);
    // The artist owns their images: inline stored ones as data: URLs, like mock mode.
    const resolve = await this.imageResolver(db, bundle.artworks.map((w) => ({ images: w.images ?? [] })));
    const inlined = new Map<string, string>();
    await Promise.all(
      bundle.artworks.flatMap((w) =>
        (w.images ?? []).map(async (im) => {
          if (!storagePathOf(im.src) || inlined.has(im.src)) return;
          try {
            const r = await fetch(resolve(im.src));
            if (r.ok) inlined.set(im.src, await blobToDataUrl(await r.blob(), 'image/jpeg'));
          } catch {
            /* keep the storage reference */
          }
        }),
      ),
    );
    const works = bundle.artworks.map((w) => toArtwork(w, (src) => inlined.get(src) ?? src));
    const docs = bundle.documents.map(toDocument);
    const json = buildArtistExport(artist, works, docs, new Date());
    const slug = artist.workingName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return { json: JSON.stringify(json, null, 2), csv: artworksToCsv(works), fileBaseName: `kofi-export-${slug}` };
  }

  /* -------------------------------------------------------------- curator -- */

  private async fetchCurator(db: SupabaseClient, id: string): Promise<CuratorRow | undefined> {
    const row = await this.run<CuratorRowDb | null>(kofi(db).from('curators').select('*, institution:institutions(*)').eq('id', id).maybeSingle());
    return row ? toCuratorRow(row) : undefined;
  }

  async getMyCurator(viewer: Viewer): Promise<CuratorRow | undefined> {
    if (viewer.role !== 'curator' || !viewer.curatorId) return undefined;
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'curator' || !me.curatorId) return undefined;
    return this.fetchCurator(db, me.curatorId);
  }

  async requestVerification(viewer: Viewer, input: CuratorRequestInput): Promise<CuratorRow> {
    if (viewer.role !== 'curator' || !viewer.userId) throw new ForbiddenError('Sign in as a curator to request verification.');
    if (!input.name.trim()) throw new ValidationError('Your name is required.', 'name');
    if (!EMAIL_RE.test(input.workEmail)) throw new ValidationError('Use your institutional work email.', 'workEmail');
    if (!input.institution.name.trim()) throw new ValidationError('Institution name is required.', 'institution');
    if (input.purpose.trim().length < 20) throw new ValidationError('Tell Kofi what you are looking for (a sentence or two).', 'purpose');
    const { db } = await this.ctx(viewer);
    const id = await this.rpc<string>(db, 'request_verification', {
      p_name: input.name,
      p_title: input.title,
      p_work_email: input.workEmail,
      p_purpose: input.purpose,
      p_institution: input.institution,
    });
    this.meCache.clear();
    this.emit();
    const row = await this.fetchCurator(db, id);
    if (!row) throw new NotFoundError('Curator record not found.');
    return row;
  }

  private async fetchShortlist(db: SupabaseClient, id: string): Promise<Shortlist> {
    const row = await this.run<ShortlistRowDb | null>(kofi(db).from('shortlists').select('*, shortlist_items(*)').eq('id', id).maybeSingle());
    if (!row) throw new NotFoundError('Shortlist not found.');
    return toShortlist(row);
  }

  private async myShortlist(viewer: Viewer, id: string): Promise<Ctx> {
    const c = await this.ctx(viewer);
    this.requireMyCurator(c.me);
    const access = await this.access(c.db, 'shortlist', id);
    if (access === 'not_found') throw new NotFoundError('Shortlist not found.');
    if (access !== 'owner') throw new ForbiddenError('That shortlist belongs to someone else.');
    return c;
  }

  async listShortlists(viewer: Viewer): Promise<Shortlist[]> {
    const { db, me } = await this.ctx(viewer);
    const curatorId = this.requireMyCurator(me);
    const rows = await this.run<ShortlistRowDb[]>(
      kofi(db).from('shortlists').select('*, shortlist_items(*)').eq('curator_id', curatorId).order('updated_at', { ascending: false }),
    );
    return rows.map(toShortlist).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  }

  async createShortlist(viewer: Viewer, name: string): Promise<Shortlist> {
    const { db, me } = await this.ctx(viewer);
    const curatorId = this.requireMyCurator(me);
    if (!name.trim()) throw new ValidationError('Name the shortlist.', 'name');
    const row = await this.run<ShortlistRowDb>(kofi(db).from('shortlists').insert({ curator_id: curatorId, name: name.trim() }).select('*').single());
    this.emit();
    return toShortlist({ ...row, shortlist_items: [] });
  }

  async renameShortlist(viewer: Viewer, id: string, name: string): Promise<Shortlist> {
    const { db } = await this.myShortlist(viewer, id);
    if (!name.trim()) throw new ValidationError('Name the shortlist.', 'name');
    await this.run(kofi(db).from('shortlists').update({ name: name.trim() }).eq('id', id));
    this.emit();
    return this.fetchShortlist(db, id);
  }

  async deleteShortlist(viewer: Viewer, id: string): Promise<void> {
    const { db } = await this.myShortlist(viewer, id);
    await this.run(kofi(db).from('shortlists').delete().eq('id', id));
    this.emit();
  }

  async addToShortlist(viewer: Viewer, shortlistId: string, artworkId: string, note?: string): Promise<Shortlist> {
    const { db } = await this.myShortlist(viewer, shortlistId);
    const denied = new ForbiddenError('You can only shortlist work you are authorized to see.');
    const aw = isUuid(artworkId)
      ? await this.run<{ id: string; visibility: string } | null>(kofi(db).from(SCHEMA_ARTWORKS).select('id, visibility').eq('id', artworkId).maybeSingle())
      : null;
    if (!aw || aw.visibility === 'private' || aw.visibility === 'kofi') throw denied;
    const current = await this.fetchShortlist(db, shortlistId);
    if (current.items.some((i) => i.artworkId === artworkId)) return current;
    const item: Record<string, unknown> = { shortlist_id: shortlistId, artwork_id: artworkId };
    if (note?.trim()) item.note = note.trim();
    try {
      await this.run(kofi(db).from('shortlist_items').insert(item));
    } catch (e) {
      if (e instanceof ForbiddenError) throw denied;
      throw e;
    }
    this.emit();
    return this.fetchShortlist(db, shortlistId);
  }

  async removeFromShortlist(viewer: Viewer, shortlistId: string, artworkId: string): Promise<Shortlist> {
    const { db } = await this.myShortlist(viewer, shortlistId);
    if (isUuid(artworkId)) await this.run(kofi(db).from('shortlist_items').delete().eq('shortlist_id', shortlistId).eq('artwork_id', artworkId));
    this.emit();
    return this.fetchShortlist(db, shortlistId);
  }

  async createInquiry(viewer: Viewer, input: { artistId: string; artworkId?: string; message: string }): Promise<Inquiry> {
    const { db, me } = await this.ctx(viewer);
    const curatorId = this.requireMyCurator(me);
    if (!me.curatorVerified) throw new ForbiddenError('Your institution has not been verified yet.');
    const artist = isUuid(input.artistId)
      ? await this.run<{ id: string; status: string; visibility: string } | null>(
          kofi(db).from(SCHEMA_ARTISTS).select('id, status, visibility').eq('id', input.artistId).maybeSingle(),
        )
      : null;
    if (!artist || artist.status !== 'approved' || artist.visibility !== 'public') throw new NotFoundError('Artist not found.');
    if (input.message.trim().length < 20) throw new ValidationError('Write a short message explaining the opportunity.', 'message');
    const denied = new ForbiddenError('You can only ask about work you are authorized to see.');
    if (input.artworkId) {
      const aw = isUuid(input.artworkId)
        ? await this.run<{ artist_id: string; visibility: string } | null>(
            kofi(db).from(SCHEMA_ARTWORKS).select('artist_id, visibility').eq('id', input.artworkId).maybeSingle(),
          )
        : null;
      if (!aw || aw.artist_id !== artist.id || aw.visibility !== 'public') throw denied;
    }
    const insert: Record<string, unknown> = { curator_id: curatorId, artist_id: artist.id, message: input.message.trim() };
    if (input.artworkId) insert.artwork_id = input.artworkId;
    let row: InquiryViewRow;
    try {
      row = await this.run<InquiryViewRow>(kofi(db).from('inquiries').insert(insert).select('*').single());
    } catch (e) {
      if (e instanceof ForbiddenError && input.artworkId) throw denied;
      throw e;
    }
    this.emit();
    return toInquiry(row);
  }

  async listInquiries(viewer: Viewer): Promise<InquiryRow[]> {
    const { db, me } = await this.ctx(viewer);
    let q = kofi(db).from(SCHEMA_INQUIRIES).select('*');
    if (me.role === 'admin') {
      /* all */
    } else if (me.role === 'curator') {
      q = q.eq('curator_id', this.requireMyCurator(me));
    } else if (me.role === 'artist') {
      // Artists only see inquiries Kofi has forwarded — pending ones are still in review (RLS enforces this too).
      q = q.eq('artist_id', this.requireMyArtist(me)).neq('status', 'pending');
    } else throw new ForbiddenError();
    const rows = await this.run<InquiryViewRow[]>(q);
    return rows.map(toInquiryRow).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async setInquiryStatus(viewer: Viewer, id: string, status: InquiryStatus, note?: string): Promise<InquiryRow> {
    if (!isUuid(id)) throw new NotFoundError('Inquiry not found.');
    const { db, me } = await this.ctx(viewer);
    if (me.role === 'artist') this.requireMyArtist(me);
    else if (me.role !== 'admin') throw new ForbiddenError();
    await this.rpc(db, 'set_inquiry_status', { p_inquiry_id: id, p_status: status, p_note: note ?? null });
    this.emit();
    const row = await this.run<InquiryViewRow | null>(kofi(db).from(SCHEMA_INQUIRIES).select('*').eq('id', id).maybeSingle());
    if (!row) throw new NotFoundError('Inquiry not found.');
    return toInquiryRow(row);
  }

  /* ----------------------------------------------------------------- admin -- */

  async listAllArtists(viewer: Viewer): Promise<AdminArtistRow[]> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    const [rows, works] = await Promise.all([
      this.run<ArtistViewRow[]>(kofi(db).from(SCHEMA_ARTISTS).select('*')),
      this.run<{ artist_id: string }[]>(kofi(db).from('artworks').select('artist_id')),
    ]);
    const counts = new Map<string, number>();
    for (const w of works) counts.set(w.artist_id, (counts.get(w.artist_id) ?? 0) + 1);
    return rows
      .map((r) => ({ ...toArtistView(r), artworkCount: counts.get(r.id) ?? 0 }))
      .sort((x, y) => statusRank(x.status) - statusRank(y.status) || x.workingName.localeCompare(y.workingName));
  }

  async setArtistStatus(viewer: Viewer, artistId: string, status: Artist['status'], note?: string): Promise<ArtistView> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(artistId)) throw new NotFoundError('Artist not found.');
    await this.rpc(db, 'set_artist_status', { p_artist_id: artistId, p_status: status, p_note: note ?? null });
    this.emit();
    const view = await this.fetchArtist(db, artistId);
    if (!view) throw new NotFoundError('Artist not found.');
    return view;
  }

  async setKofiNotes(viewer: Viewer, artistId: string, notes: string): Promise<ArtistView> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(artistId)) throw new NotFoundError('Artist not found.');
    await this.rpc(db, 'set_kofi_notes', { p_artist_id: artistId, p_notes: notes });
    this.emit();
    const view = await this.fetchArtist(db, artistId);
    if (!view) throw new NotFoundError('Artist not found.');
    return view;
  }

  async markArtworkReviewed(viewer: Viewer, artworkId: string): Promise<ArtworkView> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(artworkId)) throw new NotFoundError('Artwork not found.');
    await this.rpc(db, 'mark_artwork_reviewed', { p_artwork_id: artworkId });
    this.emit();
    const view = await this.fetchArtwork(db, artworkId);
    if (!view) throw new NotFoundError('Artwork not found.');
    return view;
  }

  async listCurators(viewer: Viewer): Promise<CuratorRow[]> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    const rows = await this.run<CuratorRowDb[]>(kofi(db).from('curators').select('*, institution:institutions(*)'));
    return rows
      .map(toCuratorRow)
      .filter((c): c is CuratorRow => !!c)
      .sort((x, y) => curatorRank(x.status) - curatorRank(y.status) || y.createdAt.localeCompare(x.createdAt));
  }

  async setCuratorStatus(viewer: Viewer, curatorId: string, status: CuratorStatus, note?: string): Promise<CuratorRow> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(curatorId)) throw new NotFoundError('Curator not found.');
    await this.rpc(db, 'set_curator_status', { p_curator_id: curatorId, p_status: status, p_note: note ?? null });
    this.meCache.clear();
    this.emit();
    const row = await this.fetchCurator(db, curatorId);
    if (!row) throw new NotFoundError('Curator not found.');
    return row;
  }

  async listAudit(viewer: Viewer, limit = 200): Promise<AuditEvent[]> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    const rows = await this.run<AuditRow[]>(kofi(db).from('audit_events').select('*').order('at', { ascending: false }).limit(limit));
    return rows.map(toAuditEvent);
  }

  async listInstitutions(viewer: Viewer): Promise<Institution[]> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin' && me.role !== 'curator') throw new ForbiddenError();
    const rows = await this.run<InstitutionRow[]>(kofi(db).from('institutions').select('*').order('created_at', { ascending: true }));
    return rows.map(toInstitution);
  }

  /* ------------------------------------------------------------ programme -- */
  /*
   * Reads come from the kofi.*_visible views: RLS returns published items (or
   * drafts for Kofi admins) and the views have already dropped works, artists
   * and exhibitions the caller may not see. Writes are admin-only table writes
   * (RLS); input is validated with the same clean*() functions as mock mode,
   * and the database re-checks with CHECK constraints / triggers. Images:
   * data:image/ uploads go to the public kofi-programme bucket and are stored
   * as 'storage:kofi-programme/<path>'; reads return the public URL.
   */

  private programmeImageResolver(db: SupabaseClient): (src: string) => string {
    return (src: string) => {
      const path = programmePathOf(src);
      if (!path) return src;
      return db.storage.from(PROGRAMME_BUCKET).getPublicUrl(path).data.publicUrl;
    };
  }

  /**
   * Normalise an incoming programme image to a storage ref: a public programme-bucket
   * URL (from a read) → 'storage:kofi-programme/…'; a signed artwork-images URL (an
   * admin picked a work's image) → 'storage:artwork-images/…', which the save step
   * then copies into the programme bucket (the database only accepts programme refs).
   */
  private programmeInputImage(image: ProgrammeImage | undefined): ProgrammeImage | undefined {
    if (!image || typeof image.src !== 'string') return image;
    const programme = normalizeProgrammeImageSrc(image.src);
    if (programme !== image.src) return { ...image, src: programme };
    return { ...image, src: this.toRef(image.src) };
  }

  /** Uploads a data:image/ (JPEG/PNG/WebP) to the programme bucket; other sources are kept as they are. */
  private async uploadProgrammeImage(db: SupabaseClient, kind: ProgrammeKind, image: ProgrammeImage | undefined): Promise<{ image?: ProgrammeImage; uploaded?: string }> {
    const artPath = image ? storagePathOf(image.src) : undefined;
    if (image && artPath) {
      // A work's image chosen as the programme image: copy it into the public programme bucket,
      // as mock mode does (it copies the image data). Admins may read every artwork image.
      const { data, error } = await db.storage.from(IMAGE_BUCKET).download(artPath);
      if (error || !data) throw new ValidationError('Could not copy that work’s image. Upload the image instead.', 'image');
      const mime = data.type && UPLOADABLE_IMAGE_EXT[data.type] ? data.type : 'image/jpeg';
      const path = `${PROGRAMME[kind].folder}/${newUuid()}.${UPLOADABLE_IMAGE_EXT[mime] ?? 'jpg'}`;
      const up = await db.storage.from(PROGRAMME_BUCKET).upload(path, data, { contentType: mime, upsert: false });
      if (up.error) throw mapPgError(up.error, 'Could not upload the image. Try again.');
      return { image: { ...image, src: PROGRAMME_PREFIX + path }, uploaded: path };
    }
    if (!image || !image.src.startsWith('data:image/')) return image ? { image } : {};
    const parsed = parseDataUrl(image.src);
    const ext = parsed ? UPLOADABLE_IMAGE_EXT[parsed.mime] : undefined;
    if (!parsed || !ext) return { image }; // e.g. an inline SVG: stored inline, like the seeded placeholders
    const path = `${PROGRAMME[kind].folder}/${newUuid()}.${ext}`;
    const { error } = await db.storage
      .from(PROGRAMME_BUCKET)
      .upload(path, new Blob([parsed.bytes], { type: parsed.mime }), { contentType: parsed.mime, upsert: false });
    if (error) throw mapPgError(error, 'Could not upload the image. Try again.');
    return { image: { ...image, src: PROGRAMME_PREFIX + path }, uploaded: path };
  }

  private refIdsOrThrow(clean: { artworkIds?: string[]; exhibitionId?: string; artistId?: string; organizerInstitutionId?: string }): void {
    if (clean.organizerInstitutionId && !isUuid(clean.organizerInstitutionId)) throw new ValidationError('That institution no longer exists.', 'organizerInstitutionId');
    // Ids that are not even UUIDs cannot exist here (same messages as the mock's checkProgrammeRefs()).
    if ((clean.artworkIds ?? []).some((id) => !isUuid(id))) throw new ValidationError('One of the attached works no longer exists.', 'artworkIds');
    if (clean.exhibitionId && !isUuid(clean.exhibitionId)) throw new ValidationError('That exhibition no longer exists.', 'exhibitionId');
    if (clean.artistId && !isUuid(clean.artistId)) throw new ValidationError('That artist no longer exists.', 'artistId');
  }

  /**
   * Create (no id) or update (id) one programme row as a Kofi admin. Every
   * authored column is written, so cleared optional fields are cleared. The
   * audit row (programme.save) is written by the table trigger.
   */
  private async saveProgrammeRow<T extends ProgrammeBase & { image?: ProgrammeImage }>(
    viewer: Viewer,
    kind: ProgrammeKind,
    input: ProgrammeInput<T>,
    clean: (input: ProgrammeInput<T>) => Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    toRow: (clean: Omit<T, 'id' | 'createdAt' | 'updatedAt'>) => Record<string, unknown>,
  ): Promise<{ db: SupabaseClient; id: string }> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    const prepared = { ...input, image: this.programmeInputImage(input.image) } as ProgrammeInput<T>;
    const cleaned = clean(prepared);
    this.refIdsOrThrow(cleaned as { artworkIds?: string[]; exhibitionId?: string; artistId?: string });
    return { db, id: await this.writeProgrammeRow<T>(db, kind, input.id, cleaned, toRow) };
  }

  /** Insert / update one validated programme row (RLS decides who may), uploading its image first. */
  private async writeProgrammeRow<T extends ProgrammeBase & { image?: ProgrammeImage }>(
    db: SupabaseClient,
    kind: ProgrammeKind,
    inputId: string | undefined,
    cleaned: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    toRow: (clean: Omit<T, 'id' | 'createdAt' | 'updatedAt'>) => Record<string, unknown>,
  ): Promise<string> {
    const input = { id: inputId };
    const { table } = PROGRAMME[kind];

    let previousImage: string | undefined;
    if (input.id) {
      if (!isUuid(input.id)) throw new NotFoundError(GONE);
      // Events have no image column.
      const prev = await this.run<{ id: string; image?: { src?: string } | null } | null>(
        kofi(db).from(table).select(kind === 'event' ? 'id' : 'id, image').eq('id', input.id).maybeSingle(),
      );
      if (!prev) throw new NotFoundError(GONE);
      previousImage = prev.image?.src;
    }

    const { image, uploaded } = await this.uploadProgrammeImage(db, kind, cleaned.image);
    const row = toRow({ ...cleaned, image } as Omit<T, 'id' | 'createdAt' | 'updatedAt'>);
    let id: string;
    try {
      if (input.id) {
        const rows = await this.run<{ id: string }[]>(kofi(db).from(table).update(row).eq('id', input.id).select('id'));
        if (!rows.length) throw new NotFoundError(GONE);
        id = input.id;
      } else {
        id = (await this.run<{ id: string }>(kofi(db).from(table).insert(row).select('id').single())).id;
      }
    } catch (e) {
      if (uploaded) await this.removeObjects(db, PROGRAMME_BUCKET, [uploaded]);
      throw e;
    }
    const oldPath = previousImage ? programmePathOf(previousImage) : undefined;
    if (oldPath && previousImage !== image?.src) await this.removeObjects(db, PROGRAMME_BUCKET, [oldPath]);
    this.emit();
    return id;
  }

  private async deleteProgrammeRow(viewer: Viewer, kind: ProgrammeKind, id: string): Promise<void> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(id)) throw new NotFoundError(GONE);
    const { table } = PROGRAMME[kind];
    const rows = await this.run<{ id: string; image?: { src?: string } | null }[]>(
      kofi(db).from(table).delete().eq('id', id).select(kind === 'event' ? 'id' : 'id, image'),
    );
    if (!rows.length) throw new NotFoundError(GONE);
    const path = rows[0]?.image?.src ? programmePathOf(rows[0].image.src) : undefined;
    if (path) await this.removeObjects(db, PROGRAMME_BUCKET, [path]);
    this.emit();
  }

  private async fetchProgramme<R>(db: SupabaseClient, kind: ProgrammeKind, id: string): Promise<R | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.run<R | null>(kofi(db).from(PROGRAMME[kind].view).select('*').eq('id', id).maybeSingle());
    return row ?? undefined;
  }

  /* ---- exhibitions ---- */

  async listExhibitions(viewer: Viewer): Promise<Exhibition[]> {
    const { db } = await this.ctx(viewer);
    const rows = await this.run<ExhibitionRow[]>(kofi(db).from(PROGRAMME.exhibition.view).select('*'));
    const resolve = this.programmeImageResolver(db);
    return sortExhibitions(rows.map((r) => toExhibition(r, resolve)), kofiToday());
  }

  async getExhibition(viewer: Viewer, id: string): Promise<Exhibition | undefined> {
    const { db } = await this.ctx(viewer);
    const row = await this.fetchProgramme<ExhibitionRow>(db, 'exhibition', id);
    return row ? toExhibition(row, this.programmeImageResolver(db)) : undefined;
  }

  async saveExhibition(viewer: Viewer, input: ProgrammeInput<Exhibition>): Promise<Exhibition> {
    const { db, id } = await this.saveProgrammeRow<Exhibition>(viewer, 'exhibition', input, cleanExhibition, exhibitionToRow);
    const row = await this.fetchProgramme<ExhibitionRow>(db, 'exhibition', id);
    if (!row) throw new NotFoundError(GONE);
    return toExhibition(row, this.programmeImageResolver(db));
  }

  async deleteExhibition(viewer: Viewer, id: string): Promise<void> {
    // Calls and events that pointed at it stay, unlinked (ON DELETE SET NULL).
    await this.deleteProgrammeRow(viewer, 'exhibition', id);
  }

  /* ---- open calls ---- */

  async listOpenCalls(viewer: Viewer): Promise<OpenCall[]> {
    const { db } = await this.ctx(viewer);
    const rows = await this.run<OpenCallRow[]>(kofi(db).from(PROGRAMME.open_call.view).select('*'));
    const resolve = this.programmeImageResolver(db);
    return sortOpenCalls(rows.map((r) => toOpenCall(r, resolve)), kofiToday());
  }

  async getOpenCall(viewer: Viewer, id: string): Promise<OpenCall | undefined> {
    const { db } = await this.ctx(viewer);
    const row = await this.fetchProgramme<OpenCallRow>(db, 'open_call', id);
    return row ? toOpenCall(row, this.programmeImageResolver(db)) : undefined;
  }

  /**
   * Admin: any call (kind / terms validated by cleanOpenCall; the server freezes terms once a
   * lot has sold and keeps a call with lots an auction). Partner: a draft for its own
   * institution, edited only while Kofi has not published it; published / sample / organiser
   * are never theirs to set (kofi.open_calls_sales_guard re-enforces all of it).
   */
  async saveOpenCall(viewer: Viewer, input: ProgrammeInput<OpenCall>): Promise<OpenCall> {
    const { db, me } = await this.ctx(viewer);
    let existing: OpenCall | undefined;
    if (input.id) {
      const row = await this.fetchProgramme<OpenCallRow>(db, 'open_call', input.id);
      if (!row) throw new NotFoundError(GONE);
      existing = toOpenCall(row);
    }
    const prepared = { ...input, image: this.programmeInputImage(input.image) } as ProgrammeInput<OpenCall>;
    let cleaned: Omit<OpenCall, 'id' | 'createdAt' | 'updatedAt'>;
    if (me.role === 'admin') {
      cleaned = cleanOpenCall(prepared, existing?.kind);
      if (cleaned.organizerInstitutionId && !isUuid(cleaned.organizerInstitutionId)) {
        throw new ValidationError('That institution no longer exists.', 'organizerInstitutionId');
      }
    } else {
      const inst = me.role === 'curator' ? me.institutionId : undefined;
      if (!inst) throw new ForbiddenError(me.role === 'curator' ? 'Your institution has not been verified yet.' : 'Kofi staff only.');
      if (existing) {
        if (existing.organizerInstitutionId !== inst) throw new ForbiddenError('You can only edit calls your institution runs.');
        if (existing.published) throw new ForbiddenError('Kofi has published this call. Ask Kofi to make changes.');
      }
      cleaned = cleanOpenCall({ ...prepared, organizerInstitutionId: inst }, existing?.kind);
      cleaned.published = existing?.published ?? false;
      cleaned.sample = existing?.sample ?? false;
    }
    this.refIdsOrThrow(cleaned);
    // lookingFor: key present (even undefined) → written (undefined/empty → NULL); key absent on
    // an update → the column is left as stored (an older editor never wipes the criteria).
    const sendsCriteria = Object.prototype.hasOwnProperty.call(input, 'lookingFor');
    const toRow = (c: Omit<OpenCall, 'id' | 'createdAt' | 'updatedAt'>) => {
      const row = openCallToRow(c);
      if (input.id && !sendsCriteria) delete row.looking_for;
      return row;
    };
    const id = await this.writeProgrammeRow<OpenCall>(db, 'open_call', input.id, cleaned, toRow);
    const row = await this.fetchProgramme<OpenCallRow>(db, 'open_call', id);
    if (!row) throw new NotFoundError(GONE);
    return toOpenCall(row, this.programmeImageResolver(db));
  }

  /** Calls this viewer runs: a partner's own (drafts included); admin: every call with an organiser. */
  async listMyCalls(viewer: Viewer): Promise<OpenCall[]> {
    const { db, me } = await this.ctx(viewer);
    let q = kofi(db).from(PROGRAMME.open_call.view).select('*');
    if (me.role === 'admin') q = q.not('organizer_institution_id', 'is', null);
    else q = q.eq('organizer_institution_id', this.requireOrganiser(me));
    const rows = await this.run<OpenCallRow[]>(q);
    const resolve = this.programmeImageResolver(db);
    return rows.map((r) => toOpenCall(r, resolve)).sort((a, b) => b.opensOn.localeCompare(a.opensOn) || a.title.localeCompare(b.title));
  }

  /** A call with applications cannot be deleted: the server answers "This call has applications. Unpublish it instead." */
  async deleteOpenCall(viewer: Viewer, id: string): Promise<void> {
    await this.deleteProgrammeRow(viewer, 'open_call', id);
  }

  /* ---- events ---- */

  async listEvents(viewer: Viewer): Promise<ProgrammeEvent[]> {
    const { db } = await this.ctx(viewer);
    const rows = await this.run<EventRow[]>(kofi(db).from(PROGRAMME.event.view).select('*'));
    return rows.map(toProgrammeEvent).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title));
  }

  async saveEvent(viewer: Viewer, input: ProgrammeInput<ProgrammeEvent>): Promise<ProgrammeEvent> {
    const { db, id } = await this.saveProgrammeRow<ProgrammeEvent>(viewer, 'event', input, cleanEvent, eventToRow);
    const row = await this.fetchProgramme<EventRow>(db, 'event', id);
    if (!row) throw new NotFoundError(GONE);
    return toProgrammeEvent(row);
  }

  async deleteEvent(viewer: Viewer, id: string): Promise<void> {
    await this.deleteProgrammeRow(viewer, 'event', id);
  }

  /* ---- journal ---- */

  async listStories(viewer: Viewer): Promise<Story[]> {
    const { db } = await this.ctx(viewer);
    const rows = await this.run<StoryRow[]>(kofi(db).from(PROGRAMME.story.view).select('*'));
    const resolve = this.programmeImageResolver(db);
    return rows
      .map((r) => toStory(r, resolve))
      .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || b.createdAt.localeCompare(a.createdAt));
  }

  async getStory(viewer: Viewer, id: string): Promise<Story | undefined> {
    const { db } = await this.ctx(viewer);
    const row = await this.fetchProgramme<StoryRow>(db, 'story', id);
    return row ? toStory(row, this.programmeImageResolver(db)) : undefined;
  }

  async saveStory(viewer: Viewer, input: ProgrammeInput<Story>): Promise<Story> {
    const { db, id } = await this.saveProgrammeRow<Story>(viewer, 'story', input, cleanStory, storyToRow);
    const row = await this.fetchProgramme<StoryRow>(db, 'story', id);
    if (!row) throw new NotFoundError(GONE);
    return toStory(row, this.programmeImageResolver(db));
  }

  async deleteStory(viewer: Viewer, id: string): Promise<void> {
    await this.deleteProgrammeRow(viewer, 'story', id);
  }

  /* --------------------------------------------------------- applications -- */

  /** Artists only — curators, visitors and admins acting as themselves are refused (as in mock mode). */
  private requireApplicant(me: Me): string {
    if (me.role !== 'artist') throw new ForbiddenError('Sign in as an artist to apply.');
    if (!me.artistId) throw new NotFoundError('Artist profile not found.');
    return me.artistId;
  }

  /**
   * The works attached to applications to a partner's calls, as a reviewer sees them
   * (kofi.call_application_works: applying is consent — any work but an Only me one;
   * the price still follows its own visibility).
   */
  private async reviewerWorks(db: SupabaseClient, callId?: string): Promise<ArtworkView[]> {
    const rows = await this.rpc<ArtworkViewRow[]>(db, 'call_application_works', { p_call: callId ?? null });
    return this.projectArtworks(db, rows ?? []);
  }

  /** Works by id as this viewer may see them: a partner as reviewer, everyone else through artworks_visible. */
  private async worksFor(db: SupabaseClient, me: Me | undefined, ids: string[], callId?: string): Promise<Map<string, ArtworkView>> {
    const wanted = [...new Set(ids)].filter(isUuid);
    if (!wanted.length) return new Map();
    const works =
      me?.role === 'curator'
        ? (await this.reviewerWorks(db, callId)).filter((w) => wanted.includes(w.id))
        : await this.projectArtworks(db, await this.run<ArtworkViewRow[]>(kofi(db).from(SCHEMA_ARTWORKS).select('*').in('id', wanted)));
    return new Map(works.map((w) => [w.id, w]));
  }

  /** Attach the works each application lists, as this viewer may see them (artist: own; reviewer: attached; admin: all). */
  private async applicationRows(db: SupabaseClient, rows: ApplicationViewRow[], me?: Me, callId?: string): Promise<ApplicationRow[]> {
    const byId = await this.worksFor(db, me, rows.flatMap((r) => r.artwork_ids ?? []), callId);
    return rows
      .map((r) => toApplicationRow(r, (r.artwork_ids ?? []).map((id) => byId.get(id)).filter((w): w is ArtworkView => !!w)))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  private async fetchApplication(db: SupabaseClient, id: string, me?: Me): Promise<ApplicationRow> {
    const row = await this.run<ApplicationViewRow | null>(kofi(db).from(SCHEMA_APPLICATIONS).select('*').eq('id', id).maybeSingle());
    if (!row) throw new NotFoundError('Application not found.');
    return (await this.applicationRows(db, [row], me, row.call_id))[0]!;
  }

  async listMyApplications(viewer: Viewer): Promise<ApplicationRow[]> {
    const { db, me } = await this.ctx(viewer);
    const artistId = this.requireApplicant(me);
    const rows = await this.run<ApplicationViewRow[]>(kofi(db).from(SCHEMA_APPLICATIONS).select('*').eq('artist_id', artistId));
    return this.applicationRows(db, rows);
  }

  /** kofi.submit_application() re-runs validateApplication() server-side with the same messages and fields. */
  async submitApplication(viewer: Viewer, input: ApplicationInput): Promise<ApplicationRow> {
    const { db, me } = await this.ctx(viewer);
    this.requireApplicant(me);
    if (!isUuid(input.callId)) throw new NotFoundError('Open call not found.');
    const requested = Array.isArray(input.artworkIds) ? input.artworkIds.map(String) : [];
    if (requested.some((id) => !isUuid(id))) throw new ValidationError('You can only attach your own works.', 'artworkIds');
    const id = await this.rpc<string>(db, 'submit_application', {
      p_call: input.callId,
      p_artwork_ids: requested,
      p_statement: typeof input.statement === 'string' ? input.statement : '',
    });
    this.emit();
    return this.fetchApplication(db, id);
  }

  async withdrawApplication(viewer: Viewer, id: string): Promise<ApplicationRow> {
    const { db, me } = await this.ctx(viewer);
    this.requireApplicant(me);
    if (!isUuid(id)) throw new NotFoundError('Application not found.');
    await this.rpc(db, 'withdraw_application', { p_id: id });
    this.emit();
    return this.fetchApplication(db, id);
  }

  /** Admin: all (optionally one call). Partner: applications to calls its institution runs only (RLS). */
  async listApplications(viewer: Viewer, callId?: string): Promise<ApplicationRow[]> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') {
      this.requireOrganiser(me);
      if (callId) await this.requirePartnerCall(db, me, callId);
    }
    let q = kofi(db).from(SCHEMA_APPLICATIONS).select('*');
    if (callId !== undefined && callId !== '') {
      if (!isUuid(callId)) return [];
      q = q.eq('call_id', callId);
    }
    return this.applicationRows(db, await this.run<ApplicationViewRow[]>(q), me, callId || undefined);
  }

  /** Moves allowed by canMoveApplication(); notes: undefined keeps, '' clears. Checked again by kofi.set_application_status(). */
  async setApplicationStatus(
    viewer: Viewer,
    id: string,
    status: ApplicationStatus,
    notes: { decisionNote?: string; staffNote?: string } = {},
  ): Promise<ApplicationRow> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') this.requireOrganiser(me);
    if (!isUuid(id)) throw new NotFoundError('Application not found.');
    await this.rpc(db, 'set_application_status', {
      p_id: id,
      p_status: status,
      p_decision_note: notes.decisionNote ?? null,
      p_staff_note: notes.staffNote ?? null,
    });
    this.emit();
    return this.fetchApplication(db, id, me);
  }

  /* -------------------------------------------- collector ("buyer") inquiries -- */

  /**
   * Anyone may send one (a visitor uses the anon client). Returns only the id.
   * The server re-validates, checks the work is discoverable by the caller,
   * derives the artist and enforces BUYER_INQUIRY_DAILY_LIMIT per email.
   */
  async submitBuyerInquiry(viewer: Viewer, input: BuyerInquiryInput): Promise<{ id: string }> {
    const problem = validateBuyerInquiry(input);
    if (problem) throw new ValidationError(problem.message, problem.field);
    const { db } = await this.ctx(viewer);
    if (input.artworkId && !isUuid(input.artworkId)) throw new NotFoundError('Artwork not found.');
    const id = await this.rpc<string>(db, 'submit_buyer_inquiry', {
      p_artwork: input.artworkId || null,
      p_name: input.name,
      p_email: input.email,
      p_org: input.organization ?? null,
      p_intent: input.intent,
      p_message: input.message,
      p_consent: input.consent === true,
    });
    this.emit();
    return { id };
  }

  async listBuyerInquiries(viewer: Viewer): Promise<BuyerInquiryRow[]> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    const rows = await this.run<BuyerInquiryViewRow[]>(kofi(db).from(SCHEMA_BUYER_INQUIRIES).select('*'));
    return rows.map(toBuyerInquiryRow).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  async setBuyerInquiryStatus(viewer: Viewer, id: string, status: BuyerInquiryStatus, staffNote?: string): Promise<BuyerInquiryRow> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(id)) throw new NotFoundError('Inquiry not found.');
    if (!BUYER_INQUIRY_STATUSES.includes(status)) throw new ValidationError('Unknown status.', 'status');
    await this.rpc(db, 'set_buyer_inquiry_status', { p_id: id, p_status: status, p_staff_note: staffNote ?? null });
    this.emit();
    const row = await this.run<BuyerInquiryViewRow | null>(kofi(db).from(SCHEMA_BUYER_INQUIRIES).select('*').eq('id', id).maybeSingle());
    if (!row) throw new NotFoundError('Inquiry not found.');
    return toBuyerInquiryRow(row);
  }

  /* --------------------------------------------------- lots, sales, payouts -- */
  /*
   * Lots and payouts are written only through RPCs (kofi.save_lot, set_lot_status,
   * record_sale, delete_lot, set_payout_status), which re-run domain/sales with the
   * same messages and cents arithmetic. Reads come from kofi.lots_visible (the sale
   * without buyerRef for the artist, no payout for the organiser) and payouts_visible.
   */

  private async lotRows(db: SupabaseClient, me: Me, rows: LotViewRow[]): Promise<LotRow[]> {
    const works = await this.worksFor(db, me, rows.map((r) => r.artwork_id));
    return sortLots(rows.map((r) => toLotRow(r, works.get(r.artwork_id))));
  }

  private async fetchLot(db: SupabaseClient, me: Me, id: string): Promise<LotRow> {
    const row = await this.run<LotViewRow | null>(kofi(db).from('lots_visible').select('*').eq('id', id).maybeSingle());
    if (!row) throw new NotFoundError('Lot not found.');
    return (await this.lotRows(db, me, [row]))[0]!;
  }

  /** Admin: all lots. Partner: lots on calls its institution runs. Artists use listMyLots. */
  async listLots(viewer: Viewer, callId?: string): Promise<LotRow[]> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') {
      this.requireOrganiser(me);
      if (callId) await this.requirePartnerCall(db, me, callId);
    }
    let q = kofi(db).from('lots_visible').select('*');
    if (callId) {
      if (!isUuid(callId)) return [];
      q = q.eq('call_id', callId);
    }
    return this.lotRows(db, me, await this.run<LotViewRow[]>(q));
  }

  async saveLot(viewer: Viewer, input: LotInput & { id?: string }): Promise<LotRow> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') this.requireOrganiser(me);
    const id = await this.rpc<string>(db, 'save_lot', { p_lot: lotInputToJson(input) });
    this.emit();
    return this.fetchLot(db, me, id);
  }

  /** canMoveLot(); sold → unsold voids the sale and its payout (a paid payout cannot be voided). */
  async setLotStatus(viewer: Viewer, id: string, status: LotStatus): Promise<LotRow> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') this.requireOrganiser(me);
    if (!isUuid(id)) throw new NotFoundError('Lot not found.');
    await this.rpc(db, 'set_lot_status', { p_id: id, p_status: status });
    this.emit();
    return this.fetchLot(db, me, id);
  }

  async recordSale(viewer: Viewer, id: string, input: SaleInput): Promise<LotRow> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') this.requireOrganiser(me);
    if (!isUuid(id)) throw new NotFoundError('Lot not found.');
    await this.rpc(db, 'record_sale', {
      p_id: id,
      p_hammer: typeof input.hammerPrice === 'number' && Number.isFinite(input.hammerPrice) ? input.hammerPrice : null,
      p_sold_on: typeof input.soldOn === 'string' ? input.soldOn : '',
      p_buyer_ref: typeof input.buyerRef === 'string' ? input.buyerRef : null,
    });
    this.emit();
    return this.fetchLot(db, me, id);
  }

  async deleteLot(viewer: Viewer, id: string): Promise<void> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'admin') this.requireOrganiser(me);
    if (!isUuid(id)) throw new NotFoundError('Lot not found.');
    await this.rpc(db, 'delete_lot', { p_id: id });
    this.emit();
  }

  /** Artist: own lots, read-only; the sale never carries the buyer reference (the view strips it). */
  async listMyLots(viewer: Viewer): Promise<LotRow[]> {
    const { db, me } = await this.ctx(viewer);
    if (me.role !== 'artist' || !me.artistId) throw new ForbiddenError('Sign in as an artist to do this.');
    return this.lotRows(db, me, await this.run<LotViewRow[]>(kofi(db).from('lots_visible').select('*').eq('artist_id', me.artistId)));
  }

  /** Admin: all payouts. Artist: own. Everyone else (partners included): ForbiddenError. */
  async listPayouts(viewer: Viewer): Promise<PayoutRow[]> {
    const { db, me } = await this.ctx(viewer);
    let q = kofi(db).from('payouts_visible').select('*');
    if (me.role === 'artist' && me.artistId) q = q.eq('artist_id', me.artistId);
    else if (me.role !== 'admin') throw new ForbiddenError('Kofi staff only.');
    const rows = await this.run<PayoutViewRow[]>(q);
    return rows.map(toPayoutRow).sort((x, y) => y.createdAt.localeCompare(x.createdAt) || x.id.localeCompare(y.id));
  }

  /** Admin only. canMovePayout; paid requires a method; the day is stored as 12:00 Kofi time. */
  async setPayoutStatus(
    viewer: Viewer,
    id: string,
    status: PayoutStatus,
    details: { method?: string; reference?: string; note?: string; paidOn?: string } = {},
  ): Promise<PayoutRow> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    if (!isUuid(id)) throw new NotFoundError('Payout not found.');
    const text = (v: unknown) => (v === undefined || v === null ? null : String(v));
    await this.rpc(db, 'set_payout_status', {
      p_id: id,
      p_status: status,
      p_method: text(details.method),
      p_reference: text(details.reference),
      // undefined keeps the note; anything else (null / '') sets or clears it, as in mock mode.
      p_note: details.note === undefined ? null : (details.note ?? ''),
      // undefined / '' → today; a non-string is not a date.
      p_paid_on: details.paidOn === undefined ? null : typeof details.paidOn === 'string' ? details.paidOn : ' ',
    });
    this.emit();
    const row = await this.run<PayoutViewRow | null>(kofi(db).from('payouts_visible').select('*').eq('id', id).maybeSingle());
    if (!row) throw new NotFoundError('Payout not found.');
    return toPayoutRow(row);
  }

  /* ------------------------------------------------------------ Kofi reports -- */

  /**
   * kofi.kofi_report() computes the three row sets of domain/reports.buildReport server-side
   * (same Kofi-day semantics) and audits report.export; here they are put in buildReport's
   * order and the totals are added with buildReport's rules.
   */
  async kofiReport(viewer: Viewer, range: ReportRange): Promise<KofiReport> {
    const { db, me } = await this.ctx(viewer);
    this.requireAdmin(me);
    const r: ReportRange = { from: typeof range?.from === 'string' ? range.from.trim() : '', to: typeof range?.to === 'string' ? range.to.trim() : '' };
    const problem = validateRange(r, kofiToday());
    if (problem) throw new ValidationError(problem, 'range');
    const data = await this.rpc<{ participation: ParticipationRow[]; placements: PlacementRow[]; payments: PaymentRow[] }>(db, 'kofi_report', {
      p_from: r.from,
      p_to: r.to,
    });
    this.emit();
    return assembleReport(r, data, new Date().toISOString());
  }

  /* ---------------------------------------------------------- demo helpers -- */

  /**
   * Restores the fictional seed via kofi.kofi_demo_reset() (defined by
   * supabase/seed_content.sql). Kofi staff only, using the current session.
   */
  async resetDemoData(): Promise<void> {
    const session = (await this.client.auth.getSession()).data.session;
    if (!session) throw new ForbiddenError('Only Kofi staff can reset demo data in Supabase mode. Sign in as Quincy first.');
    try {
      await this.rpc(this.client, 'kofi_demo_reset');
    } catch (e) {
      if (e instanceof Error && /could not find the function|kofi_demo_reset/i.test(e.message) && !(e instanceof ForbiddenError)) {
        throw new Error('Demo data is not installed on this project. Run supabase/seed_auth.sql and supabase/seed_content.sql first.');
      }
      throw e;
    }
    this.signedUrls.clear();
    this.urlToRef.clear();
    this.meCache.clear();
    this.emit();
  }
}

/** GoTrue sign-up errors → the intake's field errors. */
function signUpError(err: { message?: string; code?: string; status?: number }): Error {
  const code = err.code ?? '';
  const msg = err.message ?? '';
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered|already exists/i.test(msg)) return new ConflictError();
  if (code === 'weak_password' || /password/i.test(msg)) return new ValidationError('That password is too easy to guess. Try a longer sentence.', 'password');
  if (code === 'email_address_invalid' || code === 'email_address_not_authorized' || /invalid.*email|email.*invalid/i.test(msg)) {
    return new ValidationError('Enter an email address we can reach you at.', 'email');
  }
  if (code === 'signup_disabled' || /signups? not allowed|signup.*disabled/i.test(msg)) return new ValidationError(SIGNUP_CLOSED_MESSAGE, 'email');
  if (err.status === 429 || code.startsWith('over_') || /rate limit/i.test(msg)) return new Error('Too many sign-ups from here just now. Try again in a few minutes.');
  return mapPgError({ message: msg, status: err.status ?? null });
}

function statusRank(s: Artist['status']): number {
  return { pending: 0, draft: 1, approved: 2, paused: 3 }[s];
}
function curatorRank(s: CuratorStatus): number {
  return { pending: 0, verified: 1, rejected: 2 }[s];
}

/** Same order as mock mode: open (closing soonest, no deadline last), upcoming (opening soonest), closed (most recently closed). */
function sortOpenCalls(list: OpenCall[], today: string): OpenCall[] {
  const rank: Record<CallPhase, number> = { open: 0, upcoming: 1, closed: 2 };
  const far = '9999-12-31';
  return [...list].sort((a, b) => {
    const pa = callPhase(a, today);
    const pb = callPhase(b, today);
    if (pa !== pb) return rank[pa] - rank[pb];
    if (pa === 'open') return (a.deadline ?? far).localeCompare(b.deadline ?? far) || a.title.localeCompare(b.title);
    if (pa === 'upcoming') return a.opensOn.localeCompare(b.opensOn) || (a.deadline ?? far).localeCompare(b.deadline ?? far);
    return (b.deadline ?? '').localeCompare(a.deadline ?? '');
  });
}

/** Same order as mock mode: call title, call, lot number. */
function sortLots(rows: LotRow[]): LotRow[] {
  return rows.sort((a, b) => a.callTitle.localeCompare(b.callTitle) || a.callId.localeCompare(b.callId) || a.lotNumber - b.lotNumber);
}

/** The server's report rows in buildReport()'s order, plus buildReport()'s totals. */
export function assembleReport(
  range: ReportRange,
  data: { participation: ParticipationRow[]; placements: PlacementRow[]; payments: PaymentRow[] },
  generatedAt: string,
): KofiReport {
  const participation = [...(data.participation ?? [])].sort(
    (x, y) => y.submittedOn.localeCompare(x.submittedOn) || x.artistWorkingName.localeCompare(y.artistWorkingName),
  );
  const placements = [...(data.placements ?? [])].sort((x, y) => y.on.localeCompare(x.on) || x.artistWorkingName.localeCompare(y.artistWorkingName));
  const payments = [...(data.payments ?? [])].sort((x, y) => y.soldOn.localeCompare(x.soldOn) || x.artistWorkingName.localeCompare(y.artistWorkingName));
  const sum = (rows: PaymentRow[], pick: (r: PaymentRow) => number) => {
    const out: Record<string, number> = {};
    for (const p of rows) out[p.currency] = (out[p.currency] ?? 0) + pick(p);
    return out;
  };
  return {
    range,
    generatedAt,
    participation,
    placements,
    payments,
    totals: {
      applications: participation.length,
      selected: participation.filter((p) => p.status === 'accepted').length,
      artistsParticipating: new Set(participation.map((p) => p.artistId)).size,
      lotsSold: payments.length,
      hammerTotal: sum(payments, (p) => p.hammerPrice),
      artistPaid: sum(payments.filter((p) => p.status === 'paid'), (p) => p.artistAmount),
      artistDue: sum(payments.filter((p) => p.status === 'due'), (p) => p.artistAmount),
    },
  };
}

/** Factory used by src/data/index.ts when VITE_DATA_MODE=supabase. */
export function createSupabaseDataSource(url: string, key: string, opts?: SupabaseDataSourceOptions): DataSource {
  return new SupabaseDataSource(url, key, opts);
}

/**
 * Sign the Supabase data source in as one of the demo identities (same ids as
 * mock mode: 'visitor', 'mara', 'june', 'priya', 'lena', 'owen', 'admin') and
 * return the Viewer the server resolved. 'visitor' signs out. The shell's
 * AccountScreen should call this before `signInAs(identity)` in Supabase mode.
 */
export async function signInDemo(ds: DataSource, identityId: string): Promise<Viewer> {
  if (!(ds instanceof SupabaseDataSource)) throw new Error('signInDemo() only applies to the Supabase data source.');
  const identity = SUPABASE_DEMO_IDENTITIES.find((d) => d.id === identityId);
  if (!identity) throw new NotFoundError('Unknown demo identity.');
  if (identity.viewer.role === 'public') {
    await ds.signOut();
    return identity.viewer;
  }
  const email = demoEmailForUserUuid(identity.viewer.userId ?? '');
  if (!email) throw new NotFoundError('Unknown demo identity.');
  await ds.signInWithPassword(email, DEMO_PASSWORD);
  return ds.currentViewer();
}

/** kofi.search_artworks() result: the page of artworks_visible rows, every match counted, tag facets. */
export interface SearchResult {
  rows: ArtworkViewRow[];
  total: number;
  facets: Record<string, number>;
}

/** The v6 filters (tags, orientation, edition, uses) are evaluated by kofi.search_artworks. */
export function usesSearchRpc(f: ArtworkFilters): boolean {
  return Object.values(f.tags ?? {}).some((l) => l.length > 0) || !!f.orientations?.length || !!f.editionTypes?.length || !!f.uses?.length;
}
