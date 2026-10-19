import { useEffect, useState, type ReactNode } from 'react';
import { Button, Textarea, Sheet } from '@/ui';
import { errorMessage, useToast } from '@/state/toast';

export interface NoteAction {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'lime' | 'butter' | 'danger' | 'coral';
  noteLabel: string;
  noteHint?: string;
  /** 0 = optional. */
  minNote: number;
  run: (note: string) => Promise<void>;
}

/** A bottom sheet that asks for an (optional or required) staff note and runs one decision. */
export function NoteSheet({ action, onClose }: { action: NoteAction | undefined; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNote('');
    setError(undefined);
    setBusy(false);
  }, [action]);

  const go = async () => {
    if (!action) return;
    const len = note.trim().length;
    if (action.minNote > 0 && len < action.minNote) {
      setError(`Write at least ${action.minNote} characters so the reason is clear later (${len} so far).`);
      return;
    }
    setBusy(true);
    try {
      await action.run(note.trim());
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!action}
      onClose={onClose}
      title={action?.title ?? ''}
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button tone={action?.tone ?? 'primary'} block loading={busy} onClick={go}>
            {action?.confirmLabel}
          </Button>
        </>
      }
    >
      {action && (
        <div className="stack">
          <div className="small">{action.body}</div>
          <Textarea
            label={action.minNote > 0 ? action.noteLabel : `${action.noteLabel} (optional)`}
            hint={action.noteHint}
            value={note}
            error={error}
            maxLength={1000}
            onChange={(e) => {
              setNote(e.target.value);
              if (error) setError(undefined);
            }}
          />
        </div>
      )}
    </Sheet>
  );
}
