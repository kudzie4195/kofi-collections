import { useEffect, useMemo } from 'react';
import { useQuery } from '@/state/session';
import { Button, EmptyState, ErrorState, GallerySkeleton, LinkButton, SiteFooter, TopBar, WallLabel } from '@/ui';
import { plural } from '@/features/gallery/helpers';
import { PageHead } from './shared';
import { useSaved } from './saved';

/** Works saved on this device. Works the viewer can no longer see are dropped silently (and forgotten). */
export function SavedScreen() {
  const saved = useSaved();
  const q = useQuery((data, viewer) => data.listArtworks(viewer), []);
  const byId = useMemo(() => new Map((q.data ?? []).map((w) => [w.id, w])), [q.data]);
  const works = useMemo(() => saved.ids.map((id) => byId.get(id)).filter((w): w is NonNullable<typeof w> => !!w), [saved.ids, byId]);

  useEffect(() => {
    if (!q.data || q.loading) return;
    const gone = saved.ids.filter((id) => !byId.has(id));
    if (gone.length) saved.remove(gone);
  }, [q.data, q.loading, saved, byId]);

  return (
    <div className="screen kp-page">
      <TopBar title="Saved" home subordinate />
      <main className="container container--wide kp-main">
        <PageHead
          eyebrow="On this device"
          title="Saved works"
          lede="Works you have saved with the heart. They are kept on this device only; nothing is sent to Kofi."
          aside={q.data && works.length > 0 ? <p className="eyebrow kp-head__count">{plural(works.length, 'work')}</p> : undefined}
        />
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <GallerySkeleton n={3} />
        ) : works.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            body="Tap the heart on any work to keep it here. Handy for a shortlist before you ask Kofi about a piece."
            actions={<LinkButton to="/works">Browse works</LinkButton>}
          />
        ) : (
          <>
            <ul className="gallery-grid" aria-label="Saved works">
              {works.map((w) => (
                <li key={w.id} className="kp-saved">
                  <WallLabel work={w} to={`/work/${w.id}`} unit={w.dimensions.unit} />
                  <Button tone="ghost" size="sm" onClick={() => saved.toggle(w.id)} aria-label={`Remove ${w.title} from saved`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className="kp-savedcta">
              <p className="kp-savedcta__text">Thinking about one of these? Open the work and ask Kofi: the team can tell you about availability, viewing and terms.</p>
              <LinkButton to="/works" tone="secondary">
                Keep browsing
              </LinkButton>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
