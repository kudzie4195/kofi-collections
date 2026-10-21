/**
 * Sheets for the lots desk: make a lot from a selected work, and record a sale.
 * The sale preview runs domain/sales.splitSale on the call's terms, so what Kofi
 * sees before confirming is exactly what gets frozen.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicationRow, LotRow, OpenCall } from '@/domain/types';
import { formatMoney, parseMoney, splitSale, validateSale } from '@/domain/sales';
import { kofiToday } from '@/domain/programme';
import { ValidationError } from '@/data/DataSource';
import { useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Icon, Input, Notice, Select, Sheet } from '@/ui';

type Errors = Record<string, string | undefined>;

const MONEY_HINT = 'e.g. 2,500.00';

/** '' → undefined (empty); a bad amount → null. */
function optMoney(s: string): number | undefined | null {
  if (!s.trim()) return undefined;
  return parseMoney(s) ?? null;
}

/* ---------------- record sale ---------------- */

export function RecordSaleSheet({ lot, call, onClose }: { lot: LotRow | undefined; call: OpenCall | undefined; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [hammer, setHammer] = useState('');
  const [soldOn, setSoldOn] = useState('');
  const [buyer, setBuyer] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const today = kofiToday();

  useEffect(() => {
    if (!lot) return;
    setHammer('');
    setSoldOn(kofiToday());
    setBuyer('');
    setErrors({});
  }, [lot]);

  const terms = call?.terms;
  const cents = parseMoney(hammer);
  const preview = terms && cents && cents > 0 ? splitSale(cents, terms, new Date(0).toISOString()) : undefined;
  const cur = terms?.currency ?? 'USD';
  const m = (n: number) => formatMoney(n, cur);

  async function go() {
    if (!lot) return;
    const c = parseMoney(hammer);
    const local: Errors = {};
    if (!hammer.trim()) local.hammerPrice = 'Enter the hammer price.';
    else if (c === undefined) local.hammerPrice = 'Enter an amount like 2,500.00.';
    if (!local.hammerPrice) {
      const p = validateSale(lot, { hammerPrice: c ?? 0, soldOn, buyerRef: buyer.trim() || undefined }, today);
      if (p) local[p.field === 'status' ? 'general' : p.field] = p.message;
    }
    if (Object.values(local).some(Boolean)) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      const row = await data.recordSale(viewer, lot.id, { hammerPrice: c!, soldOn, buyerRef: buyer.trim() || undefined });
      const s = row.sale!;
      toast.push(`Lot ${row.lotNumber} sold for ${formatMoney(s.hammerPrice, s.currency)}. ${formatMoney(s.artistAmount, s.currency)} is due to ${row.artistWorkingName}.`, 'success');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError && e.field && ['hammerPrice', 'soldOn', 'buyerRef'].includes(e.field)) setErrors({ [e.field]: e.message });
      else setErrors({ general: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!lot}
      onClose={onClose}
      title={lot ? `Record sale: lot ${lot.lotNumber}` : 'Record sale'}
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={go}>
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
            void go();
          }}
        >
          <p className="small">
            <span className="strong">{lot.artworkTitle}</span> by {lot.artistWorkingName}
            {lot.reserve !== undefined && <span className="muted"> · the artist’s reserve is {m(lot.reserve)}</span>}
          </p>
          {errors.general && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              {errors.general}
            </Notice>
          )}
          {!terms && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              This call has no published terms, so a sale cannot be split yet.
            </Notice>
          )}
          <Input
            label={`Hammer price (${cur})`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={MONEY_HINT}
            hint="The winning bid, before the buyer’s premium."
            value={hammer}
            error={errors.hammerPrice}
            onChange={(e) => {
              setHammer(e.target.value);
              if (errors.hammerPrice || errors.general) setErrors({});
            }}
          />
          {preview && (
            <dl className="lt-preview" aria-live="polite" data-testid="sale-preview">
              <div>
                <dt>Artist receives</dt>
                <dd>{m(preview.artistAmount)}</dd>
              </div>
              <div>
                <dt>Kofi</dt>
                <dd>{m(preview.kofiAmount)}</dd>
              </div>
              {preview.partnerAmount > 0 && (
                <div>
                  <dt>Partner</dt>
                  <dd>{m(preview.partnerAmount)}</dd>
                </div>
              )}
              <div>
                <dt>Buyer pays</dt>
                <dd>{m(preview.hammerPrice + preview.buyerPremium)}</dd>
              </div>
            </dl>
          )}
          <Input
            label="Sold on"
            type="date"
            max={today}
            value={soldOn}
            error={errors.soldOn}
            onChange={(e) => {
              setSoldOn(e.target.value);
              if (errors.soldOn) setErrors((x) => ({ ...x, soldOn: undefined }));
            }}
          />
          <Input
            label="Buyer reference"
            hint="Paddle number or the buyer’s organisation. Kofi and the organiser only; never shown to the artist."
            maxLength={160}
            value={buyer}
            error={errors.buyerRef}
            onChange={(e) => setBuyer(e.target.value)}
          />
          <p className="tiny muted">The split is fixed from the call’s terms when you record the sale, and the artist’s payout is created as due.</p>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Sheet>
  );
}

