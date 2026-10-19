import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { identity, renderAt } from './testUtils';
import { shortlistToText } from './shortlistText';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('curator shortlist page', () => {
  it('renders Lena’s seed shortlist with its 2 items', async () => {
    renderAt('/curator/shortlists/sl_lena_1', identity('lena'));
    expect(await screen.findByRole('heading', { name: 'Weather & Infrastructure — longlist', level: 2 })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Works on this shortlist' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(within(list).getByText('Doubling (Liberty Avenue, 7:40pm)')).toBeInTheDocument();
    expect(within(list).getByText('Transit Yard (loop)')).toBeInTheDocument();
    // Doubling already has a forwarded request (inq_1), so it shows status instead of a second request button.
    expect(within(list).getByText('Forwarded to the artist')).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: 'Request introduction' })).toHaveLength(1);
  });

  it('shows a muted “No longer available” row instead of crashing when a work disappears', async () => {
    const ds = new MockDataSource({ persist: false });
    const aw = ds._raw().artworks.find((a) => a.id === 'aw_deshawn_2')!;
    aw.visibility = 'private';
    renderAt('/curator/shortlists/sl_lena_1', identity('lena'), ds);
    expect(await screen.findByText(/No longer available/)).toBeInTheDocument();
    expect(screen.getByText('Doubling (Liberty Avenue, 7:40pm)')).toBeInTheDocument();
  });

  it('validates the introduction message, then sends it through the data layer', async () => {
    const { ds } = renderAt('/curator/shortlists/sl_lena_1', identity('lena'));
    fireEvent.click(await screen.findByRole('button', { name: 'Request introduction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request introduction' });
    const box = within(dialog).getByLabelText('Your message');
    fireEvent.change(box, { target: { value: 'Too short' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to Kofi' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/at least 20 characters/i);
    expect(await ds.listInquiries(identity('lena'))).toHaveLength(2);

    fireEvent.change(box, { target: { value: 'We would like to show Transit Yard in our 2027 infrastructure show.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to Kofi' }));
    await waitFor(async () => expect(await ds.listInquiries(identity('lena'))).toHaveLength(3));
    const created = (await ds.listInquiries(identity('lena'))).find((i) => i.artworkId === 'aw_deshawn_2');
    expect(created?.status).toBe('pending');
    expect(created?.artistId).toBe('art_deshawn');
  });

  it('copies the shortlist as plain text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/curator/shortlists/sl_lena_1', identity('lena'));
    await screen.findByText('Transit Yard (loop)');
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain('Weather & Infrastructure — longlist');
    expect(text).toMatch(/1\. Doubling \(Liberty Avenue, 7:40pm\) \(2025\) — Mara Oyelaran — 152 × 122 × 4 cm — .*9,800/);
    expect(text).toContain('Transit Yard (loop) (2025) — DeShawn Ferris');
    expect(text).not.toContain('mara@example.com');
    expect(await screen.findByText('Copied 2 works as text')).toBeInTheDocument();
  });

  it('deletes a shortlist after confirmation and returns to the desk', async () => {
    const { ds, router } = renderAt('/curator/shortlists/sl_lena_1', identity('lena'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete shortlist' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shortlist?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete shortlist' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/curator'));
    expect(await ds.listShortlists(identity('lena'))).toHaveLength(0);
  });
});

describe('curator desk', () => {
  it('tells a pending curator what verification unlocks and links to it', async () => {
    renderAt('/curator', identity('owen'));
    expect(await screen.findByText('Kofi is checking your institution by hand.')).toBeInTheDocument();
    expect(screen.getByText(/Verification unlocks prices/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review your request' })).toHaveAttribute('href', '/curator/verify');
    expect(screen.getByText('Verification pending')).toBeInTheDocument();
  });

  it('creates a new shortlist from the sheet', async () => {
    const { ds, router } = renderAt('/curator', identity('lena'));
    await screen.findByRole('link', { name: /Weather & Infrastructure/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'New shortlist' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'New shortlist' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create shortlist' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Give the shortlist a name/);
    fireEvent.change(within(dialog).getByLabelText('Shortlist name'), { target: { value: 'Airport commission' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create shortlist' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/curator\/shortlists\//));
    expect((await ds.listShortlists(identity('lena'))).map((s) => s.name)).toContain('Airport commission');
  });

  it('shows plain-language request statuses', async () => {
    renderAt('/curator/inquiries', identity('lena'));
    expect(await screen.findByText('Kofi is reviewing')).toBeInTheDocument();
    expect(screen.getByText('Forwarded to the artist')).toBeInTheDocument();
    expect(screen.getByText(/contact details are shared only after they accept/)).toBeInTheDocument();
  });
});

describe('verification form', () => {
  it('shows a lime notice and no form once verified', async () => {
    renderAt('/curator/verify', identity('lena'));
    expect(await screen.findByText(/Kofi verified Carnegie Museum of Art/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Verification request' })).not.toBeInTheDocument();
  });

  it('validates inline and resends a corrected request', async () => {
    const { ds } = renderAt('/curator/verify', identity('owen'));
    const form = await screen.findByRole('form', { name: 'Verification request' });
    await waitFor(() => expect(within(form).getByLabelText('Institution name')).toHaveValue('Pittsburgh International Airport Arts Program'));
    expect(within(form).getByLabelText('Institution type')).toHaveValue('municipal');
    fireEvent.change(within(form).getByLabelText('Work email'), { target: { value: 'not-an-email' } });
    fireEvent.change(within(form).getByLabelText('What are you looking for?'), { target: { value: 'short' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Resend for verification' }));
    expect(await within(form).findByText(/Enter your work email at the institution/)).toBeInTheDocument();
    expect(within(form).getByText(/at least 20 characters/)).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText('Work email'), { target: { value: 'owen@example.org' } });
    fireEvent.change(within(form).getByLabelText('What are you looking for?'), {
      target: { value: 'Shortlisting artists for the new terminal commission, budget confirmed.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Resend for verification' }));
    await waitFor(async () => expect((await ds.getMyCurator(identity('owen')))?.workEmail).toBe('owen@example.org'));
    expect((await ds.getMyCurator(identity('owen')))?.status).toBe('pending');
  });
});

describe('shortlistToText', () => {
  it('writes Price on request when the price is withheld and never includes contact info', () => {
    const text = shortlistToText(
      { name: 'Test list' },
      [
        { artworkId: 'x', work: undefined },
        {
          artworkId: 'y',
          note: 'Maybe',
          work: {
            id: 'y',
            artistId: 'a',
            artistWorkingName: 'A. Artist',
            artistCareerStage: 'emerging',
            artistExperience: { commissions: false, publicArt: false, residencies: false, institutionalShows: false },
            artistRegionLabel: '',
            title: 'Work',
            year: 2024,
            medium: 'painting',
            materials: [],
            dimensions: { height: 10, width: 20, unit: 'in' },
            description: '',
            images: [],
            status: 'available',
            rightsNote: '',
            priceWithheld: true,
            tags: [],
            visibility: 'public',
            priceVisibility: 'institutions',
            canEdit: false,
            createdAt: '',
            updatedAt: '',
          },
        },
      ],
      { unit: 'cm', fictional: true, exportedAt: new Date('2026-10-19T00:00:00Z') },
    );
    expect(text).toContain('1. No longer available');
    expect(text).toContain('2. Work (2024) — A. Artist — 25.4 × 50.8 cm — Price on request');
    expect(text).toContain('   Note: Maybe');
    expect(text).toContain('fictional sample content');
  });
});
