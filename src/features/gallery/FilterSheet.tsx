import { useEffect, useMemo, useState } from 'react';
import type { ArtworkFilters } from '@/domain/filters';
import { applyFilters, countActiveFilters, materialFacets, sizePreset } from '@/domain/filters';
import type { ArtworkView, Medium, Unit } from '@/domain/types';
import { ARTWORK_STATUSES, CAREER_STAGES, MEDIUMS } from '@/domain/types';
import { Button, Chip, Input, Segmented, Sheet, Toggle } from '@/ui';
import { cap, NumberField, plural } from './helpers';
import { clearedFilters, compact, toggleIn, withUnit } from './params';

const SIZE_PRESETS_IN = [24, 40, 60];
const MATERIALS_SHOWN = 10;

export interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  /** Currently applied filters (from the URL). */
  filters: ArtworkFilters;
  /** Every work visible to this viewer, unfiltered. Used for facets and the live count. */
  works: ArtworkView[];
  onApply: (f: ArtworkFilters) => void;
}

/**
 * All gallery filters in one sheet. Edits a draft; the footer shows how many
 * works the draft would return (computed with `applyFilters`), and applying
 * writes the draft back to the URL.
 */
export function FilterSheet({ open, onClose, filters, works, onApply }: FilterSheetProps) {
  const [draft, setDraft] = useState<ArtworkFilters>(filters);
  const [materialText, setMaterialText] = useState('');
  const [allMaterials, setAllMaterials] = useState(false);

  // Start from the applied filters every time the sheet opens.
  useEffect(() => {
    if (open) {
      setDraft(filters);
      setMaterialText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<ArtworkFilters>) => setDraft((d) => compact({ ...d, ...patch }));
  const unit: Unit = draft.sizeUnit ?? 'cm';
  const resultCount = useMemo(() => applyFilters(works, draft).length, [works, draft]);
  const active = countActiveFilters(draft);

  const mediumCounts = useMemo(() => {
    const m = new Map<Medium, number>();
    for (const w of works) m.set(w.medium, (m.get(w.medium) ?? 0) + 1);
    return m;
  }, [works]);
  const mediums = MEDIUMS.filter((m) => mediumCounts.has(m) || draft.mediums?.includes(m));

  const facets = useMemo(() => materialFacets(works), [works]);
  const selectedMaterials = draft.materials ?? [];
  const isMaterialOn = (name: string) => selectedMaterials.some((m) => m.toLowerCase() === name.toLowerCase());
  const shownFacets = allMaterials ? facets : facets.slice(0, MATERIALS_SHOWN);
  const customMaterials = selectedMaterials.filter((m) => !facets.some((f) => f.name.toLowerCase() === m.toLowerCase()));

  const toggleMaterial = (name: string) => {
    const next = isMaterialOn(name) ? selectedMaterials.filter((m) => m.toLowerCase() !== name.toLowerCase()) : [...selectedMaterials, name];
    set({ materials: next.length ? next : undefined });
  };
  const addMaterial = () => {
    const t = materialText.trim();
    if (!t) return;
    if (!isMaterialOn(t)) set({ materials: [...selectedMaterials, t] });
    setMaterialText('');
  };

  const presetValue = (inches: number) => sizePreset(inches, 'in', unit);
  const setYears = (from: number | undefined, to: number | undefined) =>
    set({ years: from === undefined && to === undefined ? undefined : compactYears(from, to) });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={active ? `Filters (${active})` : 'Filters'}
      footer={
        <>
          <Button tone="secondary" block onClick={() => setDraft(clearedFilters(draft))} disabled={active === 0}>
            Clear all
          </Button>
          <Button
            block
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            {`Show ${plural(resultCount, 'work')}`}
          </Button>
        </>
      }
    >
      <div className="filter-section">
        <h3 className="filter-section__title">Medium</h3>
        <div className="chips">
          {mediums.map((m) => (
            <Chip key={m} medium={m} on={draft.mediums?.includes(m) ?? false} count={mediumCounts.get(m) ?? 0} onClick={() => set({ mediums: toggleIn(draft.mediums, m) })}>
              {cap(m)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Materials</h3>
        <p className="small muted" style={{ marginBottom: 8 }}>
          Matches any material you pick.
        </p>
        <div className="chips">
          {shownFacets.map((f) => (
            <Chip key={f.name} small on={isMaterialOn(f.name)} count={f.count} onClick={() => toggleMaterial(f.name)}>
              {f.name}
            </Chip>
          ))}
          {customMaterials.map((m) => (
            <Chip key={`custom-${m}`} small on onClick={() => toggleMaterial(m)} aria-label={`Remove material ${m}`}>
              {m}
            </Chip>
          ))}
        </div>
        {facets.length > MATERIALS_SHOWN && (
          <Button tone="ghost" size="sm" onClick={() => setAllMaterials((v) => !v)} style={{ marginTop: 8 }}>
            {allMaterials ? 'Show fewer materials' : `Show all ${facets.length} materials`}
          </Button>
        )}
        <form
          className="kg-inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            addMaterial();
          }}
        >
          <Input label="Another material" placeholder="e.g. linen, bronze, wool" value={materialText} onChange={(e) => setMaterialText(e.target.value)} />
          <Button tone="secondary" type="submit" disabled={!materialText.trim()}>
            Add
          </Button>
        </form>
      </div>

      <div className="filter-section">
        <div className="row row--between" style={{ marginBottom: 8 }}>
          <h3 className="filter-section__title" style={{ marginBottom: 0 }}>
            Size
          </h3>
          <div style={{ width: 112 }}>
            <Segmented<Unit>
              label="Size unit"
              value={unit}
              onChange={(u) => setDraft((d) => withUnit(d, u))}
              options={[
                { value: 'cm', label: 'cm' },
                { value: 'in', label: 'in' },
              ]}
            />
          </div>
        </div>
        <p className="small muted" style={{ marginBottom: 8 }}>
          Measured on the longest edge, including depth.
        </p>
        <div className="chips" style={{ marginBottom: 12 }}>
          {SIZE_PRESETS_IN.map((inches) => {
            const v = presetValue(inches);
            const on = draft.maxLongestEdge === v && draft.minLongestEdge === undefined;
            return (
              <Chip
                key={inches}
                small
                on={on}
                onClick={() => set(on ? { maxLongestEdge: undefined } : { maxLongestEdge: v, minLongestEdge: undefined })}
              >
                {unit === 'in' ? `Under ${inches} in` : `Under ${inches} in (${v} cm)`}
              </Chip>
            );
          })}
        </div>
        <div className="range-row kg-range">
          <NumberField label={`Smallest (${unit})`} suffix={unit} value={draft.minLongestEdge} onChange={(v) => set({ minLongestEdge: v })} />
          <span className="kg-range__to" aria-hidden="true">
            to
          </span>
          <NumberField label={`Largest (${unit})`} suffix={unit} value={draft.maxLongestEdge} onChange={(v) => set({ maxLongestEdge: v })} />
        </div>
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Availability</h3>
        <div className="chips">
          {ARTWORK_STATUSES.map((s) => (
            <Chip key={s} small on={draft.statuses?.includes(s) ?? false} onClick={() => set({ statuses: toggleIn(draft.statuses, s) })}>
              {cap(s)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Career stage</h3>
        <div className="chips">
          {CAREER_STAGES.map((s) => (
            <Chip key={s} small on={draft.careerStages?.includes(s) ?? false} onClick={() => set({ careerStages: toggleIn(draft.careerStages, s) })}>
              {cap(s)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Location</h3>
        <Input
          label="Region or city"
          hint="Matches the location each artist chooses to show, like Pennsylvania or Ottawa."
          value={draft.region ?? ''}
          onChange={(e) => set({ region: e.target.value || undefined })}
        />
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Artist experience</h3>
        <Toggle label="Has made commissions" checked={draft.commissionsExperience ?? false} onChange={(v) => set({ commissionsExperience: v || undefined })} />
        <Toggle label="Has made public art" checked={draft.publicArtExperience ?? false} onChange={(v) => set({ publicArtExperience: v || undefined })} />
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Budget</h3>
        <p className="small muted" style={{ marginBottom: 8 }}>
          Compared against prices you can see. Works listed in another currency count as “price on request”.
        </p>
        <Segmented
          label="Budget currency"
          value={(draft.budgetCurrency ?? 'USD') as 'USD' | 'CAD'}
          onChange={(v) => set({ budgetCurrency: v === 'USD' ? undefined : v })}
          options={[
            { value: 'USD', label: 'USD' },
            { value: 'CAD', label: 'CAD' },
          ]}
        />
        <div className="range-row kg-range" style={{ marginTop: 8 }}>
          <NumberField label="Minimum price" value={draft.budgetMin} onChange={(v) => set({ budgetMin: v })} />
          <span className="kg-range__to" aria-hidden="true">
            to
          </span>
          <NumberField label="Maximum price" value={draft.budgetMax} onChange={(v) => set({ budgetMax: v })} />
        </div>
        <Toggle
          label="Include works without a listed price"
          hint="Keeps “Price on request” and unpriced works in the results."
          checked={draft.includeUndisclosedPrice ?? false}
          onChange={(v) => set({ includeUndisclosedPrice: v || undefined })}
        />
      </div>

      <div className="filter-section">
        <h3 className="filter-section__title">Year made</h3>
        <div className="range-row kg-range">
          <NumberField label="From" inputMode="numeric" value={draft.years?.from} onChange={(v) => setYears(v, draft.years?.to)} />
          <span className="kg-range__to" aria-hidden="true">
            to
          </span>
          <NumberField label="To" inputMode="numeric" value={draft.years?.to} onChange={(v) => setYears(draft.years?.from, v)} />
        </div>
      </div>
    </Sheet>
  );
}

function compactYears(from: number | undefined, to: number | undefined): { from?: number; to?: number } {
  const y: { from?: number; to?: number } = {};
  if (from !== undefined) y.from = from;
  if (to !== undefined) y.to = to;
  return y;
}
