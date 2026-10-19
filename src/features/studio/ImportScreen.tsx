import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IMPORT_TEMPLATE_CSV, importArtworksCsv, type ImportResult } from '@/domain/importCsv';
import { saveTextFile } from '@/native/platform';
import { useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Icon, Notice, Panel, TopBar } from '@/ui';

const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * Reviewable CSV import. Parse → show every row with its problems → the artist
 * confirms → rows are created one by one as "Only me" drafts. Nothing is written
 * before the confirm step, and a failing row never blocks the others.
 */
export function ImportScreen() {
  const { data, viewer } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>();
  const [result, setResult] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; failed: string[] }>();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      toast.push('That file is over 2 MB. Split it into smaller sheets.', 'error');
      return;
    }
    const text = await file.text();
    const parsed = importArtworksCsv(text);
    setFileName(file.name);
    setResult(parsed);
    setDone(undefined);
  };

  const run = async () => {
    if (!result) return;
    setBusy(true);
    let created = 0;
    const failed: string[] = [];
    for (const row of result.rows) {
      if (!row.input) continue;
      try {
        await data.saveArtwork(viewer, row.input);
        created++;
      } catch (e) {
        failed.push(`Line ${row.line} (${row.preview.title}): ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    setDone({ created, failed });
    toast.push(created ? `Imported ${created} ${created === 1 ? 'work' : 'works'} as drafts` : 'Nothing was imported', created ? 'success' : 'error');
  };

  return (
    <div className="screen">
      <TopBar title="Import works" back="/studio" />
      <main className="container stack--lg" style={{ paddingTop: 20 }}>
        <section className="stack">
          <h2 className="h2">Bring in a spreadsheet</h2>
          <p className="lede">Review every row before anything is saved. Imported works start as “Only me” drafts without images.</p>
          <Notice tone="plain" icon={<Icon.Doc />}>
            Use the same columns as the CSV export (title, year, medium, materials, height, width, depth, unit, status, price_amount, price_currency, price_visibility, description, rights_note, tags). Separate several materials or tags with “;”.
          </Notice>
          <div className="row row--wrap">
            <Button
              tone="secondary"
              size="sm"
              icon={<Icon.Download />}
              onClick={async () => {
                try {
                  await saveTextFile('kofi-import-template.csv', IMPORT_TEMPLATE_CSV, 'text/csv');
                } catch (e) {
                  toast.push(errorMessage(e), 'error');
                }
              }}
            >
              Download template
            </Button>
          </div>
        </section>

        <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]); }}>
          <span className="strong">Drop a CSV here, or choose a file</span>
          <span className="small muted" style={{ display: 'block', marginTop: 4 }}>
            {fileName ?? 'UTF-8 .csv up to 2 MB'}
          </span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <div style={{ marginTop: 10 }}>
            <Button tone="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
          </div>
        </label>

        {result && (
          <Panel title={`Review ${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'}`} pinned>
            {result.missingColumns.length > 0 && (
              <Notice tone="coral" icon={<Icon.Warn />}>
                Missing required columns: {result.missingColumns.join(', ')}. Fix the header row and choose the file again.
              </Notice>
            )}
            <p className="small muted" style={{ margin: '8px 0 12px' }}>
              {result.ok} ready · {result.failed} with problems. Rows with problems are skipped; fix them in the sheet and import again.
            </p>
            <ul className="list" aria-label="Rows to import">
              {result.rows.map((row) => (
                <li key={row.line} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <span className={`status-dot status-dot--${row.input ? 'approved' : 'declined'}`} aria-hidden="true" style={{ marginTop: 8 }} />
                  <div className="list-row__main">
                    <div className="list-row__title" style={{ whiteSpace: 'normal' }}>
                      {row.preview.title} <span className="muted small">· line {row.line}</span>
                    </div>
                    <div className="list-row__sub">
                      {row.preview.year} · {row.preview.medium} · {row.preview.dimensions} · {row.preview.price}
                    </div>
                    {row.problems.length > 0 && (
                      <ul className="small" style={{ color: 'var(--danger)', marginTop: 4, fontWeight: 600 }}>
                        {row.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="row row--wrap" style={{ marginTop: 14 }}>
              <Button onClick={run} loading={busy} disabled={result.ok === 0 || busy || !!done}>
                {done ? 'Imported' : `Import ${result.ok} as drafts`}
              </Button>
              <Button tone="ghost" onClick={() => { setResult(undefined); setFileName(undefined); setDone(undefined); }}>
                Start over
              </Button>
            </div>
          </Panel>
        )}

        {done && (
          <Notice tone={done.failed.length ? 'butter' : 'lime'} icon={<Icon.Check />}>
            <div className="stack--sm">
              <div>
                {done.created} {done.created === 1 ? 'work' : 'works'} added to your studio as drafts. Add images, then set each one to Public when it is ready.
              </div>
              {done.failed.map((f) => (
                <div key={f} className="small">
                  {f}
                </div>
              ))}
              <div>
                <Button size="sm" tone="secondary" onClick={() => nav('/studio')}>
                  Go to your works
                </Button>
              </div>
            </div>
          </Notice>
        )}
      </main>
    </div>
  );
}
