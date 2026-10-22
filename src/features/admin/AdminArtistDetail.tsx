import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ArtistStatus, ArtworkView, ProfileImportRecord } from '@/domain/types';
import { formatDimensions } from '@/domain/units';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LinkButton,
  Notice,
  Panel,
  Skeleton,
  StatusDot,
  Tag,
  Textarea,
  TopBar,
  VisibilityBadge,
} from '@/ui';
import { ARTIST_STATUS_LABEL } from './AdminArtists';
import { formatDate } from './format';
import { NoteSheet, type NoteAction } from './NoteSheet';
import { FIELD_WORD, checkedSentence, deskIntakeCopy as dc } from './intakeCopy';
import { LinkList, linkParts } from './links';
import { PlatformIcon } from './icons';
import { platformName } from '@/domain/intake';
import './admin.css';

export function AdminArtistDetail() {
  const { id = '' } = useParams();
  const { viewer, data } = useSession();
  const toast = useToast();

  const q = useQuery(
    async (ds, v) => {
      const [artist, works] = await Promise.all([ds.getArtist(v, id), ds.listArtistArtworks(v, id)]);
      return { artist, works };
    },
    [id],
  );

  /* ---- Kofi notes ---- */
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const serverNotes = q.data?.artist?.kofiNotes ?? '';
  useEffect(() => {
    if (!dirty) setNotes(serverNotes);
  }, [serverNotes, dirty]);

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await data.setKofiNotes(viewer, id, notes);
      setDirty(false);
      toast.push('Kofi notes saved', 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  /* ---- status ---- */
  const [action, setAction] = useState<NoteAction>();
  const statusAction = (status: ArtistStatus): NoteAction => {
    const name = q.data?.artist?.workingName ?? 'this artist';
    const noConsent = !q.data?.artist?.consentVersion;
    const common = {
      noteLabel: 'Note',
      noteHint: 'Added to the Kofi notes below with today’s date.',
      minNote: 0,
      run: async (note: string) => {
        await data.setArtistStatus(viewer, id, status, note || undefined);
        toast.push(`${name}: ${ARTIST_STATUS_LABEL[status].toLowerCase()}`, 'success');
      },
    };
    if (status === 'approved')
      return {
        ...common,
        title: `Approve ${name}?`,
        confirmLabel: 'Approve artist',
        tone: 'lime',
        body: (
          <div className="stack--sm">
            <p>
              Their profile and every work they’ve set to Public or Verified institutions become discoverable. Works marked Kofi team only or Only me
              stay hidden.
            </p>
            {noConsent && (
              <Notice tone="coral" icon={<Icon.Warn />}>
                This artist hasn’t accepted the consent terms yet. Ask them to before their work goes public.
              </Notice>
            )}
          </div>
        ),
      };
    if (status === 'paused')
      return {
        ...common,
        title: `Pause ${name}?`,
        confirmLabel: 'Pause artist',
        tone: 'butter',
        body: <p>Their profile and work leave the gallery and curator search straight away. Nothing is deleted, and you can approve them again later.</p>,
      };
    return {
      ...common,
      title: `Send ${name} back to draft?`,
      confirmLabel: 'Send back to draft',
      tone: 'primary',
      body: <p>The profile goes back to the artist to keep working on. It leaves the gallery until it is approved again.</p>,
    };
  };

  /* ---- review ---- */
  const [reviewing, setReviewing] = useState<string>();
  const markReviewed = async (w: ArtworkView) => {
    setReviewing(w.id);
    try {
      await data.markArtworkReviewed(viewer, w.id);
      toast.push(`Marked “${w.title}” as reviewed`, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setReviewing(undefined);
    }
  };

  /* ---- links ---- */
  const [rechecking, setRechecking] = useState(false);
  const recheck = async () => {
    setRechecking(true);
    try {
      const links = await data.checkMyLinks(viewer, id);
      const verified = links.filter((l) => l.verification === 'verified').length;
      const s = checkedSentence(links.length, verified);
      toast.push(s.charAt(0).toUpperCase() + s.slice(1) + '.', 'success');
      q.reload();
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setRechecking(false);
    }
  };

  const a = q.data?.artist;

  return (
    <div className="screen">
      <TopBar title={a?.workingName ?? 'Artist'} back="/admin/artists" />
      <main className="container container--wide ad-main">
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading artist">
            <Skeleton h={72} w={72} />
            <Skeleton h={28} w="60%" />
            <Skeleton h={160} />
          </div>
        ) : !a ? (
          <EmptyState title="No artist with that link" body="The profile may have been removed." actions={<LinkButton to="/admin/artists">All artists</LinkButton>} />
        ) : (
          <div className="ad-split">
            <div className="ad-split__aside stack--lg">
            <header className="ad-person">
              <Avatar name={a.workingName} color={a.avatarColor} size="lg" />
              <div className="stack--sm" style={{ minWidth: 0, flex: 1 }}>
                <h2 className="h2" style={{ overflowWrap: 'break-word' }}>
                  {a.workingName}
                </h2>
                <p className="muted small">
                  {[a.pronouns, a.regionLabel, a.careerStage].filter(Boolean).join(', ')}
                </p>
                <div className="chips">
                  {a.mediums.map((m) => (
                    <Tag key={m} medium={m}>
                      {m}
                    </Tag>
                  ))}
                </div>
              </div>
            </header>

            <Panel title="Status" pinned>
              <div className="stack">
                <p className="row">
                  <StatusDot status={a.status} />
                  <strong>{ARTIST_STATUS_LABEL[a.status]}</strong>
                  <span className="muted small">updated {formatDate(a.updatedAt)}</span>
                </p>
                <p className="small muted">
                  {a.consentVersion
                    ? `Consent ${a.consentVersion} accepted ${formatDate(a.consentAcceptedAt)}.`
                    : 'No consent on file yet.'}
                </p>
                <div className="row row--wrap">
                  {a.status !== 'approved' && (
                    <Button tone="lime" size="sm" icon={<Icon.Check />} onClick={() => setAction(statusAction('approved'))}>
                      Approve
                    </Button>
                  )}
                  {a.status !== 'paused' && (
                    <Button tone="butter" size="sm" onClick={() => setAction(statusAction('paused'))}>
                      Pause
                    </Button>
                  )}
                  {a.status !== 'draft' && (
                    <Button tone="secondary" size="sm" onClick={() => setAction(statusAction('draft'))}>
                      Send back to draft
                    </Button>
                  )}
                  {a.status === 'approved' && (
                    <LinkButton to={`/artists/${a.id}`} tone="ghost" size="sm" className="ghost-flat" icon={<Icon.Eye />}>
                      Public profile
                    </LinkButton>
                  )}
                </div>
              </div>
            </Panel>

            <section className="ad-call" aria-labelledby="ad-call-title">
              <h2 className="eyebrow ad-call__title" id="ad-call-title">
                {dc.callTitle}
              </h2>
              {a.verificationToken ? (
                <>
                  <p className="ad-call__code">
                    <code data-testid="artist-token">{a.verificationToken}</code>
                  </p>
                  <p className="small ad-call__body">{dc.callBody}</p>
                </>
              ) : (
                <p className="small ad-call__body">{dc.callNoCode}</p>
              )}
            </section>

            <Panel className="private-panel" title="Private — Kofi staff only">
              <dl className="spec">
                <dt>Legal name</dt>
                <dd>{a.legalName ?? <span className="muted">Not given</span>}</dd>
                <dt>Email</dt>
                <dd style={{ overflowWrap: 'anywhere' }}>{a.contact?.email ?? <span className="muted">Not given</span>}</dd>
                <dt>Phone</dt>
                <dd>{a.contact?.phone ?? <span className="muted">Not given</span>}</dd>
                <dt>Studio address</dt>
                <dd>{a.contact?.studioAddress ?? <span className="muted">Not given</span>}</dd>
                <dt>Full location</dt>
                <dd>
                  {a.region ? [a.region.city, a.region.region, a.region.country].filter(Boolean).join(', ') : <span className="muted">Not given</span>}
                  {a.region && <span className="muted small"> (shown publicly as “{a.regionLabel}”)</span>}
                </dd>
              </dl>
              <p className="tiny muted" style={{ marginTop: 12 }}>
                Never share these with curators. Introductions go through Kofi after the artist accepts.
              </p>
            </Panel>

            </div>

            <div className="ad-split__main stack--lg">
            <Panel
              title={dc.linksTitle}
              className="ad-links"
              action={
                a.links.length > 0 ? (
                  <Button tone="secondary" size="sm" loading={rechecking} onClick={() => void recheck()}>
                    {dc.recheck}
                  </Button>
                ) : undefined
              }
            >
              <div className="stack--sm">
                {a.links.length > 0 && <p className="small muted">{dc.linksLede}</p>}
                <LinkList links={a.links} explain label={`${a.workingName}: links`} />
              </div>
            </Panel>

            <Panel title={dc.importsTitle} className="ad-imports">
              <ImportList records={a.imports ?? []} />
            </Panel>

            <Panel title="Kofi notes" className="ad-notes">
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveNotes();
                }}
              >
                <Textarea
                  label="Internal notes"
                  hint="Only Kofi staff can see these. Status changes with a note are added here."
                  value={notes}
                  maxLength={4000}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
                <div className="row row--wrap">
                  <Button type="submit" size="sm" loading={savingNotes} disabled={!dirty}>
                    Save notes
                  </Button>
                  {dirty && (
                    <Button
                      tone="ghost"
                      size="sm"
                      className="ghost-flat"
                      onClick={() => {
                        setNotes(serverNotes);
                        setDirty(false);
                      }}
                    >
                      Discard changes
                    </Button>
                  )}
                </div>
              </form>
            </Panel>

            <section className="stack--sm" aria-labelledby="works-title">
              <h2 className="group-title" id="works-title">
                Works
                <span className="group-title__count">{q.data.works.length}</span>
              </h2>
              <p className="small muted">Includes drafts and Kofi-only records. Opening a draft marked Only me is logged.</p>
              {q.data.works.length === 0 ? (
                <EmptyState title="No works yet" body="This artist hasn’t added any artwork records." />
              ) : (
                <Panel className="ad-flat">
                  <ul className="list">
                    {q.data.works.map((w) => {
                      const img = w.images.find((i) => i.isPrimary) ?? w.images[0];
                      return (
                        <li key={w.id} className="list-row work-row" data-medium={w.medium}>
                          <Link to={`/work/${w.id}`} aria-label={`Open ${w.title}`} style={{ flex: 'none' }}>
                            {img ? <img className="thumb" src={img.src} alt="" /> : <span className="thumb" style={{ display: 'block' }} />}
                          </Link>
                          <div className="list-row__main">
                            <Link to={`/work/${w.id}`} className="list-row__title" style={{ display: 'block', textDecoration: 'none' }}>
                              {w.title}
                            </Link>
                            <div className="list-row__sub">
                              {w.year}, {w.medium}, {formatDimensions(w.dimensions)}
                            </div>
                            <div className="work-row__badges">
                              <VisibilityBadge level={w.visibility} />
                              <VisibilityBadge level={w.priceVisibility} prefix="Price" />
                            </div>
                          </div>
                          <div className="work-row__side">
                            {w.reviewedAt ? (
                              <span className="tiny muted row">
                                <Icon.Check style={{ width: 14, height: 14 }} /> Reviewed {formatDate(w.reviewedAt)}
                              </span>
                            ) : (
                              <Button tone="lime" size="sm" loading={reviewing === w.id} onClick={() => markReviewed(w)} aria-label={`Mark ${w.title} reviewed`}>
                                Mark reviewed
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              )}
            </section>
            </div>
          </div>
        )}
      </main>
      <NoteSheet action={action} onClose={() => setAction(undefined)} />
    </div>
  );
}

function ImportList({ records }: { records: ProfileImportRecord[] }) {
  if (!records.length) return <p className="small muted">{dc.importsNone}</p>;
  const sorted = [...records].sort((x, y) => y.fetchedAt.localeCompare(x.fetchedAt));
  return (
    <ul className="ad-imports__list" aria-label={dc.importsTitle}>
      {sorted.map((r, i) => {
        const { platform, handle } = linkParts(r.source);
        const used = [...new Set(r.appliedFields.map((f) => FIELD_WORD[f] ?? f))];
        return (
          <li key={`${r.source.url}-${r.fetchedAt}-${i}`} className="ad-import">
            <span className="ad-import__icon" aria-hidden="true">
              <PlatformIcon platform={platform} />
            </span>
            <div className="ad-import__main">
              <p className="ad-import__head">
                <span className="ad-import__platform">{platformName(platform)}</span>{' '}
                <a href={r.source.url} target="_blank" rel="noopener noreferrer" className="ad-import__handle">
                  {handle}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <time className="ad-import__when" dateTime={r.fetchedAt}>
                  {formatDate(r.fetchedAt)}
                </time>
              </p>
              <p className="small ad-import__used">
                {used.length ? (
                  <>
                    <span className="ad-import__label">{dc.importsUsed}</span> {used.join(', ')}
                  </>
                ) : (
                  <span className="muted">{dc.importsNothingUsed}</span>
                )}
              </p>
              {r.notes.length > 0 && (
                <ul className="ad-import__notes">
                  {r.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
