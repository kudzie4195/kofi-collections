import { useState } from 'react';
import type { ArtDocument, ArtworkView, DocumentType } from '@/domain/types';
import { DOCUMENT_TYPES } from '@/domain/types';
import { readFileAsDataUrl } from '@/native/images';
import { isNative, saveTextFile } from '@/native/platform';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Confirm, EmptyState, ErrorState, Field, Icon, Input, Notice, Segmented, Select, Sheet, Skeleton, Tag, TopBar, VisibilityBadge } from '@/ui';
import { Group, capitalize, dataUrlToBlob, fieldErrorFrom, formatBytes, formatDate, mimeOf } from './shared';

const MAX_DOC_BYTES = 10 * 1024 * 1024;

export function Vault() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ArtDocument>();
  const [opening, setOpening] = useState<string>();

  const q = useQuery(
    async (ds, v) => {
      const [docs, works] = await Promise.all([ds.listMyDocuments(v), v.artistId ? ds.listArtistArtworks(v, v.artistId) : Promise.resolve([] as ArtworkView[])]);
      return { docs, works };
    },
    [],
  );

  async function open(doc: ArtDocument) {
    // Open a window synchronously so popup blockers treat it as the user's tap.
    const win = isNative() ? null : window.open('', '_blank');
    setOpening(doc.id);
    try {
      const dataUrl = await data.openDocument(viewer, doc.id);
      const mime = mimeOf(dataUrl);
      if (isNative() && mime.startsWith('text/')) {
        const text = await dataUrlToBlob(dataUrl).text();
        await saveTextFile(doc.fileName, text, mime);
        return;
      }
      const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.push('Opened. This open was logged.', 'info');
    } catch (e) {
      win?.close();
      toast.push(errorMessage(e), 'error');
    } finally {
      setOpening(undefined);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    try {
      await data.removeDocument(viewer, removing.id);
      toast.push(`Removed “${removing.title}”`, 'success');
      setRemoving(undefined);
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    }
  }

  let body: React.ReactNode;
  if (q.error && !q.data) body = <ErrorState error={q.error} retry={q.reload} />;
  else if (!q.data)
    body = (
      <div className="stack" aria-busy="true" aria-label="Loading your vault">
        <Skeleton h={88} />
        <Skeleton h={88} />
      </div>
    );
  else if (q.data.docs.length === 0)
    body = (
      <EmptyState
        title="Nothing in your vault yet"
        body="Keep the paperwork behind each work here: invoices, condition reports, provenance, insurance documents and letters from qualified appraisers. Only you can open them; any Kofi staff open is logged."
        actions={
          <Button icon={<Icon.Plus />} onClick={() => setAdding(true)}>
            Add document
          </Button>
        }
      />
    );
  else {
    const { docs, works } = q.data;
    const groups: { key: string; title: string; work?: ArtworkView; docs: ArtDocument[] }[] = [];
    for (const w of works) {
      const ds = docs.filter((d) => d.artworkId === w.id);
      if (ds.length) groups.push({ key: w.id, title: w.title, work: w, docs: ds });
    }
    const known = new Set(works.map((w) => w.id));
    const loose = docs.filter((d) => !d.artworkId || !known.has(d.artworkId));
    if (loose.length) groups.push({ key: 'none', title: 'Not attached to a work', docs: loose });

    body = (
      <div className="stack--lg">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`grp-${g.key}`} className="st-docgroup" data-medium={g.work?.medium}>
            <h2 className="h3 st-docgroup__title" id={`grp-${g.key}`}>
              {g.title}
              <span className="tiny muted"> {g.docs.length === 1 ? '1 document' : `${g.docs.length} documents`}</span>
            </h2>
            <ul>
              {g.docs.map((d) => (
                <li key={d.id} className="st-doc">
                  <div className="st-doc__head">
                    <Icon.Doc className="st-doc__icon" aria-hidden="true" />
                    <div className="st-doc__main">
                      <div className="strong st-doc__title">{d.title}</div>
                      <div className="row row--wrap" style={{ marginTop: 4 }}>
                        <Tag>{capitalize(d.type)}</Tag>
                        <VisibilityBadge level={d.visibility} />
                      </div>
                    </div>
                  </div>
                  <dl className="spec st-doc__spec">
                    <dt>Custodian</dt>
                    <dd>{d.custodian || 'Not recorded'}</dd>
                    <dt>Dated</dt>
                    <dd>{formatDate(d.date)}</dd>
                    <dt>File</dt>
                    <dd className="st-doc__file">
                      {d.fileName}, {formatBytes(d.sizeBytes)}
                    </dd>
                  </dl>
                  <div className="row row--wrap">
                    <Button size="sm" tone="secondary" icon={<Icon.Eye />} loading={opening === d.id} onClick={() => void open(d)} aria-label={`Open ${d.title}`}>
                      Open
                    </Button>
                    <Button size="sm" tone="ghost" icon={<Icon.Trash />} onClick={() => setRemoving(d)} aria-label={`Remove ${d.title}`}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar
        title="Private vault"
        back="/studio"
        right={
          q.data && q.data.docs.length > 0 ? (
            <Button size="sm" icon={<Icon.Plus />} onClick={() => setAdding(true)} aria-label="Add document">
              Add
            </Button>
          ) : undefined
        }
      />
      <main className="container container--wide section">
        <div className="st-split">
          <aside className="st-split__aside stack">
            <p className="eyebrow eyebrow--gold">Private vault</p>
            <h2 className="h1">The papers behind the work</h2>
            <span className="rule rule--gold" aria-hidden="true" />
            <Notice tone="plain" icon={<Icon.Lock />}>
              <p className="strong">Appraisal-ready dossier.</p>
              <p>
                Kofi stores documents privately and logs every open. Kofi never estimates or labels an appraised value — qualified appraisers and insurers do that.
              </p>
            </Notice>
          </aside>
          <div className="st-split__main">{body}</div>
        </div>
      </main>
      {adding && q.data && <AddDocumentSheet works={q.data.works} onClose={() => setAdding(false)} />}
      <Confirm
        open={!!removing}
        onClose={() => setRemoving(undefined)}
        onConfirm={confirmRemove}
        title="Remove this document?"
        body={`“${removing?.title ?? ''}” and its file are deleted from your vault. Kofi’s activity record keeps a note that it existed and when it was removed, but not the file.`}
        confirmLabel="Remove document"
        danger
      />
    </div>
  );
}

function AddDocumentSheet({ works, onClose }: { works: ArtworkView[]; onClose: () => void }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [type, setType] = useState<DocumentType>('invoice');
  const [title, setTitle] = useState('');
  const [custodian, setCustodian] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [artworkId, setArtworkId] = useState('');
  const [file, setFile] = useState<File>();
  const [visibility, setVisibility] = useState<'private' | 'kofi'>('private');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Give the document a title, like “Invoice — Doubling”.';
    if (!file) e.file = 'Choose the file to store.';
    else if (file.size > MAX_DOC_BYTES) e.file = `This file is ${formatBytes(file.size)}. Documents must be under 10 MB — try a compressed PDF.`;
    if (!date) e.date = 'Add the date on the document.';
    setErrors(e);
    if (Object.keys(e).length || !file) return;
    setBusy(true);
    try {
      const payload = await readFileAsDataUrl(file);
      await data.addDocument(viewer, {
        type,
        title: title.trim(),
        custodian: custodian.trim(),
        date,
        fileName: file.name,
        sizeBytes: file.size,
        visibility,
        payload,
        ...(artworkId ? { artworkId } : {}),
      });
      toast.push('Document added to your vault', 'success');
      onClose();
    } catch (err) {
      const fe = fieldErrorFrom(err);
      if (fe) setErrors(fe);
      toast.push(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add document"
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={() => void save()}>
            Add to vault
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {capitalize(t)}
            </option>
          ))}
        </Select>
        {type === 'appraisal' && (
          <p className="tiny muted">Store letters from qualified appraisers here. Kofi keeps them private and never shows or estimates a value.</p>
        )}
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Input label="Custodian" value={custodian} onChange={(e) => setCustodian(e.target.value)} hint="Who holds the original — artist studio, collector, insurer." />
        <Input label="Date on the document" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <Select label="Attach to a work" value={artworkId} onChange={(e) => setArtworkId(e.target.value)} hint="Optional.">
          <option value="">Not attached to a work</option>
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </Select>
        <Field label="File" error={errors.file} hint="Any file type, up to 10 MB. PDFs and text files open in the browser.">
          {(id, describedBy) => (
            <input
              id={id}
              type="file"
              className="input st-file"
              aria-describedby={describedBy}
              aria-invalid={errors.file ? true : undefined}
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                setErrors((x) => ({ ...x, file: '' }));
              }}
            />
          )}
        </Field>
        {file && (
          <p className="tiny muted">
            {file.name}, {formatBytes(file.size)}
          </p>
        )}
        <Group label="Who can open it" hint={visibility === 'private' ? 'Only you. Kofi admins can open it if needed, and every open is logged.' : 'You and Kofi staff, for example during review. Every open is logged.'}>
          <Segmented<'private' | 'kofi'>
            label="Who can open it"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'private', label: 'Only me' },
              { value: 'kofi', label: 'Me and Kofi' },
            ]}
          />
        </Group>
      </div>
    </Sheet>
  );
}
