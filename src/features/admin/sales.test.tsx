import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { adminRoutes } from './routes';

const ADMIN = DEMO_IDENTITIES.find((d) => d.id === 'admin')!.viewer;

function renderAt(path: string, ds = new MockDataSource({ persist: false }), viewer: Viewer = ADMIN) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter(
    [
      { path: '/admin', children: adminRoutes },
      { path: '*', element: <div>Elsewhere</div> },
    ],
    { initialEntries: [path] },
  );
  const utils = render(
    <ToastProvider>
      <SessionProvider dataSource={ds}>
        <RouterProvider router={router} />
        <Toasts />
      </SessionProvider>
    </ToastProvider>,
  );
  return { ...utils, ds, router };
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T15:00:00Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('open-call editor: kind, organiser, terms', () => {
  it('sends kind, organiser and terms, with term errors inline and a live example split', async () => {
    const { ds, router } = renderAt('/admin/programme/calls/new');
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Winter Benefit' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'A benefit auction.' } });
    fireEvent.change(screen.getByLabelText('Eligibility'), { target: { value: 'Approved Kofi artists' } });
    // Non-auction calls make terms optional.
    expect(screen.getByRole('switch', { name: /Add compensation terms/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('Artist %')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Kind of call'), { target: { value: 'auction' } });
    fireEvent.change(screen.getByLabelText('Organiser'), { target: { value: 'inst_cma' } });
    expect(screen.getByLabelText('Partner organisation')).toHaveValue('Carnegie Museum of Art');
    expect(screen.getByTestId('terms-example')).toHaveTextContent('On a $1,000.00 hammer price: artist $700.00 · Kofi $300.00 · buyer pays $1,000.00');

    fireEvent.change(screen.getByLabelText('Partner %'), { target: { value: '10' } });
    expect(screen.getByText(/Shares add up to 110%/)).toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Artist, Kofi and partner shares must add up to 100%.')).toBeInTheDocument();
    expect(screen.getByLabelText('Artist %')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByLabelText('Kofi %'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Buyer’s premium %'), { target: { value: '10' } });
    expect(screen.getByTestId('terms-example')).toHaveTextContent('On a $1,000.00 hammer price: artist $700.00 · Kofi $200.00 · partner $100.00 · buyer pays $1,100.00');
    fireEvent.change(screen.getByLabelText('Buyer’s premium %'), { target: { value: '40' } });
    await click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/premium above 30% is not allowed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buyer’s premium %'), { target: { value: '10' } });

    await click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/admin\/programme\/calls\/call_/));
    const id = router.state.location.pathname.split('/').pop()!;
    const saved = await ds.getOpenCall(ADMIN, id);
    expect(saved?.kind).toBe('auction');
    expect(saved?.organizerInstitutionId).toBe('inst_cma');
    expect(saved?.terms).toEqual({ artistSharePct: 70, kofiSharePct: 20, partnerSharePct: 10, buyerPremiumPct: 10, resaleRoyaltyPct: 5, currency: 'USD' });
  });

  it('shows terms read-only with the lock reason once a lot has sold, and saves without touching them', async () => {
    const { ds } = renderAt('/admin/programme/calls/call_cma_auction');
    expect(await screen.findByTestId('terms-locked')).toHaveTextContent('Locked: 2 lots have sold.');
    expect(screen.queryByLabelText('Artist %')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Kind of call')).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Manage lots' })).toHaveAttribute('href', '/admin/lots?call=call_cma_auction');
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Edited summary.' } });
    await click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Published “Night Weather Benefit Auction”/)).toBeInTheDocument();
    const c = await ds.getOpenCall(ADMIN, 'call_cma_auction');
    expect(c?.summary).toBe('Edited summary.');
    expect(c?.terms?.artistSharePct).toBe(70);
  });

  it('lists each call with its kind and organiser', async () => {
    renderAt('/admin/programme?tab=calls');
    const list = await screen.findByRole('list', { name: 'Open calls' });
    expect(within(list).getByRole('link', { name: /Night Weather Benefit Auction/ })).toHaveTextContent('Auction · Run by Carnegie Museum of Art');
    expect(within(list).getByRole('link', { name: /Art of Advocacy/ })).toHaveTextContent('Exhibition · Kofi with Neighborhood Legal Services');
  });
});

