import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { DemoIdentity, Viewer } from '@/domain/types';

/**
 * Fixed UUIDs for the fictional seed (src/data/mock/seed.ts). supabase/seed_auth.sql
 * and supabase/seed_content.sql are generated from the same table
 * (supabase/scripts/generate-seed.mjs), so mock
 * and Supabase modes share identities and records.
 *
 * Scheme: <type prefix>0000000-0000-4000-8000-<suffix>
 *   1… auth users · 2… artists · 30… artworks · 31… artwork images ·
 *   4… institutions · 5… curators · 6… shortlists · 7… inquiries ·
 *   8… documents · 9… seed audit events ·
 *   a1… exhibitions · a2… open calls · a3… applications · a4… events ·
 *   a5… stories · a6… buyer inquiries ·
 *   a7… lots · a8… payouts (supabase/migrations/0009_sales.sql)
 */
export const DEMO_UUIDS = {
  // auth.users / profiles
  user_mara: '10000000-0000-4000-8000-000000000001',
  user_tobias: '10000000-0000-4000-8000-000000000002',
  user_june: '10000000-0000-4000-8000-000000000003',
  user_deshawn: '10000000-0000-4000-8000-000000000004',
  user_priya: '10000000-0000-4000-8000-000000000005',
  user_lena: '10000000-0000-4000-8000-000000000006',
  user_owen: '10000000-0000-4000-8000-000000000007',
  user_quincy: '10000000-0000-4000-8000-000000000008',
  // artists
  art_mara: '20000000-0000-4000-8000-000000000001',
  art_tobias: '20000000-0000-4000-8000-000000000002',
  art_june: '20000000-0000-4000-8000-000000000003',
  art_deshawn: '20000000-0000-4000-8000-000000000004',
  art_priya: '20000000-0000-4000-8000-000000000005',
  // artworks
  aw_mara_1: '30000000-0000-4000-8000-000000000011',
  aw_mara_2: '30000000-0000-4000-8000-000000000012',
  aw_mara_3: '30000000-0000-4000-8000-000000000013',
  aw_tobias_1: '30000000-0000-4000-8000-000000000021',
  aw_tobias_2: '30000000-0000-4000-8000-000000000022',
  aw_tobias_3: '30000000-0000-4000-8000-000000000023',
  aw_june_1: '30000000-0000-4000-8000-000000000031',
  aw_june_2: '30000000-0000-4000-8000-000000000032',
  aw_june_3: '30000000-0000-4000-8000-000000000033',
  aw_deshawn_1: '30000000-0000-4000-8000-000000000041',
  aw_deshawn_2: '30000000-0000-4000-8000-000000000042',
  aw_priya_1: '30000000-0000-4000-8000-000000000051',
  aw_priya_2: '30000000-0000-4000-8000-000000000052',
  // artwork images
  img_mara1: '31000000-0000-4000-8000-000000000011',
  img_mara2: '31000000-0000-4000-8000-000000000012',
  img_mara3: '31000000-0000-4000-8000-000000000013',
  img_tobias1: '31000000-0000-4000-8000-000000000021',
  img_tobias2: '31000000-0000-4000-8000-000000000022',
  img_tobias3: '31000000-0000-4000-8000-000000000023',
  img_june1: '31000000-0000-4000-8000-000000000031',
  img_june2: '31000000-0000-4000-8000-000000000032',
  img_june3: '31000000-0000-4000-8000-000000000033',
  img_deshawn1: '31000000-0000-4000-8000-000000000041',
  img_deshawn2: '31000000-0000-4000-8000-000000000042',
  img_priya1: '31000000-0000-4000-8000-000000000051',
  img_priya2: '31000000-0000-4000-8000-000000000052',
  // institutions
  inst_cma: '40000000-0000-4000-8000-000000000001',
  inst_oag: '40000000-0000-4000-8000-000000000002',
  inst_pit: '40000000-0000-4000-8000-000000000003',
  // curators
  cur_lena: '50000000-0000-4000-8000-000000000001',
  cur_owen: '50000000-0000-4000-8000-000000000002',
  // shortlists
  sl_lena_1: '60000000-0000-4000-8000-000000000001',
  // inquiries
  inq_1: '70000000-0000-4000-8000-000000000001',
  inq_2: '70000000-0000-4000-8000-000000000002',
  // documents
  doc_1: '80000000-0000-4000-8000-000000000001',
  doc_2: '80000000-0000-4000-8000-000000000002',
  // seed audit events
  ev_1: '90000000-0000-4000-8000-000000000001',
  ev_2: '90000000-0000-4000-8000-000000000002',
  ev_3: '90000000-0000-4000-8000-000000000003',
  ev_4: '90000000-0000-4000-8000-000000000004',
  // programme (supabase/migrations/0008_programme.sql)
  // exhibitions a1… · open calls a2… · applications a3… · events a4… · stories a5… · buyer inquiries a6…
  ex_being_seen: 'a1000000-0000-4000-8000-000000000001',
  ex_spirit_west: 'a1000000-0000-4000-8000-000000000002',
  ex_i_am: 'a1000000-0000-4000-8000-000000000003',
  ex_night_weather: 'a1000000-0000-4000-8000-000000000004',
  ex_soft_ground: 'a1000000-0000-4000-8000-000000000005',
  call_advocacy: 'a2000000-0000-4000-8000-000000000001',
  call_night_weather: 'a2000000-0000-4000-8000-000000000002',
  call_soft_ground: 'a2000000-0000-4000-8000-000000000003',
  call_summer_open: 'a2000000-0000-4000-8000-000000000004',
  call_cma_auction: 'a2000000-0000-4000-8000-000000000005',
  app_mara_summer: 'a3000000-0000-4000-8000-000000000001',
  app_june_summer: 'a3000000-0000-4000-8000-000000000002',
  app_deshawn_night: 'a3000000-0000-4000-8000-000000000003',
  app_mara_cma: 'a3000000-0000-4000-8000-000000000004',
  app_deshawn_cma: 'a3000000-0000-4000-8000-000000000005',
  app_priya_cma: 'a3000000-0000-4000-8000-000000000006',
  ev_nw_opening: 'a4000000-0000-4000-8000-000000000001',
  ev_mara_talk: 'a4000000-0000-4000-8000-000000000002',
  ev_june_open_studio: 'a4000000-0000-4000-8000-000000000003',
  ev_collector_evening: 'a4000000-0000-4000-8000-000000000004',
  st_mara_interview: 'a5000000-0000-4000-8000-000000000001',
  st_june_loom: 'a5000000-0000-4000-8000-000000000002',
  st_artist_record: 'a5000000-0000-4000-8000-000000000003',
  st_advocacy_partner: 'a5000000-0000-4000-8000-000000000004',
  bi_doubling: 'a6000000-0000-4000-8000-000000000001',
  bi_office_placement: 'a6000000-0000-4000-8000-000000000002',
  // sales (supabase/migrations/0009_sales.sql): lots a7… · payouts a8…
  lot_cma_1: 'a7000000-0000-4000-8000-000000000001',
  lot_cma_2: 'a7000000-0000-4000-8000-000000000002',
  lot_cma_3: 'a7000000-0000-4000-8000-000000000003',
  payout_cma_1: 'a8000000-0000-4000-8000-000000000001',
  payout_cma_3: 'a8000000-0000-4000-8000-000000000003',
} as const;

