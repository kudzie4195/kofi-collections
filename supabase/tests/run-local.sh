#!/usr/bin/env bash
# Runs the migrations (0008, 0009, 0010 and 0011 each twice to prove they are re-runnable),
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
  echo "== migrations/0010_intake.sql (twice — must be idempotent)"
  run -q -f "$root/migrations/0010_intake.sql"
  run -q -f "$root/migrations/0010_intake.sql"
  echo "== migrations/0011_taxonomy.sql (twice — must be idempotent)"
  run -q -f "$root/migrations/0011_taxonomy.sql"
  run -q -f "$root/migrations/0011_taxonomy.sql"
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
  echo "== tests/intake_test.sql"
  run -f "$here/intake_test.sql"
  echo "== tests/taxonomy_test.sql"
  run -f "$here/taxonomy_test.sql"
  echo "== tests/isolation_test.sql"
  run -f "$here/isolation_test.sql"
  expected_taxonomy="$(run -At -c "select jsonb_build_object('works', (select jsonb_agg(jsonb_build_object('id', id, 'tag_ids', tag_ids, 'uses', uses, 'edition', edition, 'location', location) order by id) from kofi.artworks),
                                                          'calls', (select jsonb_agg(jsonb_build_object('id', id, 'looking_for', looking_for) order by id) from kofi.open_calls))")"
  expected_intake="$(run -At -c "select jsonb_agg(jsonb_build_object('id', id, 'token', verification_token, 'links', links, 'imports', imports) order by id) from kofi.artists")"

  # ---- live path: 0008 and 0009 applied as the pasted parts; the live project's
  # rows (loaded before 0009: every call kind 'exhibition', no auction, no lots)
  # brought up to the seed additively.
  pdb="${db}_parts"
  runp() { psql -X -v ON_ERROR_STOP=1 -d "$pdb" "$@"; }
  echo
  echo "== LIVE PATH: $pdb = shim + 0000-0007 + apply/0008_part1..4 (x2) + apply/0009_part1..5 (x2), v4 seeds, apply/0010_part1..2 (x2) + 0010_live_patch (x2), apply/0011_part1..n (x2) + 0011_live_patch (x2)"
  psql -X -q -d postgres -c "drop database if exists $pdb" -c "create database $pdb"
  runp -q -f "$here/shim.sql"
  for f in "$root"/migrations/000[0-7]_*.sql; do runp -q -f "$f"; done
  for pass in 1 2; do for f in "$root"/apply/0008_part*.sql; do echo "== $(basename "$f") (pass $pass)"; runp -q -f "$f"; done; done
  for pass in 1 2; do for f in "$root"/apply/0009_part*.sql; do echo "== $(basename "$f") (pass $pass)"; runp -q -f "$f"; done; done
  runp -q -f "$root/seed_auth.sql"
  # The live project's content was loaded by the v4 seed (before 0010): frozen copy.
  runp -q -f "$here/fixtures/seed_content_v4.sql"
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
  echo "== 0010 on the live path: apply/0010_part1..2 (x2), then apply/0010_live_patch.sql (x2)"
  for pass in 1 2; do for f in "$root"/apply/0010_part*.sql; do echo "== $(basename "$f") (pass $pass)"; runp -q -f "$f"; done; done
  runp -q -c "create table kofi_test.baseline_audit as select count(*) as n from kofi.audit_events"
  for pass in 1 2; do runp -q -f "$root/apply/0010_live_patch.sql"; done
  runp -At -v expected="$expected_intake" <<'SQL'
