#!/usr/bin/env bash
# Rebuilds a local test database and applies every tracks migration in order.
#   ./supabase/tests/run-local.sh [dbname]
# Requires Postgres.app (or any local PostgreSQL) on PATH.
set -euo pipefail

DB="${1:-tracks_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

dropdb --if-exists "$DB"
createdb "$DB"

psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/supabase/tests/00_supabase_stub.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  → $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done

echo "✓ schema applied to $DB"
