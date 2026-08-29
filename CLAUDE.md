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
- **City Planning hands a submission back with `reopen_aip`**, from the Reopen
  button on the AIP screen. It needs a reason, which goes to the audit log, and
  it returns the AIP to `draft` without erasing a single review — so the head
  resubmits without re-reading what they already passed, and City Planning
  reads it afresh afterwards. It is the only way out of an AIP that was
  accepted before its rows were read.
- **Accepting is City Planning's signature on the lines**, as submitting is the
  head's: `accept_aip()` refuses while any row is unread or standing as
  returned (`0015`). It has to, because acceptance freezes the rows and
  `review_ppa()` records nothing further on them — an AIP accepted unread could
  never be finalised and could only be rescued by reopening it, which sends an
  office that did nothing wrong back to a draft.
- **`finalize_aip_period()` is the administrator's one signature.** It accepts
  every submitted department AIP and moves the period to `for_ldc` in one
  transaction, and it refuses while any row is pending or returned, or any
  department has not submitted. After it, nobody edits — City Planning included,
  because `can_edit_ppa` allows only `open` and `consolidating` periods.

`planning_staff` is labelled "City Planning Sector Officer" in the UI. The role
key is unchanged; only `ROLE_LABELS` moved.

## Statutory funds

The 20% CDF, 5% CDRRMF, 5% GAD and 1% LCPC are **separate documents with their
own PPA rows**, filed beside the annual programme and never folded into it.

A fund is **reference data** (`tracks.statutory_funds`, Settings → Statutory
funds), carrying its code, its printed worksheet name and its `percentage`. Four
boolean columns on `departments` would have meant a migration for the fifth
mandated fund; a table means an admin screen. Each fund names the departments
that may file it (`statutory_fund_departments`, many per fund).

A department's filing is an **ordinary `aips` row carrying `fund_id`** — not a
second PPA table. `ppa_reviews`, `ppa_returns`, `ppa_revisions`, `allotments`,
`obligations`, `disbursements` and `ppa_progress` all point at `ppas`; a parallel
table would need every one of them again and would drift from them by the second
release. So the two-stage review, the submission lock, authorship and the
execution ledger all apply unchanged.

- **`kind` still means "annual or supplemental". `fund_id` says which
  programme.** A mid-year addition to the CDF is `kind='supplemental',
  fund_id=<CDF>` and needs no new concept. One annual per
  (period, department, fund).
- **The uniqueness indexes fold the null.** `aips_one_annual_idx` is on
  `coalesce(fund_id, '000…0'::uuid)` — NULLs do not collide in a unique index,
  so a bare nullable column would have quietly stopped constraining anything and
  let a department open two annual AIPs.
- **Eligibility is an RLS insert policy**, not a check in the form: `createAip`
  writes through the RLS-bound client. Un-listing a department stops it
  *starting* a new document and never touches one already filed — a settings
  edit that deleted an office's encoded rows would be one nobody could safely
  make.
- **A statutory document does not gate `finalize_aip_period()`.** The programme
  the LDC votes on is the annual AIP; a fund is a mandated attachment beside it,
  and a half-encoded 1% LCPC must not hold the whole city. The finalise panel
  says how many are outstanding without blocking on them, and finalising does
  not accept them.
- **Nothing links a statutory row to an annual one.** A project encoded in both
  places is two independent rows and the database does not know they are the
  same road. That is the accepted consequence of filing them as separate
  documents with their own rows.
- **The ceiling is stated, never enforced.** `statutory_fund_periods.base_amount`
  is the year's base, entered by the planning administrator on the consolidated
  fund view — the fund and its percentage are durable facts, the base is a fact
  about CY2027. `v_statutory_fund_totals` reports base, ceiling, programmed and
  remaining. A base not yet stated reports a **null** ceiling, not zero, and the
  screen shows a dash. An overage is reported: a department encoding in
  September cannot be blocked by what another office entered in August.
- **Statutory money is not in the AIP's GRAND TOTAL.** `v_sector_totals` and
  `v_period_totals` group by `fund_id`, so the annual consolidated view must
  filter `fund_id is null` — filtering on `kind` alone would fold the 20% CDF in,
  because a statutory document is `kind = 'annual'` too. The combined statutory
  figure is stated once, beside the programme, as a figure.
