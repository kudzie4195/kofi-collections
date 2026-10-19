import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MockDataSource } from '@/data/mock/MockDataSource';
import type { Viewer } from '@/domain/types';
import { identity, renderAt } from '@/features/curator/testUtils';
import { describeAudit, timeAgo } from './format';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const TOBIAS: Viewer = { role: 'artist', artistId: 'art_tobias', userId: 'user_tobias' };

describe('admin dashboard', () => {
  it('shows 1 pending artist (Priya) and 1 pending curator (Owen) from the seed', async () => {
    renderAt('/admin', identity('admin'));
    const artists = await screen.findByRole('link', { name: '1 artist waiting for review' });
    expect(within(artists).getByTestId('tile-num')).toHaveTextContent(/^1$/);
    expect(artists).toHaveAttribute('href', '/admin/artists?status=pending');
    const curators = screen.getByRole('link', { name: '1 curator to verify' });
    expect(within(curators).getByTestId('tile-num')).toHaveTextContent(/^1$/);
    // inq_2 is pending; aw_mara_3 (kofi-only), aw_priya_1 and aw_priya_2 have never been reviewed.
    expect(screen.getByRole('link', { name: '1 introduction request' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3 works never reviewed' })).toBeInTheDocument();
    // Recent activity comes from the audit log.
    expect(screen.getByText(/forwarded an introduction request to the artist/)).toBeInTheDocument();
  });
});

describe('admin curators', () => {
  it('verifying Owen makes the data layer show him institution prices even with a stale curatorVerified:false session', async () => {
    const ds = new MockDataSource({ persist: false });
    const owen = identity('owen');
    expect(owen.curatorVerified).toBe(false);
    const before = await ds.getArtwork(owen, 'aw_mara_1');
    expect(before?.price).toBeUndefined();
    expect(before?.priceWithheld).toBe(true);

    const { unmount } = renderAt('/admin/curators', identity('admin'), ds);
    const row = await screen.findByRole('listitem', { name: /Owen Blackwood/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Verify' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verify Owen Blackwood?' });
    fireEvent.change(within(dialog).getByLabelText(/How you checked/), { target: { value: 'Listed in the airport arts staff directory.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify curator' }));
    expect(await screen.findByText('Owen Blackwood is verified')).toBeInTheDocument();
    unmount();

    // Owen's stored session still claims curatorVerified:false; the data layer re-checks the record.
    localStorage.setItem('kofi.session.v1', JSON.stringify({ ...owen, curatorVerified: false }));
    const after = await ds.getArtwork({ ...owen, curatorVerified: false }, 'aw_mara_1');
    expect(after?.price).toEqual({ amount: 9800, currency: 'USD' });
    expect(after?.priceWithheld).toBe(false);

    // …and his own desk reflects the record, not the stale flag.
    renderAt('/curator', { ...owen, curatorVerified: false }, ds);
    expect(await screen.findByText('Verified by Kofi')).toBeInTheDocument();
    expect(screen.queryByText('Kofi is checking your institution by hand.')).not.toBeInTheDocument();
  });

  it('requires a reason of at least 10 characters to reject', async () => {
    const { ds } = renderAt('/admin/curators', identity('admin'));
    const row = await screen.findByRole('listitem', { name: /Owen Blackwood/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/at least 10 characters/);
    expect((await ds.listCurators(identity('admin'))).find((c) => c.id === 'cur_owen')?.status).toBe('pending');
  });
});

describe('admin inquiries', () => {
  it('forwarding inq_2 puts it in Tobias’s studio inquiry list', async () => {
    const ds = new MockDataSource({ persist: false });
    expect((await ds.listInquiries(TOBIAS)).map((i) => i.id)).not.toContain('inq_2');

    renderAt('/admin/inquiries', identity('admin'), ds);
    const row = await screen.findByRole('listitem', { name: 'Request from Lena Marchetti about Tobias Reinholt' });
    fireEvent.click(within(row).getByRole('button', { name: 'Forward' }));
    const dialog = await screen.findByRole('dialog', { name: 'Forward to the artist?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forward to artist' }));
    await waitFor(async () => expect((await ds.listInquiries(TOBIAS)).map((i) => i.id)).toContain('inq_2'));
    const forwarded = (await ds.listInquiries(TOBIAS)).find((i) => i.id === 'inq_2');
    expect(forwarded?.status).toBe('forwarded');
  });
});

describe('admin artist detail', () => {
  it('shows private details, includes kofi-only works and marks a work reviewed', async () => {
    const { ds } = renderAt('/admin/artists/art_mara', identity('admin'));
    expect(await screen.findByRole('heading', { name: 'Private — Kofi staff only' })).toBeInTheDocument();
    expect(screen.getByText('Omolara Oyelaran-Whitfield')).toBeInTheDocument();
    expect(screen.getByText('mara@example.com')).toBeInTheDocument();
    expect(screen.getByText('Charcoal: Bridge Study')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Charcoal: Bridge Study reviewed' }));
    await waitFor(async () => {
      const w = (await ds.listArtistArtworks(identity('admin'), 'art_mara')).find((x) => x.id === 'aw_mara_3');
      expect(w?.reviewedAt).toBeTruthy();
    });
  });

  it('approves a pending artist with a note that lands in Kofi notes', async () => {
    const { ds } = renderAt('/admin/artists/art_priya', identity('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve Priya Venkataraman?' });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Two more works documented.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve artist' }));
    await waitFor(async () => expect((await ds.getArtist(identity('admin'), 'art_priya'))?.status).toBe('approved'));
    expect((await ds.getArtist(identity('admin'), 'art_priya'))?.kofiNotes).toContain('Two more works documented.');
  });
});

describe('activity log', () => {
  it('lists audit events in plain words and filters by record type', async () => {
    renderAt('/admin/activity', identity('admin'));
    expect(await screen.findByText(/append-only/)).toBeInTheDocument();
    expect(await screen.findByText(/approved an artist/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mara Oyelaran' })).toHaveAttribute('href', '/admin/artists/art_mara');
    fireEvent.click(screen.getByRole('button', { name: /Curators/ }));
    expect(screen.queryByText(/approved an artist/)).not.toBeInTheDocument();
    expect(screen.getByText(/verified a curator/)).toBeInTheDocument();
  });

  it('formats relative time and maps actions to sentences', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(timeAgo('2026-10-19T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-19T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-10-19T07:00:00Z', now)).toBe('5 h ago');
    expect(timeAgo('2026-10-18T12:00:00Z', now)).toBe('yesterday');
    expect(timeAgo('2026-10-14T12:00:00Z', now)).toBe('5 days ago');
    expect(timeAgo('2026-09-01T12:00:00Z', now)).toBe('2 months ago');
    expect(describeAudit({ action: 'document.open' })).toBe('opened a private document');
    expect(describeAudit({ action: 'inquiry.status', meta: { status: 'forwarded' } })).toBe('forwarded an introduction request to the artist');
  });
});
