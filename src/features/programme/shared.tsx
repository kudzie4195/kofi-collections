/**
 * Building blocks shared by the public programme screens (Discover, Exhibitions,
 * Open calls, Journal, What's on). Presentational; data comes from the screens.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ArtworkView, Exhibition, OpenCall, ProgrammeEvent, ProgrammeImage, Story } from '@/domain/types';
import { callPhase, daysLeft, exhibitionPhase, kofiToday } from '@/domain/programme';
import { Icon } from '@/ui';
import {
  CALL_PHASE_LABEL,
  deadlineLabel,
  EVENT_KIND_LABEL,
  EXHIBITION_PHASE_LABEL,
  eventDateParts,
  formatDateRange,
  formatDay,
  formatEventTime,
  STORY_KIND_LABEL,
} from './format';

/** Kofi's calendar day, computed once per render tree. */
export function useToday(): string {
  return useMemo(() => kofiToday(), []);
}

export function SampleTag() {
  return (
    <span className="kp-sample" title="Fictional demo content">
      Sample
    </span>
  );
}

/** Only render image sources the browser can load directly. */
export function imageSrc(img: ProgrammeImage | undefined): string | undefined {
  if (!img) return undefined;
  const s = img.src.trim();
  return /^(data:image\/|\/|https?:\/\/|blob:)/i.test(s) ? s : undefined;
}

export function workImage(w: ArtworkView | undefined): ProgrammeImage | undefined {
  const im = w ? (w.images.find((i) => i.isPrimary) ?? w.images[0]) : undefined;
  return im ? { src: im.src, alt: im.alt, credit: w!.artistWorkingName } : undefined;
}

/**
 * Typographic poster for programme items without a photograph: black panel, the
 * three brush strokes, the title set huge in the serif, dates in tracked caps.
 */
export function Poster({ title, kicker, meta, size = 'md', className = '' }: { title: string; kicker?: string; meta?: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div className={`kp-poster kp-poster--${size} ${className}`} role="img" aria-label={`${title}${meta ? `, ${meta}` : ''}`}>
      <span className="kp-poster__strokes" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {kicker && (
        <span className="kp-poster__kicker" aria-hidden="true">
          {kicker}
        </span>
      )}
      <span className="kp-poster__title" aria-hidden="true">
        {title}
      </span>
      {meta && (
        <span className="kp-poster__meta" aria-hidden="true">
          {meta}
        </span>
      )}
      <span className="star kp-poster__star" aria-hidden="true" />
    </div>
  );
}

/** Exhibition photograph, or its poster. */
export function ExhibitionVisual({ ex, size = 'md', fallback }: { ex: Exhibition; size?: 'sm' | 'md' | 'lg'; fallback?: ProgrammeImage }) {
  const img = ex.image ?? fallback;
  const src = imageSrc(img);
  if (src && img) {
    return (
      <figure className={`kp-visual kp-visual--${size}`}>
        <img src={src} alt={img.alt} loading="lazy" />
      </figure>
    );
  }
  return <Poster title={ex.title} kicker="Kofi Collections" meta={formatDateRange(ex.startsOn, ex.endsOn)} size={size} />;
}

export function PhaseEyebrow({ ex, today, sample }: { ex: Exhibition; today: string; sample?: boolean }) {
  const phase = exhibitionPhase(ex, today);
  return (
    <p className="kp-eyebrow-row">
      <span className={`eyebrow kp-phase kp-phase--${phase}`}>{EXHIBITION_PHASE_LABEL[phase]}</span>
      {sample && <SampleTag />}
    </p>
  );
}

export function ExhibitionCard({ ex, today, feature }: { ex: Exhibition; today: string; feature?: boolean }) {
  return (
    <Link to={`/exhibitions/${ex.id}`} className={`kp-excard ${feature ? 'kp-excard--feature' : ''}`}>
      <ExhibitionVisual ex={ex} size={feature ? 'lg' : 'md'} />
      <div className="kp-excard__body">
        <PhaseEyebrow ex={ex} today={today} sample={ex.sample} />
        <h3 className="kp-excard__title">{ex.title}</h3>
        {ex.subtitle && <p className="kp-excard__sub">{ex.subtitle}</p>}
        <p className="kp-meta">
          {formatDateRange(ex.startsOn, ex.endsOn)}
          {ex.venue ? ` · ${ex.venue.name}` : ''}
        </p>
        {feature && <p className="kp-excard__summary">{ex.summary}</p>}
      </div>
    </Link>
  );
}

