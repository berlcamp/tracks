# Deploying TRACKS to the shared Supabase project

Everything below is **yours to run**. Nothing in this repo has ever touched the
cloud project, and no script here will: `scripts/build-bundle.sh` only writes a
file and tests it against a throwaway local database.

The project is shared with pta-collections, construction-saas and sms-demo.
Treat every schema except `tracks` as somebody else's production system.

---

## 1. Apply the schema

**Never run `supabase db push`, `db reset` or `db diff` against this project.**
They operate on the whole database and will propose dropping the other apps'
objects. Migrations go in by hand.

```bash
npm run deploy:bundle     # regenerates and verifies supabase/deploy/tracks-schema.sql
```

Then: **Dashboard → SQL Editor → New query → paste `supabase/deploy/tracks-schema.sql` → Run.**

The bundle is wrapped in a single `begin; … commit;`. If any statement fails,
Postgres rolls the whole thing back and the other apps are untouched. Verified:
re-running it on a database that already has the schema fails on the first
`create table` and changes nothing.

It creates:

| | |
|---|---|
| Schema | `tracks` only — nothing in `public` |
| Tables | 18, plus 7 views |
| Policies | 41 in `tracks`, plus 3 on `storage.objects` scoped to `bucket_id = 'tracks-documents'` |
| Triggers on `auth.users` | **none** — provisioning is lazy, via `tracks.claim_invite()` |

## 2. Expose the schema

**Settings → API → Exposed schemas** — add `tracks`.

Skip this and PostgREST returns 404 for every table. The app will look
comprehensively broken and the logs will not say why.

## 3. Storage

The `tracks-documents` bucket is created by the bundle as **private**. Confirm
under **Storage** that it is not public. Council resolutions are public
documents, but a permanent URL anyone can guess is not how they should leave the
building — the app serves them through 5-minute signed URLs.

## 4. Google OAuth

The project already has an OAuth client. Add to it — do not replace:

- **Authorized redirect URI:** `https://<project-ref>.supabase.co/auth/v1/callback`
- **Authorized JavaScript origin:** your production app URL

Then **Authentication → Providers → Google** on the Supabase side, if it is not
already on for this project.

## 5. Seed the reference data

The bundle is schema only. Run `supabase/seed.sql` in the SQL Editor to create
the three sectors, all 28 departments with their SUMMARY code numbers, and the
CY 2027 period. It is written with `on conflict do nothing`, so it is safe to
run twice.

Edit the bootstrap address first if `berlcamp@gmail.com` is not the account that
should hold the planning-admin role:

```sql
insert into tracks.profiles (email, full_name, global_role)
values ('berlcamp@gmail.com', 'Berl Campomanes', 'super_admin')
```

That row has a null `auth_user_id` on purpose — `tracks.claim_invite()` binds it
on the first Google sign-in from a matching address. There is no password and no
trigger involved.

## 6. Point the app at the cloud

In your hosting environment:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Leave `NEXT_PUBLIC_ENABLE_DEV_LOGIN` unset. The password panel is gated on that
flag **and** a localhost Supabase URL, so it cannot appear in production — but
there is no reason to set it.

## 7. Check it before anyone else does

1. Sign in with the bootstrap address → you should land on the dashboard as
   City Planning Administrator.
2. Sign in with **any other Google account** → `/no-access`, with no profile
   created and zero rows readable. That is the system working.
3. Settings → Sectors should list three. If it is empty, step 2 was skipped.
4. Consolidated AIP → Export to Excel should download a workbook.

## Adding a migration later

Write it as `supabase/migrations/00NN_*.sql`, then:

```bash
npm run test:db          # the SQL suite runs every migration from scratch
npm run deploy:bundle    # regenerate + verify the bundle
```

Apply **only the new file** to the cloud project through the SQL Editor. The
bundle is for a first install; it is not idempotent and re-running it will fail
on the first `create table`.

### Pending on the shared project

| Migration | Apply? |
|---|---|
| `0011_group_depth_cascade.sql` | **Skip.** Superseded by 0012, which drops the columns it fixes. Harmless if you already ran it. |
| `0012_flat_rows.sql` | **Apply.** Column C becomes rows. Needs PostgreSQL 15+ and is **one-way**: nested headings flatten to consecutive ones. It verifies every AIP's rendered sequence is unchanged and aborts the transaction if not. |
| `0013_row_review.sql` | **Apply after 0012.** Per-row review at two stages, the frozen-approval rule, and `finalize_aip_period()`. Additive — it creates `ppa_reviews` and rewrites functions and views; no data is dropped. Every existing row starts `pending`, so **a department mid-encoding will find it cannot submit until its head has approved each row.** Tell the offices before applying. |
| `0014_row_authorship.sql` | **Apply after 0013.** An encoder may edit and delete only rows they authored; the head keeps the whole office. Additive. Rows with no `created_by` — everything seeded or folded in by 0012 — stay open to any encoder of their department, so nothing already encoded is stranded. |
| `0015_accept_requires_review.sql` | **Apply after 0014.** `accept_aip()` now refuses an AIP with a row City Planning has not approved — the same question `finalize_aip_period()` asks, asked while the answer can still be acted on. Function replacement only; no data changes. **An AIP already accepted with unread rows stays stuck** — nothing can be finalised until it is reopened (`reopen_aip`), resubmitted by its head, and read row by row. Check for them first:<br>`select a.id, d.name, count(*) from tracks.aips a join tracks.departments d on d.id = a.department_id join tracks.ppas p on p.aip_id = a.id join tracks.v_ppa_review_status rs on rs.ppa_id = p.id where a.status = 'accepted' and p.row_kind = 'ppa' and rs.planning_status <> 'approved' group by 1, 2;` |
