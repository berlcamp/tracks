# TRACKS — LGU Annual Investment Program

Annual Investment Program tracking for the City of Bayugan: departments encode
PPAs, the City Planning Office reviews and consolidates, the paper goes to
LDC / Mayor / City Council, Budget allots and obligates, Accounting disburses,
and the whole thing prints back out as the official AIP form.

The reference document is `CY 2027 Annual Investment Program_Consolidated v3.xlsx`
— 9 worksheets, 1,268 PPA rows. The exporter must reproduce its sector sheets and
SUMMARY exactly.

## Hard rules — read before touching anything

### The Supabase project is SHARED
Other apps (pta-collections, construction-saas, sms-demo) live in the same
Postgres. `auth.users`, `storage.objects`, the `public` schema and the Google
OAuth config are shared infrastructure. Treat everything outside `tracks` as
third-party.

- **Never run `supabase db push`, `db reset`, or `db diff` against the remote.**
  They operate on the whole database and will propose dropping the other apps'
  objects. Production migrations are applied by hand, in order, via the SQL
  Editor — see `DEPLOY.md`, and `npm run deploy:bundle` for a verified bundle.
- **Never add a trigger to `auth.users`.** A raising trigger there breaks signup
  for every app on the project. Provisioning is lazy, via `tracks.claim_invite()`.
- **Never create anything in `public`.** Schema `tracks` only.
- `tracks` must be listed in Settings → API → Exposed schemas, or PostgREST
  returns 404 for every table.

### Architecture invariants
- Reads go through the RLS-bound user client. Workflow transitions (submit,
  return, resolve, accept, reopen, period status) go through `SECURITY DEFINER`
  RPCs in `tracks`. Never flip `aips.status` from TypeScript.
- Every total comes from a view (`v_aip_totals`, `v_sector_totals`,
  `v_period_totals`, `v_ppa_financials`). Nothing in TypeScript re-adds a column
  of pesos — the printed workbook and the on-screen grid cannot be allowed to
  disagree.
- All money is `numeric(16,2)`. Never float. Amounts are stored in **pesos**; the
  source workbook's "(In Thousand Pesos)" caption is wrong and the exporter
  prints the corrected one.
- `ppas.amount_total` is a generated column. `item_no` is **not stored** — it is
  `row_number()` in `v_ppa_rows` over `row_kind = 'ppa'` only, so column (2)
  renumbers itself and a heading takes no number and consumes none: the sequence
  reads 37, heading, heading, 38.
- **Nothing may point at a heading.** `ppa_returns`, `allotments`, `obligations`,
  `disbursements`, `ppa_progress` and `continues_ppa_id` reference
  `(id, row_kind)`, so Budget cannot allot against "Support to Tech4ed". A
  `ppas_header_is_caption_only` CHECK keeps a heading free of dates, office and
  money — one holding ₱5m would land in a subtotal while printing as a caption.
- `ppa_revisions` is written by trigger, so a City Planning overwrite of a
  department's figure can never happen off the record. `audit_logs` and
  `ppa_revisions` have no UPDATE or DELETE policy: those operations are denied to
  everyone, planning admin included.

### Review, in two stages
Every PPA row is read twice, by two different people, and the reading is an
append-only log (`ppa_reviews`) rather than a status column — a decision is a
fact about a moment. The current status is the latest entry per (row, stage);
`ppa_reviews` has no UPDATE and no DELETE policy, so an officer who changes
their mind records a second decision rather than editing the first.

| Stage | Who | When |
|---|---|---|
| `department` | the department head, on their own office's rows | while the AIP is `draft` |
| `planning` | the City Planning Sector Officer (`planning_staff`) | once it is `submitted` |

Both may approve or return, and both may attach remarks — an approval carrying
"checked against the PPMP" is the thing a head can point at a year later.
Returning requires a reason; approving does not.

- **An approved row is frozen.** The department cannot edit or delete it. To
  change it the approval is withdrawn first, which is a second entry in the log.
