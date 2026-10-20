/** Shared vocabulary for the Kofi programme desk (list + editors). */
import type { Exhibition, OpenCall, ProgrammeEvent, Story } from '@/domain/types';

export type ProgrammeKind = 'exhibitions' | 'calls' | 'events' | 'stories';
export const PROGRAMME_KINDS: ProgrammeKind[] = ['exhibitions', 'calls', 'events', 'stories'];

export function isProgrammeKind(s: string | null | undefined): s is ProgrammeKind {
  return !!s && (PROGRAMME_KINDS as string[]).includes(s);
}

export const KIND_LABEL: Record<ProgrammeKind, string> = {
  exhibitions: 'Exhibitions',
  calls: 'Open calls',
  events: 'Events',
  stories: 'Journal',
};

export const KIND_SINGULAR: Record<ProgrammeKind, string> = {
  exhibitions: 'exhibition',
  calls: 'open call',
  events: 'event',
  stories: 'story',
};

/** Where the published item lives on the public site. */
export function publicPath(kind: ProgrammeKind, id: string): string {
  switch (kind) {
    case 'exhibitions':
      return `/exhibitions/${id}`;
    case 'calls':
      return `/calls/${id}`;
    case 'stories':
      return `/journal/${id}`;
    case 'events':
      return '/whats-on';
  }
}

export type AnyProgrammeItem = Exhibition | OpenCall | ProgrammeEvent | Story;
