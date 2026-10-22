/**
 * Kofi desk copy for the v5 intake: link pills, the links and sources panels,
 * the "If they call" box, queue summaries and audit sentences. Measured by the
 * copy gate (scratchpad/harness/copy-gate.mjs). Write like a person at Kofi.
 */
import type { LinkVerification, ProfileImportFields } from '@/domain/types';

export const PILL_LABEL: Record<LinkVerification, string> = {
  claimed: 'Claimed',
  verified: 'Verified',
  failed: 'Code not found',
  unreachable: 'Unreachable',
};

export const PILL_HELP: Record<LinkVerification, string> = {
  claimed: 'The artist added this link. Nobody has checked it yet.',
  verified: 'Their code was on the page, so they run it.',
  failed: 'We reached the page. The code was not there.',
  unreachable: 'We could not read the page. Private accounts do that. Not a red flag.',
};

/** Words for the fields an import can fill, as a reviewer reads them. */
export const FIELD_WORD: Record<keyof ProfileImportFields, string> = {
  workingName: 'name',
  bio: 'bio',
  photoUrl: 'photo',
  city: 'location',
  region: 'location',
  country: 'location',
  links: 'other links',
  followers: 'follower count',
  postCount: 'post count',
};

export const deskIntakeCopy = {
  checked: 'Checked',
  notChecked: 'Not checked yet',

  linksTitle: 'Links',
  linksNone: 'No links on this profile yet.',
  linksLede: 'Each link shows what our checker found the last time it looked.',
  recheck: 'Re-check links',
  recheckDone: 'Links checked.',

  importsTitle: 'Imported from',
  importsNone: 'Typed in by hand. Nothing came from an import.',
  importsUsed: 'Used',
  importsNothingUsed: 'Looked, used nothing',

  callTitle: 'If they call',
  callBody:
    'This is their code. Ask them to put it in an Instagram bio, on any page of their website, or in a LinkedIn About section. Then press Re-check.',
  callNoCode: 'No code on this profile. Older profiles were made before codes existed.',
  callPrivate: 'Staff only.',

  noLinks: 'No links',
  importedFrom: 'Imported from',
};

/** "2 links · 1 verified", "1 link", "No links". */
export function linksSummary(total: number, verified: number): string {
  if (total === 0) return deskIntakeCopy.noLinks;
  const head = total === 1 ? '1 link' : `${total} links`;
  return verified ? `${head} · ${verified} verified` : head;
}

/** Toast and audit tail: "checked 2 links: 1 verified". */
export function checkedSentence(total: number, verified: number): string {
  const n = total === 1 ? '1 link' : `${total} links`;
  return `checked ${n}: ${verified} verified`;
}

export const AUDIT_SIGNUP = 'created a profile';
export const AUDIT_IMPORT = 'pulled details from';
export const AUDIT_IMPORT_FALLBACK = 'pulled details from a link';
