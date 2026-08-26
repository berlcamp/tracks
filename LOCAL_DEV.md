# Local development

Runs the whole stack on your machine: Postgres, PostgREST, GoTrue, Storage and
Studio, with all 7 migrations and seed data applied. **Nothing here touches the
shared cloud project.**

## Ports

The CLI default `543xx` block is already taken by a running local stack called
`bayugan-tracks`, so TRACKS uses `548xx`:

| Repo | Block |
|---|---|
| **tracks** | **`548xx`** ← this repo |
| bayugan-tracks (a separate, pre-existing stack) | `543xx` |
| hris | `544xx` |
| travelers-inn | `546xx` |
| pta-collections | `547xx` |
| point-of-sale | `555xx` |

So: API `54821`, DB `54822`, Studio `54823`, Mailpit `54824`. Nothing collides
with the other stacks.

**Five Supabase stacks do not fit on 4 CPUs.** With all of them up, this stack's
Postgres goes unhealthy and GoTrue returns 504 on sign-in — the failure looks
like an auth bug and is not one. Each stack's `studio` and `pg_meta` containers
idle at 25-37% CPU apiece and are only the table browser; stopping them fixes it
without touching any app:

```bash
docker stop $(docker ps --format '{{.Names}}' | grep -E '^supabase_(studio|pg_meta)_')
```

`supabase stop && supabase start` in the relevant repo brings a stack back whole.

## Start it

```bash
colima start --cpu 4 --memory 8 --disk 40   # if Docker is not up
npm install
npm run db:start     # first run pulls images — a few minutes
```

`db:start` applies `supabase/migrations/0001`–`0007` in order and then
`supabase/seed.sql`, which creates the 3 sectors, all 28 departments with their
SUMMARY code numbers, the CY 2027 period, the bootstrap planning admin
(`berlcamp@gmail.com`) and one CMO draft AIP with four real PPA rows.

```bash
npm run db:studio   # table browser at :54823
npm run db:reset    # wipe local DB, re-apply migrations + seed
npm run db:status   # ports and keys
```

## Signing in

### Local accounts, one per role (no setup, ~10 seconds)

```bash
npm run db:users
```

Creates one sign-in per role, all with the password `localdev12345`:

| Email | Role | Scope |
|---|---|---|
| `planning@tracks.local` | City Planning Administrator | city-wide |
| `planstaff@tracks.local` | City Planning Sector Officer | city-wide |
| `budget@tracks.local` | Budget Office | city-wide |
| `accounting@tracks.local` | Accounting Office | city-wide |
| `viewer@tracks.local` | Viewer (read-only) | city-wide |
| `cmo.head@tracks.local` | Department Head | CMO |
| `cmo.encoder@tracks.local` | Department Encoder | CMO |
| `cho.head@tracks.local` | Department Head | CHO |

The **Local development** panel on `/login` lists them; clicking one fills the
form. Two departments exist on purpose — signing in as CHO and trying to open
CMO's AIP is how you see the isolation working.

Each account is granted its role the way production does it: an invitation in
`tracks.invites`, claimed by `tracks.claim_invite()` on first sign-in. There is
no local-only back door, so what you exercise here is the real provisioning path.

**None of them is a `super_admin`** — that would bypass every role check and make
the set useless for testing. (The seeded `berlcamp@gmail.com` profile is one, and
stays unbound until you sign into it with Google.)

The script refuses to run against anything but a localhost Supabase, and is safe
to re-run.

### Real Google OAuth

Reuse the existing OAuth client — Google allows many redirect URIs per client.

1. <https://console.cloud.google.com/apis/credentials>
2. Under **Authorized redirect URIs**, *add* (do not replace):
   `http://127.0.0.1:54821/auth/v1/callback`
   That is the **local Supabase auth server**, not the Next.js app. Getting this
   wrong is the single most common failure — Google shows `redirect_uri_mismatch`.
3. Under **Authorized JavaScript origins**, add `http://localhost:3000`
4. `cp supabase/.env.example supabase/.env`, fill in the client id and secret,
   then `npm run db:stop && npm run db:start`.

Signing in as `berlcamp@gmail.com` binds the seeded planning-admin profile via
`tracks.claim_invite()`. Any other Google account gets a session but no profile,
no role, and zero rows from every table — which is the system working, not a bug.

## Tests

```bash
npm test          # 52 unit tests (exporter, template fidelity, grid layout)
npm run test:db   # 86 SQL tests
npm run test:e2e  # 25 Playwright tests (needs db:start and db:users)
```

Uses your local Postgres.app on a throwaway `tracks_test` database and stubs
Supabase's `auth`/`storage` schemas, so it is independent of the Docker stack.

| Suite | Covers |
|---|---|
| `03_access.sql` | uninvited accounts, cross-department writes, sector settings, Budget vs Accounting separation, append-only history |
| `04_workflow.sql` | the submission lock: submit → return one item → correct → resubmit → accept → Planning override → reopen |
| `05_money.sql` | generated totals, department/sector/grand rollups, allotment vs obligation vs disbursement, the group tree, supplementals |
| `aip-template.test.ts` | the generated workbook against the real form's geometry |
| `aip-workbook.test.ts` | band rows, group rows, blanks, subtotals, department scope, supplementals |
| `aip-assemble.test.ts` | folding view rows into the export shape |
| `grid-model.test.ts` | the on-screen grid's bands, group rows, subtotals and filter |
| `e2e/access.spec.ts` | the landing page, the gate on every app route, sign-in, role-filtered nav |
| `e2e/aip-grid.spec.ts` | worksheet layout, no sideways page scroll, filtering, add-through-modal, export |
| `e2e/execution.spec.ts` | monitoring columns, recording an obligation, sector settings, consolidated export |
| `e2e/paper-trail.spec.ts` | the three bodies including the ones still out, recording a resolution |
| `e2e/department.spec.ts` | what a department sees, what it is refused, and the ledger it can reach |

The E2E suite writes to your local database (it adds PPAs, obligations and
council actions). `npm run db:reset` puts the seed back.

`test:e2e` drives the local password panel rather than Google — an OAuth round
trip cannot be run headlessly, and these tests are about the flows, not the
provider.

## Generating a workbook

```bash
./supabase/tests/run-local.sh tracks_demo
psql -d tracks_demo -f supabase/seed.sql
TRACKS_DB=tracks_demo npm run export:demo -- CY2027-AIP.xlsx
```

Runs the whole path — views → mappers → assembler → workbook — against real SQL.
