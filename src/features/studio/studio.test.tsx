import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { CONSENT_VERSION } from '@/domain/types';
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
const LENA = viewerOf('lena');

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

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('studio home', () => {
  it('greets Mara and lists all 3 of her works, including the Kofi-only draft', async () => {
    renderStudio('/studio');
    expect(await screen.findByRole('heading', { name: 'Hello, Mara.' })).toBeInTheDocument();
    const works = screen.getByRole('heading', { name: 'Your works' }).closest('section')!;
    const rows = within(works).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(works).getByText('Doubling (Liberty Avenue, 7:40pm)')).toBeInTheDocument();
    expect(within(works).getByText('Small Weather No. 4')).toBeInTheDocument();
    const draft = within(works).getByText('Charcoal: Bridge Study').closest('a')!;
    expect(within(draft).getByText('Kofi team only')).toBeInTheDocument();
    expect(draft).toHaveAttribute('href', '/studio/work/aw_mara_3');
    // tiles: 3 works, 2 public, 1 forwarded inquiry, 2 vault documents
    const tiles = screen.getByRole('list', { name: 'Studio at a glance' });
    expect(within(tiles).getByText('Works in your studio').previousSibling).toHaveTextContent('3');
    expect(within(tiles).getByText('Public').previousSibling).toHaveTextContent('2');
    expect(within(tiles).getByText('Introduction to answer').previousSibling).toHaveTextContent('1');
    expect(within(tiles).getByText('Vault documents').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });
});

