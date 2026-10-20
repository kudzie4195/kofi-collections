import { useEffect, useRef, useState } from 'react';
import type { BuyerIntent } from '@/domain/types';
import { BUYER_INTENT_LABEL, BUYER_INTENTS } from '@/domain/types';
import { validateBuyerInquiry, type BuyerInquiryInput } from '@/domain/programme';
import { ValidationError } from '@/data/DataSource';
import { useSession } from '@/state/session';
import { errorMessage } from '@/state/toast';
import { Button, Icon, Input, Notice, Select, Sheet, Textarea } from '@/ui';

export interface InquiryArtwork {
  id: string;
  title: string;
  artistName: string;
}

/** Remember what had focus when a sheet opened and give it back when it closes. */
export function useFocusReturn(open: boolean): void {
  const prev = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement | null;
    return () => {
      const el = prev.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open]);
}

/**
 * "Ask Kofi" — a collector / buyer inquiry routed through Kofi. Anyone can send
 * one; the artist's contact details are never shown. With no artwork it is a
 * general "Get in touch" form (About page).
 */
export function CollectorInquirySheet({ open, onClose, artwork }: { open: boolean; onClose: () => void; artwork?: InquiryArtwork }) {
  const { data, viewer } = useSession();
  useFocusReturn(open);
  const initialMessage = artwork ? `I'm interested in ${artwork.title} by ${artwork.artistName}.` : '';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [intent, setIntent] = useState<BuyerIntent>(artwork ? 'purchase' : 'placement');
  const [message, setMessage] = useState(initialMessage);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string }>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setSentTo(undefined);
    setBusy(false);
    setMessage((m) => (m.trim() ? m : initialMessage));
    if (viewer.displayName && viewer.role !== 'public') setName((n) => n || viewer.displayName!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artwork?.id]);

  const fieldError = (f: string) => (error?.field === f ? error.message : undefined);

  const submit = async () => {
    const input: BuyerInquiryInput = {
      name,
      email: email.trim(),
      intent,
      message,
      consent,
      ...(organization.trim() ? { organization: organization.trim() } : {}),
      ...(artwork ? { artworkId: artwork.id } : {}),
    };
    const problem = validateBuyerInquiry(input);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await data.submitBuyerInquiry(viewer, input);
      setSentTo(input.email);
    } catch (e) {
      if (e instanceof ValidationError) setError({ field: e.field, message: e.message });
      else setError({ message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const title = artwork ? 'Ask Kofi about this work' : 'Get in touch';

  if (sentTo) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        footer={
          <Button block onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="kp-sent" role="status">
          <span className="kp-sent__mark" aria-hidden="true">
            <Icon.Check />
          </span>
          <p className="kp-sent__title">Thanks — Kofi will reply to {sentTo}</p>
          <p className="small muted">
            {artwork ? `Your note about ${artwork.title} goes to the Kofi team, who speak with the artist on your behalf.` : 'Your note goes to the Kofi team.'} Usually within two working days.
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button tone="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button block loading={busy} onClick={() => void submit()}>
            Send to Kofi
          </Button>
        </>
      }
    >
      <form
        className="stack kp-inquiry"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="small muted">
          {artwork ? (
            <>
              Kofi handles every inquiry about <span className="strong">{artwork.title}</span> and speaks with {artwork.artistName} for you. The artist’s own contact details are never shared.
            </>
          ) : (
            <>Collectors, organisations and artists: tell Kofi what you are looking for and the team will reply by email.</>
          )}
        </p>
        {error && !error.field && (
          <Notice tone="coral" icon={<Icon.Warn />}>
            {error.message}
          </Notice>
        )}
        <Input label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldError('name')} />
        <Input label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError('email')} />
        <Input label="Organisation (optional)" autoComplete="organization" value={organization} onChange={(e) => setOrganization(e.target.value)} error={fieldError('organization')} />
        <Select label="What are you asking about?" value={intent} onChange={(e) => setIntent(e.target.value as BuyerIntent)} error={fieldError('intent')}>
          {BUYER_INTENTS.map((i) => (
            <option key={i} value={i}>
              {BUYER_INTENT_LABEL[i]}
            </option>
          ))}
        </Select>
        <Textarea label="Message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} error={fieldError('message')} hint="Timing, budget, the space you have in mind: anything that helps." />
        <div className="field">
          <label className="kp-check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={fieldError('consent') ? true : undefined} aria-describedby={fieldError('consent') ? 'kp-consent-err' : undefined} />
            <span>Kofi may email me about this inquiry. Kofi does not share my details with the artist or anyone else without asking.</span>
          </label>
          {fieldError('consent') && (
            <span className="field__error" id="kp-consent-err" role="alert">
              {fieldError('consent')}
            </span>
          )}
        </div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
