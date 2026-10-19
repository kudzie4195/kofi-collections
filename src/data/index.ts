import type { DataSource } from './DataSource';
import { MockDataSource } from './mock/MockDataSource';

let instance: DataSource | undefined;
let pending: Promise<DataSource> | undefined;

/**
 * Resolve the app's data source once. Mock by default; Supabase when
 * VITE_DATA_MODE=supabase and credentials are present (lazy-loaded so the
 * on-device demo bundle doesn't pay for supabase-js).
 */
export function loadDataSource(): Promise<DataSource> {
  if (instance) return Promise.resolve(instance);
  if (pending) return pending;
  const p: Promise<DataSource> = (async (): Promise<DataSource> => {
    const mode = (import.meta.env.VITE_DATA_MODE as string | undefined) ?? 'mock';
    if (mode === 'supabase') {
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      if (url && key) {
        const mod = await import('./supabase/SupabaseDataSource');
        const ds: DataSource = mod.createSupabaseDataSource(url, key);
        instance = ds;
        return ds;
      }
      console.warn('[kofi] VITE_DATA_MODE=supabase but URL/key missing — falling back to mock data.');
    }
    const ds: DataSource = new MockDataSource();
    instance = ds;
    return ds;
  })();
  pending = p;
  return p;
}

/** Test helper. */
export function setDataSource(ds: DataSource): void {
  instance = ds;
  pending = undefined;
}
