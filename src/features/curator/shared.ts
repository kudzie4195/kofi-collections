import type { CuratorStatus, InquiryStatus, InstitutionType } from '@/domain/types';

export const INSTITUTION_TYPES: { value: InstitutionType; label: string }[] = [
  { value: 'museum', label: 'Museum' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'university', label: 'University' },
  { value: 'nonprofit', label: 'Nonprofit' },
  { value: 'corporate', label: 'Corporate collection' },
  { value: 'municipal', label: 'Municipal or public art program' },
  { value: 'other', label: 'Other' },
];

export function institutionTypeLabel(t: InstitutionType): string {
  return INSTITUTION_TYPES.find((x) => x.value === t)?.label ?? t;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export const CURATOR_STATUS_LABEL: Record<CuratorStatus | 'none', string> = {
  verified: 'Verified by Kofi',
  pending: 'Verification pending',
  rejected: 'Not verified',
  none: 'Not verified yet',
};

/** Plain-language inquiry status, from the curator's side of the desk. */
export const INQUIRY_STATUS_COPY: Record<InquiryStatus, string> = {
  pending: 'Kofi is reviewing',
  forwarded: 'Forwarded to the artist',
  accepted: 'Introduction accepted — Kofi will connect you',
  declined: 'Declined',
};

/** Inquiries that still count as "open" for a given work: don't invite a duplicate. */
export function isActiveInquiry(status: InquiryStatus): boolean {
  return status === 'pending' || status === 'forwarded' || status === 'accepted';
}

export const MIN_INTRO_MESSAGE = 20;
