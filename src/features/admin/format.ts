import type { AuditEvent, Role } from '@/domain/types';

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

/** AuditAction (+ meta) → a plain sentence fragment that follows the actor's name. */
export function describeAudit(ev: Pick<AuditEvent, 'action' | 'meta'>): string {
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
  }
}

function visibilityWord(v: string): string {
  return { public: 'Public', institutions: 'Verified institutions', kofi: 'Kofi team only', private: 'Only me' }[v] ?? v;
}
