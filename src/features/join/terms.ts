/**
 * The artist terms, version CONSENT_VERSION — the same six points as
 * features/studio/Consent.tsx (which does not export them), shown in a sheet on
 * step one so a visitor can read them before the account exists. Keep the two in
 * step when the terms change; the consent version is what gets recorded.
 */
export const ARTIST_TERMS: { title: string; body: string }[] = [
  {
    title: 'Your work stays yours.',
    body: 'You keep ownership of every work and its copyright. Nothing in these terms transfers rights to Kofi.',
  },
  {
    title: 'Kofi shows only what you mark visible.',
    body: 'You give Kofi a limited, non-exclusive licence to display the images and details you mark visible — to the public, to verified institutions or to Kofi staff — for as long as they stay marked that way. Change a setting and the licence follows it.',
  },
  {
    title: 'Introductions go through Kofi.',
    body: 'Curators never see your contact details. Kofi reviews every request, and your email is shared only when you accept an introduction.',
  },
  {
    title: 'You can export or withdraw at any time.',
    body: 'Download your profile, works and document details whenever you like, or hide everything from discovery in one step. No lock-in.',
  },
  {
    title: 'Private means private, with one logged exception.',
    body: 'Kofi admins can open private records to support you and keep the platform safe. Every open is recorded with who, what and when, and that record is kept even if you withdraw.',
  },
  {
    title: 'Kofi doesn’t appraise.',
    body: 'Kofi never estimates or labels the value of your work. Appraisals come from qualified appraisers; you can keep their letters in your private vault.',
  },
];