/** Compact exhibition line for lists (What's on). */
export function ExhibitionRow({ ex, today }: { ex: Exhibition; today: string }) {
  const img = imageSrc(ex.image);
  return (
    <Link to={`/exhibitions/${ex.id}`} className="kp-row">
      <span className="kp-row__thumb">{img ? <img src={img} alt="" loading="lazy" /> : <Poster title={ex.title} size="sm" />}</span>
      <span className="kp-row__main">
        <PhaseEyebrow ex={ex} today={today} sample={ex.sample} />
        <span className="kp-row__title">{ex.title}</span>
        <span className="kp-meta">{formatDateRange(ex.startsOn, ex.endsOn)}</span>
      </span>
      <Icon.ArrowRight className="kp-row__go" />
    </Link>
  );
}

/** "Closes in 41 days" — red when a week or less is left. */
export function DeadlineBadge({ call, today, large }: { call: OpenCall; today: string; large?: boolean }) {
  const phase = callPhase(call, today);
  const n = daysLeft(call, today);
  const urgent = phase === 'open' && n !== undefined && n <= 7;
  const cls = ['kp-deadline', `kp-deadline--${phase}`, urgent && 'kp-deadline--urgent', large && 'kp-deadline--lg'].filter(Boolean).join(' ');
  return (
    <span className={cls} data-urgent={urgent || undefined}>
      {phase === 'open' && <span className="kp-deadline__dot" aria-hidden="true" />}
      {deadlineLabel(call, today)}
    </span>
  );
}

export function CallCard({ call, today }: { call: OpenCall; today: string }) {
  const phase = callPhase(call, today);
  return (
    <Link to={`/calls/${call.id}`} className={`kp-callcard kp-callcard--${phase}`}>
      <div className="kp-callcard__top">
        <p className="kp-eyebrow-row">
          <span className="eyebrow">{call.partner ?? 'Kofi Collections'}</span>
          {call.sample && <SampleTag />}
        </p>
        <DeadlineBadge call={call} today={today} />
      </div>
      <h3 className="kp-callcard__title">{call.title}</h3>
      <p className="kp-callcard__summary">{call.summary}</p>
      <ul className="kp-callcard__facts">
        <li>{call.mediums.length ? call.mediums.map((m) => m[0]!.toUpperCase() + m.slice(1)).join(', ') : 'Any medium'}</li>
        <li>
          Up to {call.maxWorks} {call.maxWorks === 1 ? 'work' : 'works'}
        </li>
        <li>{call.fee}</li>
        {call.externalUrl && <li>Partner form ↗</li>}
      </ul>
      <span className="kp-callcard__go">
        {phase === 'closed' ? 'Read the call' : 'Read the call and apply'}
        <Icon.ArrowRight />
      </span>
    </Link>
  );
}

/** Compact call line for lists (What's on). */
export function CallRow({ call, today }: { call: OpenCall; today: string }) {
  return (
    <Link to={`/calls/${call.id}`} className="kp-row kp-row--text">
      <span className="kp-row__main">
        <span className="kp-eyebrow-row">
          <span className="eyebrow">{CALL_PHASE_LABEL[callPhase(call, today)]}</span>
          {call.sample && <SampleTag />}
        </span>
        <span className="kp-row__title">{call.title}</span>
        <span className="kp-meta">
          {call.partner ? `${call.partner} · ` : ''}
          {deadlineLabel(call, today)}
        </span>
      </span>
      <Icon.ArrowRight className="kp-row__go" />
    </Link>
  );
}

export function DateBlock({ startsAt }: { startsAt: string }) {
  const p = eventDateParts(startsAt);
  return (
    <span className="kp-dateblock" aria-hidden="true">
      <span className="kp-dateblock__m">{p.month}</span>
      <span className="kp-dateblock__d">{p.day}</span>
      <span className="kp-dateblock__w">{p.weekday}</span>
    </span>
  );
}

