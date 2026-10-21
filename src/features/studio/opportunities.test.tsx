import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { studioRoutes } from './routes';

const viewerOf = (id: string): Viewer => {
  const v = DEMO_IDENTITIES.find((i) => i.id === id)?.viewer;
  if (!v) throw new Error(`no identity ${id}`);
  return v;
};
const MARA = viewerOf('mara');
const JUNE = viewerOf('june');
const ADMIN = viewerOf('admin');
const DESHAWN: Viewer = { role: 'artist', userId: 'user_deshawn', artistId: 'art_deshawn', displayName: 'DeShawn Ferris' };
const STATEMENT = 'Both paintings come from the same wet week on Liberty Avenue, one large and one small.';

function renderStudio(path: string, viewer: Viewer = MARA, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter(
    [
      { path: '/studio', children: studioRoutes },
      { path: '*', element: <p>Somewhere else</p> },
    ],
    { initialEntries: [path] },
  );
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

beforeEach(() => {
  // Seed dates are absolute; pin the calendar so call phases are stable.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T15:00:00Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe('opportunities', () => {
  it('lists open and upcoming calls with medium hints, partner forms and applied status', async () => {
    const ds = new MockDataSource({ persist: false });
    await ds.saveOpenCall(ADMIN, {
      sample: true, published: true, kind: 'exhibition', title: 'Partner Form Call', partner: 'A Partner', summary: 'A call run on a partner form.',
      body: 'Read the call on the partner site.', eligibility: 'See the call', mediums: [], opensOn: '2026-10-01', maxWorks: 1,
      fee: 'See the call', externalUrl: 'https://example.org/apply',
    });
    renderStudio('/studio/opportunities', DESHAWN, ds);
    const list = await screen.findByRole('list', { name: 'Open and upcoming calls' });
    const night = within(list).getByRole('article', { name: 'Night Weather Studio Award' });
    expect(within(night).getByText('Submitted')).toBeInTheDocument();
    expect(within(night).getByText('Fits your mediums')).toBeInTheDocument();
    expect(within(night).getByRole('link', { name: 'View your application' })).toHaveAttribute('href', '/studio/applications');
    const partner = within(list).getByRole('article', { name: 'Partner Form Call' });
    expect(within(partner).getByRole('link', { name: /Apply on partner form/ })).toHaveAttribute('href', 'https://example.org/apply');
    // Kofi's real Art of Advocacy call closed on Sep 11, 2026.
    expect(within(list).queryByRole('article', { name: /The Art of Advocacy/ })).not.toBeInTheDocument();
    // Soft Ground wants printmaking/textile — not DeShawn's photography/video.
    const soft = within(list).getByRole('article', { name: /Soft Ground/ });
    expect(within(soft).getByText('Outside your listed mediums')).toBeInTheDocument();
    expect(within(list).queryByRole('article', { name: /Late Summer Open/ })).not.toBeInTheDocument();
  });
});

describe('apply flow', () => {
  it('Mara applies to the Night Weather award with two works and sees it in her applications', async () => {
    const { ds, router } = renderStudio('/studio/apply/call_night_weather');
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply' })).toBeInTheDocument();
    expect(await screen.findByText('0 of 3 selected')).toBeInTheDocument(); // lazy route: the shell can paint before the call loads
    const doubling = screen.getByRole('checkbox', { name: /Doubling/ });
    const small = screen.getByRole('checkbox', { name: /Small Weather No. 4/ });
    fireEvent.click(doubling);
    fireEvent.click(small);
    expect(doubling).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();

    // instant client feedback for a too-short statement
    fireEvent.change(screen.getByLabelText('Why these works, for this call'), { target: { value: 'Too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByText(/Write at least a sentence or two/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Why these works, for this call'), { target: { value: STATEMENT } });
    const review = screen.getByRole('list', { name: 'Works you are attaching' });
    expect(within(review).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/including Kofi-team-only ones/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/applications'));
    expect(await screen.findByText('Application sent to Kofi for “Night Weather Studio Award”')).toBeInTheDocument();
    const apps = await screen.findByRole('list', { name: 'Your applications' });
    const row = within(apps).getByRole('link', { name: 'Night Weather Studio Award' }).closest('li')!;
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
    expect(within(row).getByText('Doubling (Liberty Avenue, 7:40pm)')).toBeInTheDocument();
    const mine = await ds.listMyApplications(MARA);
    expect(mine.find((a) => a.callId === 'call_night_weather')?.artworkIds).toEqual(['aw_mara_1', 'aw_mara_2']);
  });

  it('disables works set to Only me, with the reason and a link to change it', async () => {
    renderStudio('/studio/apply/call_night_weather', JUNE);
    const priv = await screen.findByRole('checkbox', { name: /Untitled \(in progress\)/ });
    expect(priv).toBeDisabled();
    expect(screen.getByText(/Set to Only me — change visibility to attach/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit visibility' })).toHaveAttribute('href', '/studio/work/aw_june_3');
    fireEvent.click(priv);
    expect(priv).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
  });

  it('stops at the call’s maximum number of works', async () => {
    const ds = new MockDataSource({ persist: false });
    const call = (await ds.getOpenCall(ADMIN, 'call_night_weather'))!;
    await ds.saveOpenCall(ADMIN, { ...call, maxWorks: 2 });
    renderStudio('/studio/apply/call_night_weather', MARA, ds);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
    expect(boxes[2]).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(boxes[2]!);
    expect(boxes[2]).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
    // Freeing a slot re-enables it.
    fireEvent.click(boxes[0]!);
    expect(boxes[2]).not.toHaveAttribute('aria-disabled');
  });

  it('guards a call DeShawn has already applied to', async () => {
    renderStudio('/studio/apply/call_night_weather', DESHAWN);
    expect(await screen.findByRole('heading', { name: 'You’ve already applied' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My applications' })).toHaveAttribute('href', '/studio/applications');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('guards closed, upcoming and partner-form calls', async () => {
    renderStudio('/studio/apply/call_summer_open');
    expect(await screen.findByRole('heading', { name: 'This call has closed' })).toBeInTheDocument();
    cleanup();
    renderStudio('/studio/apply/call_soft_ground');
    expect(await screen.findByRole('heading', { name: 'This call isn’t open yet' })).toBeInTheDocument();
    cleanup();
    const ds = new MockDataSource({ persist: false });
    const partner = await ds.saveOpenCall(ADMIN, {
      sample: true, published: true, kind: 'exhibition', title: 'Partner Form Call', summary: 'A call run on a partner form.', body: 'Read it there.',
      eligibility: 'See the call', mediums: [], opensOn: '2026-10-01', maxWorks: 1, fee: 'See the call', externalUrl: 'https://example.org/apply',
    });
    renderStudio(`/studio/apply/${partner.id}`, MARA, ds);
    expect(await screen.findByRole('heading', { name: 'This call uses the partner’s form' })).toBeInTheDocument();
    cleanup();
    renderStudio('/studio/apply/call_nope');
    expect(await screen.findByRole('heading', { name: 'We couldn’t find that call' })).toBeInTheDocument();
  });
});

describe('my applications', () => {
  it('DeShawn withdraws his submitted application', async () => {
    const { ds } = renderStudio('/studio/applications', DESHAWN);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw application to Night Weather Studio Award' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this application?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw application' }));
    });
    expect(await screen.findByText('Application withdrawn')).toBeInTheDocument();
    await waitFor(async () => expect((await ds.listMyApplications(DESHAWN))[0]?.status).toBe('withdrawn'));
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw application to/ })).not.toBeInTheDocument();
  });

  it('shows Mara’s decision note and offers no withdraw on a decided application', async () => {
    renderStudio('/studio/applications');
    expect(await screen.findByText('Selected for Night Weather, opening October 2.')).toBeInTheDocument();
    // Mara was selected for both the Late Summer Open and the CMA benefit auction (v4 seed).
    expect(screen.getAllByText('Selected')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
  });
});

describe('studio home', () => {
  it('shows open calls and application counts', async () => {
    renderStudio('/studio');
    const block = await screen.findByRole('region', { name: 'Opportunities' });
    const open = within(block).getByRole('link', { name: /Open call/ });
    expect(open).toHaveAttribute('href', '/studio/opportunities');
    expect(open).toHaveTextContent(/^1/); // Night Weather (Art of Advocacy closed Sep 11, 2026)
    expect(within(block).getByRole('link', { name: /My applications/ })).toHaveTextContent('2 selected'); // Late Summer Open + CMA benefit auction
  });
});
