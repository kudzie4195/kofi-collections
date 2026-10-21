import { Link } from 'react-router-dom';
import type { LotRow, PayoutRow } from '@/domain/types';
import { formatMoney } from '@/domain/sales';
import { useQuery } from '@/state/session';
import { formatInstantDay } from '@/features/programme/format';
import { EmptyState, ErrorState, LinkButton, Skeleton, StatusDot, TopBar } from '@/ui';
import { LOT_DOT, LOT_STATUS_ARTIST, payoutTotals, totalsText } from './salesShared';

export function Sales() {
  const q = useQuery(async (ds, v) => {
    const [lots, payouts] = await Promise.all([ds.listMyLots(v), ds.listPayouts(v).catch(() => [] as PayoutRow[])]);
    return { lots, payouts };
  });

  const due = payoutTotals(q.data?.payouts ?? [], 'due');
  const paid = payoutTotals(q.data?.payouts ?? [], 'paid');

  return (
    <div className="screen">
      <TopBar title="Sales" back="/studio" />
      <main className="container container--wide st-main">
        <div className="st-split">
          <aside className="st-split__aside stack st-intro" aria-label="About sales">
            <p className="eyebrow eyebrow--gold">Your studio</p>
            <h2 className="h1 sto-title">Your sales</h2>
            <span className="rule" aria-hidden="true" />
            <p className="lede">
              When a work you entered in an auction sells, the hammer price is split by the call’s published terms. Kofi pays your share; this page is the record.
            </p>
            {q.data && (
              <dl className="sts-totals" aria-label="Totals">
                <div>
                  <dt>Due to you</dt>
                  <dd data-testid="sales-due">{totalsText(due, 'Nothing due')}</dd>
                </div>
                <div>
                  <dt>Paid to you</dt>
                  <dd data-testid="sales-paid">{totalsText(paid, 'Nothing paid yet')}</dd>
                </div>
              </dl>
            )}
            <p className="small muted">
              The hammer price is the winning bid. Your share is a fixed percentage of it, set in the call’s terms before you applied. The buyer’s premium is paid by the buyer on top and does not come out of your share.
            </p>
          </aside>

          <div className="st-split__main">
            {q.error && !q.data ? (
              <ErrorState error={q.error} retry={q.reload} />
            ) : !q.data ? (
              <div className="stack" aria-busy="true" aria-label="Loading your sales">
                <Skeleton h={180} />
                <Skeleton h={180} />
              </div>
            ) : q.data.lots.length === 0 ? (
              <EmptyState
                title="No lots yet"
                body="When a work of yours is selected for an auction call, it appears here as a lot, with the sale and your payment once it sells."
                actions={<LinkButton to="/studio/opportunities">See open calls</LinkButton>}
              />
            ) : (
              <ul className="sts-list" aria-label="Your lots">
                {q.data.lots.map((l) => (
                  <li key={l.id}>
                    <LotCard lot={l} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function LotCard({ lot }: { lot: LotRow }) {
  const img = lot.work ? (lot.work.images.find((i) => i.isPrimary) ?? lot.work.images[0]) : undefined;
  const currency = lot.sale?.currency ?? lot.sale?.terms.currency ?? 'USD';
  const titleId = `sts-${lot.id}`;
  const sale = lot.status === 'sold' ? lot.sale : undefined;
  const payout = lot.payout;
  return (
    <article className="sts-lot" aria-labelledby={titleId} data-medium={lot.work?.medium}>
      <div className="sts-lot__head">
        <span className="status-pill">
          <StatusDot status={LOT_DOT[lot.status]} />
          {LOT_STATUS_ARTIST[lot.status]}
        </span>
        <Link to={`/calls/${lot.callId}`} className="sts-lot__call">
          {lot.callTitle}
        </Link>
      </div>
      <div className="sts-lot__work">
        {img ? <img className="thumb thumb--lg" src={img.src} alt="" /> : <span className="thumb thumb--lg st-thumb-empty" aria-hidden="true" />}
        <div className="sts-lot__id">
          <p className="sts-lot__n">Lot {lot.lotNumber}</p>
          <h3 className="sts-lot__title" id={titleId}>
            {lot.artworkTitle}
          </h3>
        </div>
      </div>
      <dl className="sts-facts">
        <div>
          <dt>Your reserve</dt>
          <dd>{lot.reserve !== undefined ? formatMoney(lot.reserve, currency) : 'None set'}</dd>
        </div>
        {sale && (
          <>
            <div>
              <dt>Hammer price</dt>
              <dd>{formatMoney(sale.hammerPrice, sale.currency)}</dd>
            </div>
            <div className="sts-facts__share">
              <dt>Your share</dt>
              <dd>
                {formatMoney(sale.artistAmount, sale.currency)} <span className="sts-pct">{sale.terms.artistSharePct}% of the hammer price</span>
              </dd>
            </div>
            <div>
              <dt>Sold</dt>
              <dd>{formatInstantDay(sale.soldAt)}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>
                <PayoutStatus payout={payout} />
              </dd>
            </div>
          </>
        )}
        {!sale && payout?.status === 'void' && (
          <div>
            <dt>Payment</dt>
            <dd>The sale was voided, so nothing is owed for it. If the lot sells again, a new payment is recorded.</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function PayoutStatus({ payout }: { payout: LotRow['payout'] }) {
  if (!payout) return <>Kofi is recording the payment</>;
  if (payout.status === 'paid') {
    return (
      <span className="sts-paid">
        <StatusDot status="accepted" />
        Paid on {payout.paidAt ? formatInstantDay(payout.paidAt) : 'record'}
        {payout.method ? ` · ${payout.method}` : ''}
      </span>
    );
  }
  if (payout.status === 'void') return <>Voided</>;
  return (
    <span className="sts-due">
      <StatusDot status="pending" />
      Due · {formatMoney(payout.amount, payout.currency)}
    </span>
  );
}
