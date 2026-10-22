import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MockDataSource } from '@/data/mock/MockDataSource';
import type { Viewer } from '@/domain/types';
import { CONSENT_VERSION } from '@/domain/types';
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

/* ---------------- v5 intake on the Kofi desk ---------------- */

describe('artist queue: links and import sources', () => {
  it('summarises links and shows where each profile was imported from', async () => {
    renderAt('/admin/artists', identity('admin'));
    const mara = (await screen.findByText('Mara Oyelaran')).closest('a')!;
    expect(within(mara).getByTestId('links-summary')).toHaveTextContent('2 links · 1 verified');
    expect(within(mara).getByText('Imported from Instagram')).toBeInTheDocument();
    expect(within(mara).getByText('Imported from Website')).toBeInTheDocument();
    const priya = screen.getByText('Priya Venkataraman').closest('a')!;
    expect(within(priya).getByTestId('links-summary')).toHaveTextContent(/^2 links$/);
  });
});

describe('admin artist detail: links, sources, code', () => {
  it('shows pills, the imported-from list and the code; Re-check updates the pills', async () => {
    renderAt('/admin/artists/art_priya', identity('admin'));
    const links = await screen.findByRole('list', { name: 'Priya Venkataraman: links' });
    const pill = (handle: string) =>
      within(links).getByText(handle).closest('li')!.querySelector('[data-verification]')!.getAttribute('data-verification');
    expect(pill('priyavenkataraman.art')).toBe('claimed');
    expect(pill('priya-venkataraman')).toBe('unreachable');

    const sources = screen.getByRole('list', { name: 'Imported from' });
    const items = within(sources).getAllByRole('listitem').filter((li) => li.classList.contains('ad-import'));
    expect(items).toHaveLength(2);
    expect(within(sources).getByText('name, bio')).toBeInTheDocument();
    expect(within(sources).getByText('Looked, used nothing')).toBeInTheDocument();
    expect(within(sources).getByText(/could not read a name from the page/)).toBeInTheDocument();

    const call = screen.getByRole('region', { name: 'If they call' });
    expect(within(call).getByTestId('artist-token')).toHaveTextContent('kofi-pv3h8x');

    // Approve/decline are still there.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check links' }));
    expect(await screen.findByText('Checked 2 links: 1 verified.')).toBeInTheDocument();
    await waitFor(() => {
      const fresh = screen.getByRole('list', { name: 'Priya Venkataraman: links' });
      expect(within(fresh).getByText('priyavenkataraman.art').closest('li')!.querySelector('[data-verification]')!.getAttribute('data-verification')).toBe('verified');
    });
  });

  it('says so plainly when a profile has no links or imports', async () => {
    const ds = new MockDataSource({ persist: false });
    const { viewer } = await ds.signUpArtist({ displayName: 'Ada Brightwater', email: 'ada@example.com', password: 'rain on liberty avenue', consentVersion: CONSENT_VERSION });
    renderAt(`/admin/artists/${viewer.artistId}`, identity('admin'), ds);
    expect(await screen.findByText('No links on this profile yet.')).toBeInTheDocument();
    expect(screen.getByText(/Typed in by hand/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-check links' })).not.toBeInTheDocument();
    expect(screen.getByTestId('artist-token').textContent).toMatch(/^kofi-[a-z2-9]{6}$/);
  });
});

describe('audit wording for the intake', () => {
  it('reads as a sentence after the actor name', () => {
    expect(describeAudit({ action: 'artist.signup', meta: { status: 'draft' } })).toBe('created a profile');
    expect(describeAudit({ action: 'artist.import', meta: { platform: 'instagram', handle: '@mara.paints' } })).toBe('pulled details from Instagram @mara.paints');
    expect(describeAudit({ action: 'artist.import', meta: { url: 'https://www.instagram.com/mara.paints' } })).toBe('pulled details from Instagram @mara.paints');
    expect(describeAudit({ action: 'artist.import', meta: { platform: 'instagram', applied: 'workingName' } })).toBe('pulled details from Instagram');
    expect(describeAudit({ action: 'artist.import', meta: { url: 'https://www.mara-oyelaran.com' } })).toBe('pulled details from mara-oyelaran.com');
    expect(describeAudit({ action: 'artist.import' })).toBe('pulled details from a link');
    expect(describeAudit({ action: 'artist.links', meta: { links: 2, verified: 1, failed: 1, unreachable: 0 } })).toBe('checked 2 links: 1 verified');
    expect(describeAudit({ action: 'artist.links', meta: { links: 1, verified: 0 } })).toBe('checked 1 link: 0 verified');
  });

  it('shows sign-up, import and link checks in the activity log', async () => {
    const ds = new MockDataSource({ persist: false });
    const { viewer } = await ds.signUpArtist({ displayName: 'Ada Brightwater', email: 'ada@example.com', password: 'rain on liberty avenue', consentVersion: CONSENT_VERSION });
    const imp = await ds.importProfile(viewer, '@ada.paints');
    // Reading a page is not audited; applying what it suggested is.
    await ds.recordImport(viewer, { source: imp.source, fetchedAt: imp.fetchedAt, appliedFields: ['workingName'], notes: imp.notes });
    await ds.updateMyArtist(viewer, { links: [{ label: 'Instagram @ada.paints', url: 'https://www.instagram.com/ada.paints' }] });
    await ds.checkMyLinks(viewer);
    renderAt('/admin/activity', identity('admin'), ds);
    expect(await screen.findByText(/created a profile/)).toBeInTheDocument();
    expect(screen.getByText(/pulled details from Instagram/)).toBeInTheDocument();
    expect(screen.getByText(/checked 1 link: 0 verified/)).toBeInTheDocument();
  });
});
