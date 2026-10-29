import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { ArtistView, Viewer } from '@/domain/types';
import { NO_USES } from '@/domain/types';
import { SOCIAL_IMPACT_NOTE, normalizeTagIds, selectableTags } from '@/domain/taxonomy';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { QuickWork } from '@/features/join/QuickWork';
import { copy as joinCopy } from '@/features/join/copy';
import { studioRoutes } from './routes';
import { TagPicker, capMessage, type TagPickerProps } from './TagPicker';
import { NUDGE_COPY, QUICK_TAG_COPY, TAG_COPY } from './tagCopy';

vi.mock('@/native/images', () => ({
  prepareImage: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 1, height: 1, metadataStripped: true })),
}));

// The full picker renders ~110 chips; role queries over it are slow under a parallel run.
vi.setConfig({ testTimeout: 20000 });

const MARA: Viewer = DEMO_IDENTITIES.find((i) => i.id === 'mara')!.viewer;

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function Harness(props: Omit<TagPickerProps, 'value' | 'onChange'> & { initial?: string[]; spy?: (ids: string[]) => void }) {
  const { initial = [], spy, ...rest } = props;
  const [value, setValue] = useState<string[]>(initial);
  return (
    <TagPicker
      {...rest}
      value={value}
      onChange={(ids) => {
        spy?.(ids);
        setValue(ids);
      }}
    />
  );
}

const section = (name: string) => screen.getByRole('group', { name: `${TAG_COPY.sectionTitle}: ${name}` });
const chip = (sectionName: string, label: string) => within(section(sectionName)).getByRole('button', { name: new RegExp(`^${label}`) });

describe('TagPicker', () => {
  it('toggles chips as pressed buttons and reports stable ids', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const abstract = chip('Artistic Style', 'Abstract');
    expect(abstract).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(abstract);
    expect(abstract).toHaveAttribute('aria-pressed', 'true');
    expect(spy).toHaveBeenLastCalledWith(['style.abstract']);
    expect(screen.getByTestId('tagcount-style')).toHaveTextContent('1 of 6');
    fireEvent.click(abstract);
    expect(abstract).toHaveAttribute('aria-pressed', 'false');
    expect(spy).toHaveBeenLastCalledWith([]);
  });

  it('enforces the Social Impact cap with the same message as normalizeTagIds', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const tags = selectableTags('social_impact');
    for (const t of tags.slice(0, 4)) fireEvent.click(chip('Social Impact', t.label));
    expect(screen.getByTestId('tagcount-social_impact')).toHaveTextContent('4 of 4');
    fireEvent.click(chip('Social Impact', tags[4]!.label));
    expect(chip('Social Impact', tags[4]!.label)).toHaveAttribute('aria-pressed', 'false');
    const msg = normalizeTagIds(tags.slice(0, 5).map((t) => t.id), 'painting').problem?.message;
    expect(msg).toBe(capMessage('social_impact'));
    expect(within(section('Social Impact')).getByRole('alert')).toHaveTextContent(msg!);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('criteria mode has no caps and no lock', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} mode="criteria" lockedMedium="painting" />);
    expect(chip('Art Medium', 'Painting')).toHaveAttribute('aria-pressed', 'false');
    for (const t of selectableTags('social_impact').slice(0, 6)) fireEvent.click(chip('Social Impact', t.label));
    expect(spy.mock.lastCall?.[0]).toHaveLength(6);
    expect(screen.getByTestId('tagcount-social_impact')).toHaveTextContent('6 selected');
  });

  it('filters chips across categories by label', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(TAG_COPY.searchLabel), { target: { value: 'urb' } });
    expect(chip('Subject Matter', 'Urban Life')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Abstract/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: `${TAG_COPY.sectionTitle}: Artistic Style` })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(TAG_COPY.searchLabel), { target: { value: 'zzzz' } });
    expect(screen.getByRole('status')).toHaveTextContent(TAG_COPY.noMatch('zzzz'));
  });

  it('keeps the primary medium on and locked, counts it, and never emits it', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} lockedMedium="painting" />);
    const painting = chip('Art Medium', 'Painting');
    expect(painting).toHaveAttribute('aria-pressed', 'true');
    expect(painting).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(painting);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('tagcount-medium')).toHaveTextContent('1 of 6');
    fireEvent.click(chip('Art Medium', 'Drawing'));
    expect(spy).toHaveBeenLastCalledWith(['medium.drawing']);
    expect(screen.getByTestId('tagcount-medium')).toHaveTextContent('2 of 6');
  });

  it('shows the Social Impact note and the definitions on a toggle', () => {
    render(<Harness />);
    const si = section('Social Impact');
    expect(within(si).getByText(`${SOCIAL_IMPACT_NOTE}.`)).toBeInTheDocument();
    expect(within(si).getByText(TAG_COPY.definitionsToggle)).toBeInTheDocument();
    const ea = selectableTags('social_impact').find((t) => t.id === 'social_impact.education_access')!;
    expect(chip('Social Impact', ea.label)).toHaveAttribute('title', ea.definition);
    expect(within(si).getAllByText(ea.definition).length).toBeGreaterThan(0);
  });
});

function renderStudio(path: string, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(MARA));
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

