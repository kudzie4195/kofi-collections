import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ApplicationRow, LotRow, LotStatus, OpenCall } from '@/domain/types';
import { canMoveLot, formatMoney } from '@/domain/sales';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { deadlineLabel, formatInstantDay } from '@/features/programme/format';
import { Button, Confirm, EmptyState, ErrorState, Icon, LinkButton, Select, Skeleton, StatusDot, TopBar } from '@/ui';
import { NewLotSheet, RecordSaleSheet } from './LotSheets';
import { LOT_STATUS_DOT, LOT_STATUS_LABEL, moneyLines, PAYOUT_STATUS_LABEL, termsSummary, totalsBy } from './salesShared';
import './admin.css';
import './programme.css';
import './sales.css';

/** The status moves offered as buttons (sold is reached only by recording a sale). */
function moves(l: LotRow): { to: LotStatus; label: string }[] {
  const out: { to: LotStatus; label: string }[] = [];
  if (l.status === 'sold') return canMoveLot('sold', 'unsold') ? [{ to: 'unsold', label: 'Void sale' }] : [];
  if (canMoveLot(l.status, 'live')) out.push({ to: 'live', label: 'Mark live' });
  if (canMoveLot(l.status, 'unsold')) out.push({ to: 'unsold', label: 'Mark unsold' });
  if (canMoveLot(l.status, 'withdrawn')) out.push({ to: 'withdrawn', label: 'Withdraw' });
  if (l.status === 'withdrawn' && canMoveLot('withdrawn', 'planned')) out.push({ to: 'planned', label: 'Reinstate' });
  return out;
}

