#!/usr/bin/env bash
# Uploads the bundled demo photographs (public/art/<name>.jpg) into the private
# artwork-images bucket, each under its artist's folder, signed in as that demo artist
# (storage policy: artists may only write inside their own folder). Run once per
# project before supabase/seed_content.sql. Needs: SUPABASE_URL, SUPABASE_ANON_KEY.
set -euo pipefail
: "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}"
PASS="${KOFI_DEMO_PASSWORD:-kofi-demo-2026}"
cd "$(dirname "$0")/../.."
declare -A ARTIST=( [mara]=20000000-0000-4000-8000-000000000001 [tobias]=20000000-0000-4000-8000-000000000002 [june]=20000000-0000-4000-8000-000000000003 [deshawn]=20000000-0000-4000-8000-000000000004 [priya]=20000000-0000-4000-8000-000000000005 )
for f in public/art/*.jpg; do
  name=$(basename "$f"); who=${name%%[0-9]*}
  [[ -n "${ARTIST[$who]:-}" ]] || continue   # hero.jpg etc. are app chrome, not artworks
  tok=$(curl -sS "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
        -d "{\"email\":\"demo+$who@example.com\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/storage/v1/object/artwork-images/${ARTIST[$who]}/$name" \
        -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $tok" -H 'Content-Type: image/jpeg' -H 'x-upsert: true' --data-binary "@$f")
  echo "$who/$name -> $code"
done
