import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { applyFilters, EMPTY_FILTERS } from '@/domain/filters';
import { SOCIAL_IMPACT_BOUNDARY, selectableTags } from '@/domain/taxonomy';
import { activeChips } from './activeChips';
import { FILTER_COPY } from './filterCopy';
import { filtersFromParams, paramsFromFilters, searchFromFilters, withMediumTag } from './params';
import { LENA, renderAt, VISITOR } from './testUtils';

afterEach(() => localStorage.clear());

const where = () => screen.getByTestId('where').textContent ?? '';
const grid = () => screen.queryByRole('list', { name: 'Works' });
const titles = () => (grid() ? within(grid()!).getAllByRole('link').map((a) => a.querySelector('.label-card__title')?.textContent) : []);

describe('v6 filter params', () => {
  it('round-trips tags, orientation, edition and uses through the URL', () => {
    const qs = 'tags=style.abstract,theme.memory,social_impact.community_building&orient=portrait,square&edition=limited&uses=exhibition,auction';
    const f = filtersFromParams(new URLSearchParams(qs));
    expect(f.tags).toEqual({ style: ['style.abstract'], theme: ['theme.memory'], social_impact: ['social_impact.community_building'] });
    expect(f.orientations).toEqual(['portrait', 'square']);
    expect(f.editionTypes).toEqual(['limited']);
    expect(f.uses).toEqual(['exhibition', 'auction']);
    expect(searchFromFilters(f)).toBe(qs);
    expect(filtersFromParams(paramsFromFilters(f))).toEqual(f);
  });

  it('groups by category, keeps library order, accepts repeated params and drops unknown or Phase 2 tags', () => {
    const f = filtersFromParams(new URLSearchParams('tags=theme.memory&tags=style.abstract,acquisition.auction,style.nope,artist_experience.commissions&orient=sideways&uses=everything'));
    expect(f.tags).toEqual({ style: ['style.abstract'], theme: ['theme.memory'] });
    expect(f.orientations).toBeUndefined();
    expect(f.uses).toBeUndefined();
    expect(searchFromFilters(f)).toBe('tags=style.abstract,theme.memory');
  });

  it('old medium links land on the medium tag', () => {
    const f = filtersFromParams(new URLSearchParams('medium=painting&medium=mixed%20media'));
    expect(f.mediums).toBeUndefined();
    expect(f.tags).toEqual({ medium: ['medium.painting', 'medium.mixed_media'] });
  });

  it('names one removable chip per active value', () => {
    const f = filtersFromParams(new URLSearchParams('q=rain&tags=style.abstract,subject.identity,theme.identity&uses=exhibition&edition=limited&orient=portrait&unit=in&max=40&region=Ottawa&yfrom=2020'));
    const names = activeChips(f).map((c) => c.name);
    expect(names).toEqual([
      'Remove filter: Search: “rain”',
      'Remove filter: Abstract',
      'Remove filter: Identity (Subject Matter)',
      'Remove filter: Identity (Themes & Concepts)',
      'Remove filter: Portrait',
      'Remove filter: Limited edition',
      'Remove filter: For exhibition',
      'Remove filter: Under 40 in',
      'Remove filter: Region: Ottawa',
      'Remove filter: Made from 2020',
    ]);
    const abstract = activeChips(f).find((c) => c.key === 'tag:style.abstract')!;
    expect(abstract.without.tags).toEqual({ subject: ['subject.identity'], theme: ['theme.identity'] });
  });
});

