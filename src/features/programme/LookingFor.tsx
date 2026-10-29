/**
 * "What they're looking for": a call's written criteria, shown to artists on the
 * public call page. Labels come from the tag library; the block is hidden when
 * the organiser has written nothing. Uses show what matching applies, so an
 * auction call states the auction opt-in even when the organiser left it implied.
 */
import type { CallCriteria, OpenCall } from '@/domain/types';
import { USE_LABEL } from '@/domain/types';
import { effectiveCriteria, type MatchReason, type MatchResult } from '@/domain/matching';
import { Icon } from '@/ui';
import { categoryLabel, categoryOf, TAG_LIBRARY, tagLabel } from '@/domain/taxonomy';
import { matchCopy } from './matchCopy';
import './match.css';

/** True when the organiser wrote any criteria (tags, uses, region, size or a note). */
export function hasCriteria(c: CallCriteria | undefined): boolean {
  if (!c) return false;
  return (
    Object.values(c.tags ?? {}).some((l) => l.length > 0) ||
    !!c.uses?.length ||
    !!c.region?.trim() ||
    c.minLongestEdgeCm !== undefined ||
    c.maxLongestEdgeCm !== undefined ||
    !!c.note?.trim()
  );
}

const CATEGORY_ORDER = [...new Set(TAG_LIBRARY.map((t) => t.category))];

export function sizeText(c: Pick<CallCriteria, 'minLongestEdgeCm' | 'maxLongestEdgeCm'>): string | undefined {
  const { minLongestEdgeCm: min, maxLongestEdgeCm: max } = c;
  const p = matchCopy.publicBlock;
  if (min !== undefined && max !== undefined) return p.sizeBoth(min, max);
  if (max !== undefined) return p.sizeMax(max);
  if (min !== undefined) return p.sizeMin(min);
  return undefined;
}

export function LookingForBlock({ call, headingLevel = 2, id = 'lf-title' }: { call: Pick<OpenCall, 'kind' | 'mediums' | 'lookingFor'>; headingLevel?: 2 | 3; id?: string }) {
  const c = call.lookingFor;
  if (!hasCriteria(c)) return null;
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const p = matchCopy.publicBlock;
  const uses = effectiveCriteria(call).uses ?? [];
  const cats = Object.entries(c!.tags ?? {})
    .map(([cat, ids]) => [cat, ids.filter((x) => categoryOf(x) === cat)] as const)
    .filter(([, ids]) => ids.length)
    .sort(([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  const size = sizeText(c!);
  return (
    <section className="lf-block" aria-labelledby={id} data-testid="looking-for-block">
      <H className="lf-block__title" id={id}>
        {p.title}
      </H>
      <p className="lf-block__lede">{p.lede}</p>
      <dl className="lf-block__rows">
        {cats.map(([cat, ids]) => (
          <div key={cat}>
            <dt>{categoryLabel(cat)}</dt>
            <dd>
              <ul className="lf-chips" aria-label={categoryLabel(cat)}>
                {ids.map((x) => (
                  <li key={x} className="lf-chip">
                    {tagLabel(x)}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
        {uses.length > 0 && (
          <div>
            <dt>{p.uses}</dt>
            <dd>
              <ul className="lf-chips" aria-label={p.uses}>
                {uses.map((u) => (
                  <li key={u} className="lf-chip">
                    {USE_LABEL[u]}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {c!.region?.trim() && (
          <div>
            <dt>{p.region}</dt>
            <dd>{c!.region.trim()}</dd>
          </div>
        )}
        {size && (
          <div>
            <dt>{p.size}</dt>
            <dd>{size}</dd>
          </div>
        )}
      </dl>
      {c!.note?.trim() && (
        <figure className="lf-block__note">
          <figcaption className="lf-block__notelabel">{p.note}</figcaption>
          <blockquote>
            <p>{c!.note.trim()}</p>
          </blockquote>
        </figure>
      )}
    </section>
  );
}

/* ---------------- fit pieces shared by the apply page and "Works that fit" ---------------- */

/** "Fits 3 of 3" (gold) or "2 of 3" (quiet). Nothing when the call asks nothing. */
export function FitPill({ match }: { match: MatchResult }) {
  if (match.of === 0) return null;
  return (
    <span className="fit-pill" data-fits={match.fits || undefined}>
      {matchCopy.fit.pill(match.met, match.of)}
    </span>
  );
}

/** The reason sentences from domain/matching, verbatim, each marked met or missed. */
export function FitReasons({ reasons, id }: { reasons: MatchReason[]; id?: string }) {
  return (
    <ul className="fit-reasons" id={id}>
      {reasons.map((r) => (
        <li key={r.ask} data-ok={r.ok || undefined}>
          <span className="fit-reasons__mark" aria-hidden="true">
            {r.ok ? <Icon.Check /> : <Icon.Close />}
          </span>
          <span className="sr-only">{r.ok ? matchCopy.fit.met : matchCopy.fit.missed}: </span>
          <span className="fit-reasons__text">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
