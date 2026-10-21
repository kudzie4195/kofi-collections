import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { studioRoutes } from './routes';
import { payoutTotals, totalsText } from './salesShared';
import { splitExample, termsSentence } from '@/features/programme/terms';

const viewerOf = (id: string): Viewer => DEMO_IDENTITIES.find((i) => i.id === id)!.viewer;
const MARA = viewerOf('mara');
const ADMIN = viewerOf('admin');
const DESHAWN: Viewer = { role: 'artist', userId: 'user_deshawn', artistId: 'art_deshawn', displayName: 'DeShawn Ferris' };
const NOW = new Date('2026-10-20T16:00:00Z');

function renderStudio(path: string, viewer: Viewer = MARA, ds = new MockDataSource({ persist: false, now: () => NOW })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter([{ path: '/studio', children: studioRoutes }, { path: '*', element: <p>Elsewhere</p> }], { initialEntries: [path] });
  render(
    <ToastProvider>
      <SessionProvider dataSource={ds}>
        <RouterProvider router={router} />
        <Toasts />
      </SessionProvider>
    </ToastProvider>,
  );
  return { ds, router };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('studio sales', () => {
  it('shows Mara her lots, the hammer price, her share and the payout due, never the buyer reference', async () => {
    renderStudio('/studio/sales');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Your lots' });
    const lot1 = within(list).getByRole('article', { name: 'Doubling (Liberty Avenue, 7:40pm)' });
    expect(lot1).toHaveTextContent('Lot 1');
    expect(lot1).toHaveTextContent('$6,000.00');
    expect(lot1).toHaveTextContent('$8,200.00');
    expect(lot1).toHaveTextContent('$5,740.00');
    expect(lot1).toHaveTextContent('70% of the hammer price');
    expect(lot1).toHaveTextContent(/Due · \$5,740\.00/);
    const lot2 = within(list).getByRole('article', { name: 'Small Weather No. 4' });
    expect(lot2).toHaveTextContent('In the auction');
    expect(lot2).not.toHaveTextContent('Hammer price');
    expect(screen.getByTestId('sales-due')).toHaveTextContent('$5,740.00');
    expect(screen.getByTestId('sales-paid')).toHaveTextContent('Nothing paid yet');
    expect(document.body.innerHTML).not.toContain('Paddle');
  });

  it('shows DeShawn his paid payout with the date and method', async () => {
    renderStudio('/studio/sales', DESHAWN);
    const lot = await screen.findByRole('article', { name: 'Night Shift: Bakery, 3:10am' });
    expect(lot).toHaveTextContent('Paid on Oct 19, 2026 · Bank transfer');
    expect(screen.getByTestId('sales-paid')).toHaveTextContent('$1,120.00');
    expect(screen.getByTestId('sales-due')).toHaveTextContent('Nothing due');
    expect(document.body.innerHTML).not.toContain('Paddle 3');
  });

  it('shows an empty state to an artist with no lots', async () => {
    renderStudio('/studio/sales', viewerOf('june'));
    expect(await screen.findByRole('heading', { name: 'No lots yet' })).toBeInTheDocument();
  });

  it('the studio home has a Sales row with due and paid totals', async () => {
    renderStudio('/studio');
    const row = await screen.findByRole('link', { name: /Sales/ });
    expect(row).toHaveAttribute('href', '/studio/sales');
    expect(within(row).getByTestId('studio-sales-totals')).toHaveTextContent('$5,740.00 due · nothing paid');
  });
});

describe('apply page terms', () => {
  it('states the auction terms before the Send step', async () => {
    const ds = new MockDataSource({ persist: false, now: () => NOW });
    const call = await ds.saveOpenCall(ADMIN, {
      sample: true, published: true, kind: 'auction', title: 'Open Auction', partner: 'Carnegie Museum of Art', organizerInstitutionId: 'inst_cma',
      summary: 'An auction.', body: '', eligibility: 'Anyone', mediums: [], opensOn: '2026-10-01', deadline: '2026-12-01', maxWorks: 2, fee: 'No entry fee',
      terms: { artistSharePct: 70, kofiSharePct: 20, partnerSharePct: 10, buyerPremiumPct: 10, resaleRoyaltyPct: 5, currency: 'USD', paymentNote: 'Paid within 30 days.' },
    });
    renderStudio(`/studio/apply/${call.id}`, MARA, ds);
    const terms = await screen.findByTestId('call-terms');
    expect(terms).toHaveTextContent('Artists receive 70% of the hammer price · Kofi 20% · Carnegie Museum of Art 10% · Buyer’s premium 10% · Resale royalty 5%');
    expect(terms).toHaveTextContent('Paid within 30 days.');
    // The terms sit in the review step, above the Send button.
    const send = screen.getByRole('button', { name: 'Send application' });
    expect(terms.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a closed auction call still shows its terms under the notice', async () => {
    renderStudio('/studio/apply/call_cma_auction');
    expect(await screen.findByRole('heading', { name: 'This call has closed' })).toBeInTheDocument();
    expect(screen.getByTestId('call-terms')).toHaveTextContent('Artists receive 70% of the hammer price');
  });
});

describe('terms and totals helpers', () => {
  it('words the terms plainly and computes the $1,000 example in cents', () => {
    const t = { artistSharePct: 70, kofiSharePct: 30, partnerSharePct: 0, buyerPremiumPct: 0, resaleRoyaltyPct: 5, currency: 'USD' };
    expect(termsSentence(t)).toBe('Artists receive 70% of the hammer price · Kofi 30% · No buyer’s premium · Resale royalty 5%');
    expect(splitExample(t)).toBe('On a $1,000.00 hammer price: artist $700.00 · Kofi $300.00; buyer pays $1,000.00');
    expect(splitExample({ ...t, artistSharePct: 80 })).toBeUndefined();
  });
  it('sums payouts by currency and status', () => {
    const p = [
      { status: 'due' as const, amount: 100, currency: 'USD' },
      { status: 'due' as const, amount: 250, currency: 'USD' },
      { status: 'paid' as const, amount: 5000, currency: 'CAD' },
      { status: 'void' as const, amount: 999, currency: 'USD' },
    ];
    expect(payoutTotals(p, 'due')).toEqual([['USD', 350]]);
    expect(totalsText(payoutTotals(p, 'paid'))).toBe('CA$50.00');
    expect(totalsText([], 'Nothing')).toBe('Nothing');
  });
});
