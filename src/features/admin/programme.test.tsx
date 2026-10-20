import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { PUBLIC_VIEWER } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { adminRoutes } from './routes';
import { studioRoutes } from '@/features/studio/routes';

const ADMIN = DEMO_IDENTITIES.find((d) => d.id === 'admin')!.viewer;
const DESHAWN: Viewer = { role: 'artist', userId: 'user_deshawn', artistId: 'art_deshawn', displayName: 'DeShawn Ferris' };

function renderAt(path: string, viewer: Viewer, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter(
    [
      { path: '/admin', children: adminRoutes },
      { path: '/studio', children: studioRoutes },
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T15:00:00Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('admin home: programme queues', () => {
  it('adds applications-to-review and new collector inquiry tiles, and programme nav rows', async () => {
    renderAt('/admin', ADMIN);
    const apps = await screen.findByRole('link', { name: '1 application to review' });
    expect(apps).toHaveAttribute('href', '/admin/applications');
    expect(screen.getByRole('link', { name: '1 new collector inquiry' })).toHaveAttribute('href', '/admin/collectors?status=new');
    const nav = screen.getByRole('list', { name: 'Kofi admin sections' });
    for (const name of [/Programme/, /Applications/, /Collector inquiries/]) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
  });
});

describe('programme desk', () => {
  it('lists each section by tab, with Draft and Sample badges', async () => {
    const { router } = renderAt('/admin/programme', ADMIN);
    const list = await screen.findByRole('list', { name: 'Exhibitions' });
    const night = within(list).getByRole('link', { name: /Night Weather/ });
    expect(within(night).getByText('Now showing')).toBeInTheDocument();
    expect(within(night).getByText('Sample')).toBeInTheDocument();
    expect(night).toHaveAttribute('href', '/admin/programme/exhibitions/ex_night_weather');
    fireEvent.click(screen.getByRole('radio', { name: 'Open calls' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=calls'));
    const calls = await screen.findByRole('list', { name: 'Open calls' });
    expect(within(calls).getByRole('link', { name: /Late Summer Open 2026/ })).toHaveTextContent('2 applications');
    expect(screen.getByRole('link', { name: 'New open call' })).toHaveAttribute('href', '/admin/programme/calls/new');
  });

  it('creates a draft exhibition that the public cannot see', async () => {
    const { ds, router } = renderAt('/admin/programme/exhibitions/new', ADMIN);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Paper Weather' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Works on paper made outdoors.' } });
    // client check before the server's
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Choose a start date.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-04-02' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-01' } });
    // the live preview follows the form
    const preview = screen.getByRole('complementary', { name: 'Live preview' });
    expect(within(preview).getByText('Paper Weather')).toBeInTheDocument();
    expect(within(preview).getByText('Draft')).toBeInTheDocument();
    expect(within(preview).getByText('Apr 2 – May 1, 2027')).toBeInTheDocument();
    // attach a work, in order
    fireEvent.click(screen.getByRole('checkbox', { name: /Grid Drift 03/ }));
    expect(screen.getByRole('list', { name: 'Selected works, in order' })).toHaveTextContent('Grid Drift 03');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    });
    expect(await screen.findByText('Saved draft of “Paper Weather”')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/admin\/programme\/exhibitions\/ex_/));
    const adminList = await ds.listExhibitions(ADMIN);
    const created = adminList.find((x) => x.title === 'Paper Weather');
    expect(created?.published).toBe(false);
    expect(created?.artworkIds).toEqual(['aw_priya_1']);
    expect((await ds.listExhibitions(PUBLIC_VIEWER)).some((x) => x.title === 'Paper Weather')).toBe(false);
    expect(await ds.getExhibition(PUBLIC_VIEWER, created!.id)).toBeUndefined();
  });

  it('shows the server’s field error inline', async () => {
    renderAt('/admin/programme/exhibitions/ex_night_weather', ADMIN);
    const end = await screen.findByLabelText('End date');
    fireEvent.change(end, { target: { value: '2026-09-01' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    expect(await screen.findByText('The end date is before the start date.')).toBeInTheDocument();
    expect(screen.getByLabelText('End date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('link', { name: /View public page/ })).toHaveAttribute('href', '/exhibitions/ex_night_weather');
  });

  it('refuses to delete a call that has applications and says why', async () => {
    const { ds } = renderAt('/admin/programme/calls/call_summer_open', ADMIN);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this open call?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    expect(await screen.findByText('This call has applications. Unpublish it instead.')).toBeInTheDocument();
    expect(await ds.getOpenCall(ADMIN, 'call_summer_open')).toBeDefined();
  });

  it('saves an event typed in Pittsburgh time with the right offset after the clocks change', async () => {
    const { ds } = renderAt('/admin/programme/events/ev_june_open_studio', ADMIN);
    const starts = await screen.findByLabelText('Starts');
    expect(starts).toHaveValue('2026-11-08T13:00');
    fireEvent.change(starts, { target: { value: '2026-10-31T13:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-11-01T17:00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    await waitFor(async () => {
      const ev = (await ds.listEvents(ADMIN)).find((e) => e.id === 'ev_june_open_studio');
      expect(ev?.startsAt).toBe('2026-10-31T13:00:00-04:00');
      expect(ev?.endsAt).toBe('2026-11-01T17:00:00-05:00');
    });
  });
});

describe('applications review', () => {
  it('Kofi selects DeShawn with a note; he sees the note but never the staff note', async () => {
    const ds = new MockDataSource({ persist: false });
    const { unmount } = renderAt('/admin/applications', ADMIN, ds);
    fireEvent.click(await screen.findByRole('link', { name: /DeShawn Ferris/ }));
    expect(await screen.findByRole('link', { name: 'DeShawn Ferris' })).toHaveAttribute('href', '/admin/artists/art_deshawn');
    expect(screen.getByText(/made between 2 and 5am/)).toBeInTheDocument();
    expect(screen.getByText('Night Shift: Bakery, 3:10am')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    const sheet = await screen.findByRole('dialog', { name: 'Select this application?' });
    fireEvent.change(within(sheet).getByLabelText('Note to the artist'), { target: { value: 'Selected for the spring solo wall.' } });
    fireEvent.change(within(sheet).getByLabelText(/Private staff note/), { target: { value: 'Board loved the video loop; budget confirmed.' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }));
    });
    await waitFor(() => expect(screen.getByTestId('app-status')).toHaveTextContent('Selected'));
    expect(screen.getByText('Board loved the video loop; budget confirmed.')).toBeInTheDocument();
    // A decided application can go back to the shortlist.
    expect(screen.getByRole('button', { name: 'Back to shortlist' })).toBeInTheDocument();
    unmount();

    renderAt('/studio/applications', DESHAWN, ds);
    expect(await screen.findByText('Selected for the spring solo wall.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Board loved the video loop');
    expect(document.body.textContent).not.toContain('budget confirmed');
  });

  it('filters by call and status, and keeps withdrawn applications read-only', async () => {
    const ds = new MockDataSource({ persist: false });
    const [app] = await ds.listMyApplications(DESHAWN);
    await ds.withdrawApplication(DESHAWN, app!.id);
    const { router } = renderAt('/admin/applications?call=call_summer_open&status=all', ADMIN, ds);
    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByText('DeShawn Ferris')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Selected/ }));
    await waitFor(() => expect(router.state.location.search).toContain('status=accepted'));
    expect(within(screen.getByRole('list', { name: 'Applications' })).getAllByRole('listitem')).toHaveLength(1);
    cleanup();

    renderAt(`/admin/applications/${app!.id}`, ADMIN, ds);
    expect(await screen.findByText(/The artist withdrew this application/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });
});

describe('collector inquiries', () => {
  it('opens an inquiry, saves a staff note and moves it to in progress', async () => {
    const { ds } = renderAt('/admin/collectors', ADMIN);
    expect(await screen.findByText(/never shared automatically/)).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem', { name: /Inquiry from/ });
    expect(rows[0]).toHaveAccessibleName('Inquiry from Dana Whitcomb'); // newest first
    expect(within(rows[0]!).getByRole('link', { name: 'Doubling (Liberty Avenue, 7:40pm)' })).toHaveAttribute('href', '/work/aw_mara_1');
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Open inquiry from Dana Whitcomb' }));
    const sheet = await screen.findByRole('dialog', { name: 'Inquiry from Dana Whitcomb' });
    expect(within(sheet).getByRole('link', { name: 'dana.whitcomb@example.com' })).toHaveAttribute('href', 'mailto:dana.whitcomb@example.com');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'In progress' }));
    fireEvent.change(within(sheet).getByLabelText('Staff note'), { target: { value: 'Viewing booked for Thursday.' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    });
    expect(await screen.findByText('Marked in progress')).toBeInTheDocument();
    const saved = (await ds.listBuyerInquiries(ADMIN)).find((b) => b.id === 'bi_doubling');
    expect(saved?.status).toBe('in progress');
    expect(saved?.staffNote).toBe('Viewing booked for Thursday.');
  });
});