describe('lots → payouts', () => {
  it('deletes a lot, makes a new one, records a sale (payout due), and voiding a sale voids its payout', async () => {
    const ds = new MockDataSource({ persist: false });
    const first = renderAt('/admin/lots?call=call_cma_auction', ds);
    const lot2 = await screen.findByRole('listitem', { name: /Lot 2: Small Weather No. 4/ });
    // Delete (never sold) behind a confirm.
    await click(within(lot2).getByRole('button', { name: 'Delete' }));
    const del = await screen.findByRole('dialog', { name: 'Delete lot 2?' });
    await click(within(del).getByRole('button', { name: 'Delete lot' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Lot 2:/ })).not.toBeInTheDocument());
    // Sold lots offer no delete.
    expect(within(screen.getByRole('listitem', { name: /Lot 1:/ })).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    // New lot from the freed selected work.
    await click(screen.getByRole('button', { name: 'New lot' }));
    const nl = await screen.findByRole('dialog', { name: 'New lot' });
    expect(within(nl).getByLabelText('Work')).toHaveDisplayValue('Small Weather No. 4, Mara Oyelaran');
    expect(within(nl).getByLabelText('Lot number')).toHaveValue(4);
    fireEvent.change(within(nl).getByLabelText(/^Reserve/), { target: { value: '1,000.00' } });
    await click(within(nl).getByRole('button', { name: 'Create lot' }));
    const lot4 = await screen.findByRole('listitem', { name: /Lot 4: Small Weather No. 4/ });
    expect(within(lot4).getByTestId('lot-status')).toHaveTextContent('Planned');
    expect(within(lot4).getByText(/reserve \$1,000\.00/)).toBeInTheDocument();

    // Record sale: below the reserve is refused before the server.
    await click(within(lot4).getByRole('button', { name: 'Record sale' }));
    const sale = await screen.findByRole('dialog', { name: 'Record sale: lot 4' });
    fireEvent.change(within(sale).getByLabelText(/Hammer/), { target: { value: '500' } });
    await click(within(sale).getByRole('button', { name: 'Record sale' }));
    expect(await within(sale).findByText('The hammer price is below the artist’s reserve.')).toBeInTheDocument();
    fireEvent.change(within(sale).getByLabelText(/Hammer/), { target: { value: '2,500.00' } });
    expect(within(sale).getByTestId('sale-preview')).toHaveTextContent('Artist receives$1,750.00');
    expect(within(sale).getByLabelText('Sold on')).toHaveValue('2026-10-20');
    fireEvent.change(within(sale).getByLabelText('Buyer reference'), { target: { value: 'Paddle 22' } });
    await click(within(sale).getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const sold4 = screen.getByRole('listitem', { name: /Lot 4:/ });
    expect(within(sold4).getByTestId('lot-status')).toHaveTextContent('Sold');
    expect(sold4).toHaveTextContent('$2,500.00');
    expect(sold4).toHaveTextContent('Buyer: Paddle 22');
    expect(sold4).toHaveTextContent('Payout due');
    first.unmount();

    // The payout appears as due on the payouts desk.
    const payouts = renderAt('/admin/payouts', ds);
    const row = await screen.findByRole('listitem', { name: 'Mara Oyelaran, $1,750.00, Due' });
    expect(row).toHaveTextContent('Small Weather No. 4');
    expect(screen.getByTestId('total-due')).toHaveTextContent('$7,490.00');
    payouts.unmount();

    // Void the sale of lot 1 → its payout is void.
    renderAt('/admin/lots', ds);
    const lot1 = await screen.findByRole('listitem', { name: /Lot 1:/ });
    await click(within(lot1).getByRole('button', { name: 'Void sale' }));
    const v = await screen.findByRole('dialog', { name: 'Void the sale of lot 1?' });
    expect(v).toHaveTextContent("This voids the sale and the artist's payout");
    await click(within(v).getByRole('button', { name: 'Void sale' }));
    await waitFor(() => expect(within(screen.getByRole('listitem', { name: /Lot 1:/ })).getByTestId('lot-status')).toHaveTextContent('Unsold'));
    const all = await ds.listPayouts(ADMIN);
    expect(all.find((p) => p.lotId === 'lot_cma_1')?.status).toBe('void');
    // A paid payout's sale offers no void button, only the way to reopen it.
    expect(within(screen.getByRole('listitem', { name: /Lot 3:/ })).queryByRole('button', { name: 'Void sale' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: /Lot 3:/ })).getByRole('link', { name: 'reopen the payout' })).toBeInTheDocument();
  });
});

