import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { adminRoutes } from './routes';
import { criteriaToForm, formToCriteria, BLANK_CRITERIA } from './ProgrammeFields';

const ADMIN = DEMO_IDENTITIES.find((d) => d.id === 'admin')!.viewer;

function renderAt(path: string, viewer: Viewer, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter([{ path: '/admin', children: adminRoutes }, { path: '*', element: <div>Elsewhere</div> }], { initialEntries: [path] });
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

describe('criteria form model', () => {
  it('an empty section saves as no criteria; a full one round-trips in library order', () => {
    expect(formToCriteria({ ...BLANK_CRITERIA, region: '  ', note: '' })).toBeUndefined();
    const c = formToCriteria({ tagIds: ['theme.memory', 'style.abstract', 'theme.community'], uses: ['exhibition', 'auction'], region: ' Pennsylvania ', minCm: '20', maxCm: '120,5', note: 'Night work.' });
    expect(c).toEqual({
      tags: { style: ['style.abstract'], theme: ['theme.community', 'theme.memory'] },
      uses: ['auction', 'exhibition'],
      region: 'Pennsylvania',
      minLongestEdgeCm: 20,
      maxLongestEdgeCm: 120.5,
      note: 'Night work.',
    });
    expect(formToCriteria(criteriaToForm(c))).toEqual(c);
  });
});

describe('admin call editor: Looking for', () => {
  it('shows the saved criteria, validates inline, saves new ones and clears to none', async () => {
    const { ds } = renderAt('/admin/programme/calls/call_night_weather', ADMIN);
    const section = await screen.findByRole('group', { name: 'Looking for' });
    const lf = within(section);
    // seeded: theme memory + subject urban life + exhibition; the picker opens on demand
    expect(lf.getByText('Memory')).toBeInTheDocument();
    fireEvent.click(lf.getByRole('button', { name: 'Choose tags' }));
    expect(lf.getByRole('button', { name: 'Memory' })).toHaveAttribute('aria-pressed', 'true');
    expect(lf.getByRole('button', { name: 'Urban Life' })).toHaveAttribute('aria-pressed', 'true');
    expect(lf.getByRole('checkbox', { name: 'Exhibition' })).toBeChecked();

    fireEvent.click(lf.getByRole('button', { name: 'Abstract' }));
    fireEvent.click(lf.getByRole('checkbox', { name: 'Auction' }));
    fireEvent.change(lf.getByLabelText('Region'), { target: { value: 'Pennsylvania' } });
    fireEvent.change(lf.getByLabelText('Smallest longest edge (cm)'), { target: { value: '200' } });
    fireEvent.change(lf.getByLabelText('Largest longest edge (cm)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The smallest size cannot be above the largest.')).toBeInTheDocument();
    expect((await ds.getOpenCall(ADMIN, 'call_night_weather'))?.lookingFor?.region).toBeUndefined();

    fireEvent.change(lf.getByLabelText('Smallest longest edge (cm)'), { target: { value: '30' } });
    expect(screen.queryByText('The smallest size cannot be above the largest.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => {
      const saved = await ds.getOpenCall(ADMIN, 'call_night_weather');
      expect(saved?.lookingFor).toEqual({
        tags: { style: ['style.abstract'], subject: ['subject.urban_life'], theme: ['theme.memory'] },
        uses: ['auction', 'exhibition'],
        region: 'Pennsylvania',
        minLongestEdgeCm: 30,
        maxLongestEdgeCm: 100,
      });
    });

    fireEvent.click(lf.getByRole('button', { name: 'Clear criteria' }));
    expect(lf.getByText('Nothing yet. Every work counts as a fit.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect((await ds.getOpenCall(ADMIN, 'call_night_weather'))?.lookingFor).toBeUndefined());
  }, 20_000);

  it('lists works that fit below the form, ranked, with a Fits only toggle', async () => {
    renderAt('/admin/programme/calls/call_night_weather', ADMIN);
    const list = await screen.findByRole('list', { name: 'Works that fit' });
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > li')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toHaveAttribute('data-fits', 'true');
    expect(within(rows[0]!).getByText(/^Fits (\d) of \1$/)).toBeInTheDocument();
    const fitting = rows.length;
    fireEvent.click(screen.getByRole('switch', { name: 'Fits only' }));
    expect(screen.getByRole('list', { name: 'Works that fit' }).querySelectorAll(':scope > li').length).toBeGreaterThan(fitting);
  });
});
