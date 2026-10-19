import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InquiryRow } from '@/data/DataSource';
import type { CuratorStatus, InquiryStatus } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { useToast } from '@/state/toast';
import { Button, EmptyState, ErrorState, Icon, Notice, Panel, Segmented, Skeleton, StatusDot, TopBar } from '@/ui';
import { formatDate } from './format';
import { NoteSheet, type NoteAction } from './NoteSheet';
import './admin.css';

type Filter = 'all' | InquiryStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'forwarded', label: 'Forwarded' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

const STATUS_COPY: Record<InquiryStatus, string> = {
  pending: 'Waiting on Kofi',
  forwarded: 'With the artist',
  accepted: 'Artist accepted — connect them',
  declined: 'Declined',
};

const RANK: Record<InquiryStatus, number> = { pending: 0, forwarded: 1, accepted: 2, declined: 3 };

function isFilter(s: string | null): s is Filter {
  return !!s && FILTERS.some((f) => f.value === s);
}

export function AdminInquiries() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter = isFilter(raw) ? raw : 'all';
  const [action, setAction] = useState<NoteAction>();

  const q = useQuery(async (ds, v) => {
    const [rows, curators] = await Promise.all([ds.listInquiries(v), ds.listCurators(v)]);
    const curatorStatus = new Map<string, CuratorStatus>(curators.map((c) => [c.id, c.status]));
    rows.sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt.localeCompare(a.createdAt));
    return { rows, curatorStatus };
  });

  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f === 'all') p.delete('status');
    else p.set('status', f);
    setParams(p, { replace: true });
  };

  const decide = (r: InquiryRow, status: 'forwarded' | 'declined'): NoteAction =>
    status === 'forwarded'
      ? {
          title: 'Forward to the artist?',
          body: (
            <p>
              {r.artistWorkingName} will see this request from {r.curatorName} ({r.institutionName}) in their studio inbox. No contact details are
              shared until the artist accepts.
            </p>
          ),
          confirmLabel: 'Forward to artist',
          tone: 'primary',
          noteLabel: 'Staff note',
          noteHint: 'Saved on the request with the decision.',
          minNote: 0,
          run: async (note) => {
            await data.setInquiryStatus(viewer, r.id, 'forwarded', note || undefined);
            toast.push(`Forwarded to ${r.artistWorkingName}`, 'success');
          },
        }
      : {
          title: 'Decline this request?',
          body: <p>It won’t reach {r.artistWorkingName}. This can’t be undone; the curator can send a new request later.</p>,
          confirmLabel: 'Decline request',
          tone: 'danger',
          noteLabel: 'Reason',
          noteHint: 'Saved on the request so the decision can be explained later.',
          minNote: 10,
          run: async (note) => {
            await data.setInquiryStatus(viewer, r.id, 'declined', note);
            toast.push('Request declined', 'success');
          },
        };

  const rows = (q.data?.rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const pendingCount = (q.data?.rows ?? []).filter((r) => r.status === 'pending').length;

  return (
    <div className="screen">
      <TopBar title="Introduction requests" back="/admin" />
      <main className="container stack--lg" style={{ paddingTop: 20 }}>
        <Notice tone="cobalt" icon={<Icon.Lock />}>
          Forwarding sends the request to the artist’s studio inbox. It still shares no contact details: the artist accepts or declines, and only
          then does Kofi connect the two.
        </Notice>

        <div className="seg-wrap">
          <Segmented<Filter> label="Filter requests by status" value={filter} onChange={setFilter} options={FILTERS} />
        </div>

        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading requests">
            <Skeleton h={140} />
            <Skeleton h={140} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter === 'pending' ? 'Nothing waiting on Kofi' : 'No requests here'}
            body={
              filter === 'pending'
                ? 'Every introduction request has been forwarded or declined.'
                : 'When a verified curator requests an introduction, it shows up here first.'
            }
            actions={
              filter !== 'all' ? (
                <Button tone="secondary" onClick={() => setFilter('all')}>
                  Show all requests
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {filter === 'all' && pendingCount > 0 && (
              <p className="small strong">{pendingCount === 1 ? '1 request is waiting on you.' : `${pendingCount} requests are waiting on you.`}</p>
            )}
            <Panel pinned>
              <ul aria-label="Introduction requests">
                {rows.map((r) => {
                  const cStatus = q.data!.curatorStatus.get(r.curatorId);
                  return (
                    <li key={r.id} className="ops" aria-label={`Request from ${r.curatorName} about ${r.artistWorkingName}`}>
                      <div className="ops__head">
                        <div style={{ minWidth: 0 }}>
                          <div className="ops__title">
                            {r.curatorName}
                            <span className="muted" style={{ fontWeight: 500 }}>
                              , {r.institutionName}
                            </span>
                          </div>
                          <div className="ops__sub">
                            About <Link to={`/admin/artists/${r.artistId}`}>{r.artistWorkingName}</Link>
                            {r.artworkId && r.artworkTitle && (
                              <>
                                {', '}
                                <Link to={`/work/${r.artworkId}`}>{r.artworkTitle}</Link>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="status-pill">
                          <StatusDot status={r.status} />
                          {r.status === 'pending' ? 'Pending' : r.status === 'forwarded' ? 'Forwarded' : r.status === 'accepted' ? 'Accepted' : 'Declined'}
                        </span>
                      </div>
                      <p className="ops__quote">{r.message}</p>
                      {cStatus && cStatus !== 'verified' && (
                        <div style={{ marginTop: 8 }}>
                          <Notice tone="coral" icon={<Icon.Warn />}>
                            This curator is no longer verified. Check before forwarding.
                          </Notice>
                        </div>
                      )}
                      <div className="ops__meta">
                        <span>Sent {formatDate(r.createdAt)}</span>
                        <span>{STATUS_COPY[r.status]}</span>
                        {r.decidedAt && <span>Decided {formatDate(r.decidedAt)}</span>}
                        {r.staffNote && <span>Note: {r.staffNote}</span>}
                      </div>
                      {r.status === 'pending' && (
                        <div className="ops__actions">
                          <Button size="sm" icon={<Icon.Mail />} onClick={() => setAction(decide(r, 'forwarded'))}>
                            Forward
                          </Button>
                          <Button tone="danger" size="sm" onClick={() => setAction(decide(r, 'declined'))}>
                            Decline
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </>
        )}
      </main>
      <NoteSheet action={action} onClose={() => setAction(undefined)} />
    </div>
  );
}