describe('work editor', () => {
  it('hiding the price of “Doubling” makes it withheld for the verified curator', async () => {
    const ds = new MockDataSource({ persist: false });
    const before = await ds.getArtwork(LENA, 'aw_mara_1');
    expect(before?.priceWithheld).toBe(false);
    expect(before?.price?.amount).toBe(9800);

    const { router } = renderStudio('/studio/work/aw_mara_1', MARA, ds);
    const group = await screen.findByRole('radiogroup', { name: 'Who can see the price' });
    fireEvent.click(within(group).getByRole('radio', { name: /Only me/ }));
    expect(within(group).getByRole('radio', { name: /Only me/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/studio'));
    expect(await screen.findByText('Saved “Doubling (Liberty Avenue, 7:40pm)”')).toBeInTheDocument();
    const after = await ds.getArtwork(LENA, 'aw_mara_1');
    expect(after?.priceWithheld).toBe(true);
    expect(after?.price).toBeUndefined();
    // The owner still sees it.
    expect((await ds.getArtwork(MARA, 'aw_mara_1'))?.price?.amount).toBe(9800);
  });

  it('shows the images error inline when publishing a new work without images', async () => {
    const { ds } = renderStudio('/studio/work/new');
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Night Ferry' } });
    const who = screen.getByRole('radiogroup', { name: 'Who can see this work' });
    // 'Only me' is the default for a new work and is captioned as a draft.
    expect(within(who).getByRole('radio', { name: /Draft — only you/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(who).getByRole('radio', { name: /^Public/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save work' }));

    const err = await screen.findByText('Add at least one image before publishing.');
    expect(err).toHaveAttribute('role', 'alert');
    // Nothing was saved.
    expect(await ds.listArtistArtworks(MARA, 'art_mara')).toHaveLength(3);
  });

  it('updates the live wall label and unit conversion as the artist types', async () => {
    renderStudio('/studio/work/new');
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Harbor Light' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '152' } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '122' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Centimeters' }));
    const preview = screen.getByRole('complementary', { name: 'Live wall label preview' });
    expect(within(preview).getByText('Harbor Light')).toBeInTheDocument();
    expect(screen.getByText('= 59.8 × 48 in')).toBeInTheDocument();
    // Previewing as the public hides a draft.
    fireEvent.click(within(preview).getByRole('radio', { name: 'Public' }));
    expect(within(preview).getByText('Hidden from the public')).toBeInTheDocument();
  });

  it('adds materials with Enter and comma, and removes them on tap', async () => {
    renderStudio('/studio/work/new');
    const input = await screen.findByLabelText('Materials');
    fireEvent.change(input, { target: { value: 'oil on linen' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'gesso,' } });
    expect(screen.getByRole('button', { name: 'Remove oil on linen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove gesso' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove gesso' }));
    expect(screen.queryByRole('button', { name: 'Remove gesso' })).not.toBeInTheDocument();
  });
});

describe('consent', () => {
  it('records the current consent version and returns to the studio', async () => {
    const ds = new MockDataSource({ persist: false });
    const before = await ds.getMyArtist(MARA);
    const { router } = renderStudio('/studio/consent', MARA, ds);
    const agree = await screen.findByRole('button', { name: 'Agree and continue' });
    await waitFor(() => expect(screen.getByText(new RegExp(`You agreed to version ${CONSENT_VERSION}`))).toBeInTheDocument());
    expect(agree).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand and agree/));
    expect(agree).toBeEnabled();
    fireEvent.click(agree);
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio'));
    const after = await ds.getMyArtist(MARA);
    expect(after?.consentVersion).toBe(CONSENT_VERSION);
    expect(after?.consentAcceptedAt).toBeDefined();
    expect(after!.consentAcceptedAt! > before!.consentAcceptedAt!).toBe(true);
    const audit = await ds.listAudit(viewerOf('admin'));
    expect(audit.some((e) => e.action === 'artist.consent' && e.entityId === 'art_mara')).toBe(true);
  });
});

describe('profile', () => {
  it('shows a server-style validation error on the bio field and previews the public region', async () => {
    renderStudio('/studio/profile');
    const bio = await screen.findByLabelText('Bio');
    expect(screen.getByText('Pittsburgh, Pennsylvania')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Country' }));
    expect(screen.getByText('United States')).toBeInTheDocument();
    fireEvent.change(bio, { target: { value: 'Too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Write at least a sentence/)).toBeInTheDocument();
    expect(bio).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves changes and confirms before leaving with unsaved edits', async () => {
    const { ds, router } = renderStudio('/studio/profile');
    fireEvent.change(await screen.findByLabelText('Pronouns'), { target: { value: 'she/they' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/studio/profile');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    expect((await ds.getMyArtist(MARA))?.pronouns).toBe('she/they');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio'));
  });
});

describe('inquiries', () => {
  it('lets Mara accept the forwarded introduction', async () => {
    const { ds } = renderStudio('/studio/inquiries');
    expect(await screen.findByText('Carnegie Museum of Art')).toBeInTheDocument();
    expect(screen.getByText('Lena Marchetti')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept introduction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Accept this introduction?' });
    expect(within(dialog).getByText(/mara@example.com/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept introduction' }));
    });
    await waitFor(async () => expect((await ds.listInquiries(MARA))[0]?.status).toBe('accepted'));
    expect(await screen.findByText('Answered')).toBeInTheDocument();
  });
});

describe('export / withdraw', () => {
  it('hides the profile and every work in one step', async () => {
    const { ds } = renderStudio('/studio/export');
    fireEvent.click(await screen.findByRole('button', { name: 'Hide everything now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hide everything now?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Hide everything' }));
    });
    expect(await screen.findByText('Profile hidden. 3 works set to Only me.')).toBeInTheDocument();
    expect((await ds.getMyArtist(MARA))?.visibility).toBe('private');
    const works = await ds.listArtistArtworks(MARA, 'art_mara');
    expect(works.every((w) => w.visibility === 'private')).toBe(true);
    expect(await ds.getArtwork(viewerOf('visitor'), 'aw_mara_2')).toBeUndefined();
  });
});

describe('vault', () => {
  it('groups Mara’s documents under the work they belong to', async () => {
    renderStudio('/studio/vault');
    const group = await screen.findByRole('region', { name: /Doubling \(Liberty Avenue, 7:40pm\)/ });
    expect(within(group).getByText('Condition report — Doubling')).toBeInTheDocument();
    expect(within(group).getByText('Appraisal letter (human appraiser)')).toBeInTheDocument();
    expect(within(group).getByText('Example Appraisals LLC')).toBeInTheDocument();
    expect(screen.getByText(/Kofi never estimates or labels an appraised value/)).toBeInTheDocument();
  });
});