- **A fund exports as one worksheet** named from `sheet_name`, with the sector
  bands intact and **no SUMMARY** — SUMMARY is the AIP form's sector roll-up and
  a fund roll-up is not that form. `?fund=<id>` on the consolidated view and its
  export route.
- **Column (7) defaults to the fund's name** on a row added to a statutory
  document, and stays free text — otherwise the same column prints "20% CDF",
  "20%CDF" and "CDF". A row funded "20% CDF / LGU counterpart" still prints
  correctly.

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

## City Planning edits, and the trail says so

City Planning has always been able to correct any office's row — `can_edit_ppa`
returns true for `is_planning()` at every AIP status, up to and including
`accepted`, while the period is `open` or `consolidating`. What changed in
`0018` is where that is offered and whether anyone can see what was done.

- **The Consolidated AIP is editable.** It was flatly read-only, on the
  reasoning that an overwrite made there — two thousand rows on screen, no
  submission context — gets noticed a month later. The office consolidates from
  that screen, and correcting a line meant leaving it. The lock is asked **per
  row**, not per screen: each row carries its own AIP's status and its own
  office, so `contextForRow(viewer, row)` hands `canEditPpa` the same three
  facts a submission screen hands it. Budget, Accounting and a viewer get no
  Edit, because the same function says no.
- **Adding and deleting stay on the submission screen.** A row's existence is
  the office's submission; its figures are what City Planning consolidates.
- **The period lock is untouched.** Once the programme has gone to the LDC
  nobody edits, City Planning included.
- **Every change is on the record, and the record is readable.**
  `ppa_revisions` is written by TRIGGER on every insert, update and delete of
  `ppas`, so a change made through a route nobody remembered to instrument is
  in it too. `0018` adds `changed_role` — the capacity the change was made in,
  stamped at the moment of the write rather than joined from `user_roles`
  later, because a role can be reassigned and a trail that re-read it would
  rewrite its own history. Null on anything recorded before `0018`, and the
  panel says so rather than guessing.
- **History is in every row's menu, on both grids, for everyone provisioned.**
  `ppa_revisions_read` is `is_provisioned()`, so the office whose figure was
  overwritten reads who overwrote it, from what, to what. An audit trail only
  the overwriter can see is not one. The trail has no UPDATE and no DELETE
  policy for anybody, planning administrator included, and `ppa_revisions.ppa_id`
  is deliberately **not** a foreign key — the point of the trail is the row that
  is no longer there.
- **`lib/aip/history.ts` turns a revision into a sentence** and is where
  `amount_mooe` becomes "MOOE (9)". A revision whose only changed column is
  `sort_order` reads "Moved in the document": inserting above a row shifts every
  row beneath it, and reporting fourteen of those as "changed" would bury the
  one edit that mattered. Like the review and "Encoded by" columns, the trail is
  on screen only and is never printed.

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
- **The statutory funds are modelled** (20% CDF, 5% CDRRMF, 5% GAD, 1% LCPC) —
  see "Statutory funds" below. This reverses an earlier decision that they were
  out of scope: the office files them every year and was keeping them in a
  spreadsheet beside the one this application prints. **INFRASTRUCTURE CONSO is
  still out of scope**, and so are the mandated GAD Plan and Budget and LDRRMFIP
  forms — a fund exports as the AIP grid, and must not be called by those names.
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

## The presentation deck

`/planning/reports` is what the City Planning Office presents from: twelve
reports on the Annual Investment Program, laid out 16:9 for a projector, for the
Mayor, the LDC and the City Council. It reads and never writes.

- **One RPC, one snapshot.** `tracks.presentation_deck()` returns every slide's
  figures as a single `jsonb` document. Not nine endpoints: every slide is then
  aggregated from the same read, so the Executive Summary's grand total and the
  Sector slide's bars cannot drift apart between two round trips while somebody
  is standing in front of a screen. It is `SECURITY INVOKER` over
  `security_invoker` views, so it bypasses nothing.
- **Nothing in TypeScript adds up a peso.** Where a slide states a share, a rate
  or a variance, that number was computed in SQL beside the totals it came from.
  `09_presentation.sql` asserts the deck's grand total against `v_period_totals`,
  its sector figures against `v_sector_totals` and its office figures against
  `v_aip_totals` — the guarantee is the test, not a convention.
- **A drill-down recomputes and says so.** Filtering by sector, office, funding
  source, barangay or status re-aggregates over the visible rows in SQL and sets
  `filtered`, which every slide captions — the rule the grid already follows for
  a subtotal marked "(filtered rows only)".
