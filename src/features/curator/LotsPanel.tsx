/**
 * Lots on an auction call, for whoever runs it (the partner desk; the rules are
 * the same ones Kofi's desk uses, enforced by the data layer): list, new lot from
 * a selected work, record a sale, status moves, void a sale, delete.
 * Every amount is whole cents and goes through formatMoney/parseMoney.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ApplicationRow, LotRow, LotStatus, OpenCall } from '@/domain/types';
import { kofiToday } from '@/domain/programme';
import { canMoveLot, parseMoney, splitSale } from '@/domain/sales';
import { ValidationError } from '@/data/DataSource';
import { useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { formatInstantDay } from '@/features/programme/format';
import { money } from '@/features/programme/terms';
import { Button, Confirm, EmptyState, Icon, Input, Notice, Select, Sheet, StatusDot } from '@/ui';
import { LOT_MOVE_LABEL, LOT_STATUS_DOT, LOT_STATUS_LABEL } from './partnerShared';

interface Candidate {
  value: string;
  applicationId: string;
  artworkId: string;
  label: string;
}

/** Works on accepted applications that are not already a (non-withdrawn) lot. */
export function lotCandidates(apps: ApplicationRow[], lots: Pick<LotRow, 'artworkId' | 'status'>[]): Candidate[] {
  const taken = new Set(lots.filter((l) => l.status !== 'withdrawn').map((l) => l.artworkId));
  const out: Candidate[] = [];
  for (const a of apps) {
    if (a.status !== 'accepted') continue;
    for (const wid of a.artworkIds) {
      if (taken.has(wid)) continue;
      const w = a.works.find((x) => x.id === wid);
      out.push({ value: `${a.id}:${wid}`, applicationId: a.id, artworkId: wid, label: `${w?.title ?? 'Untitled work'} · ${a.artistWorkingName}` });
    }
  }
  return out;
}