- **The head cannot submit until every row is approved.** They sign for the
  lines, not the folder.
- **Submitting opens a fresh reading.** The head's approval is not City
  Planning's, so `review_status` returns to `pending` at the planning stage.
- **`finalize_aip_period()` is the administrator's one signature.** It accepts
  every submitted department AIP and moves the period to `for_ldc` in one
  transaction, and it refuses while any row is pending or returned, or any
  department has not submitted. After it, nobody edits — City Planning included,
  because `can_edit_ppa` allows only `open` and `consolidating` periods.

`planning_staff` is labelled "City Planning Sector Officer" in the UI. The role
key is unchanged; only `ROLE_LABELS` moved.

## An encoder owns what they wrote
A department can have several encoders — `user_roles.profile_id` is unique per
PERSON, not per department. Each may edit and delete only the rows they
authored; the **head may edit and delete any row in their own office**, because
they sign for the whole submission. City Planning is unchanged.

Inserting is not editing: an encoder may still add a row above or below anyone
else's. Only Edit and Delete turn on authorship.

`ppas.created_by` is null on everything seeded or folded in by `0012`, so a row
with **no author on record is open to any encoder of its department** — enforcing
strictly would have frozen every pre-existing row out of reach on the day
`0014` was applied. `v_ppa_rows.author_name` drives the "Encoded by" column,
which like the review column is on screen only and never printed.

## The submission lock
The rule the whole department workflow turns on, and the one most likely to be
broken by a later change:

| AIP status | Department can edit |
|---|---|
| `draft` | everything, and may add/remove rows |
| `submitted` | nothing |
| `returned` | **only the items with an open return** — 3 returned of 200 does not reopen the other 197. No rows may be added |
| any status | never a row the reviewer has approved — that one is frozen until the approval is withdrawn |
| `accepted` | nothing |

City Planning may edit at any time until the period is `closed`. Enforced by
`tracks.can_edit_ppa()` (per item) and `tracks.can_modify_aip_structure()`
(insert/delete), not by application code. Covered by `04_workflow.sql`.

## Decisions taken from the workbook, not guessed

- **A department belongs to exactly one sector.** Verified: no department appears
  on two sector worksheets. That is what makes the consolidated layout
  reproducible. If it ever stops being true, `sector_id` moves onto the PPA.
- **Column C is a caption row, not a tree.** The source workbook nests headings
  1–3 deep conceptually, but `writeGroupRow` only ever printed a name: no indent,
  no weight change, nothing. The nesting was never visible in the artefact the
  tree existed to produce, so `0012` folded it away. A heading is now a `ppas`
  row with `row_kind = 'header'` carrying only a description, and the whole
  document is one `sort_order` line — which is the only model in which "insert a
  row below this one" means the same thing everywhere. Flattening was one-way.
- **Statutory-fund sheets are out of scope** (20% CDF, 5% CDRRMF, 5% GAD, 1% LCPC,
  INFRASTRUCTURE CONSO). Only the sector sheets and SUMMARY are modelled.
- **Climate-change columns (13)(14)(15) exist but are never populated** in the
  source. They are nullable and print blank.
- `ref_code` is free text and is **not** derived from the item number, so the two
  can drift. That is accepted behaviour, not a bug.
- **A supplemental AIP only ever ADDS PPAs.** It never amends an existing row's
  amount, so there is no realignment link to model and no before/after to print.
  `ppas.continues_ppa_id` is for something else entirely — the same project
  carried across two AIP *years*.
- **The monitoring report is not a separate mandated form.** It is the AIP layout
  with the execution columns appended.

## The exporter

`lib/aip/workbook.ts` reproduces the official form: the 3-row merged title block,
the two-tier header with its `(1)`–`(15)` numbering, the sector and department
band rows, the group rows in column C, the subtotal rows merged across A:H, the
template column widths and the accounting number format. `tests/aip-template.test.ts`
asserts all of that against `tests/fixtures/template-geometry.json`, which was
extracted from the real workbook — change a width or drop a merge and it fails.

