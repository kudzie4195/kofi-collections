import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import type { Viewer } from '@/domain/types';
import { CONSENT_VERSION } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { JoinRoute } from './JoinScreen';
import { copy } from './copy';
import { DRAFT_KEY } from './intakeStore';
import { buildApply, defaultTicks, mergeImports, sourceName } from './ImportReview';
import { importFromSignals } from '@/domain/intake';
import { DEMO_IDENTITIES } from '@/data/mock/seed';

// The canvas re-encode needs a real browser; the intake only cares that it returns a data URL.
vi.mock('@/native/images', () => ({
  prepareImage: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 1, height: 1, metadataStripped: true })),
}));

const VISITOR: Viewer = { role: 'public', displayName: 'Visitor' };
const MARA: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
const LENA: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_lena', curatorVerified: true, displayName: 'Lena Marchetti' };
const PASSWORD = 'rain on liberty avenue';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderJoin(path: string, viewer: Viewer = VISITOR, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const el = (
    <>
      <JoinRoute />
      <Where />
    </>
  );
  const router = createMemoryRouter(
    [
      { path: '/join', element: el },
      { path: '/join/:step', element: el },
      { path: '/studio/*', element: <><p>Studio screen</p><Where /></> },
      { path: '/account', element: <p>Account screen</p> },
      { path: '*', element: <p>Elsewhere</p> },
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

/** A fresh draft artist, signed up through the data source. */
async function newArtist(ds: MockDataSource, name = 'Flow Tester', email = 'flow@example.com') {
  const r = await ds.signUpArtist({ displayName: name, email, password: PASSWORD, consentVersion: CONSENT_VERSION });
  return r.viewer;
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('step 1: your account', () => {
  it('renders one h1, the progress line and the fields', async () => {
    renderJoin('/join');
    expect(await screen.findByRole('heading', { level: 1, name: copy.account.title })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Step 1 of 5 · Your account')).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.name)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.email)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.password)).toHaveAttribute('type', 'password');
    expect(screen.getAllByRole('button', { name: copy.account.submit })).toHaveLength(1);
  });

  it('shows validation messages by field, one at a time', async () => {
    renderJoin('/join');
    const submit = await screen.findByRole('button', { name: copy.account.submit });
    fireEvent.click(submit);
    expect(await screen.findByText('Tell us your name, as you would sign it.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.account.name), { target: { value: 'Flow Tester' } });
    fireEvent.change(screen.getByLabelText(copy.account.email), { target: { value: 'flow@example.com' } });
    fireEvent.change(screen.getByLabelText(copy.account.password), { target: { value: 'short' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Use at least 10 characters. A short sentence works well.')).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.password)).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText(copy.account.password), { target: { value: PASSWORD } });
    fireEvent.click(submit);
    expect(await screen.findByText('Please read and accept how Kofi handles your data.')).toBeInTheDocument();
  });

  it('a taken email shows the conflict message on the email field', async () => {
    renderJoin('/join');
    fireEvent.change(await screen.findByLabelText(copy.account.name), { target: { value: 'Flow Tester' } });
    fireEvent.change(screen.getByLabelText(copy.account.email), { target: { value: 'mara@example.com' } });
    fireEvent.change(screen.getByLabelText(copy.account.password), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: copy.account.submit }));
    expect(await screen.findByText(/already an account with this email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.email)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('link', { name: copy.account.conflictSignIn })).toHaveAttribute('href', '/account');
    expect(where()).toBe('/join');
  });

  it('keeps a draft of name, email and consent in localStorage, never the password', async () => {
    renderJoin('/join');
    fireEvent.change(await screen.findByLabelText(copy.account.name), { target: { value: 'Flow Tester' } });
    fireEvent.change(screen.getByLabelText(copy.account.email), { target: { value: 'flow@example.com' } });
    fireEvent.change(screen.getByLabelText(copy.account.password), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toEqual({ displayName: 'Flow Tester', email: 'flow@example.com', consent: true }));
    const everything = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n');
    expect(everything).not.toContain(PASSWORD);
  });

  it('the terms open in a sheet', async () => {
    renderJoin('/join');
    fireEvent.click(await screen.findByRole('button', { name: copy.account.consentRead }));
    const sheet = await screen.findByRole('dialog', { name: copy.terms.title });
    expect(within(sheet).getByText('Your work stays yours.')).toBeInTheDocument();
  });

  it('creates the account, signs in and moves to step 2; the draft is cleared', async () => {
    const { ds } = renderJoin('/join');
    fireEvent.change(await screen.findByLabelText(copy.account.name), { target: { value: 'Flow Tester' } });
    fireEvent.change(screen.getByLabelText(copy.account.email), { target: { value: 'flow@example.com' } });
    fireEvent.change(screen.getByLabelText(copy.account.password), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: copy.account.submit }));
    expect(await screen.findByRole('heading', { level: 1, name: copy.links.title })).toBeInTheDocument();
    expect(where()).toBe('/join/links');
    const session = JSON.parse(localStorage.getItem('kofi.session.v1')!);
    expect(session).toMatchObject({ role: 'artist', artistId: 'art_flow_tester' });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect((await ds.listDemoIdentities()).some((i) => i.label === 'Flow Tester')).toBe(true);
  });

  it('a curator is told the intake is for artist accounts', async () => {
    renderJoin('/join', LENA);
    expect(await screen.findByRole('heading', { level: 1, name: copy.account.staff.title })).toBeInTheDocument();
    expect(screen.getByText(copy.account.staff.curator)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.account.staff.signOut })).toBeInTheDocument();
  });

  it('a visitor asking for a later step is sent to step 1', async () => {
    renderJoin('/join/verify');
    expect(await screen.findByRole('heading', { level: 1, name: copy.account.title })).toBeInTheDocument();
    expect(where()).toBe('/join');
  });
});

describe('routing for artists', () => {
  it('an approved artist opening /join goes to the studio', async () => {
    renderJoin('/join', MARA);
    expect(await screen.findByText('Studio screen')).toBeInTheDocument();
  });

  it('an approved artist opening any /join step goes to the studio, with a toast', async () => {
    for (const step of ['links', 'about', 'work', 'verify']) {
      renderJoin(`/join/${step}`, MARA);
      expect(await screen.findByText('Studio screen')).toBeInTheDocument();
      expect(await screen.findByText(copy.verify.redirect.live)).toBeInTheDocument();
      cleanup();
    }
  });

  it('a pending artist opening a /join step goes to the studio', async () => {
    const priya = DEMO_IDENTITIES.find((i) => i.id === 'priya')!.viewer;
    renderJoin('/join/verify', priya);
    expect(await screen.findByText('Studio screen')).toBeInTheDocument();
    expect(await screen.findByText(copy.verify.redirect.pending)).toBeInTheDocument();
  });

  it('a new artist opening /join lands on the first unfinished step (links)', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join', v, ds);
    expect(await screen.findByRole('heading', { level: 1, name: copy.links.title })).toBeInTheDocument();
    expect(where()).toBe('/join/links');
  });

  it('each step renders its heading and progress line', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    for (const [step, title, n] of [
      ['links', copy.links.title, 2],
      ['about', copy.about.title, 3],
      ['work', copy.work.title, 4],
      ['verify', copy.verify.title, 5],
    ] as const) {
      renderJoin(`/join/${step}`, v, ds);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByText(`Step ${n} of 5 · ${copy.steps[step]}`)).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('step 2: your links', () => {
  async function setup() {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/links', v, ds);
    const input = await screen.findByLabelText(copy.links.input);
    const add = (value: string) => {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: copy.links.add }));
    };
    return { ds, v, add };
  }

  it('refuses a localhost link and adds real ones, saved on the profile', async () => {
    const { ds, v, add } = await setup();
    add('http://localhost:3000/me');
    expect(await screen.findByText(/does not look like a profile or website link/i)).toBeInTheDocument();
    add('http://192.168.1.4/portfolio');
    expect(await screen.findByText(copy.links.privateHost)).toBeInTheDocument();
    add('@mara.paints');
    expect(await screen.findByText('@mara.paints')).toBeInTheDocument();
    add('https://www.mara-oyelaran.com');
    expect(await screen.findByText('mara-oyelaran.com')).toBeInTheDocument();
    expect(screen.getByText('2 of 6')).toBeInTheDocument();
    await waitFor(async () => expect((await ds.getMyArtist(v))!.links.map((l) => l.url)).toEqual(['https://www.instagram.com/mara.paints', 'https://www.mara-oyelaran.com']));
  });

  it('import review: only ticked fields are applied, and the import is recorded', async () => {
    const { ds, v, add } = await setup();
    add('https://www.mara-oyelaran.com');
    await screen.findByText('mara-oyelaran.com');
    fireEvent.click(screen.getByRole('button', { name: copy.links.pull }));
    const review = (await screen.findByRole('heading', { name: copy.links.review.title })).closest('section')!;
    const nameBox = within(review).getByRole('checkbox', { name: /Working name/i });
    const bioBox = within(review).getByRole('checkbox', { name: /Bio/i });
    // The name typed at sign-up would be replaced: unticked, with what it replaces.
    expect(nameBox).not.toBeChecked();
    expect(within(review).getByText(copy.links.review.replaces('Flow Tester'))).toBeInTheDocument();
    // The bio and location are empty: ticked, nothing to replace.
    expect(bioBox).toBeChecked();
    expect(within(review).getByRole('checkbox', { name: /Based in/i })).toBeChecked();
    expect(within(review).getAllByText(/^Replaces:/)).toHaveLength(1);
    // Sources are named by host, not "your website".
    expect(within(review).getAllByText(/from mara-oyelaran\.com/).length).toBeGreaterThan(0);
    fireEvent.click(nameBox);
    fireEvent.click(bioBox);
    fireEvent.click(within(review).getByRole('button', { name: copy.links.review.use }));
    expect(await screen.findByRole('heading', { level: 1, name: copy.about.title })).toBeInTheDocument();
    const a = (await ds.getMyArtist(v))!;
    expect(a.workingName).toBe('Mara Oyelaran');
    expect(a.bio).toBe('');
    expect(a.region?.city).toBe('Pittsburgh');
    expect(a.imports).toHaveLength(1);
    expect(a.imports![0]!.appliedFields).toContain('workingName');
    expect(a.imports![0]!.appliedFields).not.toContain('bio');
    expect(a.imports![0]!.appliedFields).not.toContain('photoUrl');
  });

  it('a found photo is a plain line, never a tick box, and is never recorded as applied', async () => {
    const { ds, v, add } = await setup();
    add('@mara.paints');
    add('https://www.mara-oyelaran.com');
    await screen.findByText('mara-oyelaran.com');
    fireEvent.click(screen.getByRole('button', { name: copy.links.pull }));
    const review = (await screen.findByRole('heading', { name: copy.links.review.title })).closest('section')!;
    expect(within(review).getByTestId('found-photo')).toHaveTextContent(copy.links.review.photoFound);
    expect(within(review).queryByRole('checkbox', { name: /photo/i })).not.toBeInTheDocument();
    // Tick everything there is, then use it.
    for (const box of within(review).getAllByRole('checkbox')) if (!(box as HTMLInputElement).checked) fireEvent.click(box);
    fireEvent.click(within(review).getByRole('button', { name: copy.links.review.use }));
    expect(await screen.findByRole('heading', { level: 1, name: copy.about.title })).toBeInTheDocument();
    const a = (await ds.getMyArtist(v))!;
    expect(a.imports).toHaveLength(2);
    expect(a.imports!.flatMap((i) => i.appliedFields)).not.toContain('photoUrl');
    expect(a.workingName).toBe('Mara Oyelaran');
  });

  it('Skip writes nothing', async () => {
    const { ds, v, add } = await setup();
    add('https://www.mara-oyelaran.com');
    await screen.findByText('mara-oyelaran.com');
    const before = (await ds.getMyArtist(v))!;
    fireEvent.click(screen.getByRole('button', { name: copy.links.pull }));
    const review = (await screen.findByRole('heading', { name: copy.links.review.title })).closest('section')!;
    fireEvent.click(within(review).getByRole('button', { name: copy.links.review.skip }));
    expect(await screen.findByRole('heading', { level: 1, name: copy.about.title })).toBeInTheDocument();
    const after = (await ds.getMyArtist(v))!;
    expect(after.workingName).toBe(before.workingName);
    expect(after.bio).toBe(before.bio);
    expect(after.region).toEqual(before.region);
    expect(after.imports ?? []).toEqual([]);
  });

  it('a link the demo cannot read shows the note on its line, not an error', async () => {
    const { add } = await setup();
    add('@someone.new');
    await screen.findByText('@someone.new');
    fireEvent.click(screen.getByRole('button', { name: copy.links.pull }));
    expect(await screen.findByRole('heading', { name: copy.links.review.title })).toBeInTheDocument();
    expect(screen.getByText(/demo cannot read live pages/i)).toBeInTheDocument();
    expect(screen.getByText(copy.links.review.thin)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('import review rules', () => {
  const NOW = '2026-10-22T12:00:00.000Z';
  const site = { label: 'Website', url: 'https://www.mara-oyelaran.com', platform: 'website' as const, handle: 'mara-oyelaran.com' };
  const ig = { label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints', platform: 'instagram' as const, handle: '@mara.paints' };

  it('names websites by host and socials by platform and handle', () => {
    expect(sourceName(site)).toBe('mara-oyelaran.com');
    expect(sourceName({ ...site, url: 'https://studio.example.org/about' })).toBe('studio.example.org');
    expect(sourceName(ig)).toBe('Instagram @mara.paints');
  });

  it('suggestions for empty fields are ticked; ones that replace a value are not', () => {
    const imp = importFromSignals(site, { jsonLd: { name: 'Mara Oyelaran', description: 'A painter working from a converted print shop in Pittsburgh.', address: { addressLocality: 'Pittsburgh', addressRegion: 'Pennsylvania', addressCountry: 'United States' } } }, NOW);
    const { suggestions } = mergeImports([imp], []);
    const ticks = defaultTicks(suggestions, { workingName: 'Fable Reviewer', bio: '', location: '' });
    expect([...ticks].sort()).toEqual(['bio', 'location']);
    expect([...defaultTicks(suggestions, { workingName: 'mara oyelaran', bio: 'Already wrote one.', location: 'Pittsburgh, Pennsylvania, United States' })].sort()).toEqual(['location', 'workingName']);
  });

  it('a photo is reported but never applied or recorded', () => {
    const imp = importFromSignals(ig, { ogTitle: 'Mara Oyelaran (@mara.paints) • Instagram', ogImage: 'https://cdn.example.com/p.jpg' }, NOW);
    const { suggestions, photo } = mergeImports([imp], []);
    expect(photo?.src).toBe('https://cdn.example.com/p.jpg');
    expect(suggestions.map((s) => s.key)).not.toContain('photoUrl');
    const { patch, records } = buildApply([imp], suggestions, new Set(suggestions.map((s) => s.key)), { region: undefined });
    expect(Object.keys(patch)).not.toContain('photoUrl');
    expect(records.flatMap((r) => r.appliedFields)).not.toContain('photoUrl');
  });
});

describe('step 3: about you', () => {
  it('shows validation messages and does not move on', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/about', v, ds);
    fireEvent.click(await screen.findByRole('button', { name: copy.about.continue }));
    expect(await screen.findByText(copy.about.errors.bio)).toBeInTheDocument();
    expect(screen.getByText(copy.about.errors.region)).toBeInTheDocument();
    expect(screen.getByText(copy.about.errors.country)).toBeInTheDocument();
    expect(screen.getByText(copy.about.errors.mediums)).toBeInTheDocument();
    expect(where()).toBe('/join/about');
  });

  it('saves the profile and moves to step 4', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/about', v, ds);
    fireEvent.change(await screen.findByLabelText(copy.about.city), { target: { value: 'Pittsburgh' } });
    fireEvent.change(screen.getByLabelText(copy.about.region), { target: { value: 'Pennsylvania' } });
    fireEvent.change(screen.getByLabelText(copy.about.country), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText(copy.about.bio), { target: { value: 'Paints the rivers of Pittsburgh at night, in oil, in thin glazes.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Painting$/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: copy.about.sales }));
    fireEvent.click(screen.getByRole('button', { name: copy.about.continue }));
    expect(await screen.findByRole('heading', { level: 1, name: copy.work.title })).toBeInTheDocument();
    const a = (await ds.getMyArtist(v))!;
    expect(a.mediums).toEqual(['painting']);
    expect(a.region).toMatchObject({ city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States' });
    expect(a.availability.sales).toBe(true);
  });
});

describe('step 3: location precision', () => {
  it('"show as city" with no city on file does not block Continue', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    await ds.updateMyArtist(v, { region: { region: '', country: '', precision: 'city' } });
    renderJoin('/join/about', v, ds);
    fireEvent.change(await screen.findByLabelText(copy.about.region), { target: { value: 'Pennsylvania' } });
    fireEvent.change(screen.getByLabelText(copy.about.country), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText(copy.about.bio), { target: { value: 'Paints the rivers of Pittsburgh at night, in oil, in thin glazes.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Painting$/ }));
    fireEvent.click(screen.getByRole('button', { name: copy.about.continue }));
    expect(await screen.findByRole('heading', { level: 1, name: copy.work.title })).toBeInTheDocument();
    expect(screen.queryByText(copy.about.errors.city)).not.toBeInTheDocument();
    expect((await ds.getMyArtist(v))!.region).toMatchObject({ region: 'Pennsylvania', precision: 'region' });
  });
});

describe('step 4: your work', () => {
  it('needs only a photo, a title and a size: year and materials are optional', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/work', v, ds);
    await screen.findByText(copy.work.none);
    fireEvent.change(screen.getByLabelText(copy.work.year), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: copy.work.save }));
    expect(await screen.findByText(copy.work.errors.photo)).toBeInTheDocument();
    expect(screen.getByText(copy.work.errors.title)).toBeInTheDocument();
    expect(screen.queryByText(/Use a year between/)).not.toBeInTheDocument();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'w.png', { type: 'image/png' });
    fireEvent.change(document.getElementById('kj-photo-input')!, { target: { files: [file] } });
    await screen.findByRole('button', { name: copy.work.photoChange });
    fireEvent.change(screen.getByLabelText(copy.work.titleLabel), { target: { value: 'Untitled' } });
    fireEvent.change(screen.getByLabelText(copy.work.height), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(copy.work.width), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: copy.work.save }));
    expect(await screen.findByRole('heading', { name: copy.work.listTitle })).toBeInTheDocument();
    const works = await ds.listArtistArtworks(v, v.artistId!);
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({ title: 'Untitled', year: new Date().getFullYear(), materials: ['painting'] });
  });

  it('a filled-in year is still checked', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/work', v, ds);
    await screen.findByText(copy.work.none);
    fireEvent.change(screen.getByLabelText(copy.work.year), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: copy.work.save }));
    expect(await screen.findByText(/Use a year between 1900/)).toBeInTheDocument();
  });

  it('a public work needs a photo; with one it is saved and listed', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/work', v, ds);
    expect(await screen.findByText(copy.work.none)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.work.titleLabel), { target: { value: 'Flow Weather No. 1' } });
    fireEvent.change(screen.getByLabelText(copy.work.materials), { target: { value: 'oil on linen' } });
    fireEvent.change(screen.getByLabelText(copy.work.height), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(copy.work.width), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: copy.work.save }));
    expect(await screen.findByText(copy.work.errors.photo)).toBeInTheDocument();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'w.png', { type: 'image/png' });
    fireEvent.change(document.getElementById('kj-photo-input')!, { target: { files: [file] } });
    await screen.findByRole('button', { name: copy.work.photoChange });
    fireEvent.click(screen.getByRole('button', { name: copy.work.save }));
    expect(await screen.findByRole('heading', { name: copy.work.listTitle })).toBeInTheDocument();
    expect(screen.getByText('Flow Weather No. 1')).toBeInTheDocument();
    const works = await ds.listArtistArtworks(v, v.artistId!);
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({ visibility: 'public', priceVisibility: 'institutions', materials: ['oil on linen'] });
  });
});

