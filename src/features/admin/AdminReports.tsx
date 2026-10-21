import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KofiReport, ParticipationRow, PaymentRow, PlacementKind, PlacementRow } from '@/domain/types';
import { CALL_KIND_LABEL } from '@/domain/types';
import { formatMoney } from '@/domain/sales';
import { kofiToday } from '@/domain/programme';
import { participationCsv, paymentsCsv, placementsCsv, validateRange } from '@/domain/reports';
import { ValidationError } from '@/data/DataSource';
import { saveTextFile } from '@/native/platform';
import { useQuery } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { APPLICATION_STATUS_LABEL, formatDateRange, formatDay } from '@/features/programme/format';
import { Button, ErrorState, Icon, Input, Segmented, Skeleton, TopBar } from '@/ui';
import { daysBefore, moneyLines, PAYOUT_STATUS_LABEL } from './salesShared';
import './admin.css';
import './programme.css';
import './sales.css';

/** Reports start with Kofi's first programme year. */
export const ALL_TIME_FROM = '2024-01-01';
const SHOWN_ROWS = 50;

type Preset = 'year' | '90' | 'all' | 'custom';

const PLACEMENT_LABEL: Record<PlacementKind, string> = {
  exhibition: 'Exhibition',
  selection: 'Selected',
  lot: 'Lot',
  sale: 'Sale',
};

export function AdminReports() {
  const [params, setParams] = useSearchParams();
  const today = kofiToday();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const from = params.get('from') ?? yearStart;
  const to = params.get('to') ?? today;

  const presets: Record<Exclude<Preset, 'custom'>, { from: string; to: string }> = {
    year: { from: yearStart, to: today },
    '90': { from: daysBefore(today, 90), to: today },
    all: { from: ALL_TIME_FROM, to: today },
  };
  const preset: Preset = (Object.keys(presets) as (keyof typeof presets)[]).find((k) => presets[k].from === from && presets[k].to === to) ?? 'custom';

  const setRange = (next: { from?: string; to?: string }) => {
    const p = new URLSearchParams(params);
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (f === yearStart && t === today) {
      p.delete('from');
      p.delete('to');
    } else {
      p.set('from', f);
      p.set('to', t);
    }
    setParams(p, { replace: true });
  };

  const problem = validateRange({ from, to }, today);
  const q = useQuery(
    async (ds, v): Promise<KofiReport | undefined> => {
      if (validateRange({ from, to }, kofiToday())) return undefined;
      return ds.kofiReport(v, { from, to });
    },
    [from, to],
  );
  const serverRangeError = q.error instanceof ValidationError ? q.error.message : undefined;
  const rangeError = problem ?? serverRangeError;
  const report = problem ? undefined : q.data;
  const fileRange = `${from}_${to}`;

  return (
    <div className="screen">
      <TopBar title="Reports" back="/admin" />
      <main className="container container--wide ad-main stack--lg">
        <section className="rp-head">
          <div className="stack">
            <p className="eyebrow eyebrow--gold">Kofi desk</p>
            <h2 className="h1">Reports</h2>
            <span className="rule" aria-hidden="true" />
            <p className="ad-lede" style={{ marginTop: 0 }}>
              Who took part, where work was placed and what artists were paid, built from applications, exhibitions, lots and payouts. Dates are Pittsburgh days.
            </p>
          </div>
          <fieldset className="rp-range" aria-describedby={rangeError ? 'rp-range-err' : undefined}>
            <legend className="field__label">Date range</legend>
            <div className="seg-wrap rp-presets">
              <Segmented<Preset>
                label="Preset ranges"
                value={preset}
                onChange={(p) => p !== 'custom' && setRange(presets[p])}
                options={[
                  { value: 'year', label: 'This year' },
                  { value: '90', label: 'Last 90 days' },
                  { value: 'all', label: 'All time' },
                ]}
              />
            </div>
            <div className="pg-two">
              <Input label="From" type="date" value={from} max={today} aria-invalid={rangeError ? true : undefined} onChange={(e) => setRange({ from: e.target.value })} />
              <Input label="To" type="date" value={to} aria-invalid={rangeError ? true : undefined} onChange={(e) => setRange({ to: e.target.value })} />
            </div>
            {rangeError ? (
              <p className="field__error" id="rp-range-err" role="alert">
                {rangeError}
              </p>
            ) : (
              <p className="tiny muted">{formatDateRange(from, to)}</p>
            )}
          </fieldset>
        </section>

        {rangeError ? null : q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !report ? (
          <div className="stack" aria-busy="true" aria-label="Loading report">
            <Skeleton h={120} />
            <Skeleton h={240} />
          </div>
        ) : (
          <ReportBody report={report} fileRange={fileRange} stale={q.loading} />
        )}
      </main>
    </div>
  );
}

