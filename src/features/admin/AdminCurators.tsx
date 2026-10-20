import { useState } from 'react';
import type { CuratorRow } from '@/data/DataSource';
import type { CuratorStatus } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { useToast } from '@/state/toast';
import { Button, EmptyState, ErrorState, Icon, Notice, Panel, Skeleton, StatusDot, Tag, TopBar } from '@/ui';
import { institutionTypeLabel } from '@/features/curator/shared';
import { formatDate } from './format';
import { NoteSheet, type NoteAction } from './NoteSheet';
import './admin.css';

const ORDER: CuratorStatus[] = ['pending', 'verified', 'rejected'];
const GROUP_LABEL: Record<CuratorStatus, string> = {
  pending: 'Waiting for verification',
  verified: 'Verified',
  rejected: 'Not verified',
};

export function AdminCurators() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const q = useQuery((ds, v) => ds.listCurators(v));
  const [action, setAction] = useState<NoteAction>();

  const decide = (c: CuratorRow, status: CuratorStatus, kind: 'verify' | 'reject' | 'revoke'): NoteAction => {
    const run = async (note: string) => {
      await data.setCuratorStatus(viewer, c.id, status, note || undefined);
      toast.push(
        kind === 'verify' ? `${c.name} is verified` : kind === 'revoke' ? `Verification revoked for ${c.name}` : `${c.name} was not verified`,
        'success',
      );
    };
    if (kind === 'verify')
      return {
        title: `Verify ${c.name}?`,
        body: (
          <p>
            They’ll see prices and works artists share with verified institutions, and can request introductions. Artist contact details stay
            private either way.
          </p>
        ),
        confirmLabel: 'Verify curator',
        tone: 'lime',
        noteLabel: 'How you checked',
        noteHint: 'For example: “Listed in the institution’s staff directory.” Stored on the curator record.',
        minNote: 0,
        run,
      };
    if (kind === 'revoke')
      return {
        title: `Revoke ${c.name}’s verification?`,
        body: <p>They lose access to institution-only prices and works straight away, and can’t send new introduction requests.</p>,
        confirmLabel: 'Revoke verification',
        tone: 'danger',
        noteLabel: 'Reason',
        noteHint: 'Shown to the curator on their verification page.',
        minNote: 10,
        run,
      };
    return {
      title: `Don’t verify ${c.name}?`,
      body: <p>They keep public access only. They can correct their details and send the request again.</p>,
      confirmLabel: 'Reject request',
      tone: 'danger',
      noteLabel: 'Reason',
      noteHint: 'Shown to the curator so they know what to fix.',
      minNote: 10,
      run,
    };
  };

  return (
    <div className="screen">
      <TopBar title="Curators" back="/admin" />
      <main className="container container--wide ad-main">
        <div className="ad-split">
        <aside className="ad-split__aside stack">
          <p className="eyebrow eyebrow--gold">Kofi desk</p>
          <h2 className="h1">Curators</h2>
          <span className="rule rule--gold" aria-hidden="true" />
        <Notice tone="plain" icon={<Icon.Building />}>
          Check each request by hand before verifying: find the person in the institution’s staff directory, or write to the work email from a
          known address.
        </Notice>
        </aside>
        <div className="ad-split__main stack--lg">

        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading curators">
            <Skeleton h={140} />
            <Skeleton h={140} />
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState title="No curator requests yet" body="When a curator asks Kofi to verify their institution, the request lands here." />
        ) : (
          ORDER.map((s) => {
            const rows = q.data!.filter((c) => c.status === s);
            if (rows.length === 0) return null;
            return (
              <section key={s} className="stack--sm" aria-labelledby={`cur-${s}`}>
                <h2 className="group-title" id={`cur-${s}`}>
                  <StatusDot status={s} />
                  {GROUP_LABEL[s]}
                  <span className="group-title__count">{rows.length}</span>
                </h2>
                <Panel className="ad-flat">
                  <ul>
                    {rows.map((c) => (
                      <li key={c.id} className="ops" aria-label={`${c.name}, ${c.institution.name}`}>
                        <div className="ops__head">
                          <div style={{ minWidth: 0 }}>
                            <div className="ops__title">{c.name}</div>
                            <div className="ops__sub">{c.title}</div>
                          </div>
                          <Tag>{institutionTypeLabel(c.institution.type)}</Tag>
                        </div>
                        <p className="small" style={{ marginTop: 6 }}>
                          <strong>{c.institution.name}</strong>
                          {c.institution.city || c.institution.country ? (
                            <span className="muted">, {[c.institution.city, c.institution.country].filter(Boolean).join(', ')}</span>
                          ) : null}
                        </p>
                        {c.institution.website && (
                          <p className="small" style={{ overflowWrap: 'anywhere' }}>
                            {/^https?:\/\//i.test(c.institution.website) ? (
                              <a href={c.institution.website} target="_blank" rel="noreferrer noopener">
                                {c.institution.website}
                              </a>
                            ) : (
                              <span>{c.institution.website}</span>
                            )}
                          </p>
                        )}
                        <p className="small mono" style={{ overflowWrap: 'anywhere', marginTop: 4 }}>
                          {c.workEmail}
                        </p>
                        <p className="ops__quote">{c.purpose}</p>
                        <div className="ops__meta">
                          <span>Requested {formatDate(c.createdAt)}</span>
                          {c.status === 'verified' && c.verifiedAt && <span>Verified {formatDate(c.verifiedAt)}</span>}
                          {c.verificationNote && <span>Kofi note: {c.verificationNote}</span>}
                        </div>
                        <div className="ops__actions">
                          {c.status === 'pending' && (
                            <>
                              <Button tone="lime" size="sm" icon={<Icon.Check />} onClick={() => setAction(decide(c, 'verified', 'verify'))}>
                                Verify
                              </Button>
                              <Button tone="danger" size="sm" onClick={() => setAction(decide(c, 'rejected', 'reject'))}>
                                Reject
                              </Button>
                            </>
                          )}
                          {c.status === 'verified' && (
                            <Button tone="danger" size="sm" onClick={() => setAction(decide(c, 'rejected', 'revoke'))}>
                              Revoke
                            </Button>
                          )}
                          {c.status === 'rejected' && (
                            <Button tone="secondary" size="sm" icon={<Icon.Check />} onClick={() => setAction(decide(c, 'verified', 'verify'))}>
                              Verify after all
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </section>
            );
          })
        )}
        </div>
        </div>
      </main>
      <NoteSheet action={action} onClose={() => setAction(undefined)} />
    </div>
  );
}