describe('step 5: check and send', () => {
  async function ready() {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    await ds.updateMyArtist(v, {
      bio: 'Paints the rivers of Pittsburgh at night, in oil, in thin glazes.',
      region: { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', precision: 'city' },
      mediums: ['painting'],
      links: [{ label: 'Instagram @mara.paints', url: 'https://www.instagram.com/mara.paints' }],
    });
    await ds.saveArtwork(v, {
      title: 'Flow Weather No. 1',
      year: 2026,
      medium: 'painting',
      materials: ['oil on linen'],
      dimensions: { height: 40, width: 30, unit: 'in' },
      description: '',
      images: [],
      status: 'available',
      rightsNote: '',
      priceVisibility: 'institutions',
      visibility: 'private',
      tags: [],
    });
    return { ds, v };
  }

  it('the verify box copies the token', async () => {
    const { ds, v } = await ready();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderJoin('/join/verify', v, ds);
    const token = (await ds.getMyArtist(v))!.verificationToken!;
    expect(await screen.findByTestId('verification-token')).toHaveTextContent(token);
    fireEvent.click(screen.getByRole('button', { name: `${copy.verifyBox.copy} ${token}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
    expect(await screen.findByText(copy.verifyBox.copied)).toBeInTheDocument();
  });

  it('Check my links updates the pills', async () => {
    const { ds, v } = await ready();
    renderJoin('/join/verify', v, ds);
    const box = (await screen.findByRole('heading', { name: copy.verifyBox.title })).closest('section')!;
    expect(within(box).getByText(copy.verifyBox.pill.claimed)).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: copy.verifyBox.check }));
    // Mara's Instagram page carries Mara's code, not this artist's.
    expect(await within(box).findByText('Code not found')).toBeInTheDocument();
    expect(within(box).queryByText('Failed')).not.toBeInTheDocument();
  });

  it('lists what is missing and keeps Send disabled until the profile is ready', async () => {
    const ds = new MockDataSource({ persist: false });
    const v = await newArtist(ds);
    renderJoin('/join/verify', v, ds);
    expect(await screen.findByText('Add at least one work. Three is better.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.verify.send })).toBeDisabled();
  });

  it('Send moves the profile to pending (public on approval) and opens the studio', async () => {
    const { ds, v } = await ready();
    renderJoin('/join/verify', v, ds);
    const send = await screen.findByRole('button', { name: copy.verify.send });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await screen.findByText('Studio screen')).toBeInTheDocument();
    const a = (await ds.getMyArtist(v))!;
    expect(a.status).toBe('pending');
    expect(a.visibility).toBe('public');
  });
});
