/**
 * What the mock "reads" at a link. Mock mode cannot fetch pages, so the sample
 * artists' public links have a canned copy of what Kofi's reader would find
 * there: the PageSignals the import uses, and `pageText` (the visible text,
 * incl. the bio) that the link check searches for the artist's code.
 *
 * Any link that is not here is "unknown": the import falls back to the handle
 * and the link check marks it 'unreachable'. All content is fictional; the
 * photo URLs are illustrative and do not resolve, so the UI must fall back to
 * initials when a suggested photo fails to load.
 *
 * Keys are `normalizeLink(url).url` with a leading "www." removed from the host,
 * so "@mara.paints", "instagram.com/mara.paints" and
 * "https://www.instagram.com/mara.paints/" all find the same page.
 */
import { normalizeLink, type PageSignals } from '@/domain/intake';

export interface PageFixture {
  signals: PageSignals;
  /** Everything a visitor can read on the page. The link check searches this for the code. */
  pageText: string;
}

/** Seed artists' codes (also used by seed.ts). Fixed so the fixtures can carry them. */
export const SEED_TOKENS = {
  art_mara: 'kofi-7f3a2k',
  art_tobias: 'kofi-tr9c6m',
  art_june: 'kofi-jw4b8t',
  art_deshawn: 'kofi-df5n7q',
  art_priya: 'kofi-pv3h8x',
} as const;

/** The sample artists' public links, as the seed stores them. */
export const SAMPLE_LINKS = {
  maraInstagram: 'https://www.instagram.com/mara.paints',
  maraWebsite: 'https://www.mara-oyelaran.com',
  maraLinkedIn: 'https://www.linkedin.com/in/mara-oyelaran',
  juneInstagram: 'https://www.instagram.com/june.weaves',
  deshawnInstagram: 'https://www.instagram.com/deshawn.nightshift',
  priyaWebsite: 'https://www.priyavenkataraman.art',
  priyaLinkedIn: 'https://www.linkedin.com/in/priya-venkataraman',
} as const;

const MARA_IG_BIO = 'Oil painter. Pittsburgh. The hour after a storm, mostly. Studio in an old print shop.';

const FIXTURES: Record<string, PageFixture> = {
  /* Mara: Instagram serves og tags (name, counts, bio, photo); her code is in the bio. */
  [SAMPLE_LINKS.maraInstagram]: {
    signals: {
      title: 'Mara Oyelaran (@mara.paints) • Instagram photos and videos',
      ogTitle: 'Mara Oyelaran (@mara.paints) • Instagram photos and videos',
      ogDescription: `2,431 Followers, 388 Following, 214 Posts - Mara Oyelaran (@mara.paints) on Instagram: "${MARA_IG_BIO}"`,
      ogImage: 'https://scontent.cdninstagram.com/v/mara.paints/profile_320.jpg',
      links: [SAMPLE_LINKS.maraWebsite],
    },
    pageText: `mara.paints Mara Oyelaran 214 posts 2,431 followers 388 following ${MARA_IG_BIO} Kofi: ${SEED_TOKENS.art_mara} mara-oyelaran.com`,
  },
  /* Mara: her own site has JSON-LD Person (best case) incl. where she is based. No code on it. */
  [SAMPLE_LINKS.maraWebsite]: {
    signals: {
      title: 'Mara Oyelaran — Painter, Pittsburgh',
      ogTitle: 'Mara Oyelaran — Painter, Pittsburgh',
      ogDescription: 'Large-format oil paintings of the city after rain.',
      ogImage: 'https://www.mara-oyelaran.com/images/og-studio.jpg',
      jsonLd: {
        name: 'Mara Oyelaran',
        description:
          'Mara Oyelaran is a painter working from a converted print shop in Pittsburgh. She builds large oil paintings in thin, repeated glazes until the colour reads as light rather than pigment.',
        image: 'https://www.mara-oyelaran.com/images/mara-oyelaran-portrait.jpg',
        address: { addressLocality: 'Pittsburgh', addressRegion: 'Pennsylvania', addressCountry: 'United States' },
        sameAs: [SAMPLE_LINKS.maraInstagram, SAMPLE_LINKS.maraLinkedIn],
      },
      links: [SAMPLE_LINKS.maraInstagram],
    },
    pageText: 'Mara Oyelaran. Paintings. Drawings. About. Contact. Large-format oil paintings of the city after rain. Studio visits by appointment.',
  },
  /* June: og tags only, code in the bio. */
  [SAMPLE_LINKS.juneInstagram]: {
    signals: {
      ogTitle: 'June Takahashi-Bell (@june.weaves) • Instagram photos and videos',
      ogDescription: '612 Followers, 290 Following, 48 Posts - June Takahashi-Bell (@june.weaves) on Instagram: "Weaver. Reclaimed thread, hand-dyed wool. Ottawa. Please touch the work."',
      ogImage: 'https://scontent.cdninstagram.com/v/june.weaves/profile_320.jpg',
    },
    pageText: `june.weaves June Takahashi-Bell 48 posts 612 followers Weaver. Reclaimed thread, hand-dyed wool. Ottawa. Please touch the work. ${SEED_TOKENS.art_june}`,
  },
  /* DeShawn: Instagram gave a title and counts but no bio; no code on the page (check → failed). */
  [SAMPLE_LINKS.deshawnInstagram]: {
    signals: {
      ogTitle: 'DeShawn Ferris (@deshawn.nightshift) • Instagram photos and videos',
      ogDescription: '1.2K Followers, 501 Following, 133 Posts - See Instagram photos and videos from DeShawn Ferris (@deshawn.nightshift)',
    },
    pageText: 'deshawn.nightshift DeShawn Ferris 133 posts 1.2K followers Night shift, Philadelphia.',
  },
  /* Priya: a plain site with og tags and her code in the footer. */
  [SAMPLE_LINKS.priyaWebsite]: {
    signals: {
      title: 'Priya Venkataraman | Prints',
      ogTitle: 'Priya Venkataraman | Prints',
      ogDescription: 'Screen prints that start as code and end as ink. Editions made in Pittsburgh.',
      links: ['https://www.instagram.com/priya.pulls'],
    },
    pageText: `Priya Venkataraman. Prints. Editions. Screen prints that start as code and end as ink. Verified on Kofi Collections: ${SEED_TOKENS.art_priya}`,
  },
};

/** Lookup key: the normalized URL, lower-cased, without "www.". */
export function fixtureKey(raw: string): string | undefined {
  const n = normalizeLink(raw);
  if (!n) return undefined;
  return n.url.toLowerCase().replace(/^https:\/\/www\./, 'https://');
}

const BY_KEY = new Map<string, PageFixture>(Object.entries(FIXTURES).map(([url, f]) => [fixtureKey(url)!, f]));

/** The canned page for a link, or undefined when mock mode cannot "read" it. */
export function fixtureFor(raw: string): PageFixture | undefined {
  const key = fixtureKey(raw);
  return key ? BY_KEY.get(key) : undefined;
}

/** The public Kofi profile URL a page may link back to (rel=me style verification). */
export const KOFI_PROFILE_BASE = 'https://app.koficollections.org/#/artists/';
