import { useState } from 'react';
import type { AuditEvent } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { Chip, EmptyState, ErrorState, Icon, Notice, Skeleton, TopBar } from '@/ui';
import { AuditList, loadAuditNames } from './AuditList';
import './admin.css';

type EntityFilter = 'all' | AuditEvent['entityType'];
const ENTITY_FILTERS: { value: EntityFilter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'artist', label: 'Artists' },
  { value: 'artwork', label: 'Artworks' },
  { value: 'document', label: 'Documents' },
  { value: 'curator', label: 'Curators' },
  { value: 'shortlist', label: 'Shortlists' },
  { value: 'inquiry', label: 'Requests' },
];

export function AdminActivity() {
  const { data } = useSession();
  const [filter, setFilter] = useState<EntityFilter>('all');
  const q = useQuery(async (ds, v) => {
    const [events, names] = await Promise.all([ds.listAudit(v, 200), loadAuditNames(ds, v)]);
    return { events, names };
  });

  const events = q.data?.events ?? [];
  const count = (f: EntityFilter) => (f === 'all' ? events.length : events.filter((e) => e.entityType === f).length);
  const shown = filter === 'all' ? events : events.filter((e) => e.entityType === filter);

  return (
    <div className="screen">
      <TopBar title="Activity log" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
        <aside className="ad-split__aside stack">
          <p className="eyebrow eyebrow--gold">Kofi desk</p>
          <h2 className="h1">Activity log</h2>
          <span className="rule" aria-hidden="true" />
        <Notice tone="plain" icon={<Icon.Lock />}>
          This log is append-only. Sensitive actions — status changes, visibility edits, opening private documents or records, shortlists and
          introduction decisions — add an entry, and nobody, including Kofi staff, can edit or delete one from the app. Showing the latest 200.
          {data.mode === 'mock' && ' In demo mode, “Reset demo data” on the Account screen restores the sample log.'}
        </Notice>

        <div className="chips chips--scroll" role="group" aria-label="Filter by record type">
          {ENTITY_FILTERS.map((f) => (
            <Chip key={f.value} on={filter === f.value} count={q.data ? count(f.value) : undefined} onClick={() => setFilter(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
        </aside>

        <div className="ad-split__main">
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack--sm" aria-busy="true" aria-label="Loading activity">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} h={44} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing recorded here yet"
            body={filter === 'all' ? 'Sensitive actions will appear as they happen.' : 'No entries for this record type in the latest 200.'}
          />
        ) : (
          <AuditList events={shown} names={q.data.names} />
        )}
        </div>
        </div>
      </main>
    </div>
  );
}
