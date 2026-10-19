import { useState } from 'react';
import type { ArtworkView } from '@/domain/types';
import { VISIBILITY_LABEL } from '@/domain/types';
import { saveTextFile } from '@/native/platform';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Confirm, ErrorState, Icon, Panel, Skeleton, TopBar } from '@/ui';
import { viewToInput } from './shared';

export function ExportScreen() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<'json' | 'csv' | 'hide'>();
  const [confirmHide, setConfirmHide] = useState(false);

  const q = useQuery(
    async (ds, v) => {
      const [artist, works] = await Promise.all([ds.getMyArtist(v), v.artistId ? ds.listArtistArtworks(v, v.artistId) : Promise.resolve([] as ArtworkView[])]);
      return { artist, works };
    },
    [],
  );

  async function download(kind: 'json' | 'csv') {
    setBusy(kind);
    try {
      const res = await data.exportMyData(viewer);
      const outcome =
        kind === 'json'
          ? await saveTextFile(`${res.fileBaseName}.json`, res.json, 'application/json')
          : await saveTextFile(`${res.fileBaseName}.csv`, res.csv, 'text/csv');
      toast.push(outcome === 'shared' ? 'Shared' : 'Export ready', 'success');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function hideEverything() {
    if (!q.data) return;
    setBusy('hide');
    let hidden = 0;
    try {
      if (q.data.artist?.visibility !== 'private') await data.updateMyArtist(viewer, { visibility: 'private' });
      for (const w of q.data.works) {
        if (w.visibility === 'private') continue;
        await data.saveArtwork(viewer, viewToInput(w, { visibility: 'private' }));
        hidden++;
      }
      setConfirmHide(false);
      toast.push(`Profile hidden. ${hidden === 1 ? '1 work' : `${hidden} works`} set to Only me.`, 'success');
    } catch (e) {
      toast.push(`${errorMessage(e)} ${hidden ? `${hidden} works were hidden before this stopped; try again to finish.` : 'Nothing was changed; try again.'}`, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  const works = q.data?.works ?? [];
  const visibleWorks = works.filter((w) => w.visibility !== 'private').length;
  const profileVis = q.data?.artist?.visibility;
  const allHidden = profileVis === 'private' && visibleWorks === 0;

  return (
    <div className="screen">
      <TopBar title="Export or withdraw" back="/studio" />
      <main className="container section stack--lg">
        <section className="stack" aria-labelledby="export-title">
          <h2 className="h2" id="export-title">
            Your records are yours to take
          </h2>
          <p className="lede">Download a full copy any time. No lock-in — the export is built to be read by a person or another system.</p>
          <Panel pinned>
            <h3 className="h3">What’s in the export</h3>
            <ul className="st-checklist">
              <li>
                <Icon.Check aria-hidden="true" />
                <span>Your profile, including private contact details and legal name.</span>
              </li>
              <li>
                <Icon.Check aria-hidden="true" />
                <span>Every work — drafts too — with images, prices and each visibility setting.</span>
              </li>
              <li>
                <Icon.Check aria-hidden="true" />
                <span>Vault document details: type, title, custodian, date and file name.</span>
              </li>
              <li className="st-checklist__no">
                <Icon.Close aria-hidden="true" />
                <span>Not the document files themselves. Open each one from your vault to keep a copy.</span>
              </li>
            </ul>
            <p className="tiny muted">JSON holds everything. CSV is one row per work, for spreadsheets. Each export is noted in your activity record.</p>
            <div className="row row--wrap st-export-actions">
              <Button icon={<Icon.Download />} loading={busy === 'json'} disabled={!!busy} onClick={() => void download('json')}>
                Download JSON
              </Button>
              <Button tone="secondary" icon={<Icon.Download />} loading={busy === 'csv'} disabled={!!busy} onClick={() => void download('csv')}>
                Download CSV
              </Button>
            </div>
          </Panel>
        </section>

        <section className="stack" aria-labelledby="withdraw-title">
          <h2 className="h2" id="withdraw-title">
            Correct or withdraw
          </h2>
          <Panel tint>
            <div className="stack prose">
              <p>
                <span className="strong">To correct anything,</span> edit your profile or the work. Changes show right away, everywhere.
              </p>
              <p>
                <span className="strong">To withdraw from discovery,</span> set your profile and every work to “Only me”. You disappear from the gallery, the artist list and curator search at once. Nothing is deleted, and you can make things public again whenever you like.
              </p>
              <p>
                <span className="strong">What Kofi keeps.</span> An append-only activity record of sensitive actions — consent, visibility changes, document opens, exports and introductions. It holds who did what and when, never your images or files. Kofi keeps it even after you withdraw, so you, Kofi and any institution can always account for who saw your private records.
              </p>
            </div>
          </Panel>

          {q.error && !q.data ? (
            <ErrorState error={q.error} retry={q.reload} />
          ) : !q.data ? (
            <Skeleton h={96} />
          ) : (
            <div className="st-withdraw">
              <p className="small" aria-live="polite">
                Right now: profile <span className="strong">{profileVis ? VISIBILITY_LABEL[profileVis] : 'unknown'}</span>,{' '}
                <span className="strong">
                  {visibleWorks} of {works.length}
                </span>{' '}
                {works.length === 1 ? 'work' : 'works'} visible to someone besides you.
              </p>
              <Button tone="coral" icon={<Icon.EyeOff />} loading={busy === 'hide'} disabled={!!busy || allHidden} onClick={() => setConfirmHide(true)}>
                {allHidden ? 'Everything is hidden' : 'Hide everything now'}
              </Button>
            </div>
          )}
        </section>
      </main>

      <Confirm
        open={confirmHide}
        onClose={() => setConfirmHide(false)}
        onConfirm={hideEverything}
        title="Hide everything now?"
        body={`Your profile and ${visibleWorks === 1 ? 'the 1 visible work' : `all ${visibleWorks} visible works`} will be set to “Only me”. They leave the gallery and curator search immediately. Prices, documents and records stay as they are, and you can make things public again one by one.`}
        confirmLabel="Hide everything"
      />
    </div>
  );
}
