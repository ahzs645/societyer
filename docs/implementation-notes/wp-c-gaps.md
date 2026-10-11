# WP-C: gap identification

Implements audit section 4 ("Identifying gaps"), schema findings §5a/§5b
(A14 representation gaps, A15 governance expectations, A4 committee model,
B11 generic coverage page) and intake-design §6.1–6.3, plus the meeting
states "Cancelled" and "Held — minutes missing".

## What was built

### System gaps (A14, B11)

- **Table** `representationGaps` (`convex/tables/gaps.ts`): `infoType` from a
  controlled list (`shared/gapCatalog.ts`, 50 types grouped by area),
  `reason` (`no_schema_field`, `no_import_key`, `import_dropped`,
  `no_ui_input`, `identity_unresolved`, `ambiguous_source`, and
  `not_transposed`), `status` (`open`, `kept_as_text`, `resolved_native`,
  `schema_change_requested`, `wont_fix`), structured `locator` (page,
  section, sheet, cell range, line range, block, char offsets, path, sha256),
  `excerpt`, `observedDate` (partial dates), `bodyKey`, affected
  table/id, proposed target table/field/value, import session/record links,
  `sourceEvidenceId`, `dedupeKey`, `sensitivity`, and an append-only
  `reviewHistory`. Enumerations are stored as strings and validated in the
  portable handlers, so old backups and future values still restore.
- **Functions** (`shared/functions/representationGaps.ts`, domain
  `representationGaps`, classified under `documents:*`): `list` (by status,
  info type, reason), `get`, `summary` (groups by info type × reason with
  status counts, per-area totals, per-import-session counts, legacy backfill
  progress), `forRecord`, `countForRecord`, `coverage`, `create` (reviewer
  "can't represent"), `setStatus`, `bulkSetStatus` (by ids or by group; never
  bulk-resolves natively), `linkAffected`, `remove`, `recordPreflight`,
  `backfillFromSourceEvidence`.
- **Import contract**: new bundle key `representationGaps` (record kind
  `representationGap`, handler delegates to
  `insertRepresentationGapFromImport`). Edits in the import files are one
  line each (record kinds, constants, mutation domain map, handler entry,
  source-evidence skip).
- **Preflight emits gaps**: `importBundlePreflightGaps(bundle)` in
  `shared/importBundlePreflight.ts` turns every unsupported key
  (`no_import_key`) and dropped field (`import_dropped`) into a typed draft
  with the field path as locator, the lost value as excerpt/proposed value
  and the record's source external id. `importBundlePreflightIssues` keeps
  its exact messages. `importSessions:createFromBundle` now records the
  drafts against the new session (idempotent per session + path).
- **Backfill**: `backfillFromSourceEvidence` converts legacy untyped
  `sourceEvidence` rows (an `import_support` row, or any row with a
  `targetTable` and no `targetId`) into typed gaps. Batched (default 400 per
  call), idempotent (`sourceEvidenceId` + `dedupeKey legacy:<id>`), never
  modifies the evidence rows, never copies restricted excerpts. Info type and
  reason come from the target area plus title rules (agreements →
  `agreement/no_schema_field`, `.msg` → `correspondence`, consent forms →
  `director.consent/no_import_key`, TOR → `committee.mandate`, agendas →
  `meeting.package`, "cancelled" → `meeting.cancelled`, schedules →
  `meeting.schedule`, …). `observedDate` comes from a "Date:" line or the
  file name; `bodyKey` (members / board / committee) from the title.
- **UI**: `UnsupportedDetailsBadge` (`src/components/UnsupportedDetailsBadge.tsx`)
  — "N unsupported details" linking to the backlog filtered to the record.
  Added to the meeting detail header and the committee detail chips.

### Record gaps (A15)

- **Tables** `governanceExpectations` (body kind, committee, kind, cadence
  rule, effective dates, severity, origin, rule key, citation, authority
  document/locator, status active/suggested/archived) and
  `continuityPeriodMarks` (a person's disposition of one expected period:
  `never_held`, `cancelled`, `waived`, `not_applicable`, `satisfied` with
  attached documents or a meeting).
