import type { AuditEvent, LinkPlatform, Role } from '@/domain/types';
import { LINK_PLATFORMS } from '@/domain/types';
import { normalizeLink, platformName } from '@/domain/intake';
import { AUDIT_IMPORT, AUDIT_IMPORT_FALLBACK, AUDIT_SIGNUP, checkedSentence } from './intakeCopy';

/** Tiny relative-time formatter. `now` is injectable for tests. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (d < 30) return w === 1 ? '1 week ago' : `${w} weeks ago`;
  const mo = Math.round(d / 30);
  if (d < 365) return mo <= 1 ? '1 month ago' : `${mo} months ago`;
  const y = Math.round(d / 365);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Kofi staff',
  artist: 'artist',
  curator: 'curator',
  public: 'visitor',
};

const ARTIST_STATUS_VERB: Record<string, string> = {
  approved: 'approved an artist',
  pending: 'submitted a profile for review',
  draft: 'sent a profile back to draft',
  paused: 'paused an artist',
};

const CURATOR_STATUS_VERB: Record<string, string> = {
  verified: 'verified a curator',
  rejected: 'marked a curator as not verified',
  pending: 'reopened a curator’s verification',
};

const INQUIRY_STATUS_VERB: Record<string, string> = {
  forwarded: 'forwarded an introduction request to the artist',
  declined: 'declined an introduction request',
  accepted: 'accepted an introduction request',
  pending: 'reopened an introduction request',
};

const PROGRAMME_NOUN: Partial<Record<AuditEvent['entityType'], string>> = {
  exhibition: 'an exhibition',
  open_call: 'an open call',
  event: 'an event',
  story: 'a journal story',
};

const APPLICATION_STATUS_VERB: Record<string, string> = {
  shortlisted: 'shortlisted an application',
  accepted: 'accepted an application',
  declined: 'declined an application',
  withdrawn: 'withdrew an application',
};

const LOT_STATUS_VERB: Record<string, string> = {
  planned: 'moved a lot back to planned',
  live: 'opened a lot for bidding',
  unsold: 'marked a lot unsold',
  withdrawn: 'withdrew a lot',
};

const PAYOUT_STATUS_VERB: Record<string, string> = {
  paid: 'marked an artist payout as paid',
  due: 'reopened an artist payout',
  void: 'voided an artist payout',
};

/** AuditAction (+ meta, + entityType for programme rows) → a plain sentence fragment that follows the actor's name. */
export function describeAudit(ev: Pick<AuditEvent, 'action' | 'meta'> & Partial<Pick<AuditEvent, 'entityType'>>): string {
  const meta = ev.meta ?? {};
  const status = typeof meta.status === 'string' ? meta.status : '';
  switch (ev.action) {
    case 'artist.create':
      return 'created an artist profile';
    case 'artist.update':
      if (meta.field === 'kofiNotes') return 'edited Kofi notes on an artist';
      if (typeof meta.visibility === 'string') return `changed profile visibility to “${visibilityWord(meta.visibility)}”`;
      return 'updated an artist profile';
    case 'artist.status':
      return ARTIST_STATUS_VERB[status] ?? 'changed an artist’s status';
    case 'artist.export':
      return 'exported their data';
    case 'artist.consent':
      return `accepted the consent terms${typeof meta.version === 'string' ? ` (${meta.version})` : ''}`;
    case 'artwork.create':
      return 'added an artwork';
    case 'artwork.update':
      return meta.reviewed ? 'marked an artwork as reviewed' : 'edited an artwork';
    case 'artwork.delete':
      return 'deleted an artwork';
    case 'artwork.visibility':
      return 'changed who can see an artwork or its price';
    case 'document.add':
      return 'added a private document';
    case 'document.remove':
      return 'removed a private document';
    case 'document.open':
      return meta.byOwner ? 'opened their own private document' : 'opened a private document';
    case 'private.view':
      return meta.what === 'documents' ? 'viewed the private document list for an artwork' : 'viewed a private record';
    case 'curator.request':
      return 'requested institution verification';
    case 'curator.status':
      return CURATOR_STATUS_VERB[status] ?? 'changed a curator’s status';
    case 'shortlist.create':
      return 'created a shortlist';
    case 'shortlist.add':
      return 'added a work to a shortlist';
    case 'shortlist.remove':
      return 'removed a work from a shortlist';
    case 'shortlist.delete':
      return 'deleted a shortlist';
    case 'inquiry.create':
      return 'requested an introduction';
    case 'inquiry.status':
      return INQUIRY_STATUS_VERB[status] ?? 'changed an introduction request';
    case 'programme.save': {
      const noun = (ev.entityType && PROGRAMME_NOUN[ev.entityType]) ?? 'a programme item';
      if (meta.created) return meta.published ? `published ${noun}` : `drafted ${noun}`;
      if (meta.publishedChanged) return meta.published ? `published ${noun}` : `unpublished ${noun}`;
      return `edited ${noun}`;
    }
    case 'programme.delete':
      return `deleted ${(ev.entityType && PROGRAMME_NOUN[ev.entityType]) ?? 'a programme item'}`;
    case 'application.submit':
      return 'applied to an open call';
    case 'application.withdraw':
      return 'withdrew an application';
    case 'application.status':
      return APPLICATION_STATUS_VERB[status] ?? 'changed an application’s status';
    case 'buyer_inquiry.submit':
      return 'sent a collector inquiry';
    case 'buyer_inquiry.status':
      if (meta.noteOnly) return 'added a staff note to a collector inquiry';
      return status === 'closed' ? 'closed a collector inquiry' : status === 'in progress' ? 'picked up a collector inquiry' : status === 'new' ? 'reopened a collector inquiry' : 'updated a collector inquiry';
    case 'lot.save':
      if (meta.created) return 'added a lot to an auction';
      return LOT_STATUS_VERB[status] ?? 'edited a lot';
    case 'lot.sale':
      return meta.voided ? 'voided a sale' : 'recorded a sale';
    case 'lot.delete':
      return 'deleted a lot';
    case 'payout.status':
      return PAYOUT_STATUS_VERB[status] ?? 'updated a payout';
    case 'report.export':
      return 'ran a Kofi report';
    case 'artist.signup':
      return AUDIT_SIGNUP;
    case 'artist.import':
      return importSentence(meta);
    case 'artist.links':
      return linksSentence(meta);
  }
  // Exhaustive above; a row written by a newer schema still reads as a sentence.
  return 'made a change';
}

