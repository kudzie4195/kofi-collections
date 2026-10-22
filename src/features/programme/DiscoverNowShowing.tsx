import { Link } from 'react-router-dom';
import type { ArtworkView, Exhibition } from '@/domain/types';
import { exhibitionPhase } from '@/domain/programme';
import { LinkButton } from '@/ui';
import { ExhibitionVisual, PhaseEyebrow, workImage } from './shared';
import { formatDateRange } from './format';

/** Home: the current (or next) exhibition. Loaded lazily by DiscoverScreen. */
export function NowShowing({ ex, today, byId }: { ex: Exhibition; today: string; byId: Map<string, ArtworkView> }) {
  const works = ex.artworkIds.map((id) => byId.get(id)).filter((w): w is ArtworkView => !!w);
  const phase = exhibitionPhase(ex, today);
  return (
    <section className="kp-now" aria-labelledby="kp-now-title">
      <div className="container container--wide kp-now__inner">
        <Link to={`/exhibitions/${ex.id}`} className="kp-now__media" tabIndex={-1} aria-hidden="true">
          <ExhibitionVisual ex={ex} size="lg" fallback={workImage(works[0])} />
        </Link>
        <div className="kp-now__text">
          <PhaseEyebrow ex={ex} today={today} sample={ex.sample} />
          <h2 id="kp-now-title" className="kp-now__title">
            <Link to={`/exhibitions/${ex.id}`}>{ex.title}</Link>
          </h2>
          {ex.subtitle && <p className="kp-now__sub">{ex.subtitle}</p>}
          <p className="kp-meta kp-now__meta">
            {formatDateRange(ex.startsOn, ex.endsOn)}
            {ex.venue ? ` · ${ex.venue.name}, ${ex.venue.city}` : ''}
          </p>
          <p className="kp-now__summary">{ex.summary}</p>
          {works.length > 0 && (
            <ul className="kp-now__thumbs" aria-label="Works in the exhibition">
              {works.slice(0, 4).map((w) => {
                const im = workImage(w);
                return (
                  <li key={w.id}>
                    <Link to={`/work/${w.id}`} aria-label={`${w.title} by ${w.artistWorkingName}`}>
                      {im && <img src={im.src} alt="" loading="lazy" />}
                    </Link>
                  </li>
                );
              })}
              {works.length > 4 && <li className="kp-now__more">+{works.length - 4}</li>}
            </ul>
          )}
          <LinkButton to={`/exhibitions/${ex.id}`} tone="secondary">
            {phase === 'upcoming' ? 'Preview the exhibition' : 'Visit the exhibition'}
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
