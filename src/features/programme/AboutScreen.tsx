import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import bundledArt from 'virtual:bundled-art';
import { Button, Icon, LinkButton, SiteFooter, TopBar } from '@/ui';
import { CollectorInquirySheet } from './CollectorInquirySheet';

const photo: string = bundledArt['hero.jpg'] ?? '/art/hero.jpg';

const SERVICES: { id: string; title: string; tone: 'red' | 'gold' | 'green'; lede: string; items: string[]; cta: { to: string; label: string } }[] = [
  {
    id: 'artists',
    title: 'For artists',
    tone: 'red',
    lede: 'Kofi works for the artist first: buying work, opening doors to collectors, and building the materials that carry a practice forward.',
    items: [
      'Art purchases: Kofi buys work directly from artists.',
      'Professional appraisals, through qualified appraisers.',
      'Sales-strategy support: pricing, editions and where to show.',
      'Connections with collectors who are looking for new work.',
      'Curated exhibitions in Pittsburgh and with partner organisations.',
      'Development programmes: artwork photography, portfolio websites and guidance on your public profile.',
      'Nationwide exposure through Kofi’s network and programme.',
      'An open-source, artist-friendly seller’s contract with royalty and resale clauses.',
    ],
    cta: { to: '/calls', label: 'See open calls' },
  },
  {
    id: 'collectors',
    title: 'For collectors',
    tone: 'gold',
    lede: 'For people buying art, whether it is a first piece or a collection with a direction. Kofi facilitates; the artist stays in the picture.',
    items: [
      'Curated selections of work, chosen with you.',
      'Connections with the artists behind the work.',
      'A focus on emerging artists and underrepresented voices.',
      'Collecting with social impact: artists are paid fairly and credited.',
      'Early access to exhibitions and private viewings.',
      'Art placement consultations for your home.',
      'Transparent transactions under Kofi’s open-source contract.',
    ],
    cta: { to: '/works', label: 'Browse the works' },
  },
  {
    id: 'organisations',
    title: 'For organisations',
    tone: 'green',
    lede: 'For offices, public buildings, nonprofits and institutions that want art in their spaces, chosen with care and installed properly.',
    items: [
      'A curated selection for your space.',
      'Site assessment, installation and insurance.',
      'Flexible installation agreements, from a few months to a year or more, with rotation.',
      'Media and promotion around the work and the artists.',
      'Fair compensation for every participating artist.',
      'Theme development with your team.',
      'Targeted artist calls that prioritise emerging and underrepresented artists.',
      'Curatorial materials: plaques, QR codes, virtual tours and booklets.',
      'Evaluation and ongoing support after installation.',
    ],
    cta: { to: '/exhibitions', label: 'See past exhibitions' },
  },
];

export function AboutScreen() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    if (!loc.hash) return;
    const el = document.getElementById(loc.hash.slice(1));
    if (el) window.requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [loc.hash]);

  return (
    <div className="screen kp-page kp-about">
      <TopBar title="About" home subordinate />
      <main>
        <header className="container container--wide kp-about__head">
          <p className="eyebrow eyebrow--gold">Kofi Collections · Pittsburgh · Since 2024</p>
          <h1 className="kp-about__title">About Kofi Collections</h1>
          <div className="kp-about__intro">
            <p className="kp-about__mission">
              Kofi Collections is dedicated to <em>promoting and amplifying underrepresented voices</em> in the art world, and to uplifting emerging artists.
            </p>
            <div className="kp-about__side">
              <p>
                The collection celebrates the contributions of LGBTQ+, Black, Hispanic and Asian American communities, and works with artists, collectors and organisations to put that work in front of the people who should see it.
              </p>
              <p className="kp-about__founder">
                <span className="eyebrow">Founder</span>
                Founded in 2024 by Quincy Kofi Swatson.
              </p>
            </div>
          </div>
          <nav className="kp-about__jump" aria-label="Services">
            {SERVICES.map((s) => (
              <a key={s.id} href={`#/about#${s.id}`} className={`kp-about__jumplink kp-about__jumplink--${s.tone}`} onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}>
                {s.title}
                <Icon.ArrowRight />
              </a>
            ))}
          </nav>
        </header>

        <figure className="container container--wide kp-about__photo">
          <img src={photo} alt="An exhibition opening: visitors among paintings on easels in a high-ceilinged room" loading="lazy" />
          <figcaption className="kp-credit">A Kofi Collections exhibition opening · photograph from koficollections.org</figcaption>
        </figure>

        <div className="container container--wide kp-about__services">
          {SERVICES.map((s) => (
            <section key={s.id} id={s.id} className="kp-svc" aria-labelledby={`kp-svc-${s.id}`}>
              <div className="kp-svc__head">
                <h2 id={`kp-svc-${s.id}`} className={`section-title${s.tone === 'red' ? '' : ` section-title--${s.tone}`} kp-svc__title`}>
                  {s.title}
                </h2>
                <p className="kp-svc__lede">{s.lede}</p>
                <LinkButton to={s.cta.to} tone="secondary" size="sm">
                  {s.cta.label}
                </LinkButton>
              </div>
              <ul className="kp-svc__list">
                {s.items.map((it) => (
                  <li key={it}>
                    <span className="star" aria-hidden="true" />
                    {it}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="kp-about__note">Kofi does not estimate the value of artworks or promise returns. Appraisals are made by qualified appraisers, at the artist’s or owner’s request.</p>
        </div>

        <section className="kp-contact" aria-labelledby="kp-contact-title">
          <div className="container container--wide kp-contact__inner">
            <div>
              <p className="eyebrow eyebrow--gold">Contact</p>
              <h2 id="kp-contact-title" className="kp-contact__title">Talk to Kofi</h2>
              <p className="kp-contact__lede">Buying, commissioning, placing art in a building, or showing your own work: start with a note and the team will reply by email.</p>
              <Button onClick={() => setOpen(true)} aria-haspopup="dialog" icon={<Icon.Mail />}>
                Get in touch
              </Button>
            </div>
            <address className="kp-contact__card">
              <span className="eyebrow">Gallery</span>
              <span className="kp-contact__addr">
                213 Smithfield St.
                <br />
                Pittsburgh, PA 15222
              </span>
              <a href="mailto:info@koficollections.org">
                <Icon.Mail /> info@koficollections.org
              </a>
              <a href="tel:+14123907677">
                <Icon.Phone /> 412.390.7677
              </a>
            </address>
          </div>
        </section>
        <p className="container container--wide kp-credit kp-about__credit">Artwork photography © the artists, via koficollections.org. Opening-night photograph © Kofi Collections.</p>
      </main>
      <SiteFooter />
      <CollectorInquirySheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
