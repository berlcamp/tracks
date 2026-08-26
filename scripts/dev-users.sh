#!/usr/bin/env bash
# Creates one LOCAL sign-in per role, so every permission path can be exercised
# by hand. Local Supabase only — it talks to 127.0.0.1 and uses the throwaway
# service-role key that ships with the CLI.
#
#   npm run db:users
#
# Safe to re-run: existing auth users are left alone and invitations are only
# created for addresses that do not already have a profile.
set -euo pipefail

API="${SUPABASE_API_URL:-http://127.0.0.1:54821}"
DB_PORT="${SUPABASE_DB_PORT:-54822}"
PASSWORD="localdev12345"

case "$API" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing to run against a non-local Supabase: $API" >&2; exit 1 ;;
esac

export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
SERVICE_ROLE="$(npx supabase status -o json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')"

# email | full name | role | department code ("-" for a city-wide role)
ACCOUNTS=$(cat <<'ROWS'
planning@tracks.local|Perla Planning|planning_admin|-
planstaff@tracks.local|Sonia Staff|planning_staff|-
budget@tracks.local|Benito Budget|budget|-
accounting@tracks.local|Aurora Accounting|accounting|-
viewer@tracks.local|Victor Viewer|viewer|-
cmo.head@tracks.local|Hector Head (CMO)|dept_head|CMO
cmo.encoder@tracks.local|Elena Encoder (CMO)|dept_encoder|CMO
cmo.encoder2@tracks.local|Ramon Encoder (CMO)|dept_encoder|CMO
cho.head@tracks.local|Helena Head (CHO)|dept_head|CHO
ROWS
)

echo "Creating local sign-ins — password for all of them: $PASSWORD"
echo

while IFS='|' read -r email name role dept; do
  [ -z "$email" ] && continue

  curl -s -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$name\"}}" \
    > /dev/null

  # The role is granted the way it is in production: an invitation, claimed by
  # tracks.claim_invite() on first sign-in. No trigger on auth.users, and no
  # back door that only exists locally.
  PGPASSWORD=postgres psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -q \
    -v email="$email" -v name="$name" -v role="$role" -v dept="$dept" <<'SQL'
insert into tracks.invites (email, full_name, role, department_id)
select :'email', :'name', :'role',
       case when :'dept' = '-' then null
            else (select id from tracks.departments where code = :'dept') end
where not exists (select 1 from tracks.profiles where email = :'email')
  and not exists (
    select 1 from tracks.invites
     where email = :'email' and status = 'pending');
SQL

  printf '  %-26s %-16s %s\n' "$email" "$role" "${dept/-/city-wide}"
done <<< "$ACCOUNTS"

echo
echo "Sign in at http://localhost:3000/login — the Local development panel lists them."