function visibilityWord(v: string): string {
  return { public: 'Public', institutions: 'Verified institutions', kofi: 'Kofi team only', private: 'Only me' }[v] ?? v;
}

type Meta = NonNullable<AuditEvent['meta']>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** "pulled details from Instagram @mara.paints" — from meta platform/handle, or derived from meta url. */
function importSentence(meta: Meta): string {
  const url = str(meta.url) ?? str(meta.source);
  const n = url ? normalizeLink(url) : undefined;
  const rawPlatform = str(meta.platform);
  const platform: LinkPlatform | undefined = rawPlatform && (LINK_PLATFORMS as string[]).includes(rawPlatform) ? (rawPlatform as LinkPlatform) : n?.platform;
  const handle = str(meta.handle) ?? n?.handle;
  if (!platform && !handle) return AUDIT_IMPORT_FALLBACK;
  if (!platform || platform === 'website' || platform === 'other') return `${AUDIT_IMPORT} ${handle ?? platformName(platform ?? 'other').toLowerCase()}`;
  return `${AUDIT_IMPORT} ${platformName(platform)}${handle ? ` ${handle}` : ''}`;
}

/** "checked 2 links: 1 verified". Accepts checked/count/total/links for the count. */
function linksSentence(meta: Meta): string {
  const total = num(meta.checked) ?? num(meta.count) ?? num(meta.total) ?? num(meta.links);
  const verified = num(meta.verified) ?? 0;
  if (total === undefined) return 'checked their links';
  return checkedSentence(total, verified);
}