function ReportBody({ report, fileRange, stale }: { report: KofiReport; fileRange: string; stale: boolean }) {
  const t = report.totals;
  return (
    <div className="stack--lg" aria-busy={stale || undefined}>
      <section aria-labelledby="rp-totals">
        <h2 className="sr-only" id="rp-totals">
          Totals
        </h2>
        <div className="rp-counts">
          <Count n={t.applications} label={t.applications === 1 ? 'Application' : 'Applications'} />
          <Count n={t.selected} label="Selected of these" />
          <Count n={t.artistsParticipating} label={t.artistsParticipating === 1 ? 'Artist taking part' : 'Artists taking part'} />
          <Count n={t.lotsSold} label={t.lotsSold === 1 ? 'Lot sold' : 'Lots sold'} />
        </div>
        <div className="rp-money">
          <MoneyTile label="Hammer total" lines={moneyLines(t.hammerTotal)} tone="cream" />
          <MoneyTile label="Paid to artists" lines={moneyLines(t.artistPaid)} tone="green" />
          <MoneyTile label="Due to artists" lines={moneyLines(t.artistDue)} tone="gold" />
        </div>
      </section>

      <ReportSection
        id="participation"
        title="Participation"
        sub="Applications sent in this range, by artist and call."
        rows={report.participation}
        csv={() => participationCsv(report.participation)}
        fileName={`kofi-participation-${fileRange}.csv`}
        head={['Artist', 'Call', 'Kind', 'Organiser', 'Status', 'Works', 'Sent', 'Decided']}
        row={(r: ParticipationRow) => [
          r.artistWorkingName,
          r.callTitle,
          CALL_KIND_LABEL[r.callKind],
          r.organizer,
          APPLICATION_STATUS_LABEL[r.status],
          <span className="rp-num">{r.worksAttached}</span>,
          formatDay(r.submittedOn),
          r.decidedOn ? formatDay(r.decidedOn) : '—',
        ]}
        rowKey={(r) => r.applicationId}
      />
      <ReportSection
        id="placements"
        title="Placements"
        sub="Works shown in exhibitions, selected from calls, offered as lots and sold."
        rows={report.placements}
        csv={() => placementsCsv(report.placements)}
        fileName={`kofi-placements-${fileRange}.csv`}
        head={['Artist', 'Work', 'Placement', 'Where', 'On', 'Amount']}
        row={(r: PlacementRow) => [
          r.artistWorkingName,
          r.artworkTitle,
          PLACEMENT_LABEL[r.kind],
          r.where,
          formatDay(r.on),
          <span className="rp-num">{r.amount !== undefined && r.currency ? formatMoney(r.amount, r.currency) : '—'}</span>,
        ]}
        rowKey={(r, i) => `${r.kind}-${r.artworkId}-${r.where}-${r.on}-${i}`}
      />
      <ReportSection
        id="payments"
        title="Payments"
        sub="Sales in this range and the artist’s payout for each. Voided sales are left out."
        rows={report.payments}
        csv={() => paymentsCsv(report.payments)}
        fileName={`kofi-payments-${fileRange}.csv`}
        head={['Artist', 'Work', 'Call', 'Lot', 'Hammer', 'Artist share', 'Kofi', 'Partner', 'Premium', 'Payout', 'Sold', 'Paid', 'Method', 'Reference']}
        row={(r: PaymentRow) => {
          const m = (n: number) => <span className="rp-num">{formatMoney(n, r.currency)}</span>;
          return [
            r.artistWorkingName,
            r.artworkTitle,
            r.callTitle,
            <span className="rp-num">{r.lotNumber}</span>,
            m(r.hammerPrice),
            m(r.artistAmount),
            m(r.kofiAmount),
            m(r.partnerAmount),
            m(r.buyerPremium),
            PAYOUT_STATUS_LABEL[r.status],
            formatDay(r.soldOn),
            r.paidOn ? formatDay(r.paidOn) : '—',
            r.method ?? '—',
            r.reference ?? '—',
          ];
        }}
        rowKey={(r) => r.payoutId}
      />
    </div>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div className="tile rp-tile">
      <span className="tile__num rp-tile__num">{n}</span>
      <span className="tile__label">{label}</span>
    </div>
  );
}

function MoneyTile({ label, lines, tone }: { label: string; lines: string[]; tone: 'cream' | 'green' | 'gold' }) {
  return (
    <div className={`rp-mtile rp-mtile--${tone}`}>
      <span className="tile__label">{label}</span>
      {lines.map((l) => (
        <span key={l} className="rp-mtile__n">
          {l}
        </span>
      ))}
    </div>
  );
}

function ReportSection<T>({
  id,
  title,
  sub,
  rows,
  head,
  row,
  rowKey,
  csv,
  fileName,
}: {
  id: string;
  title: string;
  sub: string;
  rows: T[];
  head: string[];
  row: (r: T) => ReactNode[];
  rowKey: (r: T, i: number) => string;
  csv: () => string;
  fileName: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const shown = rows.slice(0, SHOWN_ROWS);
  const more = rows.length - shown.length;
  const headId = `rp-${id}`;

  async function download() {
    setBusy(true);
    try {
      const outcome = await saveTextFile(fileName, csv(), 'text/csv');
      toast.push(outcome === 'shared' ? 'Shared' : `Downloaded ${fileName}`, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack rp-section" aria-labelledby={headId}>
      <div className="rp-section__head">
        <div>
          <h2 className="group-title" id={headId}>
            {title}
            <span className="group-title__count">{rows.length}</span>
          </h2>
          <p className="small muted">{sub}</p>
        </div>
        <Button tone="secondary" size="sm" icon={<Icon.Download />} loading={busy} aria-label={`Download CSV: ${title.toLowerCase()}`} onClick={() => void download()}>
          Download CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="small muted rp-empty">Nothing in this range.</p>
      ) : (
        <div className="rp-scroll" role="region" aria-label={`${title} table`} tabIndex={0}>
          <table className="rp-table">
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={i} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={rowKey(r, i)}>
                  {row(r).map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more > 0 && (
        <p className="small muted">
          and {more} more in the CSV.
        </p>
      )}
    </section>
  );
}
