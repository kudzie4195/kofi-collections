import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LotRow, PayoutRow, PayoutStatus } from '@/domain/types';
import { canMovePayout, formatMoney } from '@/domain/sales';
import { kofiToday } from '@/domain/programme';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { formatInstantDay } from '@/features/programme/format';
import { Button, Chip, Confirm, EmptyState, ErrorState, Icon, Input, Notice, Sheet, Skeleton, StatusDot, Textarea, TopBar } from '@/ui';
import { moneyLines, PAYOUT_STATUS_DOT, PAYOUT_STATUS_LABEL, totalsBy } from './salesShared';
import './admin.css';
import './programme.css';
import './sales.css';

type Filter = PayoutStatus | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'due', label: 'Due' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
  { value: 'all', label: 'All' },
];
const isFilter = (s: string | null): s is Filter => !!s && FILTERS.some((f) => f.value === s);

export function AdminPayouts() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter = isFilter(raw) ? raw : 'due';
  const [paying, setPaying] = useState<PayoutRow>();
  const [confirm, setConfirm] = useState<{ row: PayoutRow; to: 'due' | 'void' }>();

  const q = useQuery(async (ds, v) => {
    const [payouts, lots] = await Promise.all([ds.listPayouts(v), ds.listLots(v).catch(() => [] as LotRow[])]);
    return { payouts, callOfLot: new Map(lots.map((l) => [l.id, l.callId])) };
  });

  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f === 'due') p.delete('status');
    else p.set('status', f);
    setParams(p, { replace: true });
  };

  async function move(row: PayoutRow, to: 'due' | 'void') {
    try {
      await data.setPayoutStatus(viewer, row.id, to);
      toast.push(to === 'void' ? `Payout to ${row.artistWorkingName} voided` : `Payout to ${row.artistWorkingName} is due again`, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setConfirm(undefined);
    }
  }

  const all = q.data?.payouts ?? [];
  const rows = all.filter((p) => filter === 'all' || p.status === filter);
  const count = (f: Filter) => all.filter((p) => f === 'all' || p.status === f).length;
  const due = totalsBy(all.filter((p) => p.status === 'due'), (p) => p.currency, (p) => p.amount);
  const paid = totalsBy(all.filter((p) => p.status === 'paid'), (p) => p.currency, (p) => p.amount);

  return (
    <div className="screen">
      <TopBar title="Payouts" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
          <aside className="ad-split__aside stack">
            <p className="eyebrow eyebrow--gold">Kofi desk</p>
            <h2 className="h1">Payouts</h2>
            <span className="rule" aria-hidden="true" />
            <p className="ad-lede" style={{ marginTop: 0 }}>
              What Kofi owes artists from recorded sales. Each payout is the artist’s share of the hammer price, fixed when the sale was recorded.
            </p>
            {q.data && (
              <div className="po-totals" aria-label="Totals">
                <div className="tile tile--butter po-tile" data-testid="total-due">
                  <span className="tile__label">Due to artists</span>
                  {moneyLines(due).map((line) => (
                    <span key={line} className="po-tile__n">
                      {line}
                    </span>
                  ))}
                  <span className="po-tile__hint">
                    {count('due')} {count('due') === 1 ? 'payout' : 'payouts'}
                  </span>
                </div>
                <div className="tile po-tile po-tile--paid" data-testid="total-paid">
                  <span className="tile__label">Paid</span>
                  {moneyLines(paid).map((line) => (
                    <span key={line} className="po-tile__n">
                      {line}
                    </span>
                  ))}
                  <span className="po-tile__hint">
                    {count('paid')} {count('paid') === 1 ? 'payout' : 'payouts'}
                  </span>
                </div>
              </div>
            )}
            <div className="field">
              <span className="field__label" id="po-status-label">
                Status
              </span>
              <div className="chips chips--scroll" role="group" aria-labelledby="po-status-label">
                {FILTERS.map((f) => (
                  <Chip key={f.value} small on={filter === f.value} count={q.data ? count(f.value) : undefined} onClick={() => setFilter(f.value)}>
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
              <div className="stack" aria-busy="true" aria-label="Loading payouts">
                <Skeleton h={120} />
                <Skeleton h={120} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={filter === 'due' ? 'Nothing due' : 'No payouts here'}
                body={filter === 'due' ? 'Every recorded sale has been paid out or voided.' : 'Payouts appear when a sale is recorded on Lots.'}
                actions={
                  filter !== 'all' ? (
                    <Button tone="secondary" onClick={() => setFilter('all')}>
                      Show all
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="list po-list" aria-label="Payouts">
                {rows.map((p) => {
                  const callId = q.data!.callOfLot.get(p.lotId);
                  return (
                    <li key={p.id} className="po-row" aria-label={`${p.artistWorkingName}, ${formatMoney(p.amount, p.currency)}, ${PAYOUT_STATUS_LABEL[p.status]}`}>
                      <div className="po-row__top">
                        <div className="po-main">
                          <span className="status-pill" data-testid="payout-status">
                            <StatusDot status={PAYOUT_STATUS_DOT[p.status]} />
                            {PAYOUT_STATUS_LABEL[p.status]}
                          </span>
                          <p className="lt-title">
                            <Link to={`/admin/artists/${p.artistId}`}>{p.artistWorkingName}</Link>
                          </p>
                          <p className="list-row__sub">
                            {p.artworkTitle} · <Link to={callId ? `/admin/lots?call=${callId}` : '/admin/lots'}>{p.callTitle}</Link>, lot {p.lotNumber}
                          </p>
                        </div>
                        <div className="lt-money">
                          <span className="lt-money__label">Artist’s share</span>
                          <span className={`lt-money__n ${p.status === 'void' ? 'po-void' : ''}`}>{formatMoney(p.amount, p.currency)}</span>
                        </div>
                      </div>
                      <p className="tiny lt-meta">
                        <span>Created {formatInstantDay(p.createdAt)}</span>
                        {p.status === 'paid' && p.paidAt && <span>Paid {formatInstantDay(p.paidAt)}</span>}
                        {p.method && <span>{p.method}</span>}
                        {p.reference && <span>Ref. {p.reference}</span>}
                      </p>
                      {p.note && <p className="small po-note">{p.note}</p>}
                      <div className="lt-actions" role="group" aria-label={`Payout to ${p.artistWorkingName}`}>
                        {canMovePayout(p.status, 'paid') && (
                          <Button size="sm" onClick={() => setPaying(p)}>
                            Mark paid
                          </Button>
                        )}
                        {p.status === 'paid' && canMovePayout('paid', 'due') && (
                          <Button size="sm" tone="secondary" onClick={() => setConfirm({ row: p, to: 'due' })}>
                            Reopen
                          </Button>
                        )}
                        {canMovePayout(p.status, 'void') && (
                          <Button size="sm" tone="ghost" className="pg-delete" onClick={() => setConfirm({ row: p, to: 'void' })}>
                            Void
                          </Button>
                        )}
                        {p.status === 'void' && <span className="tiny muted lt-hint">Kept for the record. To pay again, record the sale again on Lots.</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>

      <MarkPaidSheet row={paying} onClose={() => setPaying(undefined)} />
      <Confirm
        open={!!confirm}
        onClose={() => setConfirm(undefined)}
        onConfirm={() => (confirm ? move(confirm.row, confirm.to) : undefined)}
        title={confirm?.to === 'void' ? 'Void this payout?' : 'Reopen this payout?'}
        body={
          confirm?.to === 'void'
            ? `${confirm.row.artistWorkingName} will no longer see ${formatMoney(confirm.row.amount, confirm.row.currency)} as due. The sale stays on record; to undo the sale itself, void it on Lots.`
            : confirm
              ? `The payment details are cleared and ${formatMoney(confirm.row.amount, confirm.row.currency)} shows as due to ${confirm.row.artistWorkingName} again. Use this to correct a payment recorded by mistake.`
              : ''
        }
        confirmLabel={confirm?.to === 'void' ? 'Void payout' : 'Reopen payout'}
        danger={confirm?.to === 'void'}
      />
    </div>
  );
}

function MarkPaidSheet({ row, onClose }: { row: PayoutRow | undefined; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const today = kofiToday();

  useEffect(() => {
    if (!row) return;
    setMethod('');
    setReference('');
    setPaidOn(kofiToday());
    setNote(row.note ?? '');
    setErrors({});
  }, [row]);

  async function go() {
    if (!row) return;
    const local: Record<string, string> = {};
    if (!method.trim()) local.method = 'Say how the artist was paid.';
    if (!paidOn) local.paidOn = 'Choose the payment date.';
    else if (paidOn > today) local.paidOn = 'The payment date cannot be in the future.';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      await data.setPayoutStatus(viewer, row.id, 'paid', { method: method.trim(), reference: reference.trim() || undefined, paidOn, note });
      toast.push(`${formatMoney(row.amount, row.currency)} to ${row.artistWorkingName} marked paid`, 'success');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError && e.field && ['method', 'reference', 'paidOn', 'note'].includes(e.field)) setErrors({ [e.field]: e.message });
      else setErrors({ general: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title="Mark payout paid"
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={go}>
            Mark paid
          </Button>
        </>
      }
    >
      {row && (
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <p className="small">
            <span className="strong">{formatMoney(row.amount, row.currency)}</span> to {row.artistWorkingName} for “{row.artworkTitle}”, lot {row.lotNumber}.
          </p>
          {errors.general && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              {errors.general}
            </Notice>
          )}
          <Input
            label="Payment method"
            required
            maxLength={80}
            hint="e.g. Bank transfer, Check #1042."
            value={method}
            error={errors.method}
            onChange={(e) => {
              setMethod(e.target.value);
              if (errors.method) setErrors((x) => ({ ...x, method: undefined }));
            }}
          />
          <Input label="Reference" maxLength={120} hint="Optional. A transfer or check reference." value={reference} error={errors.reference} onChange={(e) => setReference(e.target.value)} />
          <Input label="Paid on" type="date" max={today} value={paidOn} error={errors.paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          <Textarea label="Note" rows={2} hint="Optional. The artist can see this note with the payout." value={note} error={errors.note} onChange={(e) => setNote(e.target.value)} />
          <p className="tiny muted">{row.artistWorkingName} sees the payout as paid, with the date, in their studio.</p>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Sheet>
  );
}
