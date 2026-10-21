#!/usr/bin/env bash
# Runs the migrations (0008 and 0009 each twice to prove they are re-runnable),
# the seed (auth once, content twice, then the additive programme + sales seeds)
# and the RLS / RPC / programme / sales / schema-isolation assertions against a
# THROWAWAY plain-Postgres database, with supabase/tests/shim.sql standing in
# for the Supabase platform schemas AND for the other product that owns
# `public` on the shared project.
#
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run-local.sh [dbname]
#
# Output (raw psql output) is written to supabase/tests/LAST_RUN.log.
# Never point this at a Supabase project: it drops and recreates the database.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
db="${1:-kofi_rls_test}"
log="$here/LAST_RUN.log"

run() { psql -X -v ON_ERROR_STOP=1 -d "$db" "$@"; }

set +e
{
  set -e
  echo "# Kofi Collections — local RLS verification"
  echo "# date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# server: $(psql -X -At -d postgres -c 'select version()')"
  echo "# database: $db (dropped and recreated)"
  echo
  psql -X -q -d postgres -c "drop database if exists $db" -c "create database $db"
  echo "== shim.sql"
  run -q -f "$here/shim.sql"
  for f in "$root"/migrations/000[0-8]_*.sql; do
    echo "== migrations/$(basename "$f")"
    run -q -f "$f"
  done
  echo "== migrations/0008_programme.sql (second run — must be idempotent)"
  run -q -f "$root/migrations/0008_programme.sql"
  echo "== migrations/0009_sales.sql"
  run -q -f "$root/migrations/0009_sales.sql"
  echo "== migrations/0009_sales.sql (second run — must be idempotent)"
  run -q -f "$root/migrations/0009_sales.sql"
  echo "== seed_auth.sql"
  run -q -f "$root/seed_auth.sql"
  echo "== seed_content.sql (first run)"
  run -q -f "$root/seed_content.sql"
  echo "== seed_auth.sql + seed_content.sql (second run — must be idempotent)"
  run -q -f "$root/seed_auth.sql"
  run -q -f "$root/seed_content.sql"
  echo "== seed_programme.sql + seed_sales.sql (additive seeds — no-ops after seed_content.sql)"
  run -q -f "$root/seed_programme.sql"
  run -q -f "$root/seed_sales.sql"
  echo "== row counts after seed"
  run -At -c "select 'kofi.artists', count(*) from kofi.artists union all select 'kofi.artworks', count(*) from kofi.artworks
              union all select 'kofi.artwork_images', count(*) from kofi.artwork_images union all select 'kofi.curators', count(*) from kofi.curators
              union all select 'kofi.shortlist_items', count(*) from kofi.shortlist_items union all select 'kofi.inquiries', count(*) from kofi.inquiries
              union all select 'kofi.documents', count(*) from kofi.documents union all select 'kofi.audit_events', count(*) from kofi.audit_events
              union all select 'kofi.consents', count(*) from kofi.consents union all select 'kofi.profiles', count(*) from kofi.profiles
              union all select 'kofi.exhibitions', count(*) from kofi.exhibitions union all select 'kofi.open_calls', count(*) from kofi.open_calls
              union all select 'kofi.events', count(*) from kofi.events union all select 'kofi.stories', count(*) from kofi.stories
              union all select 'kofi.applications', count(*) from kofi.applications union all select 'kofi.buyer_inquiries', count(*) from kofi.buyer_inquiries
              union all select 'kofi.lots', count(*) from kofi.lots union all select 'kofi.payouts', count(*) from kofi.payouts
              union all select 'auth.users', count(*) from auth.users union all select 'public.profiles (other product)', count(*) from public.profiles"
  echo "== tests/rls_test.sql"
  run -f "$here/rls_test.sql"
  echo "== tests/rpc_test.sql"
  run -f "$here/rpc_test.sql"
  echo "== tests/programme_test.sql"
  run -f "$here/programme_test.sql"
  echo "== tests/sales_test.sql"
  run -f "$here/sales_test.sql"
  echo "== tests/isolation_test.sql"
  run -f "$here/isolation_test.sql"

  # ---- live path: 0008 and 0009 applied as the pasted parts; the live project's
  # rows (loaded before 0009: every call kind 'exhibition', no auction, no lots)
  # brought up to the seed additively.
  pdb="${db}_parts"
  runp() { psql -X -v ON_ERROR_STOP=1 -d "$pdb" "$@"; }
  echo
  echo "== LIVE PATH: $pdb = shim + 0000-0007 + apply/0008_part1..4 (x2) + apply/0009_part1..5 (x2), seeds"
  psql -X -q -d postgres -c "drop database if exists $pdb" -c "create database $pdb"
  runp -q -f "$here/shim.sql"
  for f in "$root"/migrations/000[0-7]_*.sql; do runp -q -f "$f"; done
  for pass in 1 2; do for f in "$root"/apply/0008_part*.sql; do echo "== $(basename "$f") (pass $pass)"; runp -q -f "$f"; done; done
  for pass in 1 2; do for f in "$root"/apply/0009_part*.sql; do echo "== $(basename "$f") (pass $pass)"; runp -q -f "$f"; done; done
  runp -q -f "$root/seed_auth.sql"
  runp -q -f "$root/seed_content.sql"
  echo "== live state before 0009 data: no lots / payouts / auction call / its applications, every call kind 'exhibition',"
  echo "   artworks with old rights notes; then seed_programme.sql, 0008_live_patch, seed_sales.sql, 0009_live_patch (each twice)"
  runp -q -c "begin; select set_config('kofi.seeding', 'on', true);
              create table kofi_test.expected_notes as select id, rights_note from kofi.artworks;
              create table kofi_test.expected_calls as select id, kind, organizer_institution_id, terms from kofi.open_calls;
              delete from kofi.payouts; delete from kofi.lots;
              delete from kofi.applications where call_id = 'a2000000-0000-4000-8000-000000000005';
              delete from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000005';
              update kofi.open_calls set kind = 'exhibition';
              update kofi.artworks set rights_note = 'old note'; commit;"
  for pass in 1 2; do
    runp -q -f "$root/seed_programme.sql"
    runp -q -f "$root/apply/0008_live_patch.sql"
    runp -q -f "$root/seed_sales.sql"
    runp -q -f "$root/apply/0009_live_patch.sql"
  done
  runp -At -c "do \$\$ begin
      if (select count(*) from kofi.exhibitions) <> 5 or (select count(*) from kofi.open_calls) <> 5 or (select count(*) from kofi.events) <> 4
         or (select count(*) from kofi.stories) <> 4 or (select count(*) from kofi.applications) <> 6 or (select count(*) from kofi.buyer_inquiries) <> 2
         or (select count(*) from kofi.lots) <> 3 or (select count(*) from kofi.payouts) <> 2 then
        raise exception 'FAIL: seed_programme.sql + seed_sales.sql did not load the programme and the sales';
      end if;
      if exists (select 1 from kofi.artworks w join kofi_test.expected_notes e using (id) where w.rights_note is distinct from e.rights_note) then
        raise exception 'FAIL: 0008_live_patch.sql did not restore the seed rights notes';
      end if;
      if exists (select 1 from kofi.open_calls c join kofi_test.expected_calls e using (id)
                 where (c.kind, c.organizer_institution_id, c.terms) is distinct from (e.kind, e.organizer_institution_id, e.terms)) then
        raise exception 'FAIL: 0009_live_patch.sql did not bring call kinds / organiser / terms in line with the seed';
      end if;
      if exists (select 1 from kofi.audit_events where action in ('programme.save', 'artwork.update', 'lot.save', 'lot.sale', 'payout.status')) then
        raise exception 'FAIL: seeding / patching wrote audit rows';
      end if;
      raise notice 'ok: live path — 0008 parts 1..4 and 0009 parts 1..5 (twice each), seed_programme / seed_sales / both live patches (twice) leave the seeded state, without audit noise';
    end \$\$;"
  runp -q -c "drop table kofi_test.expected_notes; drop table kofi_test.expected_calls"
  echo "== tests/programme_test.sql (live-path database)"
  runp -f "$here/programme_test.sql"
  echo "== tests/sales_test.sql (live-path database)"
  runp -f "$here/sales_test.sql"
  echo "== tests/isolation_test.sql (live-path database)"
  runp -f "$here/isolation_test.sql"
  psql -X -q -d postgres -c "drop database if exists $pdb"
  echo
  echo "# RESULT: PASS"
} 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
if [ "$status" -ne 0 ]; then
  echo "# RESULT: FAIL (exit $status)" | tee -a "$log"
fi
exit "$status"