- **Engine** `shared/continuity.ts` (pure) + `shared/functions/continuity.ts`
  (portable, domain `continuity`, classified under `deadlines:*`):
  - expands each expectation into periods: calendar year, monthly (optional
    months), quarterly, N per year (optional months), after-event (AGM +
    offset), continuous (per year);
  - matches meetings by body (members/AGM, board, committee id), counting
    distinct dates so draft/approved/format copies count once; a meeting is
    approved when `approvedAt`/`approvedInMeetingId` is set or a later
    motion `adoptsMinutesId` it;
  - annual reports: filings of an "annual" kind filed within ~a year of the
    AGM or labelled with the year; late filings are satisfied with a note;
  - financial statements: `financials` presented at the AGM or for the fiscal
    year ending ≤ 15 months before it; unverified imports are `draft_only`;
  - director count and consent per year from director terms;
  - insurance in force per year (optional series key);
  - statuses `satisfied`, `draft_only`, `record_missing`, `source_only`
    (a typed gap with an observed date for that body/period), `cancelled`,
    `never_held`, `waived`, `not_applicable`, `upcoming`. Evidence missing is
    never reported as "not held" unless a person marks it.
  - cross-reference gaps: "minutes of <date>" / "minutes dated <date>" in
    minutes text (discussion, sections, motions, source record) with no
    meeting-with-minutes within ±2 days; the year is inferred when omitted.
  - inferred cadence: per body with ≥ 4 meeting dates, median interval and
    usual months → monthly / quarterly / N per year suggestion with a
    confidence; the person confirms it into a stored expectation.
  - record families the caller cannot read are reported as "not visible",
    never as missing.
- **Expectation sources**: (1) BC Societies Act rule pack
  (`shared/continuityRules.ts`) — AGM each calendar year (s. 71(1)–(2), not
  in the incorporation year), annual report within 30 days after the AGM
  (s. 73(1)), financial statements presented at each AGM (s. 35(1)), at
  least 3 directors (s. 40; skipped for member-funded societies), director
  consent (s. 42(4)). Citations checked against BC Laws, Societies Act SBC
  2015 c. 18, current to 2026-09-22, retrieved 2026-10-06. All rules are
  `draft` with caveats (CONTRIBUTING rule-pack guidance). The pack applies
  implicitly; "Store rule pack to edit" materializes it so rows can be
  edited or switched off (an archived stored row disables the rule).
  (2) `deriveFromBylawRules`: annual-report offset when the active bylaw rule
  set differs from 30 days, and statements-at-AGM when required.
  (3) Manual entry with cadence editor. (4) Inferred-from-history
  suggestions.
- **Dashboard**: `continuity:dashboardChecks` → card "Record continuity"
  (AGM held this year, annual report filed after the latest AGM, minutes
  approved in the last 12 months, director consent on file). Implemented as
  a separate query/card so `shared/functions/dashboard.ts` is untouched.

### Coverage & gaps page (B11)

`/app/coverage` (`src/pages/CoverageGaps.tsx`, `src/features/gaps/*`),
read permission `deadlines:read`, in the Compliance nav group. Tabs:
record continuity heat-map (body × year, or body × month for one year; each
cell carries a glyph and accessible label, never color alone; click → period
drawer with evidence links and actions: never held (reason required),
cancelled, waived (reason required), not applicable, attach evidence via a
document title search, upload, record meeting, clear mark); record gaps by
severity (statutory / bylaw / internal practice, draft-only optional) plus
the cross-reference list; system-gap backlog (counts by info type × reason,
bulk keep-as-text / request schema change / won't fix with confirmation,
per-gap status with notes, record-filtered view from the badge, legacy
conversion with progress, "Record a gap" form); native coverage per area;
expectations editor. `/app/source-model-coverage` now redirects to
`/app/coverage?tab=system`; `src/pages/SourceModelCoverage.tsx` (hard-coded
to PGAIR id prefixes) is deleted.

### Committees (A4)

`committees.kind` (standing | ad_hoc | working_group | executive | advisory),
`parentBody` (board | members | committee) + `parentCommitteeId`,
`cadenceRule` (same validator as expectations) and `mandateVersions[]`
(id, effective from/to, title, mandate text, document, cadence rule, quorum
text, notes; validated non-overlapping). The free-text `cadence` stays and
follows the structured rule unless a label is given. Mutation
`committees:updateStructure`; editor card on the committee detail page
(replaces the old read-only Cadence card); kind on the create form.

### Meeting states

`shared/meetingStatus.ts`: `Scheduled`, `Held`, `HeldMinutesMissing`
("Held — minutes missing"), `Cancelled` (plus the import-only `Draft`).
Additive: `meetings.status` stays a string. The meeting form offers the new
status, lists/details show its label, AGM lookups for annual-report
pre-fill and the filing bot accept it as held, and continuity treats it as
"held, minutes missing".

## Verification

- Gates: `npm run test:continuity` (rule pack, cadence validation, period
  expansion incl. leap months and effective dates, every status, marks,
  cross references, inferred cadence, portable handlers + authorization,
  seeding/archiving, bylaw derivation, committee structure) and
  `npm run test:representation-gaps` (vocabulary, date and body extraction,
  legacy classification table, preflight emission, bundle key, backfill
  batching/idempotence/restricted excerpts, triage lifecycle and history,
  bulk rules, preflight recording on session creation).
