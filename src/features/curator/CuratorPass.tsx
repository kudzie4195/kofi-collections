import type { CuratorRow } from '@/data/DataSource';
import { Icon } from '@/ui';
import { CURATOR_STATUS_LABEL, formatDate, institutionTypeLabel } from './shared';

/** The curator's institutional pass: who they are, where they work, and Kofi's stamp. */
export function CuratorPass({ curator, fallbackName }: { curator: CuratorRow | undefined; fallbackName: string }) {
  const status = curator?.status ?? 'none';
  const stamp =
    status === 'verified' ? 'Verified' : status === 'pending' ? 'Pending review' : status === 'rejected' ? 'Not verified' : 'Not yet verified';
  const inst = curator?.institution;
  return (
    <section className={`pass pass--${status}`} aria-label="Your curator pass">
      <div className="pass__band" aria-hidden="true" />
      <div className="pass__body">
        <div className="pass__kicker">Kofi curator pass</div>
        <h2 className="pass__name">{curator?.name ?? fallbackName}</h2>
        {curator?.title && <p className="pass__title">{curator.title}</p>}
        <div className="pass__inst">
          <Icon.Building />
          <div>
            <div>{inst ? inst.name : 'No institution on file'}</div>
            {inst && (
              <div className="small muted" style={{ fontWeight: 500 }}>
                {[institutionTypeLabel(inst.type), inst.city, inst.country].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
        </div>
        <div className="pass__status small">
          <span className="row">
            <span className={`status-dot status-dot--${status === 'none' ? 'draft' : status}`} aria-hidden="true" />
            <strong>{CURATOR_STATUS_LABEL[status]}</strong>
          </span>
          {status === 'verified' && curator?.verifiedAt && <span className="muted">on {formatDate(curator.verifiedAt)}</span>}
          {status === 'pending' && curator?.createdAt && <span className="muted">since {formatDate(curator.createdAt)}</span>}
        </div>
      </div>
      <div className="pass__stamp" aria-hidden="true">
        {stamp}
      </div>
    </section>
  );
}