/* ---------------- new lot ---------------- */

interface Candidate {
  key: string;
  applicationId: string;
  artworkId: string;
  label: string;
}

/** Works on accepted applications to `callId` that are not already a (non-withdrawn) lot there. */
export function lotCandidates(callId: string, apps: ApplicationRow[], lots: LotRow[]): Candidate[] {
  const taken = new Set(lots.filter((l) => l.callId === callId && l.status !== 'withdrawn').map((l) => l.artworkId));
  const out: Candidate[] = [];
  for (const a of apps) {
    if (a.callId !== callId || a.status !== 'accepted') continue;
    for (const wid of a.artworkIds) {
      if (taken.has(wid)) continue;
      const w = a.works.find((x) => x.id === wid);
      out.push({ key: `${a.id}|${wid}`, applicationId: a.id, artworkId: wid, label: `${w?.title ?? 'Untitled work'}, ${a.artistWorkingName}` });
    }
  }
  return out;
}

export function NewLotSheet({
  open,
  onClose,
  calls,
  apps,
  lots,
  initialCallId,
}: {
  open: boolean;
  onClose: () => void;
  /** Auction calls. */
  calls: OpenCall[];
  apps: ApplicationRow[];
  lots: LotRow[];
  initialCallId?: string;
}) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [callId, setCallId] = useState('');
  const [pick, setPick] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [reserve, setReserve] = useState('');
  const [startingBid, setStartingBid] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const nextNumber = (cid: string) => String(Math.max(0, ...lots.filter((l) => l.callId === cid).map((l) => l.lotNumber)) + 1);

  useEffect(() => {
    if (!open) return;
    const cid = initialCallId && calls.some((c) => c.id === initialCallId) ? initialCallId : (calls[0]?.id ?? '');
    setCallId(cid);
    setPick(lotCandidates(cid, apps, lots)[0]?.key ?? '');
    setLotNumber(nextNumber(cid));
    setReserve('');
    setStartingBid('');
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const candidates = useMemo(() => lotCandidates(callId, apps, lots), [callId, apps, lots]);
  const call = calls.find((c) => c.id === callId);
  const cur = call?.terms?.currency ?? 'USD';

  async function go() {
    const local: Errors = {};
    const c = candidates.find((x) => x.key === pick);
    if (!c) local.artworkId = 'Choose a selected work.';
    const n = Number(lotNumber);
    if (!Number.isInteger(n) || n < 1 || n > 9999) local.lotNumber = 'Lot number must be between 1 and 9999.';
    const r = optMoney(reserve);
    const sb = optMoney(startingBid);
    if (r === null) local.reserve = 'Enter an amount like 1,000.00, or leave it empty.';
    if (sb === null) local.startingBid = 'Enter an amount like 500.00, or leave it empty.';
    if (Object.values(local).some(Boolean)) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      const row = await data.saveLot(viewer, {
        callId,
        applicationId: c!.applicationId,
        artworkId: c!.artworkId,
        lotNumber: n,
        ...(r !== undefined && r !== null ? { reserve: r } : {}),
        ...(sb !== undefined && sb !== null ? { startingBid: sb } : {}),
      });
      toast.push(`Lot ${row.lotNumber} added: ${row.artworkTitle}`, 'success');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError && e.field) {
        const f = e.field === 'applicationId' ? 'artworkId' : e.field;
        setErrors(['artworkId', 'lotNumber', 'reserve', 'startingBid', 'callId'].includes(f) ? { [f]: e.message } : { general: e.message });
      } else setErrors({ general: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New lot"
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} disabled={candidates.length === 0} onClick={go}>
            Create lot
          </Button>
        </>
      }
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        {errors.general && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            {errors.general}
          </Notice>
        )}
        <Select
          label="Auction"
          value={callId}
          error={errors.callId}
          onChange={(e) => {
            const cid = e.target.value;
            setCallId(cid);
            setPick(lotCandidates(cid, apps, lots)[0]?.key ?? '');
            setLotNumber(nextNumber(cid));
            setErrors({});
          }}
        >
          {calls.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
        {candidates.length === 0 ? (
          <Notice tone="plain" icon={<Icon.Info />}>
            <p className="small">
              No selected works are waiting to become lots on this auction.{' '}
              {callId && (
                <Link to={`/admin/applications?call=${callId}`} onClick={onClose}>
                  Review its applications
                </Link>
              )}
            </p>
          </Notice>
        ) : (
          <Select label="Work" hint="Works on selected (accepted) applications that are not lots yet." value={pick} error={errors.artworkId} onChange={(e) => setPick(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
        <Input label="Lot number" type="number" inputMode="numeric" min={1} max={9999} value={lotNumber} error={errors.lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
        <div className="pg-two">
          <Input label={`Reserve (${cur})`} inputMode="decimal" autoComplete="off" placeholder="Optional" hint="The artist’s reserve: the lowest hammer price they accept." value={reserve} error={errors.reserve} onChange={(e) => setReserve(e.target.value)} />
          <Input label={`Starting bid (${cur})`} inputMode="decimal" autoComplete="off" placeholder="Optional" hint="At or below the reserve." value={startingBid} error={errors.startingBid} onChange={(e) => setStartingBid(e.target.value)} />
        </div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
