import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderAt } from './testUtils';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('public call page: kind and terms', () => {
  it('an auction call shows the kind eyebrow with the partner and states its terms plainly', async () => {
    renderAt('/calls/call_cma_auction');
    expect(await screen.findByRole('heading', { level: 1, name: 'Night Weather Benefit Auction' })).toBeInTheDocument();
    expect(screen.getByText('Auction · Carnegie Museum of Art')).toBeInTheDocument();
    const terms = screen.getByTestId('call-terms');
    expect(terms).toHaveTextContent('Artists receive 70% of the hammer price · Kofi 20% · Carnegie Museum of Art 10% · Buyer’s premium 10% · Resale royalty 5%');
    expect(terms).toHaveTextContent('Artists are paid within 30 days of the auction.');
    expect(terms).toHaveTextContent('On a $1,000.00 hammer price: artist $700.00 · Kofi $200.00 · partner $100.00; buyer pays $1,100.00');
    expect(terms).not.toHaveTextContent(/estimate[sd]? (the )?value/i);
  });

  it('a call without terms shows no terms block', async () => {
    renderAt('/calls/call_night_weather');
    expect(await screen.findByRole('heading', { level: 1, name: 'Night Weather Studio Award' })).toBeInTheDocument();
    expect(screen.getByText('Award · Kofi Collections')).toBeInTheDocument();
    expect(screen.queryByTestId('call-terms')).not.toBeInTheDocument();
  });
});
