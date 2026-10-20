import { Link } from 'react-router-dom';
import type { DataSource } from '@/data/DataSource';
import type { AuditEvent, Viewer } from '@/domain/types';
import { describeAudit, formatDateTime, ROLE_LABEL, timeAgo } from './format';

export interface AuditNames {
  artists: Map<string, string>;
  artworks: Map<string, string>;
  curators: Map<string, string>;
  inquiries: Map<string, string>;
}

/**
 * Resolve entity ids to readable names. Uses list endpoints only — never
 * `getArtwork`, which would itself write a private-view audit entry.
 */
export async function loadAuditNames(ds: DataSource, v: Viewer): Promise<AuditNames> {
  const [artists, artworks, curators, inquiries] = await Promise.all([
    ds.listAllArtists(v),
    ds.listArtworks(v),
    ds.listCurators(v),
    ds.listInquiries(v),
  ]);
  return {
    artists: new Map(artists.map((a) => [a.id, a.workingName])),
    artworks: new Map(artworks.map((a) => [a.id, a.title])),
    curators: new Map(curators.map((c) => [c.id, c.name])),
    inquiries: new Map(inquiries.map((i) => [i.id, `${i.curatorName} about ${i.artistWorkingName}`])),
  };
}

function EntityRef({ ev, names }: { ev: AuditEvent; names: AuditNames | undefined }) {
  const id = ev.entityId;
  switch (ev.entityType) {
    case 'artwork':
      return <Link to={`/work/${id}`}>{names?.artworks.get(id) ?? `Artwork ${id}`}</Link>;
    case 'artist':
      return <Link to={`/admin/artists/${id}`}>{names?.artists.get(id) ?? `Artist ${id}`}</Link>;
    case 'curator':
      return <Link to="/admin/curators">{names?.curators.get(id) ?? `Curator ${id}`}</Link>;
    case 'inquiry':
      return <Link to="/admin/inquiries">{names?.inquiries.get(id) ? `Request: ${names.inquiries.get(id)}` : `Request ${id}`}</Link>;
    case 'shortlist': {
      const aw = typeof ev.meta?.artworkId === 'string' ? ev.meta.artworkId : undefined;
      return (
        <span>
          Shortlist <code>{id}</code>
          {aw && (
            <>
              {', work '}
              <Link to={`/work/${aw}`}>{names?.artworks.get(aw) ?? aw}</Link>
            </>
          )}
        </span>
      );
    }
    case 'document':
      return (
        <span>
          Document <code>{id}</code>
        </span>
      );
  }
}

export function AuditList({ events, names, now = new Date() }: { events: AuditEvent[]; names: AuditNames | undefined; now?: Date }) {
  return (
    <ol className="list ad-audit" aria-label="Activity">
      {events.map((ev) => (
        <li key={ev.id} className={`audit-row ${ev.action === 'private.view' ? 'audit-row--sensitive' : ''}`} data-action={ev.action}>
          <time className="audit-row__time" dateTime={ev.at} title={formatDateTime(ev.at)}>
            {timeAgo(ev.at, now)}
          </time>
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <div>
              <strong>{ev.actorName.replace(/\s*\(Kofi\)$/, '')}</strong> <span className="muted">({ROLE_LABEL[ev.actorRole]})</span> {describeAudit(ev)}
            </div>
            <div className="small">
              <EntityRef ev={ev} names={names} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
