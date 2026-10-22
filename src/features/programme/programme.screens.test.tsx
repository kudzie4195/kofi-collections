import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { navForRole, mobileTabs, desktopTabs } from '@/app/TabBar';
import { DESHAWN, LENA, MARA, QUINCY, renderAt, SEED_NOW, VISITOR } from './testUtils';
import { getSaved, isSaved, resetSavedCache, SAVED_KEY, toggleSaved } from './saved';
import { homeCopy } from './homeCopy';

beforeEach(() => {
  // Only Date is faked: the seeded programme has absolute dates, so phases are pinned to 2026-10-20.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SEED_NOW);
  resetSavedCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  resetSavedCache();
});

describe('Discover (/)', () => {
  it('renders now showing, the open call, new works, journal, events and services from the seed', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 2, name: 'Night Weather' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kofi Collections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /bring your work\. kofi brings the room\./i })).toBeInTheDocument();
    // open call band: the soonest-closing open call, with days left
    const band = screen.getByRole('heading', { name: 'Night Weather Studio Award' }).closest('section') as HTMLElement;
    expect(within(band).getByText('Closes in 41 days')).toBeInTheDocument();
    // The real Art of Advocacy call closed on Sep 11, 2026, so it is not offered as "also open".
    expect(within(band).queryByRole('link', { name: /Art of Advocacy/ })).not.toBeInTheDocument();
    // journal: the three newest stories
    expect(screen.getByRole('heading', { name: 'Mara Oyelaran paints the hour after a storm' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inside June Takahashi-Bell’s loom room' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /The Art of Advocacy: Kofi Collections leads artist selection/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What an artist-owned record changes' })).not.toBeInTheDocument();
    // what's on: upcoming events only (the opening on Oct 2 is past)
    expect(screen.getByText('Artist talk: Mara Oyelaran on glazing')).toBeInTheDocument();
    expect(screen.queryByText('Night Weather: opening reception')).not.toBeInTheDocument();
    // spotlight on the artist of the exhibition's first work
    expect(await screen.findByRole('heading', { level: 2, name: 'Mara Oyelaran' })).toBeInTheDocument();
    // services link to the About anchors
    expect(screen.getByRole('link', { name: /for organisations/i })).toHaveAttribute('href', '/about#organisations');
    expect(screen.getAllByText('Sample').length).toBeGreaterThan(0);
  });

  it('leads with artists: hero CTA, how it works, why artists join, then the collectors band', async () => {
    renderAt('/');
    await screen.findByRole('heading', { level: 2, name: 'Night Weather' });
    const hero = screen.getByRole('heading', { name: /bring your work/i }).closest('section') as HTMLElement;
    expect(within(hero).getByRole('link', { name: homeCopy.hero.start })).toHaveAttribute('href', '/join');
    expect(within(hero).getByRole('link', { name: homeCopy.hero.how })).toHaveAttribute('href', '#kp-how');
    const how = screen.getByRole('heading', { level: 2, name: homeCopy.how.title }).closest('section') as HTMLElement;
    expect(within(how).getAllByRole('listitem')).toHaveLength(3);
    for (const st of homeCopy.how.steps) expect(within(how).getByRole('heading', { level: 3, name: st.title })).toBeInTheDocument();
    for (const f of homeCopy.why.facts) expect(screen.getByRole('heading', { level: 3, name: f.title })).toBeInTheDocument();
    const collectors = screen.getByRole('heading', { level: 2, name: homeCopy.collectors.title }).closest('section') as HTMLElement;
    expect(within(collectors).getByRole('link', { name: homeCopy.collectors.browse })).toHaveAttribute('href', '/works');
    fireEvent.click(within(collectors).getByRole('button', { name: homeCopy.collectors.ask }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // artist block order: how → why → open call → … → collectors → now showing (a lazy chunk)
    await waitFor(() => expect(document.getElementById('kp-now-title')).not.toBeNull());
    const order = ['kp-how', 'kp-why', 'kp-callband-title', 'kp-collectors-title', 'kp-now-title'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the hero CTA follows the role: artists go to the studio, staff browse', async () => {
    renderAt('/', MARA);
    const hero = (await screen.findByRole('heading', { name: /bring your work/i })).closest('section') as HTMLElement;
    expect(within(hero).getByRole('link', { name: homeCopy.hero.studio })).toHaveAttribute('href', '/studio');
    expect(screen.queryByRole('link', { name: homeCopy.how.cta })).not.toBeInTheDocument();
  });

  it('hides blocks whose data is empty', async () => {
    const ds = new MockDataSource({ persist: false, now: () => SEED_NOW });
    for (const s of await ds.listStories(QUINCY)) await ds.deleteStory(QUINCY, s.id);
    for (const e of await ds.listEvents(QUINCY)) await ds.deleteEvent(QUINCY, e.id);
    renderAt('/', VISITOR, ds);
    expect(await screen.findByRole('heading', { level: 2, name: 'Night Weather' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'From the journal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What’s on' })).not.toBeInTheDocument();
  });

  it('old gallery links with filter params redirect to /works with the same params', async () => {
    renderAt('/?medium=painting&unit=in&max=40');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/works?medium=painting&unit=in&max=40'));
    expect(await screen.findByText('Small Weather No. 4')).toBeInTheDocument();
    expect(screen.getByTestId('result-count')).toHaveTextContent('1 work');
    expect(screen.getByRole('heading', { level: 1, name: 'Works' })).toBeInTheDocument();
  });

  it('a plain / stays on Discover', async () => {
    renderAt('/?utm=x');
    expect(await screen.findByRole('heading', { level: 2, name: 'Night Weather' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/?utm=x');
  });
});

describe('Exhibitions', () => {
  it('list defaults to Current and switches phases', async () => {
    renderAt('/exhibitions');
    const tabs = await screen.findByRole('radiogroup', { name: 'Show exhibitions' });
    await waitFor(() => expect(within(tabs).getByRole('radio', { name: /current · 1/i })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(within(tabs).getByRole('radio', { name: /past · 3/i }));
    expect(screen.getByTestId('where')).toHaveTextContent('phase=past');
    const list = screen.getByRole('heading', { name: 'Past exhibitions' }).closest('section') as HTMLElement;
    expect(within(list).getByRole('heading', { name: 'Being/Seen' })).toBeInTheDocument();
  });

  it('a draft is not visible to a visitor and is visible (flagged) to an admin', async () => {
    const ds = new MockDataSource({ persist: false, now: () => SEED_NOW });
    const draft = await ds.saveExhibition(QUINCY, {
      sample: true,
      published: false,
      title: 'Secret Draft Show',
      startsOn: '2026-12-01',
      summary: 'Not yet announced.',
      body: 'Draft body.',
      artworkIds: [],
    });
    const v = renderAt(`/exhibitions/${draft.id}`, VISITOR, ds);
    expect(await screen.findByRole('heading', { level: 1, name: 'Exhibition not found' })).toBeInTheDocument();
    expect(screen.queryByText('Secret Draft Show')).not.toBeInTheDocument();
    v.unmount();
    localStorage.clear();
    renderAt(`/exhibitions/${draft.id}`, QUINCY, ds);
    expect(await screen.findByRole('heading', { level: 1, name: 'Secret Draft Show' })).toBeInTheDocument();
    expect(screen.getByText(/only Kofi staff can see this exhibition/i)).toBeInTheDocument();
  });

  it('detail shows dates, venue, works, related events and the call; a poster stands in for a missing image', async () => {
    renderAt('/exhibitions/ex_night_weather');
    expect(await screen.findByRole('heading', { level: 1, name: 'Night Weather' })).toBeInTheDocument();
    expect(screen.getByText('Oct 2 – Nov 22, 2026')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Works in the exhibition' })).toBeInTheDocument();
    // a pending artist's work is filtered out by the data layer
    expect(screen.queryByText('Grid Drift 03')).not.toBeInTheDocument();
    expect(screen.getByText('Artist talk: Mara Oyelaran on glazing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /night weather studio award/i })).toHaveAttribute('href', '/calls/call_night_weather');
  });

  it('a real exhibition without an image gets a poster and an external link', async () => {
    renderAt('/exhibitions/ex_being_seen');
    expect(await screen.findByRole('heading', { level: 1, name: 'Being/Seen' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /being\/seen, may 8 – oct 25, 2025/i })).toBeInTheDocument();
    const ext = screen.getByRole('link', { name: /more on koficollections\.org/i });
    expect(ext).toHaveAttribute('href', 'https://www.koficollections.org/upcoming-exhibitions');
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('Open calls', () => {
  it('list groups open / opening soon and keeps closed calls behind a disclosure', async () => {
    renderAt('/calls');
    expect(await screen.findByRole('heading', { name: /^open\s*1$/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /opening soon/i, level: 2 })).toBeInTheDocument();
    const closed = screen.getByText('Closed calls').closest('details') as HTMLElement;
    expect(closed).not.toHaveAttribute('open');
    expect(within(closed).getByText('Late Summer Open 2026')).toBeInTheDocument();
  });

  it('artist who has not applied gets "Apply with your works"', async () => {
    renderAt('/calls/call_night_weather', MARA);
    const cta = await screen.findByRole('link', { name: 'Apply with your works' });
    expect(cta).toHaveAttribute('href', '/studio/apply/call_night_weather');
    expect(screen.getByText('Any medium')).toBeInTheDocument();
    expect(screen.getByText('No entry fee')).toBeInTheDocument();
  });

  it('artist who already applied sees their status instead', async () => {
    renderAt('/calls/call_night_weather', DESHAWN);
    expect(await screen.findByText('You have applied')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your applications' })).toHaveAttribute('href', '/studio/applications');
    expect(screen.queryByRole('link', { name: 'Apply with your works' })).not.toBeInTheDocument();
  });

  it('visitor is told artists apply from their studio, with a sign-in link; curators get no sign-in link', async () => {
    const v = renderAt('/calls/call_night_weather', VISITOR);
    expect(await screen.findByText('Artists apply from their studio')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in as an artist/i })).toHaveAttribute('href', '/account');
    v.unmount();
    renderAt('/calls/call_night_weather', LENA);
    expect(await screen.findByText('Artists apply from their studio')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in as an artist/i })).not.toBeInTheDocument();
  });

  it('an open external call links to the partner form for everyone, in a new tab, and hides terms Kofi does not state', async () => {
    const ds = new MockDataSource({ persist: false, now: () => SEED_NOW });
    const call = await ds.saveOpenCall(QUINCY, {
      sample: true, published: true, kind: 'exhibition', title: 'Partner Form Call', partner: 'A Partner', summary: 'A call run on a partner form.',
      body: 'Read the call on the partner site.', eligibility: 'See the call', mediums: [], opensOn: '2026-10-01', maxWorks: 1,
      fee: 'See the call', externalUrl: 'https://example.org/apply',
    });
    renderAt(`/calls/${call.id}`, MARA, ds);
    const a = await screen.findByRole('link', { name: /apply on the partner’s form/i });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('href', 'https://example.org/apply');
    expect(screen.getByText('Open until filled')).toBeInTheDocument();
    expect(screen.queryByText('Works accepted')).not.toBeInTheDocument();
    expect(screen.queryByText('Any medium')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Apply with your works' })).not.toBeInTheDocument();
  });

  it('Kofi’s real Art of Advocacy call shows as closed on its published deadline, linking to Kofi’s page', async () => {
    renderAt('/calls/call_advocacy', MARA);
    expect(await screen.findByRole('button', { name: 'Applications closed' })).toBeDisabled();
    expect(screen.getByText('Applications closed on Sep 11, 2026.')).toBeInTheDocument();
    const read = screen.getByRole('link', { name: /read the call on koficollections\.org/i });
    expect(read).toHaveAttribute('href', 'https://www.koficollections.org/artists');
    expect(read).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('Works accepted')).not.toBeInTheDocument();
    expect(screen.queryByText('Opens')).not.toBeInTheDocument();
  });

  it('closed and upcoming calls show a disabled state', async () => {
    const v = renderAt('/calls/call_summer_open', MARA);
    expect(await screen.findByRole('button', { name: 'Applications closed' })).toBeDisabled();
    v.unmount();
    renderAt('/calls/call_soft_ground', MARA);
    expect(await screen.findByRole('button', { name: /opens nov 15, 2026/i })).toBeDisabled();
  });
});

describe('Journal, What’s on, About', () => {
  it('article renders kicker, headline, byline, pull quote and related artist + works', async () => {
    renderAt('/journal/st_mara_interview');
    expect(await screen.findByRole('heading', { level: 1, name: 'Mara Oyelaran paints the hour after a storm' })).toBeInTheDocument();
    expect(screen.getByText('Interview')).toBeInTheDocument();
    expect(screen.getByText('By Kofi Collections editorial')).toBeInTheDocument();
    expect(screen.getByText('Oct 14, 2026')).toBeInTheDocument();
    expect(screen.getByText(/I paint the hour after a storm/).closest('blockquote')).toHaveClass('kp-pull');
    expect(await screen.findByRole('heading', { name: 'Works in this story' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /in this story mara oyelaran/i })).toHaveAttribute('href', '/artists/art_mara');
  });

  it('what’s on groups events by month and keeps past events behind a disclosure', async () => {
    renderAt('/whats-on?tab=events');
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    const past = screen.getByText('Past events').closest('details') as HTMLElement;
    expect(within(past).getByText('Night Weather: opening reception')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name: 'Journal' }));
    expect(await screen.findByText('What an artist-owned record changes')).toBeInTheDocument();
  });

  it('about has the three service anchors, contact links and a general Get in touch form', async () => {
    renderAt('/about');
    expect(await screen.findByRole('heading', { level: 1, name: 'About Kofi Collections' })).toBeInTheDocument();
    for (const id of ['artists', 'collectors', 'organisations']) expect(document.getElementById(id)).not.toBeNull();
    expect(screen.getAllByRole('link', { name: /info@koficollections\.org/i })[0]).toHaveAttribute('href', 'mailto:info@koficollections.org');
    expect(screen.getAllByRole('link', { name: /412\.390\.7677/ })[0]).toHaveAttribute('href', 'tel:+14123907677');
    fireEvent.click(screen.getByRole('button', { name: 'Get in touch' }));
    const sheet = screen.getByRole('dialog', { name: 'Get in touch' });
    expect(within(sheet).getByLabelText('Message')).toHaveValue('');
  });
});

describe('Artwork page additions', () => {
  it('Ask Kofi submits a collector inquiry, showing field errors inline first', async () => {
    const { ds } = renderAt('/work/aw_mara_1', VISITOR);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Kofi about this work' }));
    const sheet = screen.getByRole('dialog', { name: 'Ask Kofi about this work' });
    expect(within(sheet).getByLabelText('Message')).toHaveValue('I\'m interested in Doubling (Liberty Avenue, 7:40pm) by Mara Oyelaran.');
    expect(within(sheet).queryByText(/mara@|@example/)).not.toBeInTheDocument();
    const send = within(sheet).getByRole('button', { name: 'Send to Kofi' });
    fireEvent.click(send);
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Tell us your name.');
    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Ada Collector' } });
    fireEvent.change(within(sheet).getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(send);
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Enter an email address we can reply to.');
    expect(within(sheet).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(within(sheet).getByLabelText('Email'), { target: { value: 'ada@example.org' } });
    fireEvent.click(send);
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Tick the box so Kofi can reply to you.');
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(send);
    expect(await screen.findByText('Thanks — Kofi will reply to ada@example.org')).toBeInTheDocument();
    const rows = await ds.listBuyerInquiries(QUINCY);
    expect(rows.some((r) => r.email === 'ada@example.org' && r.artworkId === 'aw_mara_1' && r.intent === 'purchase')).toBe(true);
  });

  it('shows server-side field errors from ValidationError', async () => {
    const ds = new MockDataSource({ persist: false, now: () => SEED_NOW });
    const { ValidationError } = await import('@/data/DataSource');
    vi.spyOn(ds, 'submitBuyerInquiry').mockRejectedValue(new ValidationError('Too many inquiries from this email today.', 'email'));
    renderAt('/work/aw_mara_1', VISITOR, ds);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Kofi about this work' }));
    const sheet = screen.getByRole('dialog', { name: 'Ask Kofi about this work' });
    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Ada Collector' } });
    fireEvent.change(within(sheet).getByLabelText('Email'), { target: { value: 'ada@example.org' } });
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send to Kofi' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Too many inquiries from this email today.');
  });

  it('verified curators keep the introduction request as primary and can also ask Kofi', async () => {
    renderAt('/work/aw_mara_1', LENA);
    expect(await screen.findByRole('button', { name: /request introduction/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask Kofi about this work' })).toHaveClass('kp-linkbtn');
  });

  it('View in a room shows the true-scale caption', async () => {
    renderAt('/work/aw_mara_1', VISITOR);
    fireEvent.click(await screen.findByRole('button', { name: 'View in a room' }));
    const sheet = screen.getByRole('dialog', { name: 'View in a room' });
    expect(within(sheet).getByText('Bench 180 cm · figure 170 cm · work 152 × 122 cm')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Charcoal' }));
    expect(within(sheet).getByRole('radio', { name: 'Charcoal' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Save toggles the heart, toasts a link to Saved, and the Saved page lists it', async () => {
    const { router } = renderAt('/work/aw_mara_2', VISITOR);
    const heart = await screen.findByRole('button', { name: 'Save' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(heart);
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')).toEqual(['aw_mara_2']);
    const view = await screen.findByRole('link', { name: 'View' });
    expect(view.getAttribute('href')).toMatch(/\/saved$/);
    await router.navigate('/saved');
    const grid = await screen.findByRole('list', { name: 'Saved works' });
    expect(within(grid).getByText('Small Weather No. 4')).toBeInTheDocument();
  });
});

describe('Saved', () => {
  it('drops works the viewer can no longer see, and forgets them', async () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify(['aw_mara_2', 'aw_mara_3', 'gone']));
    resetSavedCache();
    renderAt('/saved', VISITOR);
    const grid = await screen.findByRole('list', { name: 'Saved works' });
    expect(within(grid).getAllByRole('link')).toHaveLength(1);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')).toEqual(['aw_mara_2']));
  });

  it('empty state points to Works', async () => {
    renderAt('/saved', VISITOR);
    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse works' })).toHaveAttribute('href', '/works');
  });

  it('the saved hook survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    resetSavedCache();
    expect(getSaved()).toEqual([]);
    expect(toggleSaved('aw_mara_1')).toBe(true);
    expect(isSaved('aw_mara_1')).toBe(true);
    expect(toggleSaved('aw_mara_1')).toBe(false);
    expect(getSaved()).toEqual([]);
  });

  it('ignores corrupt stored values', () => {
    localStorage.setItem(SAVED_KEY, '{"not":"a list"}');
    resetSavedCache();
    expect(getSaved()).toEqual([]);
    localStorage.setItem(SAVED_KEY, JSON.stringify(['a', 7, 'a', 'b']));
    resetSavedCache();
    expect(getSaved()).toEqual(['a', 'b']);
  });
});

describe('Navigation', () => {
  it('mobile bars have at most five tabs per role, as specified', () => {
    const labels = (r: Parameters<typeof mobileTabs>[0]) => mobileTabs(r).map((t) => t.label);
    expect(labels('public')).toEqual(['Discover', 'Works', 'Artists', 'What’s on', 'Sign in']);
    expect(labels('artist')).toEqual(['Discover', 'Works', 'What’s on', 'Studio', 'Account']);
    expect(labels('curator')).toEqual(['Discover', 'Works', 'Artists', 'Shortlists', 'Account']);
    expect(labels('admin')).toEqual(['Discover', 'Works', 'What’s on', 'Kofi', 'Account']);
  });

  it('desktop nav order and exactly one active item per section', () => {
    expect(desktopTabs('artist').map((t) => t.label)).toEqual(['Works', 'Artists', 'Exhibitions', 'Open calls', 'Journal', 'About', 'Studio', 'Account']);
    const lit = (path: string) => desktopTabs('artist').filter((t) => t.match(path)).map((t) => t.label);
    expect(lit('/works')).toEqual(['Works']);
    expect(lit('/work/aw_mara_1')).toEqual(['Works']);
    expect(lit('/exhibitions/ex_night_weather')).toEqual(['Exhibitions']);
    expect(lit('/calls/call_advocacy')).toEqual(['Open calls']);
    expect(lit('/journal')).toEqual(['Journal']);
    expect(lit('/studio/apply/call_night_weather')).toEqual(['Studio']);
    expect(lit('/')).toEqual([]);
    const mobileLit = (path: string) => mobileTabs('public').filter((t) => t.match(path)).map((t) => t.label);
    expect(mobileLit('/calls/x')).toEqual(['What’s on']);
    expect(mobileLit('/')).toEqual(['Discover']);
    expect(navForRole('curator').some((t) => t.label === 'What’s on')).toBe(false);
  });
});