export function AdminLots() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const callId = params.get('call') ?? '';
  const [newOpen, setNewOpen] = useState(false);
  const [saleLot, setSaleLot] = useState<LotRow>();
  const [voidLot, setVoidLot] = useState<LotRow>();
  const [deleteLot, setDeleteLot] = useState<LotRow>();
  const [busy, setBusy] = useState<string>();

  const q = useQuery(async (ds, v) => {
    const [lots, calls, apps] = await Promise.all([ds.listLots(v), ds.listOpenCalls(v), ds.listApplications(v).catch(() => [] as ApplicationRow[])]);
    return { lots, auctions: calls.filter((c) => c.kind === 'auction'), apps };
  });

  const setCall = (id: string) => {
    const p = new URLSearchParams(params);
    if (id) p.set('call', id);
    else p.delete('call');
    setParams(p, { replace: true });
  };

  async function move(l: LotRow, to: LotStatus) {
    setBusy(`${l.id}:${to}`);
    try {
      const row = await data.setLotStatus(viewer, l.id, to);
      toast.push(l.status === 'sold' ? `Sale of lot ${row.lotNumber} voided. The payout is void.` : `Lot ${row.lotNumber}: ${LOT_STATUS_LABEL[row.status].toLowerCase()}`, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function remove(l: LotRow) {
    try {
      await data.deleteLot(viewer, l.id);
      toast.push(`Lot ${l.lotNumber} deleted`, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setDeleteLot(undefined);
    }
  }

  const auctions = q.data?.auctions ?? [];
  const shown = callId ? auctions.filter((c) => c.id === callId) : auctions;
  const lots = q.data?.lots ?? [];
  const inView = lots.filter((l) => !callId || l.callId === callId);
  const sold = inView.filter((l) => l.status === 'sold' && l.sale);
  const hammer = totalsBy(sold, (l) => l.sale!.currency, (l) => l.sale!.hammerPrice);
  const callOf = (id: string) => auctions.find((c) => c.id === id);
  const filterCall = callOf(callId);

  return (
    <div className="screen">
      <TopBar title="Lots" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
          <aside className="ad-split__aside stack">
            <p className="eyebrow eyebrow--gold">Kofi desk</p>
            <h2 className="h1">Lots</h2>
            <span className="rule" aria-hidden="true" />
            <p className="ad-lede" style={{ marginTop: 0 }}>
              Selected works on auction calls. When a lot sells, record the hammer price: the split is fixed from the call’s terms and the artist’s payout is created.
            </p>
            <Select label="Auction" value={callId} onChange={(e) => setCall(e.target.value)}>
              <option value="">All auctions</option>
              {auctions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            {q.data && (
              <dl className="lt-stats">
                <div>
                  <dt>Lots</dt>
                  <dd>{inView.length}</dd>
                </div>
                <div>
                  <dt>Sold</dt>
                  <dd>{sold.length}</dd>
                </div>
                <div>
                  <dt>Hammer total</dt>
                  <dd>{moneyLines(hammer).join(' · ')}</dd>
                </div>
              </dl>
            )}
            <Button icon={<Icon.Plus />} disabled={!q.data || auctions.length === 0} onClick={() => setNewOpen(true)}>
              New lot
            </Button>
          </aside>

          <div className="ad-split__main stack--lg">
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading lots">
                <Skeleton h={140} />
                <Skeleton h={140} />
              </div>
            ) : shown.length === 0 ? (
              <EmptyState
                title={callId ? 'That auction isn’t here' : 'No auction calls yet'}
                body={callId ? 'It may have been deleted, or it is not an auction.' : 'Make an open call of kind “Auction” to start taking lots.'}
                actions={
                  callId ? (
                    <Button tone="secondary" onClick={() => setCall('')}>
                      All auctions
                    </Button>
                  ) : (
                    <LinkButton to="/admin/programme/calls/new">New open call</LinkButton>
                  )
                }
              />
            ) : (
              shown.map((c) => <CallGroup key={c.id} call={c} lots={lots.filter((l) => l.callId === c.id)} busy={busy} onMove={move} onSale={setSaleLot} onVoid={setVoidLot} onDelete={setDeleteLot} onNew={() => setNewOpen(true)} single={!!filterCall} />)
            )}
          </div>
        </div>
      </main>

      {q.data && <NewLotSheet open={newOpen} onClose={() => setNewOpen(false)} calls={auctions.filter((c) => !!c.terms)} apps={q.data.apps} lots={lots} initialCallId={callId || undefined} />}
      <RecordSaleSheet lot={saleLot} call={saleLot ? callOf(saleLot.callId) : undefined} onClose={() => setSaleLot(undefined)} />
      <Confirm
        open={!!voidLot}
        onClose={() => setVoidLot(undefined)}
        onConfirm={async () => {
          if (voidLot) await move(voidLot, 'unsold');
          setVoidLot(undefined);
        }}
        title={voidLot ? `Void the sale of lot ${voidLot.lotNumber}?` : 'Void sale?'}
        body="This voids the sale and the artist's payout. The lot goes back to unsold; the voided payout stays on the record."
        confirmLabel="Void sale"
        danger
      />
      <Confirm
        open={!!deleteLot}
        onClose={() => setDeleteLot(undefined)}
        onConfirm={() => (deleteLot ? remove(deleteLot) : undefined)}
        title={deleteLot ? `Delete lot ${deleteLot.lotNumber}?` : 'Delete lot?'}
        body={deleteLot ? `“${deleteLot.artworkTitle}” is taken out of the auction. The work and the artist’s application stay as they are.` : ''}
        confirmLabel="Delete lot"
        danger
      />
    </div>
  );
}

function CallGroup({
  call,
  lots,
  busy,
  single,
  onMove,
  onSale,
  onVoid,
  onDelete,
  onNew,
}: {
  call: OpenCall;
  lots: LotRow[];
  busy: string | undefined;
  single: boolean;
  onMove: (l: LotRow, to: LotStatus) => void;
  onSale: (l: LotRow) => void;
  onVoid: (l: LotRow) => void;
  onDelete: (l: LotRow) => void;
  onNew: () => void;
}) {
  const headId = `lt-call-${call.id}`;
  return (
    <section className="stack lt-group" aria-labelledby={headId}>
      <header className="lt-group__head">
        <h2 className="group-title" id={headId}>
          {call.title}
          <span className="group-title__count">{lots.length}</span>
        </h2>
        <p className="list-row__sub">
          {[call.partner, deadlineLabel(call), call.terms ? termsSummary(call.terms) : 'No terms yet'].filter(Boolean).join(' · ')}
        </p>
        <p className="lt-group__links small">
          <Link to={`/admin/programme/calls/${call.id}`}>Edit call</Link>
          <Link to={`/admin/applications?call=${call.id}`}>Applications</Link>
          {!single && <Link to={`/admin/lots?call=${call.id}`}>Only this auction</Link>}
        </p>
      </header>
      {lots.length === 0 ? (
        <div className="lt-empty">
          <p className="small muted">No lots yet. Selected works on this call can become lots.</p>
          <Button tone="secondary" size="sm" icon={<Icon.Plus />} onClick={onNew} disabled={!call.terms}>
            New lot
          </Button>
        </div>
      ) : (
        <ul className="list lt-list" aria-label={`Lots in ${call.title}`}>
          {lots.map((l) => (
            <LotItem key={l.id} l={l} currency={call.terms?.currency ?? 'USD'} busy={busy} onMove={onMove} onSale={onSale} onVoid={onVoid} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LotItem({
  l,
  currency,
  busy,
  onMove,
  onSale,
  onVoid,
  onDelete,
}: {
  l: LotRow;
  currency: string;
  busy: string | undefined;
  onMove: (l: LotRow, to: LotStatus) => void;
  onSale: (l: LotRow) => void;
  onVoid: (l: LotRow) => void;
  onDelete: (l: LotRow) => void;
}) {
  const img = l.work?.images.find((i) => i.isPrimary) ?? l.work?.images[0];
  const m = (n: number) => formatMoney(n, l.sale?.currency ?? currency);
  const s = l.sale;
  const p = l.payout;
  const canSell = l.status !== 'sold' && l.status !== 'withdrawn';
  const canDelete = l.status !== 'sold' && !p;
  const paid = p?.status === 'paid';
  return (
    <li className="lt-row" aria-label={`Lot ${l.lotNumber}: ${l.artworkTitle}`} data-status={l.status}>
      <div className="lt-row__top">
        <span className="lt-num" aria-hidden="true">
          <span className="lt-num__label">Lot</span>
          <span className="lt-num__n">{l.lotNumber}</span>
        </span>
        {img ? <img className="thumb lt-thumb" src={img.src} alt="" /> : <span className="thumb lt-thumb pg-row__thumb--empty" aria-hidden="true" />}
        <div className="lt-main">
          <span className="status-pill" data-testid="lot-status">
            <StatusDot status={LOT_STATUS_DOT[l.status]} />
            {LOT_STATUS_LABEL[l.status]}
          </span>
          <p className="lt-title">
            <Link to={`/work/${l.artworkId}`}>{l.artworkTitle}</Link>
          </p>
          <p className="list-row__sub">
            <Link to={`/admin/artists/${l.artistId}`}>{l.artistWorkingName}</Link>
            {l.reserve !== undefined && ` · reserve ${m(l.reserve)}`}
            {l.startingBid !== undefined && ` · starts at ${m(l.startingBid)}`}
          </p>
        </div>
        {s && (
          <div className="lt-money">
            <span className="lt-money__label">Hammer</span>
            <span className="lt-money__n">{formatMoney(s.hammerPrice, s.currency)}</span>
          </div>
        )}
      </div>

      {s && (
        <div className="lt-sale">
          <p className="small lt-split">
            Artist {formatMoney(s.artistAmount, s.currency)} · Kofi {formatMoney(s.kofiAmount, s.currency)}
            {s.partnerAmount > 0 && ` · Partner ${formatMoney(s.partnerAmount, s.currency)}`}
            {s.buyerPremium > 0 && ` · Buyer’s premium ${formatMoney(s.buyerPremium, s.currency)}`}
          </p>
          <p className="tiny lt-meta">
            <span>Sold {formatInstantDay(s.soldAt)}</span>
            {s.buyerRef && <span>Buyer: {s.buyerRef}</span>}
            {p && (
              <span className={`lt-payout lt-payout--${p.status}`}>
                Payout {PAYOUT_STATUS_LABEL[p.status].toLowerCase()}
                {p.status === 'paid' && p.paidAt ? ` ${formatInstantDay(p.paidAt)}` : ''}
              </span>
            )}
          </p>
        </div>
      )}
      {!s && p?.status === 'void' && <p className="tiny muted lt-meta">An earlier sale was voided; its payout is kept as void.</p>}

      <div className="lt-actions" role="group" aria-label={`Lot ${l.lotNumber} actions`}>
        {canSell && (
          <Button size="sm" onClick={() => onSale(l)}>
            Record sale
          </Button>
        )}
        {moves(l).map((mv) =>
          mv.label === 'Void sale' ? (
            paid ? (
              <span key={mv.to} className="tiny muted lt-hint">
                Paid. To void this sale, <Link to="/admin/payouts?status=paid">reopen the payout</Link> first.
              </span>
            ) : (
              <Button key={mv.to} size="sm" tone="danger" onClick={() => onVoid(l)}>
                Void sale
              </Button>
            )
          ) : (
            <Button key={mv.to} size="sm" tone="secondary" loading={busy === `${l.id}:${mv.to}`} onClick={() => onMove(l, mv.to)}>
              {mv.label}
            </Button>
          ),
        )}
        {canDelete && (
          <Button size="sm" tone="ghost" className="pg-delete" icon={<Icon.Trash />} onClick={() => onDelete(l)}>
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}
