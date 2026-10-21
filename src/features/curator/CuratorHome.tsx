import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import { Button, EmptyState, ErrorState, Icon, Input, LinkButton, Notice, Sheet, Skeleton, TopBar } from '@/ui';
import { CuratorPass } from './CuratorPass';
import { formatDate } from './shared';
import './curator.css';

export function CuratorHome() {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery(async (ds, v) => {
    const curator = await ds.getMyCurator(v);
    const shortlists = curator ? await ds.listShortlists(v) : [];
    // The partner desk: only for verified curators; a pending curator sees nothing new.
    let partner: { calls: number; toReview: number; lots: number; sold: number } | undefined;
    if (curator?.status === 'verified') {
      const calls = await ds.listMyCalls(v).catch(() => []);
      if (calls.length) {
        const [apps, lots] = await Promise.all([ds.listApplications(v).catch(() => []), ds.listLots(v).catch(() => [])]);
        partner = {
          calls: calls.length,
          toReview: apps.filter((a) => a.status === 'submitted' || a.status === 'shortlisted').length,
          lots: lots.length,
          sold: lots.filter((l) => l.status === 'sold').length,
        };
      } else partner = { calls: 0, toReview: 0, lots: 0, sold: 0 };
    }
    return { curator, shortlists, partner };
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setName('');
    setNameError(undefined);
    setCreating(true);
  };

  const create = async () => {
    if (!name.trim()) {
      setNameError('Give the shortlist a name, like the show or project it is for.');
      return;
    }
    setBusy(true);
    try {
      const s = await data.createShortlist(viewer, name);
      toast.push(`Started “${s.name}”`, 'success');
      setCreating(false);
      nav(`/curator/shortlists/${s.id}`);
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'name') setNameError(e.message);
      else toast.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const curator = q.data?.curator;
  const status = curator?.status;
  const verified = status === 'verified';

  return (
    <div className="screen">
      <TopBar title="Shortlists" right={<LinkButton to="/curator/inquiries" tone="ghost" size="sm" className="ghost-flat" icon={<Icon.Inbox />}>Requests</LinkButton>} />
      <main className="container container--wide cu-main">
        {q.error && !q.data ? (
          <ErrorState error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <div className="stack" aria-busy="true" aria-label="Loading your shortlists">
            <Skeleton h={168} />
            <Skeleton h={56} />
            <Skeleton h={56} />
          </div>
        ) : (
          <div className="cu-split">
            <div className="cu-split__aside stack--lg">
            <CuratorPass curator={curator} fallbackName={viewer.displayName ?? 'Curator'} />

            {!verified && (
              <Notice tone={status === 'rejected' ? 'coral' : 'butter'} icon={status === 'rejected' ? <Icon.Warn /> : <Icon.Building />}>
                <div className="stack--sm">
                  <p className="strong">
                    {status === 'pending'
                      ? 'Kofi is checking your institution by hand.'
                      : status === 'rejected'
                        ? 'Kofi couldn’t verify your institution.'
                        : 'Verify your institution to start working with Kofi artists.'}
                  </p>
                  {status === 'rejected' && curator?.verificationNote && <p>Note from Kofi: {curator.verificationNote}</p>}
                  <p>
                    Verification unlocks prices artists share only with verified institutions, introduction requests through Kofi, and
                    shortlisting works that are shown to institutions only. Until then you can browse and shortlist public work.
                  </p>
                  <div>
                    <LinkButton to="/curator/verify" tone={status === 'rejected' ? 'secondary' : 'primary'} size="sm">
                      {status === 'pending' ? 'Review your request' : status === 'rejected' ? 'Update and resend' : 'Verify your institution'}
                    </LinkButton>
                  </div>
                </div>
              </Notice>
            )}
            </div>

            <div className="cu-split__main stack--lg">
            {q.data.partner && (
              <section className="stack" aria-labelledby="cu-calls-title">
                <p className="eyebrow eyebrow--gold">Partner desk</p>
                {q.data.partner.calls > 0 ? (
                  <ul className="list cu-lists cu-calls" aria-labelledby="cu-calls-title">
                    <li>
                      <Link to="/curator/calls" className="list-row cu-list-row">
                        <span className="sl-count" aria-hidden="true">
                          {q.data.partner.calls}
                        </span>
                        <span className="list-row__main">
                          <span className="list-row__title" style={{ display: 'block' }} id="cu-calls-title">
                            Calls you run
                          </span>
                          <span className="list-row__sub" style={{ display: 'block' }}>
                            {q.data.partner.calls === 1 ? '1 call' : `${q.data.partner.calls} calls`} · {q.data.partner.toReview} to review
                            {q.data.partner.lots ? ` · ${q.data.partner.lots} lots, ${q.data.partner.sold} sold` : ''}
                          </span>
                        </span>
                        <Icon.Back className="sl-row-chev" />
                      </Link>
                    </li>
                  </ul>
                ) : (
                  <p className="small muted" id="cu-calls-title">
                    Running an open call or a benefit auction with Kofi? <Link to="/curator/calls">Draft a call for your institution</Link>.
                  </p>
                )}
              </section>
            )}
            {curator ? (
              <section className="stack--lg">
                <div className="cu-head">
                  <div>
                    <p className="eyebrow eyebrow--gold">{q.data.shortlists.length === 1 ? '1 list' : `${q.data.shortlists.length} lists`}</p>
                    <h2 className="section-title">Your shortlists</h2>
                  </div>
                  {q.data.shortlists.length > 0 && (
                    <Button size="sm" icon={<Icon.Plus />} onClick={openCreate}>
                      New shortlist
                    </Button>
                  )}
                </div>
                {q.data.shortlists.length === 0 ? (
                  <EmptyState
                    title="No shortlists yet"
                    body="Start a list for a show, a commission call or a collection review, then add works from any artwork page in the gallery."
                    actions={
                      <>
                        <Button onClick={openCreate} icon={<Icon.Plus />}>
                          New shortlist
                        </Button>
                        <LinkButton to="/" tone="secondary" icon={<Icon.Gallery />}>
                          Browse the gallery
                        </LinkButton>
                      </>
                    }
                  />
                ) : (
                    <ul className="list cu-lists" aria-label="Shortlists">
                      {q.data.shortlists.map((s) => (
                        <li key={s.id}>
                          <Link to={`/curator/shortlists/${s.id}`} className="list-row cu-list-row">
                            <span className="sl-count" aria-hidden="true">
                              {s.items.length}
                            </span>
                            <span className="list-row__main">
                              <span className="list-row__title" style={{ display: 'block' }}>
                                {s.name}
                              </span>
                              <span className="list-row__sub" style={{ display: 'block' }}>
                                {s.items.length === 1 ? '1 work' : `${s.items.length} works`}, updated {formatDate(s.updatedAt)}
                              </span>
                            </span>
                            <Icon.Back className="sl-row-chev" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                )}
                <p className="small muted">To add a work, open it in the gallery and choose a shortlist.</p>
              </section>
            ) : (
              <EmptyState
                title="Shortlists start after you apply"
                body="Kofi keeps shortlists on your curator record. Send your institution details first; you can browse the public gallery while you wait."
                actions={
                  <>
                    <LinkButton to="/curator/verify">Verify your institution</LinkButton>
                    <LinkButton to="/" tone="secondary">
                      Browse the gallery
                    </LinkButton>
                  </>
                }
              />
            )}
            </div>
          </div>
        )}
      </main>

      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New shortlist"
        footer={
          <>
            <Button tone="secondary" block onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button block loading={busy} onClick={create}>
              Create shortlist
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="stack"
        >
          <Input
            label="Shortlist name"
            hint="Shortlists are yours alone. Kofi’s activity log notes when works are added or removed."
            value={name}
            maxLength={120}
            autoFocus
            error={nameError}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(undefined);
            }}
            placeholder="Spring 2027 group show"
          />
        </form>
      </Sheet>
    </div>
  );
}