create table kofi_test.expected_intake as select :'expected'::jsonb as v;
do $$
begin
  if (select jsonb_agg(jsonb_build_object('id', id, 'token', verification_token, 'links', links, 'imports', imports) order by id) from kofi.artists)
     is distinct from (select v from kofi_test.expected_intake) then
    raise exception 'FAIL: 0010 parts + 0010_live_patch.sql did not bring the demo artists to the seed (tokens, typed links, imports)';
  end if;
  if (select count(*) from kofi.audit_events) <> (select n from kofi_test.baseline_audit) then
    raise exception 'FAIL: 0010_live_patch.sql wrote audit rows';
  end if;
  perform kofi.kofi_demo_reset();
  if (select jsonb_agg(jsonb_build_object('id', id, 'token', verification_token, 'links', links, 'imports', imports) order by id) from kofi.artists)
     is distinct from (select v from kofi_test.expected_intake) then
    raise exception 'FAIL: after 0010_live_patch.sql, Reset demo data should restore the same codes, links and imports';
  end if;
  raise notice 'ok: live path — 0010 parts 1..2 (twice) + 0010_live_patch.sql (twice) give the seed''s tokens, typed links and imports, without audit rows; the reset snapshot keeps them';
end $$;
SQL
  runp -q -c "drop table kofi_test.baseline_audit"
  echo "== 0011 on the live path: apply/0011_part1..n (x2), then apply/0011_live_patch.sql (x2)"
  for pass in 1 2; do for f in "$root"/apply/0011_part*.sql; do echo "== $(basename "$f") (pass $pass)"; runp -q -f "$f"; done; done
  runp -q -c "create table kofi_test.baseline_audit as select count(*) as n from kofi.audit_events"
  for pass in 1 2; do runp -q -f "$root/apply/0011_live_patch.sql"; done
  runp -At -v expected="$expected_taxonomy" <<'SQL'
create table kofi_test.expected_taxonomy as select :'expected'::jsonb as v;
create or replace function kofi_test.taxonomy_state() returns jsonb language sql as $f$
  select jsonb_build_object('works', (select jsonb_agg(jsonb_build_object('id', id, 'tag_ids', tag_ids, 'uses', uses, 'edition', edition, 'location', location) order by id) from kofi.artworks),
                            'calls', (select jsonb_agg(jsonb_build_object('id', id, 'looking_for', looking_for) order by id) from kofi.open_calls))
$f$;
do $$
begin
  if kofi_test.taxonomy_state() is distinct from (select v from kofi_test.expected_taxonomy) then
    raise exception 'FAIL: 0011 parts + 0011_live_patch.sql did not bring the demo works and calls to the seed (tags, uses, editions, criteria)';
  end if;
  if (select count(*) from kofi.audit_events) <> (select n from kofi_test.baseline_audit) then
    raise exception 'FAIL: 0011_live_patch.sql wrote audit rows';
  end if;
  if (select jsonb_agg(jsonb_build_object('id', id, 'token', verification_token, 'links', links, 'imports', imports) order by id) from kofi.artists)
     is distinct from (select v from kofi_test.expected_intake) then
    raise exception 'FAIL: 0011 changed the 0010 intake state (tokens, typed links, imports)';
  end if;
  perform kofi.kofi_demo_reset();
  if kofi_test.taxonomy_state() is distinct from (select v from kofi_test.expected_taxonomy) then
    raise exception 'FAIL: after 0011_live_patch.sql, Reset demo data should restore the same tags, uses, editions and criteria';
  end if;
  if (select jsonb_agg(jsonb_build_object('id', id, 'token', verification_token, 'links', links, 'imports', imports) order by id) from kofi.artists)
     is distinct from (select v from kofi_test.expected_intake) then
    raise exception 'FAIL: after 0011, Reset demo data should still restore the 0010 codes, links and imports';
  end if;
  raise notice 'ok: live path — 0011 parts (twice) + 0011_live_patch.sql (twice) give the seed''s tags, uses, editions and call criteria without audit rows; 0010 intake state unchanged; the reset snapshot keeps both';
end $$;
SQL
  runp -q -c "drop table kofi_test.baseline_audit; drop table kofi_test.expected_intake; drop table kofi_test.expected_taxonomy; drop function kofi_test.taxonomy_state()"
  echo "== tests/programme_test.sql (live-path database)"
  runp -f "$here/programme_test.sql"
  echo "== tests/sales_test.sql (live-path database)"
  runp -f "$here/sales_test.sql"
  echo "== tests/intake_test.sql (live-path database)"
  runp -f "$here/intake_test.sql"
  echo "== tests/taxonomy_test.sql (live-path database)"
  runp -f "$here/taxonomy_test.sql"
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