- Existing gates re-run: authorization policy, permissioned mutation,
  workspace access, static parity, portable manifest, portable conformance
  matrix (0 divergent), import bundle preflight.
- `test:interface-route-coverage` still fails only on the pre-existing
  `/app/people-directory/:id` and `/app/people-history` entries (owned by
  the people package); the two new routes are covered.
- Browser, demo org (local runtime): heat-map, period drawer (marked a
  missing AGM year "never held" with a reason; the cell turned "N"), month
  view, record gaps, expectations (added a manual cadence; its row appeared),
  native coverage, dashboard card, committee structure editor (added a
  mandate version), phone width 390 px.
- Browser, restored PGAIR backup (142 meetings): before conversion the AGM
  row shows 2017 and 2018 as record missing (audit gap 1), 2023–2025 missing
  (never transposed), and 2009/2011/2013/2015/2016/2019–2022 as draft only
  (no approval recorded, audit gap 5). Annual-report rows are record missing
  for every AGM year (audit gap 6, "evidence missing"); financial statements
  missing or unverified (gap 7); director rows missing every year (gap 8).
  Converting the 3,591 legacy rows took about 5 s and produced 25 info-type
  groups (top: minutes content 792, general records 443, programs 431,
  agendas without minutes 384, committee mandates 267, agreements 63,
  director consents 55, proxies 35). After conversion 2010, 2012, 2014 and
  2023–2025 AGMs become "only in source files"; 2017 and 2018 stay record
  missing. Cross references found: minutes of 2010-09-28 (audit gap 3),
  2018-11-20 and 2018-11-28 (the missing Nov 2018 meeting, gap 1), plus
  2011-09-27, 2014-11-25, 2020-05-20 and 2020-06-20. Confirming the inferred
  board cadence (5 per year) shows 2018 as "no meeting record" (gap 2).
  153 converted gaps link to the 132 meetings their source files fed, so
  meeting pages show "N unsupported details" (one 2021 AGM shows a 2022
  agenda among them, exposing the audit's mis-merge). Native coverage
  overall 13.8 %.

## Assumptions and decisions

- New reason `not_transposed` was added beyond the audit's list: the 3,591
  PGAIR rows are sources mapped to a model area whose content was never
  transposed, which is neither a schema nor an import-key gap.
- Statutory rules apply from the year after incorporation, or from the first
  recorded meeting year when no incorporation date is set (PGAIR has none).
  Years before 28 Nov 2016 were under the former Society Act; the caveat says
  so rather than modelling the old Act.
- `source_only` uses typed gaps (after backfill) with an observed date and
  body key; it does not scan raw document titles.
- Record-gap severity follows the expectation (statutory / bylaw /
  practice); cross-reference gaps are listed separately.
- Permissions: continuity reads/writes use `deadlines:*`; gaps use
  `documents:*`; each record family inside `continuity:gaps` and `coverage`
  is read only with that family's read permission.

## Deferred

- No `expectedRecords` materialized table: periods are computed on read
  (cheap at PGAIR scale: 142 meetings). Materialize if hosted read limits
  become a problem.
- Schedule documents (e.g. "Board Meeting Schedule 2017") are typed as
  `meeting.schedule` gaps but do not yet create expected rows automatically.
- Extraction `unsupported[]` / `references[]` wiring belongs to the AI intake
  pipeline (not in this package); the import key and gap API are ready for it.
- Per-import-session gap summary on the Import sessions page: the summary
  query returns `byImportSession`; the Imports page itself is owned by
  another package.
- Badge on motion, person and document pages: drop in
  `<UnsupportedDetailsBadge table="motions" id={…} />` etc.

## Interfaces for other packages

- `UnsupportedDetailsBadge({ table, id })` — any record page.
- `representationGaps:create` — reviewer "can't represent" (pass
  `affectedTable`/`affectedId`, `locator`, `excerpt`).
- Bundle key `representationGaps: [{ infoType, reason, excerpt, locator,
  observedDate, bodyKey, affectedTable, affectedId, proposedTargetTable,
  proposedField, proposedValue, sourceExternalIds, dedupeKey }]`.
- `importBundlePreflightGaps(bundle)` (pure) and
  `recordPreflightGapsForBundle(ctx, societyId, bundle, sessionId)`.
- `shared/meetingStatus.ts` (`MEETING_STATUS_OPTIONS`, `isMeetingHeld`,
  `meetingStatusLabel`) — import code should write `HeldMinutesMissing` /
  `Cancelled` instead of forcing `Held` (finding C14, import package).
- `committees.cadenceRule` / `mandateVersions` and
  `CadenceRuleFields`/`describeCadenceRule` for any committee UI.