export function EventRow({ ev, exhibitionTitle, past, link = true }: { ev: ProgrammeEvent; exhibitionTitle?: string; past?: boolean; link?: boolean }) {
  const body = (
    <>
      <DateBlock startsAt={ev.startsAt} />
      <span className="kp-event__main">
        <span className="kp-eyebrow-row">
          <span className="eyebrow eyebrow--gold">{EVENT_KIND_LABEL[ev.kind]}</span>
          {ev.sample && <SampleTag />}
        </span>
        <span className="kp-event__title">{ev.title}</span>
        <span className="kp-meta">
          {formatEventTime(ev.startsAt, ev.endsAt)}
          {ev.venue ? ` · ${ev.venue.name}${ev.venue.address ? `, ${ev.venue.address}` : ''}` : ''}
        </span>
        {!past && <span className="kp-event__summary">{ev.summary}</span>}
        {exhibitionTitle && <span className="kp-event__ex">Part of {exhibitionTitle}</span>}
      </span>
    </>
  );
  const cls = `kp-event ${past ? 'kp-event--past' : ''}`;
  if (link && ev.exhibitionId) {
    return (
      <Link to={`/exhibitions/${ev.exhibitionId}`} className={cls}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

export function StoryCard({ story, image, lead }: { story: Story; image?: ProgrammeImage; lead?: boolean }) {
  const img = story.image ?? image;
  const src = imageSrc(img);
  return (
    <Link to={`/journal/${story.id}`} className={`kp-story ${lead ? 'kp-story--lead' : ''}`}>
      {src && img ? (
        <figure className="kp-story__img">
          <img src={src} alt={img.alt} loading="lazy" />
        </figure>
      ) : (
        <Poster title={story.title} kicker={STORY_KIND_LABEL[story.kind]} meta={formatDay(story.publishedOn)} size={lead ? 'lg' : 'md'} className="kp-story__poster" />
      )}
      <div className="kp-story__body">
        <p className="kp-eyebrow-row">
          <span className="eyebrow eyebrow--gold">{STORY_KIND_LABEL[story.kind]}</span>
          {story.sample && <SampleTag />}
        </p>
        <h3 className="kp-story__title">{story.title}</h3>
        <p className="kp-story__dek">{story.dek}</p>
        <p className="kp-meta">
          {story.author} · {formatDay(story.publishedOn)}
        </p>
      </div>
    </Link>
  );
}

/** Compact story line for lists (What's on). */
export function StoryRow({ story }: { story: Story }) {
  return (
    <Link to={`/journal/${story.id}`} className="kp-row kp-row--text">
      <span className="kp-row__main">
        <span className="kp-eyebrow-row">
          <span className="eyebrow eyebrow--gold">{STORY_KIND_LABEL[story.kind]}</span>
          {story.sample && <SampleTag />}
        </span>
        <span className="kp-row__title">{story.title}</span>
        <span className="kp-meta">{formatDay(story.publishedOn)}</span>
      </span>
      <Icon.ArrowRight className="kp-row__go" />
    </Link>
  );
}

/** Editorial page header: eyebrow, serif h1, lede, optional aside (counts, controls). */
export function PageHead({ eyebrow, title, lede, aside }: { eyebrow: string; title: string; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="kp-head">
      <div className="kp-head__main">
        <p className="eyebrow kp-head__eyebrow">{eyebrow}</p>
        <h1 className="kp-head__title">{title}</h1>
      </div>
      {(lede || aside) && (
        <div className="kp-head__side">
          {lede && <p className="kp-head__lede">{lede}</p>}
          {aside}
        </div>
      )}
    </header>
  );
}

/** Section title with the brush rule and an optional "see all" link. */
export function SectionHead({ id, title, eyebrow, to, linkLabel, tone = 'red' }: { id: string; title: string; eyebrow?: string; to?: string; linkLabel?: string; tone?: 'red' | 'gold' | 'green' }) {
  return (
    <div className="kp-sechead">
      <div>
        {eyebrow && <p className="eyebrow kp-sechead__eyebrow">{eyebrow}</p>}
        <h2 id={id} className={`kp-sechead__title kp-sechead__title--${tone}`}>
          {title}
        </h2>
      </div>
      {to && (
        <Link to={to} className="kp-more">
          {linkLabel ?? 'See all'}
          <Icon.ArrowRight />
        </Link>
      )}
    </div>
  );
}

/** Group a list by a key, keeping first-seen order. */
export function groupBy<T>(list: T[], key: (t: T) => string): { key: string; items: T[] }[] {
  const out: { key: string; items: T[] }[] = [];
  for (const item of list) {
    const k = key(item);
    const g = out.find((x) => x.key === k);
    if (g) g.items.push(item);
    else out.push({ key: k, items: [item] });
  }
  return out;
}
