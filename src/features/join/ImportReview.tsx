import { useEffect, useRef, useState } from 'react';
import type { ArtistLink, ArtistView, ProfileImport, ProfileImportFields, ProfileImportRecord } from '@/domain/types';
import { platformName } from '@/domain/intake';
import type { ArtistPatch } from '@/data/DataSource';
import { Button, Icon, inkFor } from '@/ui';
import { PlatformIcon } from './PlatformIcon';
import { copy } from './copy';

const c = copy.links.review;

export type SuggestionKey = 'workingName' | 'bio' | 'location';
const ORDER: SuggestionKey[] = ['workingName', 'location', 'bio'];

export interface Suggestion {
  key: SuggestionKey;
  /** What the review card shows. */
  value: string;
  /** Index into the imports array of the winning source. */
  from: number;
  confidence: number;
  location?: { city?: string; region?: string; country?: string };
}

/** A photo a page offered. Shown, never applied: profiles have no photo field yet. */
export interface FoundPhoto {
  src: string;
  from: number;
}

/** What the profile holds now, per field, as the review card would print it. */
export type CurrentValues = Partial<Record<SuggestionKey, string>>;

/** The mock and the server both refuse a bio under 20 characters; such a suggestion is not offered. */
const MIN_BIO = 20;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? url;
  }
}

/** "from mara-oyelaran.com" / "from Instagram @mara.paints". */
export function sourceName(link: ArtistLink): string {
  const p = link.platform ?? 'other';
  if (p === 'website') return hostOf(link.url);
  if (p === 'other') return link.handle || link.label || hostOf(link.url);
  return link.handle ? `${platformName(p)} ${link.handle}` : platformName(p);
}