describe('payouts desk', () => {
  it('marking paid requires a method; totals move from due to paid', async () => {
    const { ds } = renderAt('/admin/payouts');
    expect(await screen.findByTestId('total-due')).toHaveTextContent('$5,740.00');
    expect(screen.getByTestId('total-paid')).toHaveTextContent('$1,120.00');
    const row = screen.getByRole('listitem', { name: 'Mara Oyelaran, $5,740.00, Due' });
    await click(within(row).getByRole('button', { name: 'Mark paid' }));
    const dlg = await screen.findByRole('dialog', { name: 'Mark payout paid' });
    expect(within(dlg).getByLabelText('Paid on')).toHaveValue('2026-10-20');
    await click(within(dlg).getByRole('button', { name: 'Mark paid' }));
    expect(await within(dlg).findByText('Say how the artist was paid.')).toBeInTheDocument();
    expect((await ds.listPayouts(ADMIN)).find((p) => p.id === 'payout_cma_1')?.status).toBe('due');
    fireEvent.change(within(dlg).getByLabelText('Payment method'), { target: { value: 'Bank transfer' } });
    fireEvent.change(within(dlg).getByLabelText('Reference'), { target: { value: 'KC-2026-0040' } });
    await click(within(dlg).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(screen.getByTestId('total-paid')).toHaveTextContent('$6,860.00'));
    expect(screen.getByTestId('total-due')).toHaveTextContent('$0.00');
    const p = (await ds.listPayouts(ADMIN)).find((x) => x.id === 'payout_cma_1')!;
    expect(p).toMatchObject({ status: 'paid', method: 'Bank transfer', reference: 'KC-2026-0040' });

    // Paid list → reopen behind a confirm.
    await click(screen.getByRole('button', { name: /^Paid/ }));
    const paidRow = await screen.findByRole('listitem', { name: 'Mara Oyelaran, $5,740.00, Paid' });
    expect(paidRow).toHaveTextContent('Ref. KC-2026-0040');
    await click(within(paidRow).getByRole('button', { name: 'Reopen' }));
    const c = await screen.findByRole('dialog', { name: 'Reopen this payout?' });
    await click(within(c).getByRole('button', { name: 'Reopen payout' }));
    await waitFor(async () => expect((await ds.listPayouts(ADMIN)).find((x) => x.id === 'payout_cma_1')?.status).toBe('due'));
  });
});

