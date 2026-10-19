import type { DataSource } from '../DataSource';

/** Replaced by the Supabase worker. Until then, throws so misconfiguration is loud. */
export function createSupabaseDataSource(_url: string, _key: string): DataSource {
  throw new Error('Supabase data source not implemented yet.');
}
