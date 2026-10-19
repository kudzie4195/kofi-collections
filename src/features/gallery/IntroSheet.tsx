import { useEffect, useState } from 'react';
import { ValidationError } from '@/data/DataSource';
import { useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, Icon, Notice, Sheet, Textarea } from '@/ui';

const MIN_CHARS = 20;

/**
 * A verified curator asks Kofi for an introduction to an artist, optionally
 * about one work. Kofi reviews and forwards; artist contact is never shared.
 */
export function IntroSheet({
  open,
  onClose,
  artistId,
  artistName,
  artworkId,
  artworkTitle,
}: {
  open: boolean;
  onClose: () => void;
  artistId: string;
  artistName: string;
  artworkId?: string;
  artworkTitle?: string;
}) {
  const { data, viewer } = useSession();
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setError(undefined);
  }, [open]);

  const len = message.trim().length;

  const send = async () => {
    if (len < MIN_CHARS) {
      setError(`Write at least ${MIN_CHARS} characters so Kofi and ${artistName} understand the opportunity.`);
      return;
    }
    setBusy(true);
    try {
      const input: { artistId: string; artworkId?: string; message: string } = { artistId, message: message.trim() };
      if (artworkId) input.artworkId = artworkId;
      await data.createInquiry(viewer, input);
      toast.push(`Request sent. Kofi will review it before forwarding to ${artistName}.`, 'success');
      setMessage('');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'message') setError(e.message);
      else toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Request an introduction"
      footer={
        <>
          <Button tone="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={send}>
            Send request
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>
          To <strong>{artistName}</strong>
          {artworkTitle && (
            <>
              , about <em>{artworkTitle}</em>
            </>
          )}
          .
        </p>
        <Textarea
          label="Your message"
          hint={`Say what the opportunity is, the timing and your institution. ${len < MIN_CHARS ? `${MIN_CHARS - len} more characters needed.` : 'Ready to send.'}`}
          error={error}
          value={message}
          rows={5}
          onChange={(e) => {
            setMessage(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <Notice tone="plain" icon={<Icon.Lock />}>
          Kofi reviews every request and forwards it to the artist. Their email, phone and studio address are never shared with you. If {artistName} accepts, Kofi makes the introduction.
        </Notice>
      </div>
    </Sheet>
  );
}
