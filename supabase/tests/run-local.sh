#!/usr/bin/env bash
# Runs the migrations, the seed (twice, to prove it is re-runnable) and the RLS
# assertions against a THROWAWAY plain-Postgres database, with
# supabase/tests/shim.sql standing in for the Supabase platform schemas.
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
  echo "== seed.sql (first run)"
  run -q -f "$root/seed.sql"
  echo "== seed.sql (second run — must be idempotent)"
  run -q -f "$root/seed.sql"
  echo "== row counts after seed"
  run -At -c "select 'artists', count(*) from artists union all select 'artworks', count(*) from artworks
              union all select 'artwork_images', count(*) from artwork_images union all select 'curators', count(*) from curators
              union all select 'shortlist_items', count(*) from shortlist_items union all select 'inquiries', count(*) from inquiries
              union all select 'documents', count(*) from documents union all select 'audit_events', count(*) from audit_events
              union all select 'consents', count(*) from consents union all select 'auth.users', count(*) from auth.users"
  echo "== tests/rls_test.sql"
  run -f "$here/rls_test.sql"
  echo "== tests/rpc_test.sql"
  run -f "$here/rpc_test.sql"
  echo
  echo "# RESULT: PASS"
} 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
if [ "$status" -ne 0 ]; then
  echo "# RESULT: FAIL (exit $status)" | tee -a "$log"
fi
exit "$status"
