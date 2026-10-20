import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CONSENT_VERSION } from '@/domain/types';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, ErrorState, FictionalFooter, Icon, Notice, Skeleton, TopBar } from '@/ui';
import { formatDate } from './shared';

const TERMS: { title: string; body: string }[] = [
  {
    title: 'Your work stays yours.',
    body: 'You keep ownership of every work and its copyright. Nothing in these terms transfers rights to Kofi.',
  },
  {
    title: 'Kofi shows only what you mark visible.',
    body: 'You give Kofi a limited, non-exclusive licence to display the images and details you mark visible — to the public, to verified institutions or to Kofi staff — for as long as they stay marked that way. Change a setting and the licence follows it.',
  },
  {
    title: 'Introductions go through Kofi.',
    body: 'Curators never see your contact details. Kofi reviews every request, and your email is shared only when you accept an introduction.',
  },
  {
    title: 'You can export or withdraw at any time.',
    body: 'Download your profile, works and document details whenever you like, or hide everything from discovery in one step. No lock-in.',
  },
  {
    title: 'Private means private, with one logged exception.',
    body: 'Kofi admins can open private records to support you and keep the platform safe. Every open is recorded with who, what and when, and that record is kept even if you withdraw.',
  },
  {
    title: 'Kofi doesn’t appraise.',
    body: 'Kofi never estimates or labels the value of your work. Appraisals come from qualified appraisers; you can keep their letters in your private vault.',
  },
];

export function Consent() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const thenSubmit = (loc.state as { next?: string } | null)?.next === 'submit';
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery((ds, v) => ds.getMyArtist(v), []);

  const current = q.data?.consentVersion === CONSENT_VERSION;

  async function accept() {
    setBusy(true);
    try {
      await data.acceptConsent(viewer, CONSENT_VERSION);
      if (thenSubmit && q.data?.status === 'draft') {
        await data.submitForReview(viewer);
        toast.push('Terms accepted. Your profile is with Kofi for review.', 'success');
      } else toast.push('Terms accepted', 'success');
      nav('/studio');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <TopBar title="Artist terms" back="/studio" />
      <main className="container container--wide section">
        <div className="st-split">
        <header className="st-split__aside stack">
          <p className="kicker">Version {CONSENT_VERSION}</p>
          <h2 className="h1">The deal, in plain language</h2>
          <span className="rule" aria-hidden="true" />
          <p className="lede">Six things to know before Kofi shows any of your work.</p>

        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : q.loading && !q.data ? (
          <Skeleton h={40} />
        ) : current ? (
          <Notice tone="lime" icon={<Icon.Check />}>
            You agreed to version {CONSENT_VERSION}
            {q.data?.consentAcceptedAt ? ` on ${formatDate(q.data.consentAcceptedAt)}` : ''}. You can read the terms again here at any time.
          </Notice>
        ) : q.data?.consentVersion ? (
          <Notice tone="butter" icon={<Icon.Warn />}>
            The terms changed since you agreed to version {q.data.consentVersion}. Please read and agree to the current version.
          </Notice>
        ) : null}
        </header>

        <div className="st-split__main stack--lg">
        <ol className="st-terms">
          {TERMS.map((t, i) => (
            <li key={t.title} className="st-terms__item">
              <span className="st-terms__num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3 className="h3">{t.title}</h3>
                <p className="small">{t.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <section className="st-agree" aria-label="Agree to the terms">
          <label className="st-check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              <span className="strong">I understand and agree</span>
              <span className="tiny muted" style={{ display: 'block' }}>
                Recorded with the date and version {CONSENT_VERSION} in your activity record.
              </span>
            </span>
          </label>
          {thenSubmit && q.data?.status === 'draft' && <p className="small">After you agree, your profile goes to Kofi for review.</p>}
          <Button block disabled={!agreed || busy || !q.data} loading={busy} onClick={() => void accept()}>
            Agree and continue
          </Button>
        </section>
        </div>
        </div>
        <FictionalFooter />
      </main>
    </div>
  );
}
