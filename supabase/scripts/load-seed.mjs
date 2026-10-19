// Loads the TypeScript demo seed (src/data/mock/seed.ts) and the UUID table
// (src/data/supabase/demo.ts) in plain Node by bundling them with the esbuild
// that Vite already ships. No extra dependencies.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..', '..');

export async function loadSeed() {
  const entry = `
    export { buildSeed, DEMO_IDENTITIES, DEMO_USERS } from '@/data/mock/seed';
    export { DEMO_UUIDS, DEMO_EMAILS, DEMO_PASSWORD } from '@/data/supabase/demo';
    export { CONSENT_VERSION } from '@/domain/types';
  `;
  const result = await build({
    stdin: { contents: entry, resolveDir: projectRoot, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    tsconfig: path.join(projectRoot, 'tsconfig.json'),
    logLevel: 'error',
  });
  const code = result.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  return mod;
}