- **The document is the same triple as the consolidated view**: (period, kind,
  fund). A statutory fund is presented as its own deck and its money is in none
  of the annual programme's figures.
- **Everything is sized in `cqh`** — a percentage of the slide's own height (see
  `.deck-slide`). One set of components typesets as a panel in the app shell, as
  a full-screen slide on a projector and as a landscape page from `?print=all`.
  Recharts is told nothing in pixels either: `ChartContainer`'s `aspect-video`
  and `text-xs` are both overridden, so a chart is as large as the panel it is
  given and its axis type scales with the slide.
- **The chart type follows the figures, not variety** (`components/reports/charts.tsx`,
  on Recharts through shadcn's `ChartContainer`):

  | | |
  |---|---|
  | horizontal bars | a ranking with long names — sectors, offices, barangays, funding sources, the largest PPAs. Names read left to right, so the category axis has to be the vertical one |
  | vertical bars | a small ordered set with short labels: the review checkpoints, the money cascade, a programme against a ceiling |
  | line | time. Years, and the twelve months of the execution year. The slope is the point; a bar chart of months reads as a ranking |
  | donut | a **partition** of one figure already on the slide. Never a ranking — a pie of fourteen offices is unreadable at four metres and on paper |

  A single percentage against a track stays a plain `<Meter>`: a charting
  library adds nothing to it and a gauge would take four times the room.
  `domain={[0, 'dataMax']}` is set explicitly on every measure axis — left to
  choose, Recharts rounds the maximum up to a "nice" number and every bar is
  then drawn at a fraction of the width for no reason a reader can see.
- **The Executive Summary carries the year's execution curve**: cumulative
  obligation against disbursement, January to December, aggregated by the
  `monthly` CTE in `presentation_deck()`. The gap between the two lines is
  money committed and not yet paid, and its shape over the year is the thing a
  table of totals cannot show. Anything dated before the year opens January
  rather than starting the curve at zero — otherwise the chart draws a January
  jump that never happened — so the last point IS the total beside it, which
  `09_presentation.sql` asserts.
- **`components/reports/slides.tsx` is `'use client'`**, and has to be: a
  formatter passed to a chart is a function, and a function cannot cross the
  server/client boundary. Without it the interactive deck worked and
  `?print=all` — reached straight from a server component — returned a 500.
- **The same reports are on the dashboard, scoped.** `/planning/reports` is
  the city's programme and is closed to a department account. The dashboard
  offers those reports to every provisioned reader — one dropdown instead of a
  contents rail, no presentation mode and no printing — and a department
  account reads them over **its own office and nothing else**.
  - The scope is applied in `loadDeckRequest({ scope })`, on the server, before
    the RPC is called. It is not RLS and must not be mistaken for it:
    `ppas_read` is `is_provisioned()`, so the database hands every provisioned
    account every office's rows — as the consolidated view and the execution
    ledger require. `?office=` is ignored outright while a scope is set.
  - **A scope is not a drill-down, and is not captioned as one.**
    `presentation_deck()` sets `filtered` the moment `p_department_id` is
    passed, which is right for a planning officer narrowing the city's
    programme and wrong for the only programme an office has. `isDrilledDown()`
    corrects the flag and `ScopeNote` states whose figures these are, on every
    slide — a head comparing this grand total against the consolidated AIP has
    to be able to see there that the two are different documents.
  - **Ten of the twelve reports narrow; two do not.** `resources` and `trend`
    are built from `aip_periods`, `v_period_totals` and
    `v_statutory_fund_totals` and never see the department filter. That is
    right for what they are — the NTA and the statutory bases belong to no
    office and the multi-year series is the whole programme's — so
    `slidesFor(scope)` withholds them inside one rather than showing city
    figures under an office's heading. The panel says how many reports there
    are and why. The Decision Summary's Funding column carries three of the
    same city figures and withholds those three under a scope, keeping the one
    fact — PPAs with no funding source — that is counted over the rows on
    screen.
  - The report is client state, not `?slide=`: the whole deck arrives in one
    payload, so changing report costs no round trip. The presenter's deck keeps
    the URL parameter, because a link to slide nine has to be sendable.
- **Presentation mode is a ROUTE, not an overlay.** `/planning/reports/present`
  lives in its own `(present)` route group with no shell. An overlay was tried
  first and only ever *covers* the sidebar: the rail keeps its place in the tab
  order and in the accessibility tree behind it, so somebody tabbing
  mid-presentation lands on links nobody can see and a screen reader announces
  a navigation that is not on the screen. Here there is no navigation to hide,
  because none is rendered. Both routes resolve the request through
  `loadDeckRequest()`, so the screen the presentation was set up on and the
  screen behind the Mayor cannot show two different documents. Arrows and
  Page Up/Down move between slides — whoever is presenting is holding a clicker
  that sends nothing else.

### Two things the deck states rather than hides

- **Barangay is DERIVED.** The AIP form has no location column and `ppas` has no
  barangay: `tracks.barangay_mentions()` reads names out of a PPA's description
  and expected output, and the slide says so in as many words. A row naming
  several barangays is attributed to **none** of them — attributing it to each
  would count the same peso twice — and a row naming none is not assigned
  anywhere; both go to their own buckets, which are on screen. A barangay
  breakdown that could be relied on needs a location recorded against the PPA,
  which is a change to the row and to the encoding form, not to this report.
- **The resources slide compares against what is recorded, and nothing else.**
  `aip_periods.nta_amount` and the statutory bases are figures the planning
  administrator entered. TRACKS holds no revenue projection and the deck invents
  none, so the "gap" is a gap against the NTA alone and is labelled that way.

Physical progress that was never reported is never rendered as 0%: it is its own
state, it is left out of the weighted average, and the slide prints how much of
the programme the average speaks for.

## Demo mode

A whole worked programme year, on the real application, that can be shown to
people and handed back to its starting state afterwards. Settings → Demo.

- **Demo data lives in its own AIP PERIOD, and that is the entire safety
  argument.** Everything in `tracks` hangs off `aip_periods` — aips, then ppas,
  then reviews, returns, revisions, allotments, obligations, disbursements,
  progress; `aip_actions` off the period directly — so a period is the only
  boundary a reset can be scoped to and be *structurally* unable to escape.
  Every statement in `rebuild_demo_data()` filters on `aip_periods.is_demo`,
  and `11_demo.sql` asserts the negative claim directly: seed it, edit it,
  reset it, and not one real submission, row or peso moved.
- **There are NO demo sign-ins.** Whoever is signed in walks the demo. The
  application still holds nothing but the anon key — no service-role path was
  added, and none should be. The demo PROFILES carry `auth_user_id = null`:
  they exist so rows have believable names against them and they can never
  authenticate, because there is no auth user to authenticate as. Their
  addresses are on `.invalid`, which RFC 2606 reserves.
- **Off HIDES the year; it does not delete it.** A toggle that destroys data is
  one somebody flips by accident, and whoever turns it back on next month wants
  what they left. Rebuilding is its own button that says what it does.
- **Hiding is RLS, not a filter in TypeScript**, so the demo year leaves every
  screen at once — picker, consolidated view, monitoring, Budget's worklist,
  the deck — with no query edited. `v_ppa_rows`, `v_aip_totals`,
  `v_sector_totals`, `v_period_totals` and `v_monitoring` are all
  security_invoker and all start `from tracks.aips`.
- **BOTH policies on each table carry the predicate, not just the one called
  `_read`.** `aips_planning_write` and `aip_periods_admin_write` are `FOR ALL`,
  which includes SELECT, and permissive policies are OR'd — so tightening
  `aips_read` alone hid the demo from a department head and left it in full
  view of the City Planning Office, which is the one audience the switch exists
  for. That bug is what `75a`–`75e` exist to catch.
- **`ppas_read` is deliberately NOT filtered.** It would put an EXISTS on the
  hottest read in the application to hide rows already unreachable through
  every view that renders them. Demo data is not secret; it is noise.
- **The demo year is in the PAST** (the newest free year at or below 2025).
  `getCurrentPeriod()` takes the latest year, so a demo dated ahead of the real
  programme would become the year every screen opened on. It is badged `DEMO`
  in the year picker and on both document headers.
- **The period is `consolidating` with an LDC leg that came back**, not
  `for_ldc`. A demo has to stay editable — that is the point of the reset
  button — and paper comes back as well as goes out, so a returned Mayor's leg
  is both truthful and the more useful thing to show.
- **`ppa_revisions` is NOT deleted by a reset.** It has no DELETE policy for
  anybody, and a reset that erased the trail would be the one thing in this
  schema allowed to rewrite history. Old entries point at PPA ids that no
  longer exist, so nothing renders them.
- `demo_standing()` is the one deliberate exception to the hiding: the settings
  panel has to report what is in the demo year *while it is hidden*, which is
  exactly when somebody is deciding whether to turn it back on. It is
  SECURITY DEFINER, planning-administrator only, and returns three counts and a
  title — no row.

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
- **The year is a URL parameter, not the latest row.** `?period=<id>` on
  Submissions and on the Consolidated AIP, chosen with a picker that appears
  once there is more than one; an id that no longer exists falls back to the
  current programme rather than erroring. Only the current year offers "Start
  AIP" — an older period may still be `open`, and nothing closes it
  automatically. The consolidated page also takes `?kind=supplemental`, which
  consolidates the period's supplementals as **their own document**: they are
  never folded into the annual programme, and the finalise panel belongs to the
  annual view even though the supplementals' rows count towards it.
- **Where the programme has got to is set on the Consolidated AIP page**, not in
  Settings — it is a fact about that document rather than reference data. The
  control is the planning administrator's (`set_period_status`, audited, and
  free in both directions because paper comes back as well as goes out); anyone
  else reads it as a badge. Settings → AIP periods shows the status but no
  longer changes it.