describe('reports desk', () => {
  function captureDownloads() {
    const blobs: Blob[] = [];
    const names: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((b: Blob) => (blobs.push(b), 'blob:mock')) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { blobs, names };
  }
  const readBlob = (b: Blob) =>
    new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(b);
    });

  it('defaults to this Kofi year, shows totals from the seed, and downloads CSVs named by section and range', async () => {
    const dl = captureDownloads();
    const { router } = renderAt('/admin/reports');
    expect(await screen.findByLabelText('From')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-20');
    expect(screen.getByRole('radio', { name: 'This year' })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Applications')).toBeInTheDocument();

    // October 2026: the two auction sales.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(router.state.location.search).toBe('?from=2026-10-01&to=2026-10-31'));
    const lotsSold = await screen.findByText('Lots sold');
    expect(lotsSold.parentElement).toHaveTextContent(/^2Lots sold$/);
    expect(screen.getByText('Hammer total').parentElement).toHaveTextContent('$9,800.00');
    expect(screen.getByText('Paid to artists').parentElement).toHaveTextContent('$1,120.00');
    expect(screen.getByText('Due to artists').parentElement).toHaveTextContent('$5,740.00');
    const payments = screen.getByRole('region', { name: 'Payments table' });
    expect(within(payments).getAllByRole('row')).toHaveLength(3);

    await click(screen.getByRole('button', { name: 'Download CSV: payments' }));
    await waitFor(() => expect(dl.names).toEqual(['kofi-payments-2026-10-01_2026-10-31.csv']));
    const csv = await readBlob(dl.blobs[0]!);
    expect(csv.split('\r\n')[0]).toBe('artist,work,call,lot,hammer_price,artist_amount,kofi_amount,partner_amount,buyer_premium,currency,payout_status,sold_on,paid_on,method,reference,payout_id,artist_id');
    expect(csv).toContain('8200.00,5740.00');

    await click(screen.getByRole('button', { name: 'Download CSV: participation' }));
    await waitFor(() => expect(dl.names[1]).toBe('kofi-participation-2026-10-01_2026-10-31.csv'));
    expect((await readBlob(dl.blobs[1]!)).startsWith('artist,call,kind,organizer,status')).toBe(true);
  });

  it('presets set the range, and a bad range is explained inline without running the report', async () => {
    const { ds } = renderAt('/admin/reports');
    await screen.findByText('Applications');
    await click(screen.getByRole('radio', { name: 'All time' }));
    expect(screen.getByLabelText('From')).toHaveValue('2024-01-01');
    await click(screen.getByRole('radio', { name: 'Last 90 days' }));
    expect(screen.getByLabelText('From')).toHaveValue('2026-07-22');
    const spy = vi.spyOn(ds, 'kofiReport');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('The start date must be before the end date.')).toBeInTheDocument();
    expect(screen.queryByText('Applications')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith(expect.anything(), { from: '2026-10-10', to: '2026-10-01' });
  });
});

describe('admin home and application shortcuts', () => {
  it('shows a Payouts due tile with the amount, a lots tile, and Lots / Payouts / Reports rows', async () => {
    renderAt('/admin');
    const due = await screen.findByRole('link', { name: '1 payout due: $5,740.00' });
    expect(due).toHaveAttribute('href', '/admin/payouts');
    expect(screen.getByRole('link', { name: '1 lot open for sale' })).toHaveAttribute('href', '/admin/lots');
    const nav = screen.getByRole('list', { name: 'Kofi admin sections' });
    for (const [name, href] of [
      [/^Lots/, '/admin/lots'],
      [/^Payouts/, '/admin/payouts'],
      [/^Reports/, '/admin/reports'],
    ] as const)
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    expect(within(nav).getByRole('link', { name: /^Payouts/ })).toHaveTextContent('$5,740.00 due · 1 paid');
  });

  it('offers “Make a lot” on an accepted application to an auction call only', async () => {
    const first = renderAt('/admin/applications/app_mara_cma');
    expect(await screen.findByRole('link', { name: 'Make a lot' })).toHaveAttribute('href', '/admin/lots?call=call_cma_auction');
    first.unmount();
    renderAt('/admin/applications/app_priya_cma');
    await screen.findByTestId('app-status');
    expect(screen.queryByRole('link', { name: 'Make a lot' })).not.toBeInTheDocument();
  });
});
