#!/usr/bin/env node
// Uploads the two FICTIONAL demo vault files (Mara's condition report and
// appraisal letter from src/data/mock/seed.ts) into the private `vault` bucket
// at the paths supabase/seed_content.sql stores in kofi.documents.file_ref.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node supabase/scripts/upload-demo-vault.mjs
//   node supabase/scripts/upload-demo-vault.mjs --dry-run     # print what would be uploaded
//
// The service-role key bypasses Storage RLS. Keep it out of the app and out of
// git; run this from your own machine against a DEMO project only.
import { createClient } from '@supabase/supabase-js';
import { loadSeed } from './load-seed.mjs';

const dryRun = process.argv.includes('--dry-run');
const { buildSeed, DEMO_UUIDS } = await loadSeed();
const seed = buildSeed();

const files = seed.documents.map((d) => {
  const payload = seed.documentPayloads[d.fileRef];
  if (!payload) throw new Error(`No payload for ${d.fileRef}`);
  const m = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(payload);
  if (!m) throw new Error(`Bad payload for ${d.fileRef}`);
  const contentType = m[1];
  const body = Buffer.from(decodeURIComponent(m[2]), 'utf8');
  return { path: `${DEMO_UUIDS[d.artistId]}/${DEMO_UUIDS[d.id]}`, contentType, body, title: d.title };
});

if (dryRun) {
  for (const f of files) console.log(`would upload vault/${f.path}  (${f.contentType}, ${f.body.length} bytes)  ${f.title}`);
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --dry-run).');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
for (const f of files) {
  const { error } = await admin.storage.from('vault').upload(f.path, f.body, { contentType: f.contentType, upsert: true });
  if (error) {
    console.error(`failed vault/${f.path}: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`uploaded vault/${f.path}  ${f.title}`);
  }
}
