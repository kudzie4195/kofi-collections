import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LookingForBlock, hasCriteria } from './LookingFor';
import { renderAt, VISITOR } from './testUtils';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('public call page: What they’re looking for', () => {
  it('shows the CMA auction’s criteria by category, with uses, region and the organiser’s note', async () => {
    renderAt('/calls/call_cma_auction', VISITOR);
    const block = await screen.findByRole('region', { name: 'What they’re looking for' });
    const themes = within(block).getByRole('list', { name: 'Themes & Concepts' });
    expect(within(themes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Community', 'Memory']);
    expect(within(within(block).getByRole('list', { name: 'Available for' })).getByText('Auction')).toBeInTheDocument();
    expect(within(block).getByText('Pennsylvania')).toBeInTheDocument();
    expect(within(block).getByText('Work about the city at night and the people who keep it running.')).toBeInTheDocument();
  });

  it('is hidden when the call asks nothing', async () => {
    renderAt('/calls/call_soft_ground', VISITOR);
    expect(await screen.findByRole('heading', { level: 1, name: /Soft Ground/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What they’re looking for' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('looking-for-block')).not.toBeInTheDocument();
  });

  it('states size bounds and an implied auction use; empty criteria render nothing', () => {
    expect(hasCriteria({ tags: { style: [] }, region: ' ' })).toBe(false);
    const { container } = render(<LookingForBlock call={{ kind: 'auction', mediums: [], lookingFor: {} }} />);
    expect(container).toBeEmptyDOMElement();
    render(<LookingForBlock call={{ kind: 'auction', mediums: [], lookingFor: { minLongestEdgeCm: 30, maxLongestEdgeCm: 120 } }} />);
    expect(screen.getByText('Longest edge 30–120 cm')).toBeInTheDocument();
    expect(screen.getByText('Auction')).toBeInTheDocument();
  });
});
