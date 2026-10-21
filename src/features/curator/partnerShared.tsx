/**
 * The partner desk ("Calls you run"): shared vocabulary, the verification gate
 * and small presentational pieces. A partner is a verified curator whose
 * institution organises a call; the data layer enforces every rule — this file
 * only decides what to show.
 */
import type { ReactNode } from 'react';
import type { LotStatus, OpenCall } from '@/domain/types';
import type { CuratorRow } from '@/data/DataSource';
import { ForbiddenError } from '@/data/DataSource';
import { callPhase } from '@/domain/programme';
import { CALL_PHASE_LABEL } from '@/features/programme/format';
import { EmptyState, ErrorState, LinkButton, TopBar } from '@/ui';

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  planned: 'Planned',
  live: 'Live',
  sold: 'Sold',
  unsold: 'Unsold',
  withdrawn: 'Withdrawn',
};
export const LOT_STATUS_DOT: Record<LotStatus, string> = { planned: 'pending', live: 'forwarded', sold: 'accepted', unsold: 'draft', withdrawn: 'declined' };

/** The button that moves a lot to `to`. */
export const LOT_MOVE_LABEL: Record<Exclude<LotStatus, 'sold'>, string> = {
  planned: 'Back to planned',
  live: 'Mark live',
  unsold: 'Mark unsold',
  withdrawn: 'Withdraw',
};

export function isPartnerCurator(c: CuratorRow | undefined): c is CuratorRow {
  return !!c && c.status === 'verified';
}

/** Small status badge in the admin desk's vocabulary (pg-badge classes from admin/programme.css). */
export function Badge({ tone, children }: { tone: 'now' | 'soon' | 'past' | 'draft' | 'sample'; children: ReactNode }) {
  return <span className={`pg-badge pg-badge--${tone}`}>{children}</span>;
}

export function PhaseBadge({ call }: { call: Pick<OpenCall, 'opensOn' | 'deadline'> }) {
  const p = callPhase(call);
  return <Badge tone={p === 'open' ? 'now' : p === 'upcoming' ? 'soon' : 'past'}>{CALL_PHASE_LABEL[p]}</Badge>;
}

export function PublishBadge({ published }: { published: boolean }) {
  return published ? <span className="pc-pub">Published</span> : <Badge tone="draft">Draft</Badge>;
}

/**
 * The partner desk's frame. TopBar title is the route's only h1.
 */
export function PartnerShell({ title, back = '/curator/calls', children, wide = true }: { title: string; back?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="screen">
      <TopBar title={title} back={back} />
      <main className={`container ${wide ? 'container--wide' : ''} cu-main pc-main`}>{children}</main>
    </div>
  );
}

/**
 * What a curator who can't run calls sees instead (pending, rejected or never
 * applied). Never throws: the desk explains and links to verification.
 */
export function PartnerGate({ curator }: { curator: CuratorRow | undefined }) {
  const status = curator?.status;
  return (
    <EmptyState
      title={status === 'pending' ? 'Verification pending' : status === 'rejected' ? 'Not verified' : 'Verify your institution first'}
      body={
        status === 'pending'
          ? 'Kofi is checking your institution by hand. Once it is verified, the open calls your institution runs with Kofi appear here.'
          : status === 'rejected'
            ? 'Kofi couldn’t verify your institution, so you can’t run calls yet. Update your request and Kofi will look again.'
            : 'Calls are run by verified institutions. Send your institution’s details to Kofi first.'
      }
      actions={
        <LinkButton to="/curator/verify" tone={status === 'pending' ? 'secondary' : 'primary'}>
          {status === 'pending' ? 'Review your request' : status === 'rejected' ? 'Update and resend' : 'Verify your institution'}
        </LinkButton>
      }
    />
  );
}

/** A load error, except "forbidden", which is the gate (e.g. verification was revoked mid-session). */
export function PartnerError({ error, retry, curator }: { error: Error; retry: () => void; curator?: CuratorRow }) {
  if (error instanceof ForbiddenError) return <PartnerGate curator={curator} />;
  return <ErrorState error={error} retry={retry} />;
}
