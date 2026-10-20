/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import fs from 'node:fs';

const single = process.env.SINGLE_FILE === '1';

/**
 * `virtual:bundled-art` maps public/art/<name>.<ext> → a URL. Normally that is the
 * served path (/art/<name>.jpg); in the single-file build the files are inlined as
 * data URLs so the one-file demo works from file:// with every photograph intact.
 */
function bundledArt() {
  const id = 'virtual:bundled-art';
  const dir = path.resolve(__dirname, 'public/art');
  return {
    name: 'kofi-bundled-art',
    resolveId(source: string) {
      return source === id ? '\0' + id : null;
    },
    load(resolved: string) {
      if (resolved !== '\0' + id) return null;
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
      const map: Record<string, string> = {};
      for (const f of files) {
        if (single) {
          const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
          map[f] = `data:${mime};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
        } else {
          map[f] = `/art/${f}`;
        }
      }
      return `export default ${JSON.stringify(map)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), bundledArt(), ...(single ? [viteSingleFile()] : [])],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { target: 'es2020', sourcemap: false, ...(single ? { assetsInlineLimit: 100_000_000, cssCodeSplit: false } : {}) },
  server: { port: 5173, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
