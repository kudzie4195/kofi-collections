/**
 * TagPicker — choose controlled tags (stable ids) for a work, or for an organiser's
 * "Looking for" criteria. Labels and definitions render verbatim from the library.
 *
 *   mode 'work'      caps per category (6, Social Impact 4) with the same messages as
 *                    normalizeTagIds; `lockedMedium`'s tag shows as on (counts toward the
 *                    medium cap) and is left out of onChange — the data layer mirrors it.
 *   mode 'criteria'  no caps, no lock.
 *
 * Chip styles live in ./tags.css (`.tagchip`, `.tagchip[aria-pressed='true']`) so the
 * gallery filters can share them.
 */
import { useId, useMemo, useState } from 'react';
import type { Medium } from '@/domain/types';
import {
  ARTIST_TAG_CATEGORIES,
  MAX_SOCIAL_IMPACT_TAGS,
  MAX_TAGS_PER_CATEGORY,
  SOCIAL_IMPACT_BOUNDARY,
  SOCIAL_IMPACT_NOTE,
  categoryLabel,
  categoryOf,
  mediumTagId,
  selectableTags,
  tagLabel,
  type ArtistTagCategory,
} from '@/domain/taxonomy';
import { TAG_COPY } from './tagCopy';
import './tags.css';

/** Chips shown before "Show all" on narrow screens (CSS hides the rest below 900px). */
export const COLLAPSE_AFTER = 8;

export interface TagPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  categories?: readonly ArtistTagCategory[];
  mode?: 'work' | 'criteria';
  lockedMedium?: Medium;
  compact?: boolean;
  search?: boolean;
  /** Optional per-category errors, keyed by category id (e.g. from a `tags.style` ValidationError). */
  problems?: Partial<Record<string, string>>;
  /** Accessible name for the whole picker. */
  label?: string;
}

export function capFor(category: string): number {
  return category === 'social_impact' ? MAX_SOCIAL_IMPACT_TAGS : MAX_TAGS_PER_CATEGORY;
}

/** Same wording as normalizeTagIds' problem message. */
export function capMessage(category: string): string {
  return `Pick up to ${capFor(category)} ${categoryLabel(category).toLowerCase()} tags.`;
}