Two deliberate departures from the source, both confirmed with the office:

- the AMOUNT caption reads **"(In Pesos)"**. The source says "(In Thousand Pesos)"
  while holding pesos; the caption is the thing that is wrong.
- **no cell contains a formula.** Every figure is the number the database
  computed. The source SUMMARY sheet has already decayed into `#REF!` in four
  places, including its own GRAND TOTAL.

`lib/aip/assemble.ts` folds the view rows into the nested shape and **never adds
up a column of pesos** — totals come from `v_aip_totals`, `v_sector_totals` and
`v_period_totals`. A total missing from the input is reported as zero rather than
derived, because a wrong number is worse than an obvious one.

## The app

Next.js 16 App Router, React 19, Tailwind 4, shadcn (radix-nova) — the same
stack and component set as `berlcamp/pta-collections`, so the sidebar, tables and
type scale match.

- `proxy.ts` is the access gate (Next 16 renamed middleware → proxy). It refreshes
  the session, calls `tracks.claim_invite()` for a signed-in account with no
  profile, and bounces the uninvited to `/no-access`.
- `lib/auth/permissions.ts` mirrors the database's rules so the UI can hide what a
  user cannot do. It is **not** the enforcement: RLS and the workflow RPCs are.
  Keep the two in step — `canEditPpa` is `tracks.can_edit_ppa`.
- `lib/aip/grid-model.ts` turns rows into the grid's band/heading/subtotal
  sequence. It is a pure function and it is tested, because this layout has to
  agree with the exported workbook's layout.
- Rows are added the way a spreadsheet adds them: a per-row menu in a leading
  column outside the printed `(1)`–`(15)` numbering, offering add above, add
  below, edit and delete. The add modal asks which kind of row first — a line of
  the programme, or a column-C caption. Inserting goes through
  `tracks.insert_ppa_row`, which is `SECURITY INVOKER`: it bypasses nothing, so
  the same policies still judge it, and the shift plus the insert are one
  transaction. Deleting leaves a gap in `sort_order` on purpose — the document is
  ordered by the sequence, not its values.
- Writes to `ppas` go through the RLS-bound client, not an RPC, so the submission
  lock rejects them in exactly the way psql does. Workflow transitions
  (submit/return/resolve/accept/reopen) go through the RPCs.
- Filtering the grid recomputes the subtotal rows over the visible rows and marks
  them "(filtered rows only)" — a subtotal that silently included hidden rows
  would be worse than no subtotal. A heading survives a filter only if a row
  still stands under it or it matches the search itself, and the exporter applies
  the same rule, or screen and workbook disagree.
- A department's annual AIP and its supplementals are shown **side by side and
  never merged**. Each is a document with its own status, its own council leg and
  its own printout; a merged view would invent a combined programme no office
  ever approved. The combined figure is stated once, as a figure.
- Monitoring measures utilisation against the **allotment**, not the programmed
  amount, and shows a dash rather than 0% when nothing has been allotted yet.
  Both figures are on screen together because they differ.
- Every `<Label>` binds to its control with `htmlFor`. A label that is only text
  above a box announces nothing to a screen reader and does not focus on click.

## Commands
```
npm run db:start     # local Supabase on 548xx
npm run db:reset     # wipe local DB, re-apply migrations + seed
npm run db:users     # create the local demo sign-ins (localhost only)
npm test             # 78 unit tests — exporter, template fidelity, grid, permissions
npm run test:db      # 144 SQL tests against a throwaway Postgres.app database
npm run typecheck
npm run export:demo  # build a real .xlsx from the local database
npm run test:e2e     # 30 Playwright tests against the local stack
npm run dev          # localhost:3000
npm run build
```

`test:db` is independent of Docker — it runs whether or not `db:start` is up.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