/** "" → undefined (empty is allowed); anything unparseable → NaN. */
function moneyField(s: string): number | undefined {
  if (!s.trim()) return undefined;
  return parseMoney(s) ?? Number.NaN;
}
const centsToField = (c: number | undefined) => (c === undefined ? '' : (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const MOVES: Exclude<LotStatus, 'sold'>[] = ['live', 'unsold', 'withdrawn', 'planned'];

export function LotsPanel({ call, lots, apps, partnerName }: { call: OpenCall; lots: LotRow[]; apps: ApplicationRow[]; partnerName: string }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const currency = call.terms?.currency ?? 'USD';
  const candidates = useMemo(() => lotCandidates(apps, lots), [apps, lots]);
  const [editing, setEditing] = useState<{ lot?: LotRow } | undefined>();
  const [selling, setSelling] = useState<LotRow>();
  const [managing, setManaging] = useState<LotRow>();
  const [voiding, setVoiding] = useState<LotRow>();
  const [deleting, setDeleting] = useState<LotRow>();

  const sold = lots.filter((l) => l.status === 'sold');
  const hammer = sold.reduce((n, l) => n + (l.sale?.hammerPrice ?? 0), 0);
  const nextNumber = lots.reduce((n, l) => Math.max(n, l.lotNumber), 0) + 1;

  async function moveTo(lot: LotRow, to: LotStatus) {
    try {
      await data.setLotStatus(viewer, lot.id, to);
      toast.push(`Lot ${lot.lotNumber}: ${LOT_STATUS_LABEL[to].toLowerCase()}`, 'success');
      setManaging(undefined);
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    }
  }

  return (
    <section className="stack" aria-labelledby="pc-lots-title">
      <div className="cu-head">
        <div>
          <p className="eyebrow eyebrow--gold">
            {lots.length === 1 ? '1 lot' : `${lots.length} lots`} · {sold.length} sold{sold.length ? ` · ${money(hammer, currency)} hammer` : ''}
          </p>
          <h2 className="section-title" id="pc-lots-title">
            Lots
          </h2>
        </div>
        <Button size="sm" icon={<Icon.Plus />} disabled={!call.terms} onClick={() => setEditing({})}>
          New lot
        </Button>
      </div>
      {!call.terms ? (
        <Notice tone="coral" icon={<Icon.Warn />}>
          Set the call’s terms before adding lots.
        </Notice>
      ) : (
        <p className="small muted">
          Lots come from selected works. The reserve is the artist’s: the lowest hammer price they agreed to. Recording a sale splits the hammer price by the published terms; Kofi pays the artist.
        </p>
      )}

      {lots.length === 0 ? (
        <EmptyState
          title="No lots yet"
          body={candidates.length ? `${candidates.length === 1 ? 'One selected work is' : `${candidates.length} selected works are`} ready to become lots.` : 'Select applications first; their works can then become lots.'}
        />
      ) : (
        <div className="pc-lots-wrap">
          <table className="pc-lots">
            <caption className="sr-only">Lots in {call.title}</caption>
            <thead>
              <tr>
                <th scope="col">Lot</th>
                <th scope="col">Work</th>
                <th scope="col">Status</th>
                <th scope="col" className="pc-num">
                  Reserve
                </th>
                <th scope="col" className="pc-num">
                  Hammer
                </th>
                <th scope="col">Split</th>
                <th scope="col">Buyer ref</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const img = l.work ? (l.work.images.find((i) => i.isPrimary) ?? l.work.images[0]) : undefined;
                const c = l.sale?.currency ?? currency;
                const canSell = l.status !== 'sold' && l.status !== 'withdrawn';
                return (
                  <tr key={l.id} data-medium={l.work?.medium} data-status={l.status}>
                    <th scope="row" className="pc-lotno">
                      <span className="pc-lotno__n">{l.lotNumber}</span>
                      <span className="sr-only">Lot {l.lotNumber}</span>
                    </th>
                    <td className="pc-workcell" data-label="Work">
                      <div className="pc-work">
                        {img ? <img className="thumb" src={img.src} alt="" /> : <span className="thumb pg-row__thumb--empty" aria-hidden="true" />}
                        <span className="pc-work__text">
                          <span className="pc-work__title">{l.artworkTitle}</span>
                          <span className="pc-work__artist">{l.artistWorkingName}</span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Status">
                      <span className="status-pill">
                        <StatusDot status={LOT_STATUS_DOT[l.status]} />
                        {LOT_STATUS_LABEL[l.status]}
                      </span>
                    </td>
                    <td className="pc-num" data-label="Reserve">
                      <span className="pc-vals">
                        <span>{l.reserve !== undefined ? money(l.reserve, c) : '—'}</span>
                        {l.startingBid !== undefined && <span className="pc-sub">Starting bid {money(l.startingBid, c)}</span>}
                      </span>
                    </td>
                    <td className="pc-num" data-label="Hammer">
                      {l.sale ? (
                        <span className="pc-vals">
                          <span>{money(l.sale.hammerPrice, l.sale.currency)}</span>
                          <span className="pc-sub">Sold {formatInstantDay(l.sale.soldAt)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Split">
                      {l.sale ? (
                        <span className="pc-vals">
                          <span>Artist {money(l.sale.artistAmount, l.sale.currency)}</span>
                          <span>Kofi {money(l.sale.kofiAmount, l.sale.currency)}</span>
                          {l.sale.partnerAmount > 0 && <span>{partnerName} {money(l.sale.partnerAmount, l.sale.currency)}</span>}
                          {l.sale.buyerPremium > 0 && <span className="pc-sub">Buyer’s premium {money(l.sale.buyerPremium, l.sale.currency)}</span>}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Buyer ref">{l.sale?.buyerRef ?? '—'}</td>
                    <td className="pc-actions">
                      {canSell && (
                        <Button size="sm" onClick={() => setSelling(l)} aria-label={`Record sale, lot ${l.lotNumber}`}>
                          Record sale
                        </Button>
                      )}
                      {l.status === 'sold' ? (
                        <Button size="sm" tone="secondary" onClick={() => setVoiding(l)} aria-label={`Void sale, lot ${l.lotNumber}`}>
                          Void sale
                        </Button>
                      ) : (
                        <Button size="sm" tone="ghost" onClick={() => setManaging(l)} aria-label={`Manage lot ${l.lotNumber}`}>
                          Manage
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LotSheet open={!!editing} lot={editing?.lot} call={call} candidates={candidates} nextNumber={nextNumber} onClose={() => setEditing(undefined)} />
      <SaleSheet lot={selling} call={call} partnerName={partnerName} onClose={() => setSelling(undefined)} />

      <Sheet open={!!managing} onClose={() => setManaging(undefined)} title={managing ? `Lot ${managing.lotNumber}` : 'Lot'}>
        {managing && (
          <div className="stack">
            <p className="small">
              {managing.artworkTitle} · {managing.artistWorkingName}. Now <span className="strong">{LOT_STATUS_LABEL[managing.status].toLowerCase()}</span>.
            </p>
            <div className="pc-movegroup" role="group" aria-label="Move the lot">
              {MOVES.filter((m) => canMoveLot(managing.status, m)).map((m) => (
                <Button key={m} tone={m === 'withdrawn' ? 'secondary' : m === 'live' ? 'primary' : 'secondary'} block onClick={() => void moveTo(managing, m)}>
                  {managing.status === 'withdrawn' && m === 'planned' ? 'Reinstate' : LOT_MOVE_LABEL[m]}
                </Button>
              ))}
            </div>
            <div className="pc-movegroup">
              <Button
                tone="ghost"
                block
                icon={<Icon.Edit />}
                onClick={() => {
                  const l = managing;
                  setManaging(undefined);
                  setEditing({ lot: l });
                }}
              >
                Edit lot number and reserve
              </Button>
              <Button
                tone="ghost"
                block
                className="pg-delete"
                icon={<Icon.Trash />}
                onClick={() => {
                  const l = managing;
                  setManaging(undefined);
                  setDeleting(l);
                }}
              >
                Delete lot
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <Confirm
        open={!!voiding}
        onClose={() => setVoiding(undefined)}
        title={voiding ? `Void the sale of lot ${voiding.lotNumber}?` : 'Void the sale?'}
        body="The recorded sale is cleared and the lot goes back to unsold. Kofi keeps the voided payment on the record. A sale Kofi has already settled with the artist can’t be voided from here; ask Kofi."
        confirmLabel="Void sale"
        danger
        onConfirm={async () => {
          if (!voiding) return;
          try {
            await data.setLotStatus(viewer, voiding.id, 'unsold');
            toast.push(`Lot ${voiding.lotNumber}: sale voided`, 'success');
            setVoiding(undefined);
          } catch (e) {
            // Payout state is Kofi's business, not the organiser's: never echo it here.
            const msg = /payout/i.test(errorMessage(e)) ? 'This sale is closed on Kofi’s side and can’t be voided from here. Ask Kofi.' : errorMessage(e);
            toast.push(msg, 'error');
            setVoiding(undefined);
          }
        }}
      />
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={deleting ? `Delete lot ${deleting.lotNumber}?` : 'Delete the lot?'}
        body="The work stays selected and can become a lot again. A lot with a sale on record can’t be deleted; withdraw it instead."
        confirmLabel="Delete lot"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await data.deleteLot(viewer, deleting.id);
            toast.push(`Lot ${deleting.lotNumber} deleted`, 'success');
          } catch (e) {
            toast.push(errorMessage(e), 'error');
          }
          setDeleting(undefined);
        }}
      />
    </section>
  );
}

/* ---------------- new / edit lot ---------------- */

type LotErrors = { work?: string; lotNumber?: string; reserve?: string; startingBid?: string; general?: string };

function LotSheet({ open, lot, call, candidates, nextNumber, onClose }: { open: boolean; lot?: LotRow; call: OpenCall; candidates: Candidate[]; nextNumber: number; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [work, setWork] = useState('');
  const [num, setNum] = useState('');
  const [reserve, setReserve] = useState('');
  const [start, setStart] = useState('');
  const [errors, setErrors] = useState<LotErrors>({});
  const [busy, setBusy] = useState(false);
  const currency = call.terms?.currency ?? 'USD';

  useEffect(() => {
    if (!open) return;
    setWork(lot ? `${lot.applicationId}:${lot.artworkId}` : '');
    setNum(String(lot?.lotNumber ?? nextNumber));
    setReserve(centsToField(lot?.reserve));
    setStart(centsToField(lot?.startingBid));
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lot?.id]);

  async function save() {
    const e: LotErrors = {};
    const [applicationId = '', artworkId = ''] = work.split(':');
    if (!lot && !work) e.work = 'Choose a selected work.';
    const n = Number(num);
    if (!/^\d+$/.test(num.trim()) || n < 1 || n > 9999) e.lotNumber = 'Lot number must be between 1 and 9999.';
    const r = moneyField(reserve);
    const s = moneyField(start);
    if (Number.isNaN(r)) e.reserve = 'Enter an amount like 1,000.00, or leave it empty.';
    if (Number.isNaN(s)) e.startingBid = 'Enter an amount like 500.00, or leave it empty.';
    if (Object.values(e).some(Boolean)) {
      setErrors(e);
      return;
    }
    setBusy(true);
    try {
      const saved = await data.saveLot(viewer, {
        id: lot?.id,
        callId: call.id,
        applicationId: lot?.applicationId ?? applicationId,
        artworkId: lot?.artworkId ?? artworkId,
        lotNumber: n,
        ...(r !== undefined ? { reserve: r } : {}),
        ...(s !== undefined ? { startingBid: s } : {}),
      });
      toast.push(lot ? `Lot ${saved.lotNumber} saved` : `Lot ${saved.lotNumber} created: ${saved.artworkTitle}`, 'success');
      onClose();
    } catch (err) {
      if (err instanceof ValidationError) {
        const f = err.field;
        if (f === 'artworkId' || f === 'applicationId') setErrors({ work: err.message });
        else if (f === 'lotNumber' || f === 'reserve' || f === 'startingBid') setErrors({ [f]: err.message });
        else setErrors({ general: err.message });
      } else setErrors({ general: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={lot ? `Edit lot ${lot.lotNumber}` : 'New lot'}
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={save} disabled={!lot && candidates.length === 0}>
            {lot ? 'Save lot' : 'Create lot'}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {errors.general && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            {errors.general}
          </Notice>
        )}
        {lot ? (
          <div className="pc-readonly">
            <span className="field__label">Work</span>
            <p className="pc-readonly__value">
              {lot.artworkTitle} · {lot.artistWorkingName}
            </p>
          </div>
        ) : candidates.length === 0 ? (
          <Notice tone="plain" icon={<Icon.Info />}>
            Every selected work is already a lot. Select more applications to add lots.
          </Notice>
        ) : (
          <Select label="Work" hint="Works on selected applications that are not lots yet." value={work} error={errors.work} onChange={(e) => {
            setWork(e.target.value);
            setErrors((x) => ({ ...x, work: undefined, general: undefined }));
          }}>
            <option value="">Choose a selected work</option>
            {candidates.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
        <Input label="Lot number" type="number" inputMode="numeric" min={1} max={9999} value={num} error={errors.lotNumber} onChange={(e) => {
          setNum(e.target.value);
          setErrors((x) => ({ ...x, lotNumber: undefined }));
        }} />
        <div className="pg-two">
          <Input
            label={`Reserve (${currency})`}
            hint="The artist’s reserve: the lowest hammer price they agreed to."
            inputMode="decimal"
            placeholder="1,000.00"
            value={reserve}
            error={errors.reserve}
            onChange={(e) => {
              setReserve(e.target.value);
              setErrors((x) => ({ ...x, reserve: undefined, startingBid: undefined }));
            }}
          />
          <Input
            label={`Starting bid (${currency})`}
            hint="Optional. Not above the reserve."
            inputMode="decimal"
            placeholder="500.00"
            value={start}
            error={errors.startingBid}
            onChange={(e) => {
              setStart(e.target.value);
              setErrors((x) => ({ ...x, startingBid: undefined }));
            }}
          />
        </div>
      </form>
    </Sheet>
  );
}

/* ---------------- record a sale ---------------- */

type SaleErrors = { hammerPrice?: string; soldOn?: string; buyerRef?: string; general?: string };

function SaleSheet({ lot, call, partnerName, onClose }: { lot?: LotRow; call: OpenCall; partnerName: string; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [hammer, setHammer] = useState('');
  const [soldOn, setSoldOn] = useState(kofiToday());
  const [buyer, setBuyer] = useState('');
  const [errors, setErrors] = useState<SaleErrors>({});
  const [busy, setBusy] = useState(false);
  const terms = call.terms;
  const currency = terms?.currency ?? 'USD';
  const today = kofiToday();

  useEffect(() => {
    if (!lot) return;
    setHammer('');
    setSoldOn(kofiToday());
    setBuyer('');
    setErrors({});
  }, [lot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parseMoney(hammer);
  const preview = terms && cents && cents > 0 ? splitSale(cents, terms, '') : undefined;
  const belowReserve = !!lot && lot.reserve !== undefined && cents !== undefined && cents > 0 && cents < lot.reserve;

  async function record() {
    if (!lot) return;
    const e: SaleErrors = {};
    if (!cents || cents <= 0) e.hammerPrice = 'Enter the hammer price, like 2,500.00.';
    if (!soldOn) e.soldOn = 'Enter the date of the sale.';
    if (Object.values(e).some(Boolean)) {
      setErrors(e);
      return;
    }
    setBusy(true);
    try {
      const saved = await data.recordSale(viewer, lot.id, { hammerPrice: cents!, soldOn, ...(buyer.trim() ? { buyerRef: buyer.trim() } : {}) });
      toast.push(`Lot ${saved.lotNumber} sold for ${money(saved.sale?.hammerPrice ?? cents!, currency)}`, 'success');
      onClose();
    } catch (err) {
      if (err instanceof ValidationError && (err.field === 'hammerPrice' || err.field === 'soldOn' || err.field === 'buyerRef')) setErrors({ [err.field]: err.message });
      else setErrors({ general: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!lot}
      onClose={onClose}
      title="Record sale"
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={record}>
            Record sale
          </Button>
        </>
      }
    >
      {lot && (
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void record();
          }}
        >
          <p className="small">
            Lot {lot.lotNumber}: <span className="strong">{lot.artworkTitle}</span> by {lot.artistWorkingName}.{' '}
            {lot.reserve !== undefined ? `The artist’s reserve is ${money(lot.reserve, currency)}.` : 'No reserve was set.'}
          </p>
          {errors.general && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              {errors.general}
            </Notice>
          )}
          <Input
            label={`Hammer price (${currency})`}
            hint="The winning bid, before the buyer’s premium."
            inputMode="decimal"
            placeholder="2,500.00"
            autoFocus
            value={hammer}
            error={errors.hammerPrice ?? (belowReserve ? 'This is below the artist’s reserve.' : undefined)}
            onChange={(e) => {
              setHammer(e.target.value);
              setErrors((x) => ({ ...x, hammerPrice: undefined, general: undefined }));
            }}
          />
          <Input label="Sold on" type="date" max={today} value={soldOn} error={errors.soldOn} onChange={(e) => {
            setSoldOn(e.target.value);
            setErrors((x) => ({ ...x, soldOn: undefined }));
          }} />
          <Input
            label="Buyer reference"
            hint="Optional. A paddle number or the buyer’s organisation. Seen by Kofi and your institution, never by the artist."
            maxLength={160}
            value={buyer}
            error={errors.buyerRef}
            onChange={(e) => setBuyer(e.target.value)}
          />
          <div className="pc-example" aria-live="polite">
            <p className="eyebrow">How it is shared</p>
            {preview && terms ? (
              <dl className="pc-splitlist">
                <div>
                  <dt>Artist ({terms.artistSharePct}%)</dt>
                  <dd>{money(preview.artistAmount, currency)}</dd>
                </div>
                <div>
                  <dt>Kofi ({terms.kofiSharePct}%)</dt>
                  <dd>{money(preview.kofiAmount, currency)}</dd>
                </div>
                {terms.partnerSharePct > 0 && (
                  <div>
                    <dt>
                      {partnerName} ({terms.partnerSharePct}%)
                    </dt>
                    <dd>{money(preview.partnerAmount, currency)}</dd>
                  </div>
                )}
                <div>
                  <dt>Buyer pays</dt>
                  <dd>
                    {money(preview.hammerPrice + preview.buyerPremium, currency)}
                    {preview.buyerPremium > 0 && <span className="pc-sub">incl. {terms.buyerPremiumPct}% premium</span>}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="small muted">Enter the hammer price to see the split from the call’s terms.</p>
            )}
          </div>
        </form>
      )}
    </Sheet>
  );
}
