/**
 * Studio copy for the v5 intake: the "Finish your profile" card, the pending
 * banner and the profile editor's links section. Measured by the copy gate.
 */
export const studioIntakeCopy = {
  finish: {
    title: 'Finish your profile',
    done: 'done',
    progressLabel: 'Profile complete',
    leftTitle: 'Still to do',
    ready: 'Everything Kofi needs is in. Send it when it reads the way you want.',
    cta: 'Pick up where you left off',
    note: 'It saves as you go. Nobody outside Kofi sees it before approval.',
  },
  pending: {
    title: 'Kofi is reviewing your profile',
    lede: 'Thanks for sending it in.',
    nextTitle: 'What happens next',
    next: [
      'We look at your work and open each of your links.',
      'Kofi reviews it, and your studio shows the result.',
    ],
    keepEditing: 'Keep editing if you like. Whatever you change while you wait goes straight to the person at Kofi who is reading your profile, so nothing gets lost.',
    editProfile: 'Edit profile',
  },
  links: {
    lede: 'Paste your Instagram, website, Facebook or LinkedIn. Links are public; checks are not.',
    inputLabel: 'Paste a link or type a handle',
    inputHint: 'For example @mara.paints or mara-oyelaran.com.',
    add: 'Add',
    addManual: 'Add with your own label',
    remove: 'Remove',
    duplicate: 'That link is already on your profile.',
    savedFirst: 'We saved your links first.',
    checkedNone: 'None verified yet. Put the code on one page and try again.',
    unreachable: 'Some pages would not let us read them. Private accounts do that, and it is fine.',
  },
};

/** "Checked 2 links. 1 verified." */
export function checkedToast(total: number, verified: number): string {
  const n = total === 1 ? '1 link' : `${total} links`;
  return `Checked ${n}. ${verified} verified.`;
}
