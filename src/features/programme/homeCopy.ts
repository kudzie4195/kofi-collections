/**
 * Home (/) strings added in v5: the artist hero, how it works, why artists join and
 * the collectors band. Measured by scratchpad/harness/copy-gate.mjs. Existing blocks
 * (now showing, open calls, journal, services) keep their copy where it was.
 *
 * Headline options considered (serif, two lines; the second line is the italic gold one):
 *   A  "Bring your work." / "Kofi brings the room."         chosen: speaks to the artist,
 *      and "the room" is both the gallery and the people in it (collectors, curators).
 *   B  "One profile." / "Every open call."                  clear, but sells a feature.
 *   C  "Make the record." / "Keep it yours."                true to v4, but reads as a records app.
 */
export const homeCopy = {
  hero: {
    eyebrow: 'Pittsburgh · For artists',
    line1: 'Bring your work.',
    line2: 'Kofi brings the room.',
    // line1: 'One profile.',
    // line2: 'Every open call.',
    // line1: 'Make the record.',
    // line2: 'Keep it yours.',
    lede: 'Make your artist profile in about ten minutes. Paste your Instagram or website and we fill in what we can. You check every word.',
    start: 'Start your profile',
    studio: 'Open your studio',
    browse: 'Browse the works',
    how: 'See how it works',
  },
  how: {
    eyebrow: 'How it works',
    title: 'Three steps to the wall',
    steps: [
      {
        title: 'Make your profile',
        body: 'Paste your links and we fill what we can. Ten minutes, most of it reading.',
      },
      {
        title: 'Add your work',
        body: 'Photograph a piece, give it a title and choose who sees each price. Everyone, verified curators only, or just Kofi.',
      },
      {
        title: 'Kofi reviews it',
        body: 'Someone at Kofi looks over your profile and opens the links you gave us. Once it’s approved you appear in Works and can apply to open calls.',
      },
    ],
    cta: 'Start your profile',
  },
  why: {
    eyebrow: 'Why artists join',
    title: 'What stays with you',
    facts: [
      {
        title: 'You own the record.',
        body: 'Export everything you’ve entered, any time, as files you can open anywhere. If you leave, it leaves with you.',
      },
      {
        title: 'Prices go where you say.',
        body: 'Each work has its own setting. Show a price to the public, to verified curators, or to no one at all.',
      },
      {
        title: 'One portfolio for every call.',
        body: 'Apply to open calls with the works already in your studio, so there’s no fresh upload and no new form to fill in each time a call opens.',
      },
    ],
  },
  collectors: {
    eyebrow: 'For collectors',
    title: 'Looking for work?',
    body: 'Browse what artists have chosen to show. Or tell Kofi what you’re after, whether that’s a size, a medium or a budget, and we’ll make the introduction.',
    browse: 'Browse works',
    ask: 'Ask Kofi',
  },
};