describe('work editor: tags, uses, edition', () => {
  it('saves three more subject tags, a use and a limited edition', async () => {
    const ds = new MockDataSource({ persist: false });
    const { router } = renderStudio('/studio/work/aw_mara_1', ds);
    await screen.findByRole('group', { name: `${TAG_COPY.sectionTitle}: Subject Matter` });
    for (const label of ['Portraits', 'Nature', 'Architecture']) fireEvent.click(chip('Subject Matter', label));
    fireEvent.click(chip('Social Impact', 'Community Building'));
    fireEvent.click(screen.getByRole('switch', { name: /^Licensing/ }));
    expect(screen.getByTestId('orientation')).toHaveTextContent(/from the dimensions/);
    fireEvent.change(screen.getByLabelText('Edition type'), { target: { value: 'limited' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Edition size'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio'));
    const w = (await ds.getArtwork(MARA, 'aw_mara_1'))!;
    const subjects = w.tagIds.filter((t) => t.startsWith('subject.'));
    expect(subjects).toEqual(expect.arrayContaining(['subject.portraits', 'subject.nature', 'subject.architecture', 'subject.urban_life']));
    expect(w.tagIds).toContain('medium.painting');
    expect(w.tagIds).toContain('social_impact.community_building');
    expect(w.uses).toMatchObject({ licensing: true, exhibition: true, auction: true, commission: false });
    expect(w.edition).toEqual({ type: 'limited', number: 2, size: 5 });
  });

  it('blocks an edition number above the size before saving', async () => {
    renderStudio('/studio/work/aw_mara_1');
    fireEvent.change(await screen.findByLabelText('Edition type'), { target: { value: 'artist_proof' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Edition size'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The number can’t be higher than the edition size.')).toBeInTheDocument();
  });
});

describe('studio home: Add tags nudge', () => {
  it('lists works with only their medium tag, and goes away once tagged', async () => {
    const ds = new MockDataSource({ persist: false });
    const saved = await ds.saveArtwork(MARA, {
      title: 'Untagged Study',
      year: 2026,
      medium: 'drawing',
      materials: ['graphite on paper'],
      dimensions: { height: 30, width: 20, unit: 'cm' },
      description: '',
      images: [],
      status: 'available',
      rightsNote: '',
      priceVisibility: 'institutions',
      visibility: 'private',
      tags: [],
    });
    expect(saved.tagIds).toEqual(['medium.drawing']);
    const { router } = renderStudio('/studio', ds);
    const nudge = await screen.findByTestId('tag-nudge');
    expect(within(nudge).getByText(NUDGE_COPY.body(1))).toBeInTheDocument();
    const link = within(nudge).getByRole('link', { name: 'Untagged Study' });
    expect(link).toHaveAttribute('href', `/studio/work/${saved.id}?section=tags`);
    fireEvent.click(link);
    await screen.findByRole('group', { name: `${TAG_COPY.sectionTitle}: Artistic Style` });
    fireEvent.click(chip('Artistic Style', 'Realism'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio'));
    await screen.findByRole('heading', { name: 'Your works' });
    expect(screen.queryByTestId('tag-nudge')).not.toBeInTheDocument();
  });
});

describe('join step four: quick work', () => {
  it('saves optional tags and opted-in uses; uses start off', async () => {
    const ds = new MockDataSource({ persist: false });
    localStorage.setItem('kofi.session.v1', JSON.stringify(MARA));
    const artist = (await ds.getMyArtist(MARA)) as ArtistView;
    const onSaved = vi.fn();
    render(
      <ToastProvider>
        <SessionProvider dataSource={ds}>
          <QuickWork artist={artist} onSaved={onSaved} />
        </SessionProvider>
      </ToastProvider>,
    );
    const tags = screen.getByRole('group', { name: QUICK_TAG_COPY.title });
    expect(within(tags).queryByRole('group', { name: `${TAG_COPY.sectionTitle}: Materials` })).not.toBeInTheDocument();
    expect(within(tags).queryByLabelText(TAG_COPY.searchLabel)).not.toBeInTheDocument();
    for (const k of ['Auction', 'Exhibition', 'Licensing', 'Commission']) expect(screen.getByRole('switch', { name: new RegExp(`^${k}`) })).toHaveAttribute('aria-checked', 'false');

    fireEvent.change(document.getElementById('kj-photo-input')!, { target: { files: [new File([new Uint8Array([1])], 'w.png', { type: 'image/png' })] } });
    await screen.findByRole('button', { name: joinCopy.work.photoChange });
    fireEvent.change(screen.getByLabelText(joinCopy.work.titleLabel), { target: { value: 'River Glaze' } });
    fireEvent.change(screen.getByLabelText(joinCopy.work.height), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(joinCopy.work.width), { target: { value: '30' } });
    fireEvent.click(chip('Artistic Style', 'Abstract'));
    fireEvent.click(chip('Subject Matter', 'Urban Life'));
    fireEvent.click(chip('Social Impact', 'Education Access'));
    fireEvent.click(screen.getByRole('switch', { name: /^Exhibition/ }));
    fireEvent.click(screen.getByRole('button', { name: joinCopy.work.save }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const w = onSaved.mock.calls[0]![0];
    expect(w.tagIds).toEqual(expect.arrayContaining(['medium.painting', 'style.abstract', 'subject.urban_life', 'social_impact.education_access']));
    expect(w.uses).toEqual({ ...NO_USES, exhibition: true });
  });
});
