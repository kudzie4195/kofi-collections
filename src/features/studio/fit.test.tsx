import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { studioRoutes } from './routes';
import { worksThatFit } from './Opportunities';

const viewerOf = (id: string): Viewer => DEMO_IDENTITIES.find((i) => i.id === id)!.viewer;
const MARA = viewerOf('mara');
const ADMIN = viewerOf('admin');

function renderStudio(path: string, viewer: Viewer, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter([{ path: '/studio', children: studioRoutes }, { path: '*', element: <p>Somewhere else</p> }], { initialEntries: [path] });
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
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T15:00:00Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('apply page: fit lines', () => {
  it('shows "Fits N of M" per work with the reasons on expand; works that miss stay selectable', async () => {
    renderStudio('/studio/apply/call_night_weather', MARA);
    const works = await screen.findByRole('list', { name: 'Your works' });
    const cards = [...works.querySelectorAll<HTMLElement>(':scope > li')];
    const doubling = cards.find((c) => c.textContent?.includes('Doubling'))!;
    const bridge = cards.find((c) => c.textContent?.includes('Bridge Study'))!;
    expect(within(doubling).getByText('Fits 3 of 3')).toBeInTheDocument();
    expect(within(bridge).getByText('Fits 2 of 3')).toBeInTheDocument();

    // reasons are the domain sentences, verbatim
    fireEvent.click(within(bridge).getByText('Fits 2 of 3'));
    expect(within(bridge).getByText('Themes & Concepts: Memory. This work is not tagged with any of these.')).toBeInTheDocument();
    expect(within(bridge).getByText('Available for exhibition.')).toBeInTheDocument();

    const pick = within(bridge).getByRole('checkbox', { name: /Bridge Study/ });
    fireEvent.click(pick);
    expect(pick).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('It is your call. Works that miss an ask can still be sent.')).toBeInTheDocument();
  });
});

describe('opportunities: works that fit', () => {
  it('counts the artist’s own works that meet every ask, and says when a call asks nothing', async () => {
    const ds = new MockDataSource({ persist: false });
    await ds.saveOpenCall(ADMIN, {
      sample: true, published: true, kind: 'award', title: 'Open Studio Grant', summary: 'A grant with no criteria.', body: 'Apply.', eligibility: 'Anyone',
      mediums: [], opensOn: '2026-10-01', maxWorks: 2, fee: 'No entry fee',
    });
    const call = (await ds.getOpenCall(MARA, 'call_night_weather'))!;
    const expected = worksThatFit(call, await ds.listArtistArtworks(MARA, 'art_mara'));
    expect(expected.asks).toBe(3);
    expect(expected.fit).toBeGreaterThan(0);

    renderStudio('/studio/opportunities', MARA, ds);
    const list = await screen.findByRole('list', { name: 'Open and upcoming calls' });
    const night = within(list).getByRole('article', { name: 'Night Weather Studio Award' });
    expect(within(night).getByTestId('works-fit')).toHaveTextContent(expected.fit === 1 ? '1 of your works fits' : `${expected.fit} of your works fit`);
    const grant = within(list).getByRole('article', { name: 'Open Studio Grant' });
    expect(within(grant).getByTestId('works-fit')).toHaveTextContent('No criteria yet');
  });
});
