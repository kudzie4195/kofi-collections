/**
 * Compensation terms for an open call: the split of a hammer price between the
 * artist, Kofi and a partner, the buyer's premium on top and the artist's resale
 * royalty. Whole percentages; the live example uses domain/sales.splitSale so it
 * is exactly what a recorded sale would freeze.
 */
import type { CallTerms } from '@/domain/types';
import { Icon, Input, Notice, Textarea } from '@/ui';
import { exampleSplit } from './salesShared';

export interface TermsForm {
  artistSharePct: string;
  kofiSharePct: string;
  partnerSharePct: string;
  buyerPremiumPct: string;
  resaleRoyaltyPct: string;
  currency: string;
  paymentNote: string;
}

export const TERMS_FIELDS: (keyof CallTerms)[] = ['artistSharePct', 'kofiSharePct', 'partnerSharePct', 'buyerPremiumPct', 'resaleRoyaltyPct', 'currency', 'paymentNote'];

export function termsToForm(t: CallTerms): TermsForm {
  return {
    artistSharePct: String(t.artistSharePct),
    kofiSharePct: String(t.kofiSharePct),
    partnerSharePct: String(t.partnerSharePct),
    buyerPremiumPct: String(t.buyerPremiumPct),
    resaleRoyaltyPct: String(t.resaleRoyaltyPct),
    currency: t.currency,
    paymentNote: t.paymentNote ?? '',
  };
}

const pct = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

export function formToTerms(f: TermsForm): CallTerms {
  const t: CallTerms = {
    artistSharePct: pct(f.artistSharePct),
    kofiSharePct: pct(f.kofiSharePct),
    partnerSharePct: pct(f.partnerSharePct),
    buyerPremiumPct: pct(f.buyerPremiumPct),
    resaleRoyaltyPct: pct(f.resaleRoyaltyPct),
    currency: f.currency.trim().toUpperCase(),
  };
  if (f.paymentNote.trim()) t.paymentNote = f.paymentNote.trim();
  return t;
}

type Errors = Record<string, string | undefined>;

export function TermsFields({ value, onChange, errors }: { value: TermsForm; onChange: (k: keyof TermsForm, v: string) => void; errors: Errors }) {
  const terms = formToTerms(value);
  const shares = [terms.artistSharePct, terms.kofiSharePct, terms.partnerSharePct];
  const sum = shares.every((n) => Number.isFinite(n)) ? shares.reduce((a, b) => a + b, 0) : undefined;
  const example = exampleSplit(terms);
  const num = (k: keyof TermsForm, label: string, hint?: string) => (
    <Input label={label} type="number" inputMode="numeric" min={0} max={100} step={1} hint={hint} value={value[k]} error={errors[k]} onChange={(e) => onChange(k, e.target.value)} />
  );
  return (
    <div className="stack tf">
      {errors.terms && (
        <p className="field__error" role="alert" data-invalid="true" tabIndex={-1}>
          {errors.terms}
        </p>
      )}
      <div className="tf-shares">
        {num('artistSharePct', 'Artist %')}
        {num('kofiSharePct', 'Kofi %')}
        {num('partnerSharePct', 'Partner %')}
      </div>
      <p className={`tiny tf-sum ${sum === 100 ? 'tf-sum--ok' : ''}`} aria-live="polite">
        {sum === undefined ? 'Enter all three shares.' : sum === 100 ? 'Shares add up to 100%.' : `Shares add up to ${sum}%. They must add up to 100%.`} The partner share goes to the organiser.
      </p>
      <div className="pg-two">
        {num('buyerPremiumPct', 'Buyer’s premium %', 'Charged on top of the hammer price. Up to 30%.')}
        {num('resaleRoyaltyPct', 'Resale royalty %', 'The artist’s share of any later resale. Up to 25%.')}
      </div>
      <div className="tf-cur">
        <Input
          label="Currency"
          hint="3-letter code, e.g. USD or CAD."
          maxLength={3}
          autoCapitalize="characters"
          autoComplete="off"
          value={value.currency}
          error={errors.currency}
          onChange={(e) => onChange('currency', e.target.value.toUpperCase())}
        />
      </div>
      <Textarea label="Payment note" hint="Shown to artists before they apply, e.g. when they are paid." rows={2} value={value.paymentNote} error={errors.paymentNote} onChange={(e) => onChange('paymentNote', e.target.value)} />
      <p className="tf-example" aria-live="polite" data-testid="terms-example">
        {example ?? 'Fix the terms above to see an example split.'}
      </p>
    </div>
  );
}

/** Read-only terms once a sale has frozen them. */
export function LockedTerms({ terms, reason }: { terms: CallTerms; reason: string }) {
  const rows: [string, string][] = [
    ['Artist', `${terms.artistSharePct}%`],
    ['Kofi', `${terms.kofiSharePct}%`],
    ['Partner', `${terms.partnerSharePct}%`],
    ['Buyer’s premium', `${terms.buyerPremiumPct}%`],
    ['Resale royalty', `${terms.resaleRoyaltyPct}%`],
    ['Currency', terms.currency],
  ];
  if (terms.paymentNote) rows.push(['Payment note', terms.paymentNote]);
  const example = exampleSplit(terms);
  return (
    <div className="stack tf">
      <Notice tone="plain" icon={<Icon.Lock />}>
        <p className="small" data-testid="terms-locked">
          {reason}
        </p>
      </Notice>
      <dl className="pga-facts tf-locked">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {example && <p className="tf-example">{example}</p>}
    </div>
  );
}
