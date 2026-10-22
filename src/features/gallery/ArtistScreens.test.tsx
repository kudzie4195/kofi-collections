import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LENA, MARA, renderAt, VISITOR } from './testUtils';

afterEach(() => localStorage.clear());

describe('Artists (/artists)', () => {
  it('lists approved artists only, with search and medium filter', async () => {
    renderAt('/artists', VISITOR);
    const list = await screen.findByRole('list', { name: 'Artists' });
    const names = () => within(screen.getByRole('list', { name: 'Artists' })).getAllByRole('link').map((a) => a.querySelector('.list-row__title')?.textContent);
    expect(names()).toEqual(['DeShawn Ferris', 'June Takahashi-Bell', 'Mara Oyelaran', 'Tobias Reinholt']);
    expect(within(list).queryByText('Priya Venkataraman')).not.toBeInTheDocument();
    expect(within(list).getByText('Pittsburgh, Pennsylvania, Mid-career, 2 works')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search artists'), { target: { value: 'ottawa' } });
    expect(names()).toEqual(['June Takahashi-Bell']);
    fireEvent.change(screen.getByLabelText('Search artists'), { target: { value: '' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Medium' })).getByRole('button', { name: 'Ceramics' }));
    expect(names()).toEqual(['Tobias Reinholt']);
    expect(screen.getByTestId('where')).toHaveTextContent('/artists?medium=ceramics');
  });

  it('search with no matches offers to clear', async () => {
    renderAt('/artists?q=zzz', VISITOR);
    expect(await screen.findByText('No artists match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all artists' }));
    expect(await screen.findByText('Mara Oyelaran')).toBeInTheDocument();
  });
});

describe('Artist profile (/artists/:id)', () => {
  it('shows the public profile, safe external links and only published works', async () => {
    renderAt('/artists/art_mara', VISITOR);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mara Oyelaran' })).toBeInTheDocument();
    expect(screen.getByText('she/her, Pittsburgh, Pennsylvania')).toBeInTheDocument();
    expect(screen.getByText('Open to commissions')).toBeInTheDocument();
    expect(screen.getByText(/I paint the hour after a storm/)).toBeInTheDocument();
    expect(screen.getByText('Years practicing').nextElementSibling).toHaveTextContent('14');
    const site = screen.getByRole('link', { name: /website/i });
    expect(site).toHaveAttribute('href', 'https://www.mara-oyelaran.com');
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', 'noopener noreferrer');
    const works = await screen.findByRole('list', { name: 'Works by Mara Oyelaran' });
    expect(within(works).getByText('Doubling (Liberty Avenue, 7:40pm)')).toBeInTheDocument();
    expect(within(works).getByText('Small Weather No. 4')).toBeInTheDocument();
    expect(within(works).queryByText('Charcoal: Bridge Study')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit profile/i })).not.toBeInTheDocument();
    // Private fields never render
    expect(screen.queryByText(/mara@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Foundry St/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Omolara/)).not.toBeInTheDocument();
  });

  it('only shows the availability tags that are true', async () => {
    renderAt('/artists/art_deshawn', VISITOR);
    await screen.findByRole('heading', { level: 1, name: 'DeShawn Ferris' });
    expect(screen.getByText('Open to commissions')).toBeInTheDocument();
    expect(screen.getByText('Open to sales')).toBeInTheDocument();
    expect(screen.queryByText('Open to exhibitions')).not.toBeInTheDocument();
  });

  it('a pending artist is not available to a visitor', async () => {
    renderAt('/artists/art_priya', VISITOR);
    expect(await screen.findByText("This artist isn't available")).toBeInTheDocument();
  });

  it('owner gets "Edit profile"; verified curator gets "Request introduction"', async () => {
    const a = renderAt('/artists/art_mara', MARA);
    expect(await screen.findByRole('link', { name: /edit profile/i })).toHaveAttribute('href', '/studio/profile');
    // Owner sees their own Kofi-only study in the grid, marked with its visibility
    expect(await screen.findByText('Charcoal: Bridge Study')).toBeInTheDocument();
    a.unmount();
    localStorage.clear();
    renderAt('/artists/art_tobias', LENA);
    fireEvent.click(await screen.findByRole('button', { name: /request introduction/i }));
    const sheet = screen.getByRole('dialog', { name: 'Request an introduction' });
    expect(within(sheet).getByText('Tobias Reinholt')).toBeInTheDocument();
  });
});
