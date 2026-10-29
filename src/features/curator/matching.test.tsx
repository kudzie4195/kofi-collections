import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { identity, renderAt } from './testUtils';

const NOW = new Date('2026-10-20T16:00:00Z');
const fresh = () => new MockDataSource({ persist: false, now: () => NOW });
const rowsOf = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(':scope > li')];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('partner call editor: Looking for', () => {
  it('Lena drafts a call with criteria; a bad size is caught inline; an empty section saves none', async () => {
    const lena = identity('lena');
    const ds = fresh();
    const { router } = renderAt('/curator/calls/new', lena, ds);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'River Light' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Work about the rivers.' } });
    fireEvent.change(screen.getByLabelText('Eligibility'), { target: { value: 'Artists in Pennsylvania' } });
    const lf = within(screen.getByRole('group', { name: 'Looking for' }));
    fireEvent.click(lf.getByRole('button', { name: 'Choose tags' }));
    fireEvent.click(lf.getByRole('button', { name: 'Memory' }));
    fireEvent.click(lf.getByRole('button', { name: 'Community' }));
    fireEvent.click(lf.getByRole('checkbox', { name: 'Exhibition' }));
    fireEvent.change(lf.getByLabelText('Largest longest edge (cm)'), { target: { value: '-4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter a size in centimetres.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/curator/calls/new');

    fireEvent.change(lf.getByLabelText('Largest longest edge (cm)'), { target: { value: '150' } });
    fireEvent.change(lf.getByLabelText('Note to artists'), { target: { value: 'Small works welcome.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/curator\/calls\/(?!new)/));
    const id = router.state.location.pathname.split('/').pop()!;
    expect((await ds.getOpenCall(lena, id))?.lookingFor).toEqual({
      tags: { theme: ['theme.community', 'theme.memory'] },
      uses: ['exhibition'],
      maxLongestEdgeCm: 150,
      note: 'Small works welcome.',
    });

    cleanup();
    renderAt(`/curator/calls/${id}/edit`, lena, ds);
    const again = within(await screen.findByRole('group', { name: 'Looking for' }));
    expect(again.getByText('Community, Memory')).toBeInTheDocument();
    fireEvent.click(again.getByRole('button', { name: 'Clear criteria' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect((await ds.getOpenCall(lena, id))?.lookingFor).toBeUndefined());
  }, 20_000);
});

describe('partner call desk: Works that fit', () => {
  it('ranks works against the CMA auction with reasons, and "Fits only" hides near misses', async () => {
    const { router } = renderAt('/curator/calls/call_cma_auction', identity('lena'), fresh());
    fireEvent.click(await screen.findByRole('radio', { name: 'Works that fit' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=fit'));
    const list = await screen.findByRole('list', { name: 'Works that fit' });
    const fits = rowsOf(list);
    expect(fits.length).toBeGreaterThan(0);
    for (const r of fits) expect(within(r).getByText('Fits 3 of 3')).toBeInTheDocument();
    // Doubling: memory, auction and in Pennsylvania. Links to the work page.
    const doubling = fits.find((r) => r.textContent?.includes('Doubling'))!;
    expect(within(doubling).getByRole('link', { name: /Doubling/ })).toHaveAttribute('href', '/work/aw_mara_1');
    expect(within(doubling).getByText('Available for auction.')).toBeInTheDocument();
    expect(within(doubling).getByText('In Pennsylvania.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Fits only' }));
    const all = rowsOf(screen.getByRole('list', { name: 'Works that fit' }));
    expect(all.length).toBeGreaterThan(fits.length);
    // fits first, then most asks met
    const met = all.map((r) => (r.dataset.fits ? 99 : Number(/^(\d) of/.exec(r.querySelector('.fit-pill')?.textContent ?? '')?.[1] ?? 0)));
    expect([...met].sort((a, b) => b - a)).toEqual(met);
    const miss = all.find((r) => !r.dataset.fits)!;
    expect(miss.querySelector('.fit-reasons li:not([data-ok])')).not.toBeNull();
  });
});
