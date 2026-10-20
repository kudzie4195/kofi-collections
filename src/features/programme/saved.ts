/**
 * Works saved on this device ("Saved", the heart on an artwork page).
 *
 * Per-device only: a list of artwork ids in localStorage under `kofi.saved.v1`.
 * Every storage access is wrapped — private windows, blocked storage and quota
 * errors all fall back to an in-memory list for the rest of the session, so the
 * heart still works, it just isn't remembered. No cross-tab sync.
 */
import { useCallback, useSyncExternalStore } from 'react';

export const SAVED_KEY = 'kofi.saved.v1';
const MAX_SAVED = 500;

let memory: string[] | undefined;
const listeners = new Set<() => void>();

function sanitize(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === 'string' && x.length > 0 && x.length < 200 && !out.includes(x)) out.push(x);
  return out.slice(0, MAX_SAVED);
}

function readStorage(): string[] | undefined {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw === null) return [];
    return sanitize(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function writeStorage(ids: string[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the in-memory list carries on */
  }
}

/** Current saved ids (newest first). Stable reference until the list changes. */
export function getSaved(): string[] {
  if (memory === undefined) memory = readStorage() ?? [];
  return memory;
}

function setSaved(next: string[]): void {
  memory = sanitize(next);
  writeStorage(memory);
  for (const l of listeners) l();
}

export function isSaved(id: string): boolean {
  return getSaved().includes(id);
}

/** Toggle one id. Returns true when the work is now saved. */
export function toggleSaved(id: string): boolean {
  const cur = getSaved();
  if (cur.includes(id)) {
    setSaved(cur.filter((x) => x !== id));
    return false;
  }
  setSaved([id, ...cur]);
  return true;
}

/** Drop ids (e.g. works that are no longer visible). No-op when none are present. */
export function removeSaved(ids: string[]): void {
  const cur = getSaved();
  if (!ids.some((id) => cur.includes(id))) return;
  setSaved(cur.filter((x) => !ids.includes(x)));
}

/** Test helper: forget the in-memory copy so the next read goes back to storage. */
export function resetSavedCache(): void {
  memory = undefined;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSaved() {
  const ids = useSyncExternalStore(subscribe, getSaved, getSaved);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, has, toggle: toggleSaved, remove: removeSaved };
}