describe('Works: tag filters, facets and the active chips bar', () => {
  it('shows facet counts per tag group; zero-count chips stay, muted; "Show all" past 8', async () => {
    const ds = new MockDataSource({ persist: false });
    const works = (await ds.listArtworks(VISITOR)).map(withMediumTag);
    renderAt('/works', VISITOR, ds);
    await screen.findByText('Small Weather No. 4');
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    const sheet = screen.getByRole('dialog', { name: /filters/i });

    const style = within(sheet).getByRole('group', { name: /^Artistic Style/ });
    const expectedAbstract = applyFilters(works, { ...EMPTY_FILTERS, tags: { style: ['style.abstract'] } }).length;
    expect(expectedAbstract).toBeGreaterThan(0);
    const abstract = within(style).getByRole('button', { name: /^abstract/i });
    expect(abstract.querySelector('.chip__count')).toHaveTextContent(String(expectedAbstract));

    // A tag nobody has used yet: visible, muted, still a button
    const zero = within(style).getByRole('button', { name: /^surrealism/i });
    expect(zero.querySelector('.chip__count')).toHaveTextContent('0');
    expect(zero).toHaveClass('kg-fchip--zero');

    // Collapsed to 8, "Show all 12" opens the rest
    expect(within(style).getAllByRole('button')).toHaveLength(8);
    const more = within(sheet).getByRole('button', { name: `Show all ${selectableTags('style').length}` });
    fireEvent.click(more);
    expect(within(style).getAllByRole('button')).toHaveLength(selectableTags('style').length);

    // Social Impact group carries the artist-chosen lede; structured groups exist
    expect(within(sheet).getByRole('group', { name: /^Social Impact/ })).toBeInTheDocument();
    expect(within(sheet).getAllByText(FILTER_COPY.socialImpactLede).length).toBeGreaterThan(0);
    for (const g of ['Orientation', 'Edition type', 'Available for']) expect(within(sheet).getByRole('group', { name: g })).toBeInTheDocument();
  });

  it('OR within a group, AND across groups, applied from the sheet into the URL', async () => {
    renderAt('/works');
    await screen.findByText('Small Weather No. 4');
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    const sheet = screen.getByRole('dialog', { name: /filters/i });
    const medium = within(sheet).getByRole('group', { name: /^Art Medium/ });
    fireEvent.click(within(medium).getByRole('button', { name: /^painting/i }));
    fireEvent.click(within(medium).getByRole('button', { name: /^textile/i }));
    const impact = within(sheet).getByRole('group', { name: /^Social Impact/ });
    fireEvent.click(within(impact).getByRole('button', { name: /^cultural preservation/i }));
    fireEvent.click(within(sheet).getByRole('button', { name: /^Show \d+ works?$/ }));

    expect(where()).toContain('tags=medium.painting,medium.textile,social_impact.cultural_preservation');
    expect(titles()).toEqual(expect.arrayContaining(['Warp / Weft / Wait', 'Small Loom Studies I–IV']));
    expect(titles()).not.toContain('Small Weather No. 4');
    expect(titles()).not.toContain('Threshold (maquette)');
  });

  it('active chips: × removes one value, "Clear all" empties every filter but keeps the unit', async () => {
    renderAt('/works?tags=style.abstract,theme.heritage&uses=exhibition&unit=in');
    await waitFor(() => expect(screen.getByTestId('result-count')).not.toHaveTextContent('Loading'));
    const bar = screen.getByRole('region', { name: 'Active filters' });
    expect(within(bar).getAllByRole('button', { name: /^Remove filter: / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove filter: Abstract',
      'Remove filter: Heritage',
      'Remove filter: For exhibition',
    ]);
    expect(screen.getByRole('button', { name: /^filters \(3\)/i })).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: 'Remove filter: Abstract' }));
    expect(where()).not.toContain('style.abstract');
    expect(where()).toContain('tags=theme.heritage');
    expect(screen.queryByRole('button', { name: 'Remove filter: Abstract' })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('region', { name: 'Active filters' })).getByRole('button', { name: 'Clear all' }));
    expect(where()).toBe('/works?unit=in');
    expect(screen.queryByRole('region', { name: 'Active filters' })).not.toBeInTheDocument();
    expect(screen.getByTestId('result-count')).toHaveTextContent('9 works');
  });

  it('/works?tags=style.abstract shows only abstract work, with its chip', async () => {
    renderAt('/works?tags=style.abstract');
    await screen.findByRole('button', { name: 'Remove filter: Abstract' });
    await waitFor(() => expect(titles().length).toBeGreaterThan(0));
    expect(titles()).toContain('Threshold (maquette)');
    expect(titles()).not.toContain('Doubling (Liberty Avenue, 7:40pm)');
  });

  it('a visitor never sees a withheld price through filters or facets', async () => {
    renderAt('/works?tags=medium.painting&bmax=20000&undisclosed=1');
    await screen.findByText('Doubling (Liberty Avenue, 7:40pm)');
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    expect(document.body.textContent).not.toContain('9,800');
    expect(document.body.textContent).not.toContain('9800');
  });
});

describe('Artwork page: grouped tags', () => {
  it('renders tag rows by category; each chip links to Works filtered by that tag; keywords sit underneath', async () => {
    renderAt('/work/aw_mara_1', LENA);
    const section = (await screen.findByRole('heading', { name: FILTER_COPY.tagsTitle })).closest('section') as HTMLElement;
    const style = within(section).getByRole('list', { name: 'Artistic Style' });
    expect(within(style).getByRole('link', { name: 'Expressionism' })).toHaveAttribute('href', '/works?tags=style.expressionism');
    expect(within(section).getByRole('list', { name: 'Art Medium' })).toBeInTheDocument();
    expect(within(section).getByRole('list', { name: 'Themes & Concepts' })).toHaveTextContent('Memory');
    expect(within(section).getByText(/night, city, reflection/)).toBeInTheDocument();
    // a tag link opens Works filtered by it
    fireEvent.click(within(style).getByRole('link', { name: 'Expressionism' }));
    expect(where()).toBe('/works?tags=style.expressionism');
  });

  it('Social Impact row says the artist chose it and carries the boundary', async () => {
    renderAt('/work/aw_tobias_3', VISITOR);
    const section = (await screen.findByRole('heading', { name: FILTER_COPY.tagsTitle })).closest('section') as HTMLElement;
    const row = section.querySelector('[data-category="social_impact"]') as HTMLElement;
    expect(row).toHaveAttribute('title', SOCIAL_IMPACT_BOUNDARY);
    expect(within(row).getByText(FILTER_COPY.socialImpactLede)).toBeInTheDocument();
    expect(FILTER_COPY.socialImpactLede).toMatch(/not a verified result/i);
    const chip = within(row).getByRole('link', { name: 'Community Building' });
    expect(chip.getAttribute('title')).toContain(SOCIAL_IMPACT_BOUNDARY);
    expect(chip).toHaveAttribute('href', '/works?tags=social_impact.community_building');
  });
});
