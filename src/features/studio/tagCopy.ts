/**
 * Studio copy for tagging a work (v6). Tag labels and definitions are NOT here: they come
 * from Kofi's workbook through domain/taxonomy and are rendered verbatim.
 */
import type { UseKey } from '@/domain/types';

export const TAG_COPY = {
  sectionTitle: 'Tags',
  intro: 'Pick what fits. Curators and organisers search the collection by these tags. A few that describe the work well put it in the right searches; tags that stretch the truth put it in front of the wrong people.',
  searchLabel: 'Find a tag',
  searchPlaceholder: 'Type to filter, e.g. abstract',
  noMatch: (q: string) => `No tags match “${q}”. Try a shorter word.`,
  clearSearch: 'Clear',
  count: (n: number, cap: number) => `${n} of ${cap}`,
  countFree: (n: number) => `${n} selected`,
  showAll: (n: number) => `Show all ${n}`,
  showFewer: 'Show fewer',
  lockedTitle: 'Your main medium',
  lockedHint: (label: string) => `${label} is your main medium, so it stays on. Add others if the work mixes processes.`,
  socialChange: 'Add, change or remove these whenever you like.',
  definitionsToggle: 'What these mean',
  keywordsLabel: 'Keywords',
  keywordsHint: 'Words people might search that the tags miss. Press Enter after each one.',
  keywordsPlaceholder: 'e.g. night, river',
} as const;

export const USES_COPY = {
  title: 'Available for',
  help: 'Separate from whether it’s for sale.',
  hint: {
    auction: 'Benefit and partner auctions.',
    exhibition: 'Shows and loans, including works not for sale.',
    licensing: 'Reproduction in print or on screen, on terms you agree.',
    commission: 'You’d take a commission based on this work.',
  } satisfies Record<UseKey, string>,
  quickHint: 'All off until you switch one on. Change it any time.',
} as const;

export const EDITION_COPY = {
  title: 'Edition',
  type: 'Edition type',
  none: 'Not set',
  number: 'Number',
  size: 'Edition size',
  hint: 'A print numbered 2/5 is number 2 of an edition of 5.',
  numberTooHigh: 'The number can’t be higher than the edition size.',
  wholeNumbers: 'Use whole numbers from 1 up.',
  sizeNeeded: 'Enter how many are in the edition.',
} as const;

export const LOCATION_COPY = {
  title: 'Where the work is',
  hint: 'Only if it isn’t where you are. If the work is stored, on loan or already hanging somewhere else, tell organisers the state or province so they can plan shipping; the street is never shown.',
  city: 'City',
  region: 'State or province',
  country: 'Country',
  needBoth: 'Add the state or province and the country, or leave all three blank.',
} as const;

export const ORIENTATION_COPY = {
  label: 'Orientation',
  line: (label: string) => `${label}, from the dimensions`,
  pending: 'Shown once the height and width are in.',
} as const;

export const NUDGE_COPY = {
  title: 'Add tags',
  body: (n: number) => (n === 1 ? '1 work has no tags yet. Tagged work is found by curators.' : `${n} works have no tags yet. Tagged work is found by curators.`),
  more: (n: number) => `and ${n} more`,
} as const;

export const QUICK_TAG_COPY = {
  title: 'Tags',
  optional: 'Optional',
  hint: 'A few tags help curators find this work. You can add more later in your studio.',
} as const;

export const WORK_PANEL_COPY = {
  usesAndPlace: 'Uses and location',
  locationNow: (label: string) => `Shown now as ${label}. Fill these in to change it.`,
} as const;