export function TagPicker({
  value,
  onChange,
  categories = ARTIST_TAG_CATEGORIES,
  mode = 'work',
  lockedMedium,
  compact = false,
  search,
  problems,
  label = TAG_COPY.sectionTitle,
}: TagPickerProps) {
  const uid = useId();
  const showSearch = search ?? !compact;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [capHit, setCapHit] = useState<string | undefined>();
  const lockedId = mode === 'work' && lockedMedium ? mediumTagId(lockedMedium) : undefined;

  const selected = useMemo(() => {
    const s = new Set(value);
    if (lockedId) s.add(lockedId);
    return s;
  }, [value, lockedId]);

  const q = query.trim().toLowerCase();

  function toggle(id: string) {
    if (id === lockedId) return;
    const cat = categoryOf(id);
    if (selected.has(id)) {
      setCapHit(undefined);
      onChange(emit([...selected].filter((x) => x !== id)));
      return;
    }
    if (mode === 'work') {
      const inCat = [...selected].filter((x) => categoryOf(x) === cat).length;
      if (inCat >= capFor(cat)) {
        setCapHit(cat);
        return;
      }
    }
    setCapHit(undefined);
    onChange(emit([...selected, id]));
  }

  /**
   * Keep the caller's order and append new ids. The locked medium is shown as on but never
   * emitted: the data layer mirrors the primary medium (normalizeTagIds), so changing the
   * medium elsewhere never leaves a stale medium tag behind.
   */
  function emit(ids: string[]): string[] {
    const want = new Set(ids);
    if (lockedId) want.delete(lockedId);
    const kept = value.filter((x) => want.has(x));
    for (const x of want) if (!kept.includes(x)) kept.push(x);
    return kept;
  }

  const sections = categories.map((cat) => {
    const all = selectableTags(cat);
    const shown = q ? all.filter((t) => t.label.toLowerCase().includes(q)) : all;
    return { cat, all, shown };
  });
  const anyShown = sections.some((s) => s.shown.length > 0);

  return (
    <div className={`tagpicker${compact ? ' tagpicker--compact' : ''}`} role="group" aria-label={label} data-mode={mode}>
      {showSearch && (
        <div className="tagpicker__search">
          <label className="field__label" htmlFor={`${uid}-q`}>
            {TAG_COPY.searchLabel}
          </label>
          <div className="tagpicker__searchrow">
            <input
              id={`${uid}-q`}
              className="input"
              type="search"
              value={query}
              placeholder={TAG_COPY.searchPlaceholder}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="tagpicker__clear" onClick={() => setQuery('')}>
                {TAG_COPY.clearSearch}
              </button>
            )}
          </div>
        </div>
      )}
      {q && !anyShown && (
        <p className="small muted" role="status">
          {TAG_COPY.noMatch(query.trim())}
        </p>
      )}
      {sections.map(({ cat, all, shown }) => {
        if (q && shown.length === 0) return null;
        const n = all.filter((t) => selected.has(t.id)).length;
        const headId = `${uid}-${cat}`;
        const isOpen = !!expanded[cat] || !!q;
        const collapsible = !q && all.length > COLLAPSE_AFTER;
        const problem = problems?.[cat] || (capHit === cat ? capMessage(cat) : undefined);
        const isSocial = cat === 'social_impact';
        return (
          <section key={cat} className="tagsection" role="group" aria-label={`${TAG_COPY.sectionTitle}: ${categoryLabel(cat)}`} data-category={cat} data-expanded={isOpen ? 'true' : undefined}>
            <div className="tagsection__head">
              <h3 className="tagsection__title" id={headId}>
                {categoryLabel(cat)}
              </h3>
              {(n > 0 || mode === 'work') && (
                <span className="tagsection__count" data-testid={`tagcount-${cat}`}>
                  {mode === 'work' ? TAG_COPY.count(n, capFor(cat)) : TAG_COPY.countFree(n)}
                </span>
              )}
            </div>
            {cat === 'medium' && lockedId && <p className="tagsection__lede">{TAG_COPY.lockedHint(tagLabel(lockedId))}</p>}
            {isSocial && (
              <div className="tagsection__lede">
                <p>{SOCIAL_IMPACT_NOTE}.</p>
                <p className="tagsection__boundary">
                  {SOCIAL_IMPACT_BOUNDARY} {mode === 'work' ? TAG_COPY.socialChange : ''}
                </p>
              </div>
            )}
            <div className="tagchips">
              {shown.map((t, i) => {
                const on = selected.has(t.id);
                const locked = t.id === lockedId;
                const extra = collapsible && i >= COLLAPSE_AFTER && !on;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`tagchip${locked ? ' tagchip--locked' : ''}${extra ? ' tagchip--extra' : ''}`}
                    aria-pressed={on}
                    aria-disabled={locked || undefined}
                    title={locked ? `${TAG_COPY.lockedTitle}. ${t.definition}` : t.definition}
                    data-tag={t.id}
                    onClick={() => toggle(t.id)}
                  >
                    {t.label}
                    {locked && <span className="sr-only"> ({TAG_COPY.lockedTitle.toLowerCase()})</span>}
                  </button>
                );
              })}
            </div>
            {collapsible && (
              <button type="button" className="tagsection__more" aria-expanded={isOpen} onClick={() => setExpanded((e) => ({ ...e, [cat]: !e[cat] }))}>
                {isOpen ? TAG_COPY.showFewer : TAG_COPY.showAll(all.length)}
              </button>
            )}
            {problem && (
              <p className="field__error" role="alert">
                {problem}
              </p>
            )}
            {isSocial && (
              <details className="tagsection__defs">
                <summary>{TAG_COPY.definitionsToggle}</summary>
                <dl>
                  {all.map((t) => (
                    <div key={t.id} className="tagsection__def">
                      <dt>{t.label}</dt>
                      <dd>{t.definition}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
