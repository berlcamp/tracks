#!/usr/bin/env bash
# Full local test cycle: rebuild schema, load fixtures, run every suite.
set -euo pipefail
DB="${1:-tracks_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

"$ROOT/supabase/tests/run-local.sh" "$DB" >/dev/null
for f in 01_assert 02_fixtures 03_access 04_workflow 05_money 06_groups 07_review 08_statutory; do
  psql -q -d "$DB" -f "$ROOT/supabase/tests/$f.sql" 2>&1 \
    | grep -E '^psql.*ERROR' || true
done
echo
psql -d "$DB" -tAc "select case when passed then '  PASS' else '✗ FAIL' end || ' │ ' || description || coalesce('  → ' || detail, '') from tracks_test.results order by id;"
echo
psql -d "$DB" -tAc "select 'TOTAL: ' || count(*) || '   passed: ' || count(*) filter (where passed) || '   FAILED: ' || count(*) filter (where not passed) from tracks_test.results;"
