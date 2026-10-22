// Kofi Collections — profile-import edge function (Deno, Supabase Edge Runtime).
//
// Reads what is public at an artist's link (import mode) and checks a link for
// the artist's verification code (verify mode). See handler.ts for the API,
// fetch.ts for the SSRF / size / time guards, parse.ts for the HTML reading.
//
// Deploy (JWT verification stays ON — the default):
//   supabase functions deploy profile-import --project-ref cdcavlfcbecylvkevxfi
// Secrets (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are
// provided by the platform):
//   supabase secrets set KOFI_ALLOWED_ORIGINS="https://<app origin>" --project-ref cdcavlfcbecylvkevxfi
// Tests: deno test supabase/functions/profile-import/
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './handler.ts';
import { allowedOriginsFrom, supabaseDeps } from './deps.ts';

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`profile-import: missing env ${k}`);
  return v;
};

async function resolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      out.push(...(await Deno.resolveDns(host, type)));
    } catch {
      /* no record of this type */
    }
  }
  if (!out.length) throw new Error('no address');
  return out;
}

const handler = createHandler(
  supabaseDeps(
    createClient,
    {
      url: env('SUPABASE_URL'),
      anonKey: env('SUPABASE_ANON_KEY'),
      serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
      allowedOrigins: allowedOriginsFrom(Deno.env.get('KOFI_ALLOWED_ORIGINS')),
    },
    { fetchImpl: fetch, resolve: typeof Deno.resolveDns === 'function' ? resolve : undefined },
  ),
);

Deno.serve(handler);
