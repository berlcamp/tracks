#!/usr/bin/env bash
# Rebuilds supabase/deploy/tracks-schema.sql from the migrations, then proves it
# applies to a clean database. Run this after adding a migration.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
OUT="$ROOT/supabase/deploy/tracks-schema.sql"
mkdir -p "$(dirname "$OUT")"

{
  cat "$ROOT/supabase/deploy/HEADER.sql"
  echo ""
  echo "begin;"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    printf '\n-- %s\n-- %s\n-- %s\n\n' \
      "---------------------------------------------------------------------------" \
      "$(basename "$f")" \
      "---------------------------------------------------------------------------"
    cat "$f"
  done
  echo ""
  echo "commit;"
} > "$OUT"

DB="tracks_bundle_check"
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$OUT"
echo "✓ $(basename "$OUT") applies cleanly ($(wc -l < "$OUT" | tr -d ' ') lines)"
dropdb "$DB"
