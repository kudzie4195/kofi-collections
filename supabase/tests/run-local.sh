#!/usr/bin/env bash
# Runs the migrations (0008 twice to prove it is re-runnable), the seed (auth
# once, content twice, then the additive programme seed) and the RLS / RPC /
# programme / schema-isolation assertions against a
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
  for f in "$root"/migrations/*.sql; do
    echo "== migrations/$(basename "$f")"
    run -q -f "$f"
  done
  echo "== migrations/0008_programme.sql (second run — must be idempotent)"
  run -q -f "$root/migrations/0008_programme.sql"
  echo "== seed_auth.sql"
  run -q -f "$root/seed_auth.sql"
  echo "== seed_content.sql (first run)"
  run -q -f "$root/seed_content.sql"
  echo "== seed_auth.sql + seed_content.sql (second run — must be idempotent)"
  run -q -f "$root/seed_auth.sql"
  run -q -f "$root/seed_content.sql"
  echo "== seed_programme.sql (additive programme seed — a no-op after seed_content.sql)"
  run -q -f "$root/seed_programme.sql"
  echo "== row counts after seed"
  run -At -c "select 'kofi.artists', count(*) from kofi.artists union all select 'kofi.artworks', count(*) from kofi.artworks
              union all select 'kofi.artwork_images', count(*) from kofi.artwork_images union all select 'kofi.curators', count(*) from kofi.curators
              union all select 'kofi.shortlist_items', count(*) from kofi.shortlist_items union all select 'kofi.inquiries', count(*) from kofi.inquiries
              union all select 'kofi.documents', count(*) from kofi.documents union all select 'kofi.audit_events', count(*) from kofi.audit_events
              union all select 'kofi.consents', count(*) from kofi.consents union all select 'kofi.profiles', count(*) from kofi.profiles
              union all select 'kofi.exhibitions', count(*) from kofi.exhibitions union all select 'kofi.open_calls', count(*) from kofi.open_calls
              union all select 'kofi.events', count(*) from kofi.events union all select 'kofi.stories', count(*) from kofi.stories
              union all select 'kofi.applications', count(*) from kofi.applications union all select 'kofi.buyer_inquiries', count(*) from kofi.buyer_inquiries
              union all select 'auth.users', count(*) from auth.users union all select 'public.profiles (other product)', count(*) from public.profiles"
  echo "== tests/rls_test.sql"
  run -f "$here/rls_test.sql"
  echo "== tests/rpc_test.sql"
  run -f "$here/rpc_test.sql"
  echo "== tests/programme_test.sql"
  run -f "$here/programme_test.sql"
  echo "== tests/isolation_test.sql"
  run -f "$here/isolation_test.sql"
  echo
  echo "# RESULT: PASS"
} 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
if [ "$status" -ne 0 ]; then
  echo "# RESULT: FAIL (exit $status)" | tee -a "$log"
fi
exit "$status"