- A department's annual AIP and its supplementals are shown **side by side and
  never merged**. Each is a document with its own status, its own council leg and
  its own printout; a merged view would invent a combined programme no office
  ever approved. The combined figure is stated once, as a figure — and it spans
  **one programme only**, because a figure combining the annual AIP with the 20%
  CDF would be a total nobody approved.
- `/aip` is **two tables**: the annual programme with its supplementals, and the
  statutory funds beneath it. "Start a document" is a menu — a supplemental, or
  a fund this office is listed against and has not filed — rather than a row of
  buttons that empties itself one at a time as each is used.
- Monitoring measures utilisation against the **allotment**, not the programmed
  amount, and shows a dash rather than 0% when nothing has been allotted yet.
  Both figures are on screen together because they differ.
- **`getMonitoring()` no longer filters `aip_kind = 'annual'`.** It used to, which
  silently hid every supplemental PPA from Budget and Accounting: the rows were
  encoded, reviewed and accepted, then could never be allotted against because
  they never reached the worklist. `/monitoring` takes a document picker
  (`?fund=`) because a report is read as the programme it belongs to; `/budget`
  stays **one list across every document** with a fund column, because a clerk
  wants every outstanding OBR in one place.
- **Monitoring's fund tabs follow filed documents, not eligibility.** A
  department sees a tab for each fund *its own office has filed*
  (`listFiledFunds`), not the four that exist and not the ones it is merely
  listed against in Settings — a report tab that opens on nothing is worse than
  no tab, and the tab appears the day the document does. A `?fund=` for a
  document the reader has none of falls back to the annual programme, the same
  way a stale `?period=` does. The Consolidated AIP is the exception and lists
  **every** fund: the planning administrator has to reach a fund to state its
  base before anybody files against it.
