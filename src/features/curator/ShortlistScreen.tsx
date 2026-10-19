import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ForbiddenError, ValidationError, type InquiryRow } from '@/data/DataSource';
import type { ArtworkView, Unit } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import {
  Button,
  Confirm,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  LinkButton,
  Notice,
  Segmented,
  Sheet,
  Skeleton,
  StatusDot,
  Textarea,
  TopBar,
  WallLabel,
} from '@/ui';
import { formatDate, INQUIRY_STATUS_COPY, isActiveInquiry, MIN_INTRO_MESSAGE } from './shared';
import { shortlistToText, type ResolvedItem } from './shortlistText';
import './curator.css';

export function ShortlistScreen() {
  const { id = '' } = useParams();
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [unit, setUnit] = useState<Unit>('cm');

  const q = useQuery(
    async (ds, v) => {
      const curator = await ds.getMyCurator(v);
      if (!curator) return { curator, list: undefined, items: [] as ResolvedItem[], inquiries: [] as InquiryRow[] };
      const [lists, inquiries] = await Promise.all([ds.listShortlists(v), ds.listInquiries(v)]);
      const list = lists.find((s) => s.id === id);
      const items: ResolvedItem[] = list
        ? await Promise.all(
            list.items.map(async (it) => {
              // A work can disappear (deleted, hidden, artist paused). Never let one crash the list.
              const work = await ds.getArtwork(v, it.artworkId).catch(() => undefined);
              const r: ResolvedItem = { artworkId: it.artworkId, work };
              if (it.note) r.note = it.note;
              return r;
            }),
          )
        : [];
      return { curator, list, items, inquiries };
    },
    [id],
  );

  const inquiryByWork = useMemo(() => {
    const m = new Map<string, InquiryRow>();
    for (const i of q.data?.inquiries ?? []) {
      if (!i.artworkId) continue;
      const prev = m.get(i.artworkId);
      if (!prev || prev.createdAt < i.createdAt) m.set(i.artworkId, i);
    }
    return m;
  }, [q.data?.inquiries]);

  /* ---- rename ---- */
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameError, setRenameError] = useState<string>();
  const [renameBusy, setRenameBusy] = useState(false);
  const rename = async () => {
    if (!q.data?.list) return;
    if (!newName.trim()) {
      setRenameError('A shortlist needs a name.');
      return;
    }
    setRenameBusy(true);
    try {
      await data.renameShortlist(viewer, q.data.list.id, newName);
      toast.push('Shortlist renamed', 'success');
      setRenaming(false);
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'name') setRenameError(e.message);
      else toast.push(errorMessage(e), 'error');
    } finally {
      setRenameBusy(false);
    }
  };

  /* ---- delete ---- */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = async () => {
    if (!q.data?.list) return;
    try {
      await data.deleteShortlist(viewer, q.data.list.id);
      toast.push('Shortlist deleted', 'success');
      setConfirmDelete(false);
      nav('/curator', { replace: true });
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    }
  };

  /* ---- remove item ---- */
  const [removing, setRemoving] = useState<string>();
  const remove = async (artworkId: string, title: string) => {
    if (!q.data?.list) return;
    setRemoving(artworkId);
    try {
      await data.removeFromShortlist(viewer, q.data.list.id, artworkId);
      toast.push(`Removed ${title}`, 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setRemoving(undefined);
    }
  };

  /* ---- request introduction ---- */
  const [introFor, setIntroFor] = useState<ArtworkView>();
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState<string>();
  const [introBlocked, setIntroBlocked] = useState<string>();
  const [introBusy, setIntroBusy] = useState(false);
  const openIntro = (w: ArtworkView) => {
    setIntroFor(w);
    setMessage('');
    setMessageError(undefined);
    setIntroBlocked(undefined);
  };
  const sendIntro = async () => {
    if (!introFor) return;
    if (message.trim().length < MIN_INTRO_MESSAGE) {
      setMessageError(`Write at least ${MIN_INTRO_MESSAGE} characters: what the opportunity is, and when.`);
      return;
    }
    setIntroBusy(true);
    try {
      await data.createInquiry(viewer, { artistId: introFor.artistId, artworkId: introFor.id, message });
      toast.push('Request sent to Kofi for review', 'success');
      setIntroFor(undefined);
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'message') setMessageError(e.message);
      else if (e instanceof ForbiddenError) setIntroBlocked(e.message);
      else toast.push(errorMessage(e), 'error');
    } finally {
      setIntroBusy(false);
    }
  };

  /* ---- copy as text ---- */
  const [fallbackText, setFallbackText] = useState<string>();
  const copyAsText = async () => {
    if (!q.data?.list) return;
    const text = shortlistToText(q.data.list, q.data.items, { unit, fictional: data.mode === 'mock' });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      const n = q.data.items.length;
      toast.push(`Copied ${n === 1 ? '1 work' : `${n} works`} as text`, 'success');
    } catch {
      // Some WebViews and insecure contexts block the clipboard; show the text so it can be copied by hand.
      setFallbackText(text);
    }
  };

  const list = q.data?.list;
  const verified = q.data?.curator?.status === 'verified';

  return (
    <div className="screen">
      <TopBar title={list?.name ?? 'Shortlist'} back="/curator" />
      <main className="container stack--lg" style={{ paddingTop: 20 }}>
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading shortlist">
            <Skeleton h={40} w="70%" />
            <Skeleton h={200} />
            <Skeleton h={200} />
          </div>
        ) : !q.data.curator ? (
          <EmptyState
            title="Verify your institution first"
            body="Shortlists live on your curator record, which Kofi creates when you send your institution details."
            actions={<LinkButton to="/curator/verify">Verify your institution</LinkButton>}
          />
        ) : !list ? (
          <EmptyState
            title="This shortlist isn’t here"
            body="It may have been deleted, or the link belongs to another curator’s list."
            actions={<LinkButton to="/curator">Back to your shortlists</LinkButton>}
          />
        ) : (
          <>
            <header className="stack--sm">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <h2 className="h2 sl-title">
                  {list.name}
                </h2>
                <Button
                  tone="ghost"
                  icon={<Icon.Edit />}
                  aria-label="Rename shortlist"
                  onClick={() => {
                    setNewName(list.name);
                    setRenameError(undefined);
                    setRenaming(true);
                  }}
                />
              </div>
              <p className="muted small">
                {list.items.length === 1 ? '1 work' : `${list.items.length} works`}, updated {formatDate(list.updatedAt)}
              </p>
            </header>

            <div className="toolbar">
              <Button tone="secondary" size="sm" icon={<Icon.Doc />} onClick={copyAsText}>
                Copy as text
              </Button>
              <div className="toolbar__unit">
                <Segmented<Unit>
                  label="Dimension units"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: 'cm', label: 'cm' },
                    { value: 'in', label: 'in' },
                  ]}
                />
              </div>
            </div>

            {!verified && (
              <Notice tone="butter" icon={<Icon.Lock />}>
                Introductions open once Kofi verifies your institution. Prices shared only with verified institutions show as “Price on request”
                until then.
              </Notice>
            )}

            {q.data.items.length === 0 ? (
              <EmptyState
                title="Nothing on this list yet"
                body="Open any work in the gallery and add it to this shortlist. It will show up here with its wall label."
                actions={
                  <LinkButton to="/" icon={<Icon.Gallery />}>
                    Browse the gallery
                  </LinkButton>
                }
              />
            ) : (
              <ol className="sl-items" aria-label="Works on this shortlist">
                {q.data.items.map((it, i) => {
                  const num = String(i + 1).padStart(2, '0');
                  if (!it.work) {
                    return (
                      <li key={it.artworkId} className="sl-gone">
                        <div style={{ minWidth: 0 }}>
                          <div className="sl-gone__title">
                            {num} No longer available
                          </div>
                          <p className="small">The artist removed or hid this work. It stays here until you remove it.</p>
                          {it.note && <p className="small">Your note: {it.note}</p>}
                        </div>
                        <Button
                          tone="secondary"
                          size="sm"
                          icon={<Icon.Trash />}
                          loading={removing === it.artworkId}
                          onClick={() => remove(it.artworkId, 'the unavailable work')}
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  }
                  const w = it.work;
                  const inq = inquiryByWork.get(w.id);
                  const active = inq && isActiveInquiry(inq.status);
                  return (
                    <li key={it.artworkId} className="sl-item" data-medium={w.medium}>
                      <WallLabel work={w} unit={unit} corner={<span className="sl-num">{num}</span>} />
                      <div className="sl-item__actions">
                        {it.note && <p className="sl-item__note">{it.note}</p>}
                        {inq && (
                          <p className="small row" style={{ alignItems: 'flex-start' }}>
                            <StatusDot status={inq.status} />
                            <span>
                              <span className="strong">{INQUIRY_STATUS_COPY[inq.status]}</span>
                              <span className="muted" style={{ display: 'block' }}>
                                Requested {formatDate(inq.createdAt)}
                              </span>
                            </span>
                          </p>
                        )}
                        <LinkButton to={`/work/${w.id}`} tone="secondary" size="sm" block>
                          View work
                        </LinkButton>
                        {!active &&
                          (verified ? (
                            <Button size="sm" block icon={<Icon.Mail />} onClick={() => openIntro(w)}>
                              Request introduction
                            </Button>
                          ) : (
                            <LinkButton to="/curator/verify" tone="butter" size="sm" block>
                              Verify to request
                            </LinkButton>
                          ))}
                        <Button
                          tone="ghost"
                          size="sm"
                          className="ghost-flat"
                          icon={<Icon.Trash />}
                          loading={removing === w.id}
                          aria-label={`Remove ${w.title} from this shortlist`}
                          onClick={() => remove(w.id, w.title)}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="divider" />
            <div>
              <Button tone="danger" size="sm" icon={<Icon.Trash />} onClick={() => setConfirmDelete(true)}>
                Delete shortlist
              </Button>
            </div>
          </>
        )}
      </main>

      <Sheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename shortlist"
        footer={
          <>
            <Button tone="secondary" block onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button block loading={renameBusy} onClick={rename}>
              Save name
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input
            label="Shortlist name"
            value={newName}
            maxLength={120}
            autoFocus
            error={renameError}
            onChange={(e) => {
              setNewName(e.target.value);
              if (renameError) setRenameError(undefined);
            }}
          />
        </form>
      </Sheet>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={del}
        danger
        title="Delete this shortlist?"
        body={`“${list?.name ?? ''}” and its notes will be deleted. The works stay in the gallery, and introduction requests you already sent are not affected.`}
        confirmLabel="Delete shortlist"
      />

      <Sheet
        open={!!introFor}
        onClose={() => setIntroFor(undefined)}
        title="Request introduction"
        footer={
          <>
            <Button tone="secondary" block onClick={() => setIntroFor(undefined)}>
              Cancel
            </Button>
            <Button block loading={introBusy} disabled={!!introBlocked} onClick={sendIntro}>
              Send to Kofi
            </Button>
          </>
        }
      >
        {introFor && (
          <div className="stack">
            <p>
              About <strong>{introFor.title}</strong> by {introFor.artistWorkingName}.
            </p>
            <Notice tone="plain" icon={<Icon.Lock />}>
              Kofi reads every request before it reaches the artist. Their contact details stay private; if they accept, Kofi connects you.
            </Notice>
            {introBlocked && (
              <Notice tone="coral" icon={<Icon.Warn />}>
                {introBlocked} <LinkButtonInline />
              </Notice>
            )}
            <Textarea
              label="Your message"
              hint={`What the opportunity is, the timeline and any budget. At least ${MIN_INTRO_MESSAGE} characters (${message.trim().length} so far).`}
              value={message}
              maxLength={2000}
              error={messageError}
              onChange={(e) => {
                setMessage(e.target.value);
                if (messageError) setMessageError(undefined);
              }}
            />
          </div>
        )}
      </Sheet>

      <Sheet
        open={fallbackText !== undefined}
        onClose={() => setFallbackText(undefined)}
        title="Copy your shortlist"
        footer={
          <Button block tone="secondary" onClick={() => setFallbackText(undefined)}>
            Done
          </Button>
        }
      >
        <div className="stack">
          <p className="small">This device didn’t let Kofi use the clipboard. Select the text below and copy it.</p>
          <Textarea label="Shortlist as text" readOnly value={fallbackText ?? ''} rows={10} onFocus={(e) => e.currentTarget.select()} />
        </div>
      </Sheet>
    </div>
  );
}

function LinkButtonInline() {
  return (
    <Link to="/curator/verify" style={{ color: 'inherit', fontWeight: 700 }}>
      Check your verification
    </Link>
  );
}
