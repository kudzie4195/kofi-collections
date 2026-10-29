/**
 * Copy for the Works filters, the active-filter chips and the artwork page's tag rows (v6).
 * Tag and category labels are not here: they come from Kofi's workbook through domain/taxonomy.
 * Checked by the copy gate (scratchpad/harness/copy-gate.mjs).
 */

export const FILTER_COPY = {
  /* ---- filter sheet ---- */
  tagsLede: 'Pick several in one group to see work with any of them. Each group you add narrows the list.',
  showAll: (n: number) => `Show all ${n}`,
  showFewer: 'Show fewer',
  socialImpactLede: 'What the work is about, as the artist states it. Not a verified result, and not about the artist.',
  orientationTitle: 'Orientation',
  orientationLede: 'Read from the measurements.',
  editionTitle: 'Edition type',
  usesTitle: 'Available for',
  usesLede: 'What the artist allows. That is separate from whether a work is for sale, so a work that isn’t for sale can still go to an exhibition.',
  materialsTitle: 'Materials as listed',
  materialsLede: 'Matches any word on a work’s materials line.',
  noneYet: 'Nothing tagged here yet',

  /* ---- active chips bar ---- */
  activeLabel: 'Active filters',
  clearAll: 'Clear all',
  removeFilter: (label: string) => `Remove filter: ${label}`,
  chipSearch: (q: string) => `Search: “${q}”`,
  chipRegion: (r: string) => `Region: ${r}`,
  chipUse: (label: string) => `For ${label.toLowerCase()}`,
  chipSizeUnder: (v: string) => `Under ${v}`,
  chipSizeOver: (v: string) => `Over ${v}`,
  chipSizeBetween: (a: string, b: string) => `${a} to ${b}`,
  chipBudgetUnder: (v: string) => `Up to ${v}`,
  chipBudgetOver: (v: string) => `From ${v}`,
  chipBudgetBetween: (a: string, b: string) => `${a} to ${b}`,
  chipYearsFrom: (y: number) => `Made from ${y}`,
  chipYearsTo: (y: number) => `Made up to ${y}`,
  chipYearsBetween: (a: number, b: number) => `Made ${a} to ${b}`,
  chipMaterial: (m: string) => `Material: ${m}`,
  chipCommissions: 'Has made commissions',
  chipPublicArt: 'Has made public art',

  /* ---- artwork page ---- */
  tagsTitle: 'How the artist describes it',
  keywordsLabel: 'Keywords',
  tagLinkTitle: (label: string) => `See works tagged ${label}`,
  editionLabel: 'Edition',
  editionNumber: (n: number, size: number) => `${n} of ${size}`,
  usesLabel: 'Available for',
  usesNone: 'Not offered yet',
  orientationLabel: 'Orientation',
} as const;
