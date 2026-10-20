import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { BuyerInquiryRow, BuyerInquiryStatus } from '@/domain/types';
import { BUYER_INQUIRY_STATUSES, BUYER_INTENT_LABEL } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { BUYER_STATUS_LABEL, formatInstantDay } from '@/features/programme/format';
import { Button, Chip, EmptyState, ErrorState, Icon, Notice, Segmented, Sheet, Skeleton, StatusDot, Textarea, TopBar } from '@/ui';
import './admin.css';
import './programme.css';

type Filter = 'all' | BuyerInquiryStatus;
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, ...BUYER_INQUIRY_STATUSES.map((s) => ({ value: s as Filter, label: BUYER_STATUS_LABEL[s] }))];
function isFilter(s: string | null): s is Filter {
  return !!s && FILTERS.some((f) => f.value === s);
}
const DOT: Record<BuyerInquiryStatus, string> = { new: 'pending', 'in progress': 'forwarded', closed: 'draft' };

export function AdminCollectors() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter = isFilter(raw) ? raw : 'all';
  const [openId, setOpenId] = useState<string>();
  const trigger = useRef<HTMLElement | null>(null);
  const q = useQuery((ds, v) => ds.listBuyerInquiries(v));

  const all = q.data ?? [];
  const rows = all.filter((r) => filter === 'all' || r.status === filter);
  const opened = all.find((r) => r.id === openId);

  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f === 'all') p.delete('status');
    else p.set('status', f);
    setParams(p, { replace: true });
  };
  const open = (id: string) => {
    trigger.current = document.activeElement as HTMLElement | null;
    setOpenId(id);
  };
  const close = () => {
    setOpenId(undefined);
    window.setTimeout(() => trigger.current?.focus?.(), 0);
  };

  return (
    <div className="screen">
      <TopBar title="Collector inquiries" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
          <aside className="ad-split__aside stack">
            <p className="eyebrow eyebrow--gold">Kofi desk</p>
            <h2 className="h1">Collector inquiries</h2>
            <span className="rule rule--green" aria-hidden="true" />
            <p className="ad-lede" style={{ marginTop: 0 }}>
              Messages from people asking about a work, a commission or art for a space. Kofi replies to them directly.
            </p>
            <Notice tone="cobalt" icon={<Icon.Lock />}>
              The artist’s contact details are never shared automatically. Reply from Kofi; introduce the artist only once they’ve agreed.
            </Notice>
            <div className="field">
              <span className="field__label" id="bi-status-label">
                Status
              </span>
              <div className="chips chips--scroll" role="group" aria-labelledby="bi-status-label">
                {FILTERS.map((f) => (
                  <Chip key={f.value} small on={filter === f.value} count={q.data ? all.filter((r) => f.value === 'all' || r.status === f.value).length : undefined} onClick={() => setFilter(f.value)}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            </div>
          </aside>

          <div className="ad-split__main stack">
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading inquiries">
                <Skeleton h={120} />
                <Skeleton h={120} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={filter === 'new' ? 'No new inquiries' : 'No inquiries here'}
                body="When someone uses “Ask Kofi about this work” or the About page form, the message lands here."
                actions={
                  filter !== 'all' ? (
                    <Button tone="secondary" onClick={() => setFilter('all')}>
                      Show all
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="pg-inbox" aria-label="Collector inquiries">
                {rows.map((r) => (
                  <li key={r.id} className="ops pgc-row" aria-label={`Inquiry from ${r.name}`}>
                    <div className="ops__head">
                      <div style={{ minWidth: 0 }}>
                        <button type="button" className="pgc-open" onClick={() => open(r.id)}>
                          <span className="ops__title">{r.name}</span>
                          {r.organization && <span className="ops__sub"> · {r.organization}</span>}
                        </button>
                        <div className="ops__sub">
                          {BUYER_INTENT_LABEL[r.intent]}
                          {r.artworkId && r.artworkTitle && (
                            <>
                              {' · '}
                              <Link to={`/work/${r.artworkId}`}>{r.artworkTitle}</Link>
                              {r.artistWorkingName && ` by ${r.artistWorkingName}`}
                            </>
                          )}
                        </div>
                      </div>
                      <span className="status-pill">
                        <StatusDot status={DOT[r.status]} />
                        {BUYER_STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <p className="pgc-excerpt">{r.message}</p>
                    <div className="ops__meta">
                      <span>Received {formatInstantDay(r.createdAt)}</span>
                      {r.staffNote && <span>Staff note saved</span>}
                    </div>
                    <div className="ops__actions">
                      <Button size="sm" tone="secondary" onClick={() => open(r.id)} aria-label={`Open inquiry from ${r.name}`}>
                        Open
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
      <InquirySheet row={opened} onClose={close} />
    </div>
  );
}

function InquirySheet({ row, onClose }: { row: BuyerInquiryRow | undefined; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState<BuyerInquiryStatus>('new');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const rowId = row?.id;

  useEffect(() => {
    if (!row) return;
    setStatus(row.status);
    setNote(row.staffNote ?? '');
    setError(undefined);
    // re-seed only when a different inquiry opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const save = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await data.setBuyerInquiryStatus(viewer, row.id, status, note);
      toast.push(status === row.status ? 'Note saved' : `Marked ${BUYER_STATUS_LABEL[status].toLowerCase()}`, 'success');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title={row ? `Inquiry from ${row.name}` : ''}
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {row && (
        <div className="stack">
          <dl className="pga-facts">
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${row.email}`}>{row.email}</a>
              </dd>
            </div>
            {row.organization && (
              <div>
                <dt>Organisation</dt>
                <dd>{row.organization}</dd>
              </div>
            )}
            <div>
              <dt>Asking about</dt>
              <dd>
                {BUYER_INTENT_LABEL[row.intent]}
                {row.artworkId && row.artworkTitle && (
                  <>
                    {': '}
                    <Link to={`/work/${row.artworkId}`}>{row.artworkTitle}</Link>
                    {row.artistWorkingName && ` by ${row.artistWorkingName}`}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{formatInstantDay(row.createdAt)}</dd>
            </div>
          </dl>
          <p className="ops__quote">{row.message}</p>
          <p className="tiny muted">Reply from Kofi’s inbox. Don’t forward the artist’s email or phone; ask the artist first.</p>
          <div className="field">
            <span className="field__label" id="bi-sheet-status">
              Status
            </span>
            <Segmented<BuyerInquiryStatus>
              label="Inquiry status"
              value={status}
              onChange={setStatus}
              options={BUYER_INQUIRY_STATUSES.map((s) => ({ value: s, label: BUYER_STATUS_LABEL[s] }))}
            />
          </div>
          <Textarea label="Staff note" hint="Kofi only. Who is handling it, what was sent, what’s next." rows={3} maxLength={2000} value={note} error={error} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </Sheet>
  );
}
