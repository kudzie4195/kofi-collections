// Loads the TypeScript demo seed (src/data/mock/seed.ts) and the UUID table
// (src/data/supabase/demo.ts) in plain Node by bundling them with the esbuild
// that Vite already ships. No extra dependencies.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..', '..');

/**
 * Same contract as the `virtual:bundled-art` Vite plugin (vite.config.ts) in a
 * normal build: public/art/<name> → '/art/<name>'. The generator turns artwork
 * photos into storage refs and keeps programme images as bundled /art/ paths.
 */
function bundledArtPlugin() {
  const id = 'virtual:bundled-art';
  return {
    name: 'kofi-bundled-art',
    setup(b) {
      b.onResolve({ filter: /^virtual:bundled-art$/ }, () => ({ path: id, namespace: 'kofi-art' }));
      b.onLoad({ filter: /.*/, namespace: 'kofi-art' }, () => {
        const dir = path.join(projectRoot, 'public', 'art');
        const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
        const map = Object.fromEntries(files.map((f) => [f, `/art/${f}`]));
        return { contents: `export default ${JSON.stringify(map)};`, loader: 'js' };
      });
    },
  };
}

export async function loadSeed() {
  const entry = `
    export { buildSeed, DEMO_IDENTITIES, DEMO_USERS, V4_SEED_LINKS } from '@/data/mock/seed';
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
    plugins: [bundledArtPlugin()],
  });
  const code = result.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  return mod;
}