- **Money is entered in one place.** `/budget` is Budget and Accounting's
  workspace — a single-column worklist of every PPA with the one thing
  outstanding on it (`lib/execution/worklist.ts`, tested), opening into the
  ledger at `/budget/<ppaId>`. `/monitoring` is the report and reads the same
  ledger with the money buttons withheld (`canRecordMoney={false}`), because a
  report that also takes entries is a report people edit by accident. This is
  placement, not permission: the officer records the same OBR from the
  workspace and RLS would allow either. Physical progress is not money and is
  still reported from the monitoring side, by the office doing the work.
- Every `<Label>` binds to its control with `htmlFor`. A label that is only text
  above a box announces nothing to a screen reader and does not focus on click.

## Commands
```
npm run db:start     # local Supabase on 548xx
npm run db:reset     # wipe local DB, re-apply migrations + seed
npm run db:users     # create the local demo sign-ins (localhost only)
npm test             # 155 unit tests — exporter, template fidelity, grid, permissions, deck, history
npm run test:db      # 272 SQL tests against a throwaway Postgres.app database
npm run typecheck
npm run export:demo  # build a real .xlsx from the local database
npm run test:e2e     # 53 Playwright tests against the local stack
npm run dev          # localhost:3000
npm run build
```

`test:db` is independent of Docker — it runs whether or not `db:start` is up.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
