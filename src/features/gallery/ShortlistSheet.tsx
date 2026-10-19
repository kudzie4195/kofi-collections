import { useState } from 'react';
import { ValidationError } from '@/data/DataSource';
import type { Shortlist } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, ErrorState, Icon, Input, Sheet, Skeleton } from '@/ui';
import { plural } from './helpers';

/** Verified curator: add one work to an existing shortlist, or create one inline. */
export function ShortlistSheet({ open, onClose, artworkId, artworkTitle }: { open: boolean; onClose: () => void; artworkId: string; artworkTitle: string }) {
  const { data, viewer } = useSession();
  const toast = useToast();
  const lists = useQuery((d, v) => (open ? d.listShortlists(v) : Promise.resolve<Shortlist[] | undefined>(undefined)), [open]);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  const addTo = async (s: Shortlist) => {
    setBusyId(s.id);
    try {
      await data.addToShortlist(viewer, s.id, artworkId);
      toast.push(`Added to “${s.name}”`, 'success');
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const createAndAdd = async () => {
    if (!name.trim()) {
      setNameError('Name the shortlist, for example the show or commission it is for.');
      return;
    }
    setBusyId('new');
    try {
      const s = await data.createShortlist(viewer, name.trim());
      await data.addToShortlist(viewer, s.id, artworkId);
      toast.push(`Created “${s.name}” and added this work`, 'success');
      setName('');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'name') setNameError(e.message);
      else toast.push(errorMessage(e), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add to shortlist">
      <div className="stack">
        <p className="small muted">
          Saving <em>{artworkTitle}</em>. Shortlists are private to you.
        </p>
        {lists.error && !lists.data ? (
          <ErrorState error={lists.error} retry={lists.reload} />
        ) : !lists.data ? (
          <div className="stack--sm" aria-busy="true" aria-label="Loading shortlists">
            <Skeleton h={56} />
            <Skeleton h={56} />
          </div>
        ) : lists.data.length === 0 ? (
          <p className="small">You have no shortlists yet. Name your first one below.</p>
        ) : (
          <ul className="list" aria-label="Your shortlists">
            {lists.data.map((s) => {
              const has = s.items.some((i) => i.artworkId === artworkId);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="list-row"
                    onClick={() => !has && addTo(s)}
                    disabled={has || busyId !== undefined}
                    aria-busy={busyId === s.id || undefined}
                    aria-label={has ? `${s.name}, already saved here` : `Add to ${s.name}`}
                  >
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        {s.name}
                      </span>
                      <span className="list-row__sub">{has ? 'Already saved here' : plural(s.items.length, 'work')}</span>
                    </span>
                    {has ? <Icon.Check width={20} height={20} aria-hidden="true" /> : <Icon.Plus width={20} height={20} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="kg-inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            void createAndAdd();
          }}
        >
          <Input
            label="New shortlist"
            placeholder="e.g. Spring 2027 group show"
            value={name}
            error={nameError}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(undefined);
            }}
          />
          <Button type="submit" tone="secondary" loading={busyId === 'new'} disabled={busyId !== undefined && busyId !== 'new'}>
            Create and add
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