export type DemoSeedId = keyof typeof DEMO_UUIDS;

/** Map a mock seed id to its fixed UUID; returns undefined for ids not in the seed. */
export function demoUuid(id: string): string | undefined {
  return (DEMO_UUIDS as Record<string, string>)[id];
}

/**
 * Demo sign-in credentials (fictional accounts on a demo project only).
 * Emails use the reserved example.com domain so nothing is ever delivered.
 */
export const DEMO_PASSWORD = 'kofi-demo-2026';

export const DEMO_EMAILS: Record<string, string> = {
  user_mara: 'demo+mara@example.com',
  user_tobias: 'demo+tobias@example.com',
  user_june: 'demo+june@example.com',
  user_deshawn: 'demo+deshawn@example.com',
  user_priya: 'demo+priya@example.com',
  user_lena: 'demo+lena@example.com',
  user_owen: 'demo+owen@example.com',
  user_quincy: 'demo+quincy@example.com',
};

/** Email for a demo auth user by UUID (undefined when the UUID is not a demo user). */
export function demoEmailForUserUuid(uuid: string): string | undefined {
  for (const [key, email] of Object.entries(DEMO_EMAILS)) {
    if (demoUuid(key) === uuid) return email;
  }
  return undefined;
}

function mapViewer(v: Viewer): Viewer {
  const out: Viewer = { ...v };
  if (v.userId) out.userId = demoUuid(v.userId) ?? v.userId;
  if (v.artistId) out.artistId = demoUuid(v.artistId) ?? v.artistId;
  if (v.curatorId) out.curatorId = demoUuid(v.curatorId) ?? v.curatorId;
  return out;
}

/** The same demo identities (ids, labels, captions) as mock mode, with UUID-keyed viewers. */
export const SUPABASE_DEMO_IDENTITIES: DemoIdentity[] = DEMO_IDENTITIES.map((d) => ({ ...d, viewer: mapViewer(d.viewer) }));