/** The profile's current values in the shape the review card compares against. */
export function currentValues(artist: Pick<ArtistView, 'workingName' | 'bio' | 'region'>): CurrentValues {
  const r = artist.region;
  return {
    workingName: artist.workingName?.trim() ?? '',
    bio: artist.bio?.trim() ?? '',
    location: r ? [r.city, r.region, r.country].map((x) => x?.trim()).filter(Boolean).join(', ') : '',
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** True when ticking the suggestion would overwrite something the artist already has. */
export function replaces(s: Suggestion, current: CurrentValues): string | undefined {
  const cur = current[s.key]?.trim();
  return cur && !same(cur, s.value) ? cur : undefined;
}

/** Ticked by default: suggestions for empty fields. One that would replace a value starts unticked. */
export function defaultTicks(suggestions: Suggestion[], current: CurrentValues): Set<SuggestionKey> {
  return new Set(suggestions.filter((s) => !replaces(s, current)).map((s) => s.key));
}

/**
 * Merge several imports into one suggestion per field: the highest confidence wins
 * (ties go to the earlier link). Links found on the pages are pooled, minus the ones
 * the artist already has. A photo is reported separately; it is never applied.
 */
export function mergeImports(imports: ProfileImport[], existing: ArtistLink[]): { suggestions: Suggestion[]; photo?: FoundPhoto; found: ArtistLink[] } {
  const best = new Map<SuggestionKey, Suggestion>();
  let photo: (FoundPhoto & { confidence: number }) | undefined;
  const offer = (s: Suggestion) => {
    const cur = best.get(s.key);
    if (!cur || s.confidence > cur.confidence) best.set(s.key, s);
  };
  imports.forEach((imp, i) => {
    const f = imp.fields;
    const conf = (k: keyof ProfileImportFields, dflt = 0.5) => imp.confidence[k] ?? dflt;
    if (f.workingName?.trim()) offer({ key: 'workingName', value: f.workingName.trim(), from: i, confidence: conf('workingName') });
    if (f.bio && f.bio.trim().length >= MIN_BIO) offer({ key: 'bio', value: f.bio.trim(), from: i, confidence: conf('bio') });
    if (f.photoUrl && (!photo || conf('photoUrl') > photo.confidence)) photo = { src: f.photoUrl, from: i, confidence: conf('photoUrl') };
    if (f.city || f.region || f.country) {
      const location = { city: f.city, region: f.region, country: f.country };
      offer({ key: 'location', value: [f.city, f.region, f.country].filter(Boolean).join(', '), from: i, confidence: conf('city'), location });
    }
  });
  const have = new Set(existing.map((l) => l.url.toLowerCase()));
  const found: ArtistLink[] = [];
  for (const imp of imports) {
    for (const l of imp.fields.links ?? []) {
      const k = l.url.toLowerCase();
      if (have.has(k)) continue;
      have.add(k);
      found.push(l);
    }
  }
  return {
    suggestions: ORDER.map((k) => best.get(k)).filter((s): s is Suggestion => !!s),
    ...(photo ? { photo: { src: photo.src, from: photo.from } } : {}),
    found,
  };
}

/**
 * What "Use these" writes: a profile patch with only the ticked fields, and one import
 * record per link that was read (fields applied from that link, possibly none).
 * A photo is never part of it.
 */
export function buildApply(imports: ProfileImport[], suggestions: Suggestion[], ticked: Set<SuggestionKey>, artist: Pick<ArtistView, 'region'>): { patch: ArtistPatch; records: ProfileImportRecord[] } {
  const patch: ArtistPatch = {};
  const applied = new Map<number, (keyof ProfileImportFields)[]>();
  const note = (i: number, ...keys: (keyof ProfileImportFields)[]) => applied.set(i, [...(applied.get(i) ?? []), ...keys]);
  for (const s of suggestions) {
    if (!ticked.has(s.key)) continue;
    if (s.key === 'workingName') {
      patch.workingName = s.value;
      note(s.from, 'workingName');
    } else if (s.key === 'bio') {
      patch.bio = s.value;
      note(s.from, 'bio');
    } else if (s.key === 'location' && s.location) {
      const cur = artist.region ?? { region: '', country: '', precision: 'region' as const };
      const city = s.location.city ?? cur.city;
      patch.region = {
        region: s.location.region ?? cur.region,
        country: s.location.country ?? cur.country,
        precision: cur.precision,
        ...(city ? { city } : {}),
      };
      note(s.from, ...(['city', 'region', 'country'] as const).filter((k) => s.location![k]));
    }
  }
  const records = imports.map((imp, i) => ({ source: imp.source, fetchedAt: imp.fetchedAt, appliedFields: applied.get(i) ?? [], notes: imp.notes }));
  return { patch, records };
}

/** True when the links gave us nothing beyond a name guessed from a handle. */
export function isThin(suggestions: Suggestion[]): boolean {
  return suggestions.every((s) => s.key === 'workingName' && s.confidence <= 0.3);
}

/** The suggested photo, or the initials when it does not load (demo placeholders never do). */
function SuggestedPhoto({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    const initials = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
    return (
      <span className="kj-sugg__initials" style={{ background: 'var(--gold)', color: inkFor('#e3b23c') }} aria-hidden="true">
        {initials || '?'}
      </span>
    );
  }
  return <img src={src} alt="" width={56} height={56} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

const LABEL: Record<SuggestionKey, string> = { workingName: c.workingName, bio: c.bio, location: c.location };

export function ImportReview({
  imports,
  suggestions,
  photo,
  found,
  current = {},
  busy,
  onUse,
  onSkip,
  onAddFound,
}: {
  imports: ProfileImport[];
  suggestions: Suggestion[];
  photo?: FoundPhoto;
  found: ArtistLink[];
  /** What the profile holds now: a suggestion that would replace it starts unticked. */
  current?: CurrentValues;
  busy?: boolean;
  onUse: (ticked: Set<SuggestionKey>) => void;
  onSkip: () => void;
  onAddFound: (link: ArtistLink) => void;
}) {
  const [ticked, setTicked] = useState<Set<SuggestionKey>>(() => defaultTicks(suggestions, current));
  const toggle = (k: SuggestionKey) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const thin = isThin(suggestions) && !photo;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);
  const photoName = suggestions.find((x) => x.key === 'workingName')?.value ?? current.workingName ?? '';

  return (
    <section className="kj-review" aria-labelledby="kj-review-title" ref={ref}>
      <h2 id="kj-review-title" className="kj-review__title">
        {c.title}
      </h2>
      {suggestions.length > 0 && <p className="kj-review__lede">{c.lede}</p>}
      {thin && <p className="kj-review__thin">{c.thin}</p>}
      {suggestions.length > 0 && (
        <ul className="kj-sugg">
          {suggestions.map((s) => {
            const src = sourceName(imports[s.from]!.source);
            const was = replaces(s, current);
            const hintId = `kj-sugg-was-${s.key}`;
            return (
              <li key={s.key} className="kj-sugg__row">
                <label className="kj-tick">
                  <input type="checkbox" checked={ticked.has(s.key)} onChange={() => toggle(s.key)} aria-describedby={was ? hintId : undefined} />
                  <span className="kj-sugg__body">
                    <span className="kj-sugg__label">
                      {LABEL[s.key]} <span className="kj-sugg__src">· {c.from(src)}</span>
                    </span>
                    <span className={s.key === 'bio' ? 'kj-sugg__value kj-sugg__value--bio' : 'kj-sugg__value'}>{s.value}</span>
                    {was && (
                      <span className="kj-sugg__was" id={hintId}>
                        {c.replaces(was)}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {photo && (
        <p className="kj-sugg__photo" data-testid="found-photo">
          <SuggestedPhoto src={photo.src} name={photoName || sourceName(imports[photo.from]!.source)} />
          <span className="kj-sugg__note">{c.photoFound}</span>
        </p>
      )}
      {found.length > 0 && (
        <div className="kj-found">
          <span className="kj-found__label">{c.alsoFound}</span>
          <div className="chips">
            {found.map((l) => (
              <button key={l.url} type="button" className="chip kj-found__chip" onClick={() => onAddFound(l)} aria-label={c.addFound(l.label)}>
                <PlatformIcon platform={l.platform} width={14} height={14} />
                {l.label}
                <Icon.Plus width={14} height={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="kj-actions">
        {suggestions.length > 0 ? (
          <>
            <Button onClick={() => onUse(ticked)} loading={busy}>
              {c.use}
            </Button>
            <Button tone="ghost" onClick={onSkip} disabled={busy}>
              {c.skip}
            </Button>
          </>
        ) : (
          <Button onClick={onSkip}>{c.continue}</Button>
        )}
      </div>
    </section>
  );
}
