import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { identity, renderAt } from './testUtils';
import { lotCandidates } from './LotsPanel';

const NOW = new Date('2026-10-20T16:00:00Z');
const fresh = () => new MockDataSource({ persist: false, now: () => NOW });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('partner desk: guards', () => {
  it('a pending curator (Owen) sees "Verification pending" on the calls list, never an error or a New call button', async () => {
    renderAt('/curator/calls', identity('owen'), fresh());
    expect(await screen.findByRole('heading', { name: 'Verification pending' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Calls you run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review your request' })).toHaveAttribute('href', '/curator/verify');
    expect(screen.queryByText(/New call/)).not.toBeInTheDocument();
    expect(screen.queryByText('That didn’t load')).not.toBeInTheDocument();
  });

  it('Owen is also gated on the editor and a call desk', async () => {
    renderAt('/curator/calls/new', identity('owen'), fresh());
    expect(await screen.findByRole('heading', { name: 'Verification pending' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    cleanup();
    renderAt('/curator/calls/call_cma_auction?tab=lots', identity('owen'), fresh());
    expect(await screen.findByRole('heading', { name: 'Verification pending' })).toBeInTheDocument();
    expect(screen.queryByText('Paddle 14')).not.toBeInTheDocument();
  });

  it('Lena cannot edit a call Kofi has published, nor open a call another organiser runs', async () => {
    renderAt('/curator/calls/call_cma_auction/edit', identity('lena'), fresh());
    expect(await screen.findByRole('heading', { name: 'Kofi has published this call' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    cleanup();
    renderAt('/curator/calls/call_night_weather', identity('lena'), fresh());
    expect(await screen.findByRole('heading', { name: 'We couldn’t find that call' })).toBeInTheDocument();
  });
});

describe('partner desk: calls', () => {
  it('lists the calls Lena’s institution runs with phase, publish state and counts', async () => {
    renderAt('/curator/calls', identity('lena'), fresh());
    const list = await screen.findByRole('list', { name: 'Calls you run' });
    const row = within(list).getByRole('link', { name: /Night Weather Benefit Auction/ });
    expect(row).toHaveTextContent('Closed');
    expect(row).toHaveTextContent('Published');
    expect(row).toHaveTextContent('3 applications');
    expect(row).toHaveTextContent('3 lots');
    expect(screen.getAllByRole('link', { name: /New call/ }).length).toBeGreaterThan(0);
  });

  it('the curator home shows a Calls you run row for Lena', async () => {
    renderAt('/curator', identity('lena'), fresh());
    const row = await screen.findByRole('link', { name: /Calls you run/ });
    expect(row).toHaveAttribute('href', '/curator/calls');
    expect(row).toHaveTextContent('3 lots, 2 sold');
  });

  it('the curator home shows nothing new to a pending curator', async () => {
    renderAt('/curator', identity('owen'), fresh());
    await screen.findByText('Kofi is checking your institution by hand.');
    expect(screen.queryByText('Calls you run')).not.toBeInTheDocument();
    expect(screen.queryByText('Partner desk')).not.toBeInTheDocument();
  });

  it('creates a draft auction with her institution as organiser, live split example and inline terms errors', async () => {
    const { ds, router } = renderAt('/curator/calls/new', identity('lena'), fresh());
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Test Benefit Auction' } });
    fireEvent.change(screen.getByLabelText('Kind of call'), { target: { value: 'auction' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'A test auction.' } });
    fireEvent.change(screen.getByLabelText('Eligibility'), { target: { value: 'Anyone with a Kofi profile' } });
    expect(screen.getByText('Carnegie Museum of Art', { selector: '.pc-readonly__value' })).toBeInTheDocument();
    expect(screen.getByText('Kofi publishes partner calls after review.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /publish/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Kofi share (%)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Carnegie Museum of Art share (%)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Buyer’s premium (%)'), { target: { value: '10' } });
    expect(screen.getByTestId('terms-example')).toHaveTextContent('On a $1,000.00 hammer price: artist $700.00 · Kofi $200.00 · partner $100.00; buyer pays $1,100.00');

    fireEvent.change(screen.getByLabelText('Artist share (%)'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Artist, Kofi and partner shares must add up to 100%.')).toBeInTheDocument();
    expect(ds._raw().openCalls.some((c) => c.title === 'Test Benefit Auction')).toBe(false);

    fireEvent.change(screen.getByLabelText('Artist share (%)'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(ds._raw().openCalls.some((c) => c.title === 'Test Benefit Auction')).toBe(true));
    const call = ds._raw().openCalls.find((c) => c.title === 'Test Benefit Auction')!;
    expect(call).toMatchObject({ published: false, sample: false, kind: 'auction', organizerInstitutionId: 'inst_cma', partner: 'Carnegie Museum of Art' });
    expect(call.terms).toMatchObject({ artistSharePct: 70, kofiSharePct: 20, partnerSharePct: 10, buyerPremiumPct: 10, currency: 'USD' });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/curator/calls/${call.id}`));
  });

  it('server validation lands on the field (deadline before opening)', async () => {
    renderAt('/curator/calls/new', identity('lena'), fresh());
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Dates test' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'A call.' } });
    fireEvent.change(screen.getByLabelText('Eligibility'), { target: { value: 'Anyone' } });
    fireEvent.change(screen.getByLabelText('Opens on'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('The deadline is before the call opens.')).toBeInTheDocument();
  });

  it('edits her own draft', async () => {
    const ds = fresh();
    const draft = await ds.saveOpenCall(identity('lena'), {
      sample: false, published: false, kind: 'exhibition', title: 'Draft show', summary: 'S', body: '', eligibility: 'E', mediums: [], opensOn: '2026-11-01', maxWorks: 2, fee: 'No entry fee',
    });
    renderAt(`/curator/calls/${draft.id}/edit`, identity('lena'), ds);
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('Draft show');
    fireEvent.change(title, { target: { value: 'Draft show, renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(ds._raw().openCalls.find((c) => c.id === draft.id)?.title).toBe('Draft show, renamed'));
    expect(ds._raw().openCalls.find((c) => c.id === draft.id)?.published).toBe(false);
  });
});

describe('partner desk: applications', () => {
  it('lists applications with statements, never artist contact, and decides one with both notes', async () => {
    const ds = fresh();
    ds._raw().applications.push({
      id: 'app_june_cma', callId: 'call_cma_auction', artistId: 'art_june', artworkIds: ['aw_june_1'], statement: 'A wall textile for the benefit auction, woven from salvaged thread.',
      status: 'submitted', createdAt: '2026-09-20T15:00:00.000Z', updatedAt: '2026-09-20T15:00:00.000Z',
    });
    const { router } = renderAt('/curator/calls/call_cma_auction', identity('lena'), ds);
    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(within(list).getByText(/woven from salvaged thread/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/mara@example\.com|@example\.com/);
    fireEvent.click(within(list).getByRole('link', { name: /June Takahashi-Bell/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/curator/calls/call_cma_auction/applications/app_june_cma'));
    expect(await screen.findByText('Reviewers’ note')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Decision' })).getByRole('button', { name: 'Select' }));
    const dlg = await screen.findByRole('dialog', { name: 'Select this application?' });
    fireEvent.change(within(dlg).getByLabelText('Note to the artist'), { target: { value: 'Selected as a lot.' } });
    fireEvent.change(within(dlg).getByLabelText(/Reviewers’ note/), { target: { value: 'Agree reserve by phone.' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(ds._raw().applications.find((a) => a.id === 'app_june_cma')?.status).toBe('accepted'));
    expect(ds._raw().applications.find((a) => a.id === 'app_june_cma')).toMatchObject({ decisionNote: 'Selected as a lot.', staffNote: 'Agree reserve by phone.' });
  });

  it('a withdrawn application is read-only', async () => {
    const ds = fresh();
    ds._raw().applications.push({
      id: 'app_w', callId: 'call_cma_auction', artistId: 'art_june', artworkIds: ['aw_june_1'], statement: 'Withdrawn one.',
      status: 'withdrawn', createdAt: '2026-09-20T15:00:00.000Z', updatedAt: '2026-09-21T15:00:00.000Z',
    });
    renderAt('/curator/calls/call_cma_auction/applications/app_w', identity('lena'), ds);
    expect(await screen.findByText(/The artist withdrew this application/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Decision' })).not.toBeInTheDocument();
  });
});

describe('partner desk: lots', () => {
  it('shows lots with the split and buyer reference to the organiser', async () => {
    renderAt('/curator/calls/call_cma_auction?tab=lots', identity('lena'), fresh());
    expect(await screen.findByText('Paddle 14')).toBeInTheDocument();
    expect(screen.getByText('Artist $5,740.00')).toBeInTheDocument();
    expect(screen.getByText('Carnegie Museum of Art $820.00')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Record sale/ })).toHaveLength(1); // only the live lot
  });

  it('deletes a never-sold lot, makes it again from the selected work, records a sale and voids it', async () => {
    const ds = fresh();
    renderAt('/curator/calls/call_cma_auction?tab=lots', identity('lena'), ds);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage lot 2' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Lot 2' })).getByRole('button', { name: 'Delete lot' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete lot 2?' })).getByRole('button', { name: 'Delete lot' }));
    await waitFor(() => expect(ds._raw().lots.some((l) => l.id === 'lot_cma_2')).toBe(false));

    fireEvent.click(await screen.findByRole('button', { name: 'New lot' }));
    const lotDlg = await screen.findByRole('dialog', { name: 'New lot' });
    const work = within(lotDlg).getByLabelText('Work') as HTMLSelectElement;
    expect(Array.from(work.options).map((o) => o.text)).toEqual(['Choose a selected work', 'Small Weather No. 4 · Mara Oyelaran']);
    fireEvent.click(within(lotDlg).getByRole('button', { name: 'Create lot' }));
    expect(await within(lotDlg).findByText('Choose a selected work.')).toBeInTheDocument();
    fireEvent.change(work, { target: { value: work.options[1]!.value } });
    fireEvent.change(within(lotDlg).getByLabelText('Lot number'), { target: { value: '7' } });
    fireEvent.change(within(lotDlg).getByLabelText(/Reserve/), { target: { value: '1,000.00' } });
    fireEvent.click(within(lotDlg).getByRole('button', { name: 'Create lot' }));
    await waitFor(() => expect(ds._raw().lots.find((l) => l.lotNumber === 7)).toMatchObject({ artworkId: 'aw_mara_2', reserve: 100000, status: 'planned' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Record sale, lot 7' }));
    const sale = await screen.findByRole('dialog', { name: 'Record sale' });
    fireEvent.change(within(sale).getByLabelText(/Hammer price/), { target: { value: '900.00' } });
    expect(within(sale).getByText('This is below the artist’s reserve.')).toBeInTheDocument();
    fireEvent.change(within(sale).getByLabelText(/Hammer price/), { target: { value: '1,500.00' } });
    expect(within(sale).getByText('$1,050.00')).toBeInTheDocument(); // artist 70%
    expect(within(sale).getByText('$1,650.00')).toBeInTheDocument(); // buyer pays with 10% premium
    // The sheet defaults to the real clock's today; the data source's clock is NOW, so pin the date.
    fireEvent.change(within(sale).getByLabelText('Sold on'), { target: { value: '2026-10-20' } });
    fireEvent.change(within(sale).getByLabelText('Buyer reference'), { target: { value: 'Paddle 9' } });
    fireEvent.click(within(sale).getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(ds._raw().lots.find((l) => l.lotNumber === 7)?.status).toBe('sold'));
    const lot = ds._raw().lots.find((l) => l.lotNumber === 7)!;
    expect(lot.sale).toMatchObject({ hammerPrice: 150000, artistAmount: 105000, kofiAmount: 30000, partnerAmount: 15000, buyerRef: 'Paddle 9' });
    expect(ds._raw().payouts.find((p) => p.lotId === lot.id)).toMatchObject({ status: 'due', amount: 105000 });
    expect(await screen.findByText('Paddle 9')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Void sale, lot 7' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Void the sale of lot 7?' })).getByRole('button', { name: 'Void sale' }));
    await waitFor(() => expect(ds._raw().lots.find((l) => l.id === lot.id)?.status).toBe('unsold'));
    expect(ds._raw().payouts.find((p) => p.lotId === lot.id)?.status).toBe('void');
  });

  it('refuses to void a sale Kofi has already paid out', async () => {
    const ds = fresh();
    renderAt('/curator/calls/call_cma_auction?tab=lots', identity('lena'), ds);
    fireEvent.click(await screen.findByRole('button', { name: 'Void sale, lot 3' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Void the sale of lot 3?' })).getByRole('button', { name: 'Void sale' }));
    // The organiser never learns payout state: the data layer's "Payout already paid." is replaced by neutral copy.
    expect(await screen.findByText(/closed on Kofi’s side and can’t be voided from here/)).toBeInTheDocument();
    expect(screen.queryByText(/Payout already paid/)).not.toBeInTheDocument();
    expect(ds._raw().lots.find((l) => l.id === 'lot_cma_3')?.status).toBe('sold');
  });

  it('moves a lot through statuses allowed by canMoveLot', async () => {
    const ds = fresh();
    renderAt('/curator/calls/call_cma_auction?tab=lots', identity('lena'), ds);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage lot 2' }));
    const dlg = await screen.findByRole('dialog', { name: 'Lot 2' });
    expect(within(dlg).queryByRole('button', { name: 'Mark live' })).not.toBeInTheDocument(); // already live
    fireEvent.click(within(dlg).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(ds._raw().lots.find((l) => l.id === 'lot_cma_2')?.status).toBe('withdrawn'));
  });

  it('lot candidates are selected works not already lotted', () => {
    const apps = [
      { id: 'a1', status: 'accepted', artistWorkingName: 'A', artworkIds: ['w1', 'w2'], works: [{ id: 'w1', title: 'One' }, { id: 'w2', title: 'Two' }] },
      { id: 'a2', status: 'declined', artistWorkingName: 'B', artworkIds: ['w3'], works: [] },
    ] as unknown as Parameters<typeof lotCandidates>[0];
    expect(lotCandidates(apps, [{ artworkId: 'w1', status: 'live' }]).map((c) => c.value)).toEqual(['a1:w2']);
    expect(lotCandidates(apps, [{ artworkId: 'w1', status: 'withdrawn' }]).map((c) => c.value)).toEqual(['a1:w1', 'a1:w2']);
  });
});
