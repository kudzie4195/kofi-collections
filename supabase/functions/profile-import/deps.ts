/**
 * HandlerDeps backed by Supabase. `createClient` is passed in (index.ts uses
 * npm:@supabase/supabase-js in Deno; the local harness passes the Node copy),
 * so this file has no remote imports and no Deno globals.
 *
 *   caller-scoped client  (anon key + the caller's Authorization header):
 *     auth.getUser, rpc whoami, select from artists_visible, rpc log_audit —
 *     RLS and the owner/admin projection decide what it may see.
 *   service-role client:   rpc set_link_verification only.
 */
import type { ArtistForCheck, HandlerDeps } from './handler.ts';
import { fetchPage, type FetchDeps } from './fetch.ts';

// deno-lint-ignore no-explicit-any
type AnyClient = any;
type CreateClient = (url: string, key: string, opts?: Record<string, unknown>) => AnyClient;

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  allowedOrigins: string[];
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function supabaseDeps(createClient: CreateClient, env: SupabaseEnv, fetchDeps: FetchDeps): HandlerDeps {
  const asCaller = (authorization: string) =>
    createClient(env.url, env.anonKey, { ...NO_SESSION, db: { schema: 'kofi' }, global: { headers: { Authorization: authorization } } });
  const service = createClient(env.url, env.serviceRoleKey, { ...NO_SESSION, db: { schema: 'kofi' } });

  return {
    allowedOrigins: env.allowedOrigins,
    async getUser(authorization) {
      const jwt = authorization.replace(/^Bearer\s+/i, '');
      if (!jwt) return null;
      const { data, error } = await asCaller(authorization).auth.getUser(jwt);
      if (error || !data?.user?.id) return null;
      return { id: data.user.id as string };
    },
    async loadArtist(authorization, artistId): Promise<ArtistForCheck | undefined> {
      const db = asCaller(authorization);
      let id = artistId;
      if (!id) {
        const { data, error } = await db.rpc('whoami');
        if (error) throw new Error(error.message);
        id = (data as { artist_id: string | null }[] | null)?.[0]?.artist_id ?? undefined;
        if (!id) return undefined;
      }
      const { data, error } = await db.from('artists_visible').select('id, verification_token, links').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as { id: string; verification_token: string | null; links: { url: string }[] | null } | null;
      if (!row || !row.verification_token) return undefined;
      return { id: row.id, token: row.verification_token, links: (row.links ?? []).filter((l) => l && typeof l.url === 'string') };
    },
    async writeVerification(artistId, url, verification, checkedAt) {
      const { error } = await service.rpc('set_link_verification', {
        p_url: url,
        p_verification: verification,
        p_checked_at: checkedAt,
        p_artist_id: artistId,
      });
      if (error) throw new Error(error.message);
    },
    async logAudit(authorization, action, artistId, meta) {
      await asCaller(authorization).rpc('log_audit', { p_action: action, p_entity_type: 'artist', p_entity_id: artistId ?? null, p_meta: meta });
    },
    fetchPage: (url) => fetchPage(url, fetchDeps),
  };
}

/** KOFI_ALLOWED_ORIGINS="https://a.example,https://b.example" plus the app shells. */
export function allowedOriginsFrom(value: string | undefined): string[] {
  const base = ['http://localhost:5173', 'http://localhost:4173', 'capacitor://localhost', 'https://localhost', 'http://localhost'];
  const extra = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([...base, ...extra])];
}
