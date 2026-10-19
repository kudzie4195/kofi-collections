import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LENA, MARA, OWEN, QUINCY, renderAt, VISITOR } from './testUtils';

afterEach(() => localStorage.clear());

const header = async () => (await screen.findByRole('heading', { level: 1, name: /doubling/i })).closest('header') as HTMLElement;

describe('Artwork detail (/work/:id)', () => {
  it('shows "Price on request" for aw_mara_1 to a visitor, with the full record and no owner badges', async () => {
    renderAt('/work/aw_mara_1', VISITOR);
    const h = await header();
    expect(within(h).getByText('Price on request')).toBeInTheDocument();
    expect(screen.queryByText('$9,800')).not.toBeInTheDocument();
    expect(screen.getByText('152 × 122 × 4 cm (59.8 × 48 × 1.6 in)')).toBeInTheDocument();
    expect(screen.getByText('oil on linen')).toBeInTheDocument();
    expect(screen.getByText('© Mara Oyelaran. Reproduction by permission only.')).toBeInTheDocument();
    expect(within(h).getByRole('link', { name: 'Mara Oyelaran' })).toHaveAttribute('href', '/artists/art_mara');
    expect(screen.queryByText(/^Record:/)).not.toBeInTheDocument();
    expect(screen.getByText(/curators from verified institutions can request an introduction/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in as a curator/i })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('button', { name: /request introduction/i })).not.toBeInTheDocument();
    // More by the artist, never including the Kofi-only study
    expect(await screen.findByRole('heading', { name: 'More by Mara Oyelaran' })).toBeInTheDocument();
    expect(screen.getByText('Small Weather No. 4')).toBeInTheDocument();
    expect(screen.queryByText('Charcoal: Bridge Study')).not.toBeInTheDocument();
  });

  it('shows "$9,800" for aw_mara_1 to a verified curator, with shortlist and introduction actions', async () => {
    renderAt('/work/aw_mara_1', LENA);
    const h = await header();
    expect(within(h).getByText('$9,800')).toBeInTheDocument();
    expect(screen.queryByText('Price on request')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to shortlist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request introduction/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Record:/)).not.toBeInTheDocument();
  });

  it('treats a private draft (aw_june_3) as not available for a visitor', async () => {
    renderAt('/work/aw_june_3', VISITOR);
    expect(await screen.findByText("This work isn't available")).toBeInTheDocument();
    expect(screen.queryByText('Untitled (in progress)')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the gallery' })).toHaveAttribute('href', '/');
  });

  it('a Kofi-only record and an unknown id read exactly like not found', async () => {
    const a = renderAt('/work/aw_mara_3', VISITOR);
    expect(await screen.findByText("This work isn't available")).toBeInTheDocument();
    const kofiText = document.querySelector('main')?.textContent;
    a.unmount();
    renderAt('/work/does_not_exist', VISITOR);
    expect(await screen.findByText("This work isn't available")).toBeInTheDocument();
    expect(document.querySelector('main')?.textContent).toBe(kofiText);
  });

  it('owner sees visibility badges and an "Edit in studio" link', async () => {
    renderAt('/work/aw_mara_1', MARA);
    await header();
    expect(screen.getByText(/Record:/)).toHaveTextContent('Record: Public');
    expect(screen.getByText(/Price:/)).toHaveTextContent('Price: Verified institutions');
    expect(screen.getByRole('link', { name: /edit in studio/i })).toHaveAttribute('href', '/studio/work/aw_mara_1');
    expect(screen.getByText('$9,800')).toBeInTheDocument();
  });

  it('pending curator is told verification is pending, with a link to /curator/verify', async () => {
    renderAt('/work/aw_mara_1', OWEN);
    await header();
    expect(screen.getByText(/still verifying your institution/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /check your verification/i })).toHaveAttribute('href', '/curator/verify');
    expect(screen.queryByRole('button', { name: /request introduction/i })).not.toBeInTheDocument();
  });

  it('admin opening a private record logs exactly one audited view (no re-fetch loop)', async () => {
    const { ds } = renderAt('/work/aw_june_3', QUINCY);
    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled (in progress)' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 80));
    const views = (await ds.listAudit(QUINCY, 500)).filter((e) => e.action === 'private.view' && e.entityId === 'aw_june_3');
    expect(views).toHaveLength(1);
  });

  it('verified curator can request an introduction (min 20 characters)', async () => {
    const { ds } = renderAt('/work/aw_mara_1', LENA);
    await header();
    const before = (await ds.listInquiries(LENA)).length;
    fireEvent.click(screen.getByRole('button', { name: /request introduction/i }));
    const sheet = screen.getByRole('dialog', { name: 'Request an introduction' });
    expect(within(sheet).getByText(/never shared with you/i)).toBeInTheDocument();
    const box = within(sheet).getByLabelText('Your message');
    fireEvent.change(box, { target: { value: 'Too short' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send request' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/at least 20 characters/i);
    fireEvent.change(box, { target: { value: 'We are planning a 2027 show on weather and would love to include this painting.' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/request sent/i)).toBeInTheDocument();
    const after = await ds.listInquiries(LENA);
    expect(after).toHaveLength(before + 1);
    expect(after.some((i) => i.artworkId === 'aw_mara_1' && i.status === 'pending' && i.message.startsWith('We are planning'))).toBe(true);
  });

  it('verified curator can add to an existing shortlist or create one inline', async () => {
    const { ds } = renderAt('/work/aw_mara_2', LENA);
    await screen.findByRole('heading', { level: 1, name: 'Small Weather No. 4' });
    fireEvent.click(screen.getByRole('button', { name: /add to shortlist/i }));
    let sheet = screen.getByRole('dialog', { name: 'Add to shortlist' });
    fireEvent.click(await within(sheet).findByRole('button', { name: /add to weather & infrastructure/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    let lists = await ds.listShortlists(LENA);
    expect(lists.find((s) => s.id === 'sl_lena_1')?.items.map((i) => i.artworkId)).toContain('aw_mara_2');

    fireEvent.click(screen.getByRole('button', { name: /add to shortlist/i }));
    sheet = screen.getByRole('dialog', { name: 'Add to shortlist' });
    expect(await within(sheet).findByRole('button', { name: /already saved here/i })).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('New shortlist'), { target: { value: 'Small works wall' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create and add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    lists = await ds.listShortlists(LENA);
    expect(lists.find((s) => s.name === 'Small works wall')?.items.map((i) => i.artworkId)).toEqual(['aw_mara_2']);
  });
});
