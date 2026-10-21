/**
 * A call's published money terms, stated plainly — the open-contract ethos: an
 * artist reads exactly how a hammer price is shared before they apply. Used by
 * the public call page, the studio apply flow and the partner desk.
 * Money is whole cents; everything goes through formatMoney.
 */
import type { CallTerms } from '@/domain/types';
import { formatMoney, splitSale, validateTerms } from '@/domain/sales';
import './terms.css';

/** formatMoney, but never throws on a half-typed currency code. */
export function money(cents: number, currency: string): string {
  try {
    return formatMoney(cents, currency);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "Artists receive 70% of the hammer price · Kofi 20% · Carnegie Museum of Art 10% · Buyer's premium 10% · Resale royalty 5%" */
export function termsSentence(terms: CallTerms, partnerName?: string): string {
  const parts = [`Artists receive ${terms.artistSharePct}% of the hammer price`, `Kofi ${terms.kofiSharePct}%`];
  if (terms.partnerSharePct > 0) parts.push(`${partnerName || 'The partner'} ${terms.partnerSharePct}%`);
  parts.push(terms.buyerPremiumPct > 0 ? `Buyer’s premium ${terms.buyerPremiumPct}%` : 'No buyer’s premium');
  parts.push(terms.resaleRoyaltyPct > 0 ? `Resale royalty ${terms.resaleRoyaltyPct}%` : 'No resale royalty');
  return parts.join(' · ');
}

/** "On a $1,000.00 hammer price: artist $700.00 · Kofi $200.00 · partner $100.00; buyer pays $1,100.00", or undefined while the terms are invalid. */
export function splitExample(terms: CallTerms, hammer = 100000): string | undefined {
  if (validateTerms(terms)) return undefined;
  const s = splitSale(hammer, terms, '');
  const c = terms.currency;
  const parts = [`artist ${money(s.artistAmount, c)}`, `Kofi ${money(s.kofiAmount, c)}`];
  if (terms.partnerSharePct > 0) parts.push(`partner ${money(s.partnerAmount, c)}`);
  return `On a ${money(hammer, c)} hammer price: ${parts.join(' · ')}; buyer pays ${money(hammer + s.buyerPremium, c)}`;
}

export function termsFacts(terms: CallTerms, partnerName?: string): { label: string; value: string }[] {
  const rows = [
    { label: 'Artist', value: `${terms.artistSharePct}% of the hammer price` },
    { label: 'Kofi', value: `${terms.kofiSharePct}%` },
  ];
  if (terms.partnerSharePct > 0) rows.push({ label: partnerName || 'Partner', value: `${terms.partnerSharePct}%` });
  rows.push({ label: 'Buyer’s premium', value: terms.buyerPremiumPct > 0 ? `${terms.buyerPremiumPct}%, paid by the buyer on top of the hammer price` : 'None' });
  rows.push({ label: 'Resale royalty', value: terms.resaleRoyaltyPct > 0 ? `${terms.resaleRoyaltyPct}% to the artist on any later resale` : 'None' });
  rows.push({ label: 'Currency', value: terms.currency });
  return rows;
}

/**
 * The terms as a block: the plain sentence, the facts and the payment note.
 * `variant` only changes spacing; the words are the same everywhere.
 */
export function TermsBlock({ terms, partnerName, headingLevel = 2, title = 'Terms', variant = 'page', id }: { terms: CallTerms; partnerName?: string; headingLevel?: 2 | 3; title?: string; variant?: 'page' | 'compact'; id?: string }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = id ?? 'kt-terms-title';
  const example = splitExample(terms);
  return (
    <section className={`kt-terms kt-terms--${variant}`} aria-labelledby={headingId} data-testid="call-terms">
      <H className="kt-terms__title" id={headingId}>
        {title}
      </H>
      <p className="kt-terms__sentence">{termsSentence(terms, partnerName)}</p>
      <dl className="kt-terms__facts">
        {termsFacts(terms, partnerName).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        {terms.paymentNote && (
          <div>
            <dt>Payment</dt>
            <dd>{terms.paymentNote}</dd>
          </div>
        )}
      </dl>
      {example && <p className="kt-terms__example">{example}.</p>}
      <p className="kt-terms__fine">Artists set their own reserve, the lowest hammer price they will accept. Kofi never estimates what a work is worth.</p>
    </section>
  );
}
