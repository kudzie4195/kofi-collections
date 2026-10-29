import { useId } from 'react';
import type { ArtworkUses } from '@/domain/types';
import { USE_KEYS, USE_LABEL } from '@/domain/types';
import { Toggle } from '@/ui';
import { USES_COPY } from './tagCopy';

/** "Available for": four switches, independent of the work's sale status. */
export function UsesField({ value, onChange, compact = false }: { value: ArtworkUses; onChange: (v: ArtworkUses) => void; compact?: boolean }) {
  const id = useId();
  return (
    <div className={`field uses${compact ? ' uses--compact' : ''}`} role="group" aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`}>
      <span className="field__label" id={`${id}-l`}>
        {USES_COPY.title}
      </span>
      <span className="field__hint uses__help" id={`${id}-h`}>
        {USES_COPY.help}
        {compact ? ` ${USES_COPY.quickHint}` : ''}
      </span>
      <div className="uses__grid">
        {USE_KEYS.map((k) => (
          <Toggle key={k} checked={value[k]} onChange={(on) => onChange({ ...value, [k]: on })} label={USE_LABEL[k]} hint={compact ? undefined : USES_COPY.hint[k]} />
        ))}
      </div>
    </div>
  );
}
