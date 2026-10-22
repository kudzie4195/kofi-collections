import type { ArtistView, IntakeStep } from '@/domain/types';
import { INTAKE_STEPS } from '@/domain/types';

/**
 * Step one's draft (name, email, consent tick) under `kofi.intake.v1`. The password is
 * never written anywhere. After sign-up the profile itself is the draft.
 */
export const DRAFT_KEY = 'kofi.intake.v1';
/** Which optional steps an artist has moved past (links and work can be skipped). */
export const DONE_KEY = 'kofi.intake.done.v1';

export interface AccountDraft {
  displayName: string;
  email: string;
  consent: boolean;
}

export function loadDraft(): AccountDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Partial<AccountDraft>) : {};
    return { displayName: typeof d.displayName === 'string' ? d.displayName : '', email: typeof d.email === 'string' ? d.email : '', consent: d.consent === true };
  } catch {
    return { displayName: '', email: '', consent: false };
  }
}

export function saveDraft(d: AccountDraft): void {
  try {
    // Explicit fields only, so nothing else (a password) can ride along.
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ displayName: d.displayName, email: d.email, consent: d.consent }));
  } catch {
    /* storage blocked: the form still works, it just won't survive a reload */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function readDone(): Record<string, IntakeStep[]> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? (v as Record<string, IntakeStep[]>) : {};
  } catch {
    return {};
  }
}

export function markDone(userId: string | undefined, step: IntakeStep): void {
  if (!userId) return;
  const all = readDone();
  const mine = new Set(all[userId] ?? []);
  mine.add(step);
  all[userId] = [...mine];
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function doneSteps(userId: string | undefined): Set<IntakeStep> {
  return new Set(userId ? readDone()[userId] ?? [] : []);
}

/** The about step is complete when everything readyForReview asks of the profile text is there. */
export function aboutComplete(a: Pick<ArtistView, 'workingName' | 'bio' | 'region' | 'mediums'>): boolean {
  return !!a.workingName.trim() && a.bio.trim().length >= 40 && !!a.region?.region && !!a.region?.country && a.mediums.length > 0;
}

/** Where an artist who opens /join should land: the first step that isn't finished. */
export function firstUnfinished(a: ArtistView, workCount: number, done: Set<IntakeStep>): IntakeStep {
  if (!a.links.length && !(a.imports?.length) && !done.has('links')) return 'links';
  if (!aboutComplete(a)) return 'about';
  if (workCount < 1 && !done.has('work')) return 'work';
  return 'verify';
}

export function isStep(s: string | undefined): s is IntakeStep {
  return !!s && (INTAKE_STEPS as string[]).includes(s);
}
