import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { filtersFromParams, paramsFromFilters, withUnit } from './params';
import { renderAt } from './testUtils';

afterEach(() => localStorage.clear());

const grid = () => screen.getByRole('list', { name: 'Works' });
const titlesInGrid = () => within(grid()).getAllByRole('link').map((a) => a.querySelector('.label-card__title')?.textContent);

describe('Works gallery (/works)', () => {
  it('shows published works to a visitor and never drafts, Kofi-only records or pending artists', async () => {
    renderAt('/works');
    expect(await screen.findByText('Small Weather No. 4')).toBeInTheDocument();
    expect(screen.getByText('Doubling (Liberty Avenue, 7:40pm)')).toBeInTheDocument();
    expect(screen.queryByText('Charcoal: Bridge Study')).not.toBeInTheDocument();
    expect(screen.queryByText('Untitled (in progress)')).not.toBeInTheDocument();
    expect(screen.queryByText('Grid Drift 03')).not.toBeInTheDocument();
    expect(screen.queryByText('Grid Drift 04')).not.toBeInTheDocument();
    expect(screen.getByTestId('result-count')).toHaveTextContent('9 works');
    // Compact page header (the hero lives on Discover now)
    expect(screen.getByRole('heading', { level: 1, name: 'Works' })).toBeInTheDocument();
    expect(screen.getByText(/9 works by 4 artists/)).toBeInTheDocument();
    // Cards link to the detail route
    expect(screen.getByText('Small Weather No. 4').closest('a')).toHaveAttribute('href', '/work/aw_mara_2');
  });

  it('painting + size under 40 in from URL params gives exactly Small Weather No. 4', async () => {
    renderAt('/works?medium=painting&unit=in&max=40');
    await screen.findByText('Small Weather No. 4');
    expect(titlesInGrid()).toEqual(['Small Weather No. 4']);
    expect(screen.getByRole('button', { name: /^filters \(2\)/i })).toBeInTheDocument();
  });

  it('painting chip + "Under 40 in" preset in the filter sheet narrows to Small Weather No. 4 and writes the URL', async () => {
    renderAt('/works');
    await screen.findByText('Small Weather No. 4');
    const mediums = screen.getByRole('group', { name: 'Medium' });
    fireEvent.click(within(mediums).getByRole('button', { name: /^painting/i }));
    expect(titlesInGrid()).toEqual(expect.arrayContaining(['Small Weather No. 4', 'Doubling (Liberty Avenue, 7:40pm)']));
    expect(titlesInGrid()).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    const sheet = screen.getByRole('dialog', { name: /filters/i });
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: 'Size unit' })).getByRole('radio', { name: 'in' }));
    fireEvent.click(within(sheet).getByRole('button', { name: /under 40 in/i }));
    const show = within(sheet).getByRole('button', { name: 'Show 1 work' });
    fireEvent.click(show);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(titlesInGrid()).toEqual(['Small Weather No. 4']);
    const where = screen.getByTestId('where').textContent ?? '';
    expect(where).toContain('tags=medium.painting');
    expect(where).toContain('unit=in');
    expect(where).toContain('max=40');
  });

  it('filter state survives back/forward', async () => {
    const { router } = renderAt('/works');
    await screen.findByText('Small Weather No. 4');
    fireEvent.click(within(screen.getByRole('group', { name: 'Medium' })).getByRole('button', { name: /^textile/i }));
    expect(titlesInGrid()).toHaveLength(2);
    await act(() => router.navigate(-1));
    await waitFor(() => expect(titlesInGrid()).toHaveLength(9));
    await act(() => router.navigate(1));
    await waitFor(() => expect(titlesInGrid()).toHaveLength(2));
  });

  it('zero results shows an empty state whose action clears filters', async () => {
    renderAt('/works?q=nothing-matches-this');
    expect(await screen.findByText('No works match those filters')).toBeInTheDocument();
    const empty = screen.getByText('No works match those filters').closest('.empty') as HTMLElement;
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Small Weather No. 4')).toBeInTheDocument();
    expect(screen.getByTestId('result-count')).toHaveTextContent('9 works');
  });

  it('the live count in the sheet tracks the draft and "Clear all" resets it', async () => {
    // An old medium link lands on the medium tag, which also finds work that lists ceramics as a second medium (Crowd).
    renderAt('/works?medium=ceramics');
    await screen.findByText('Lean II');
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    const sheet = screen.getByRole('dialog', { name: /filters/i });
    expect(within(sheet).getByRole('button', { name: 'Show 2 works' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }));
    expect(within(sheet).getByRole('button', { name: 'Show 9 works' })).toBeInTheDocument();
    // Free-text material
    fireEvent.change(within(sheet).getByLabelText('Another material'), { target: { value: 'wool' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    expect(within(sheet).getByRole('button', { name: 'Show 1 work' })).toBeInTheDocument();
    // Commission experience toggle combines with it
    fireEvent.click(within(sheet).getByRole('switch', { name: /has made commissions/i }));
    expect(within(sheet).getByRole('button', { name: 'Show 0 works' })).toBeInTheDocument();
  });

  it('switching the unit converts size bounds so the filter keeps its meaning', () => {
    const f = filtersFromParams(new URLSearchParams('unit=in&max=40'));
    const cm = withUnit(f, 'cm');
    expect(cm.sizeUnit).toBe('cm');
    expect(cm.maxLongestEdge).toBe(101.6);
    expect(withUnit(cm, 'in').maxLongestEdge).toBe(40);
    expect(paramsFromFilters(cm).toString()).toBe('max=101.6');
  });
});
