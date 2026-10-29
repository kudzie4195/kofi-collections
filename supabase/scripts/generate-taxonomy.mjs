#!/usr/bin/env node
// Writes the kofi.tag_categories + kofi.tags seed into supabase/migrations/0011_taxonomy.sql
// (the block between "-- BEGIN GENERATED TAXONOMY" and "-- END GENERATED TAXONOMY") from the
// tag library the app uses (src/domain/taxonomy.data.ts, generated from Kofi's workbook) and
// the form / filter order in src/domain/taxonomy.ts. Then run split-0011.mjs.
//
//   node supabase/scripts/generate-taxonomy.mjs
//
// Categories are upserted (they are structural: labels feed the cap messages). Tags are
// inserted when missing and never overwritten, so re-running 0011 cannot undo a label,
// definition, deprecation or alias Kofi has edited since (governance lives in the table).
// The tag rows are split into chunks of at most CHUNK_BYTES, each starting a new apply part.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './load-seed.mjs';

const CHUNK_BYTES = 17 * 1024;
const target = path.join(projectRoot, 'supabase/migrations/0011_taxonomy.sql');
const BEGIN = '-- BEGIN GENERATED TAXONOMY (supabase/scripts/generate-taxonomy.mjs) — do not edit by hand';
const END = '-- END GENERATED TAXONOMY';

async function loadTaxonomy() {
  const result = await build({
    stdin: {
      contents: `export { TAG_LIBRARY, TAG_CATEGORY_DEFS, ARTIST_TAG_CATEGORIES, FILTER_TAG_CATEGORIES } from '@/domain/taxonomy';`,
      resolveDir: projectRoot,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    tsconfig: path.join(projectRoot, 'tsconfig.json'),
    logLevel: 'error',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

const { TAG_LIBRARY, TAG_CATEGORY_DEFS, ARTIST_TAG_CATEGORIES, FILTER_TAG_CATEGORIES } = await loadTaxonomy();
const s = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const pos = (list, id) => (list.indexOf(id) >= 0 ? String(list.indexOf(id) + 1) : 'null');

for (const t of TAG_LIBRARY) {
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(t.id) || t.id.split('.')[0] !== t.category) throw new Error(`tag id ${t.id} is not category.slug`);
}

const out = [BEGIN];
out.push(`-- ${TAG_CATEGORY_DEFS.length} categories and ${TAG_LIBRARY.length} tags (${TAG_LIBRARY.filter((t) => t.appAddition).length} app additions) from src/domain/taxonomy.data.ts.`);
out.push('insert into kofi.tag_categories (id, label, ui, source, belongs_to, phase, note, artist_position, filter_position, position) values');
out.push(
  TAG_CATEGORY_DEFS.map(
    (c, i) =>
      `  (${s(c.id)}, ${s(c.label)}, ${s(c.ui)}, ${s(c.source)}, ${s(c.belongsTo)}, ${s(c.phase)}, ${s(c.note)}, ${pos(ARTIST_TAG_CATEGORIES, c.id)}, ${pos(FILTER_TAG_CATEGORIES, c.id)}, ${i + 1})`,
  ).join(',\n'),
);
out.push('on conflict (id) do update set label = excluded.label, ui = excluded.ui, source = excluded.source, belongs_to = excluded.belongs_to,');
out.push('  phase = excluded.phase, note = excluded.note, artist_position = excluded.artist_position, filter_position = excluded.filter_position, position = excluded.position');
out.push('where (kofi.tag_categories.label, kofi.tag_categories.ui, kofi.tag_categories.source, kofi.tag_categories.belongs_to, kofi.tag_categories.phase, kofi.tag_categories.note,');
out.push('       kofi.tag_categories.artist_position, kofi.tag_categories.filter_position, kofi.tag_categories.position)');
out.push('  is distinct from (excluded.label, excluded.ui, excluded.source, excluded.belongs_to, excluded.phase, excluded.note,');
out.push('                    excluded.artist_position, excluded.filter_position, excluded.position);');
out.push('');

const rows = TAG_LIBRARY.map(
  (t, i) => `  (${s(t.id)}, ${s(t.category)}, ${s(t.label)}, ${s(t.definition)}, ${t.artistSelectable ? 'true' : 'false'}, ${s(t.phase)}, ${t.appAddition ? 'true' : 'false'}, ${i + 1})`,
);
const chunks = [];
let cur = [];
let bytes = 0;
for (const r of rows) {
  const b = Buffer.byteLength(r) + 2;
  if (cur.length && bytes + b > CHUNK_BYTES) {
    chunks.push(cur);
    cur = [];
    bytes = 0;
  }
  cur.push(r);
  bytes += b;
}
if (cur.length) chunks.push(cur);
chunks.forEach((chunk, k) => {
  if (k > 0) out.push(`-- @part tag library seed (${k + 1} of ${chunks.length})`);
  out.push(`-- tags ${chunks.slice(0, k).reduce((n, c) => n + c.length, 0) + 1}-${chunks.slice(0, k + 1).reduce((n, c) => n + c.length, 0)} of ${rows.length}`);
  out.push('insert into kofi.tags (id, category, label, definition, artist_selectable, phase, app_addition, position) values');
  out.push(chunk.join(',\n'));
  out.push('on conflict (id) do nothing;');
  out.push('');
});
out.push(END);

const src = readFileSync(target, 'utf8');
const a = src.indexOf(BEGIN);
const z = src.indexOf(END);
if (a < 0 || z < 0 || z < a) throw new Error('0011_taxonomy.sql: GENERATED TAXONOMY markers not found');
writeFileSync(target, src.slice(0, a) + out.join('\n') + src.slice(z + END.length));
console.log(`wrote ${path.relative(projectRoot, target)}: ${TAG_CATEGORY_DEFS.length} categories, ${rows.length} tags in ${chunks.length} chunk(s)`);
