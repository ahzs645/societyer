# WP-B: import core and meeting data model

Implements the PGAIR audit findings for the import contract, the meeting/minutes/motion data model and the repair of already imported data. Source: `docs/pgair-transposition-and-interface-audit.md` (schema A1–A18, C1–C14; intake ID-03; governance G-04). All new fields are optional, so existing rows and old backups still validate.

## What was built

### Bugs

| Finding | Change |
| --- | --- |
| C1 motion outcome synonyms | `shared/motionOutcome.ts` `classifyMotionOutcome`: passed / approved / adopted / accepted / agreed / carried unanimously / "(Carried)" / "Motion carried" ⇒ `Voted` + `Carried`; "no objection(s)", "without objection", "by consensus" ⇒ `Carried` with `decidedBy: "consent"`; not carried / failed / lost / rejected ⇒ `Voted` + `Defeated`; tabled / deferred / postponed / withdrawn as before. Unknown wording ("NeedsReview", "Unknown", "Received") stays `Moved` and is flagged. The raw wording is stored in the new `motions.sourceOutcomeText` (and the existing `legacy outcome:` history note). Used by `syncMotionsForMinutes`. |
| C2 merged motions | `mergeExistingMeetingImport` no longer writes the retired `minutes.motions`; it appends new motions (de-duplicated by wording) through `syncMotionsForMinutes(..., mode: "append")`, and moves any legacy embedded motions into the table. |
| ID-03 empty-hash dedupe | `shared/driveDedupe.ts` `dedupeKeyForDriveItem`: the empty-content SHA-256, zero-byte and failed downloads keep their own identity. Used by `scripts/stage-drive-audit.ts`. |
| Quorum forced to `not_recorded` | `shared/quorumStatement.ts` `quorumStatementFromText` reads explicit statements (achieved / reached / present / "quorum of members (12) was present" / gained later), ignores conditional wording ("assuming quorum is reached"). `stage-drive-audit.ts` stages `confirmed` with a pending cited checkpoint carrying the stated count. |

### Repair mutation

`minutes:repairImported` (`shared/functions/minutesRepair.ts`, registered in `shared/functions/registry.ts` and `convex/minutes.ts`). Args `{ societyId, dryRun?, options? }`; options switch off individual steps (`motions`, `embedded`, `sections`, `titles`, `reclassifyBodies`, `datePrecision`, `quorum`, `attendance`). Requires minutes/meetings/motions/agendas write (+ committees write when it may create committees, documents read for source text). It re-derives motion outcomes from stored raw wording, syncs legacy embedded motions, strips "| " artifacts from section and agenda titles (original in `sections[].sourceTitle`), replaces file-name/generic titles with `<Body> meeting — <date>` (original in `meetings.sourceTitle`) and moves Board-typed meetings whose source names a committee into that committee, marks noon-UTC placeholders `scheduledAtPrecision: "date"`, records quorum the stored source text states (pending checkpoint `repair-source-quorum`; a linked document is read only if it backs exactly one minutes record), and moves non-person attendees into `draftTranscript.nonPersonAttendance` with a review note. Adopted minutes are never changed. It is idempotent and returns counts plus up to 25 examples.

UI: **Import sessions → Repair imported minutes** (`src/features/meetings/components/RepairImportedMinutesAction.tsx`) previews the dry run, applies on confirmation and reports results.

Verified on the restored PGAIR backup in the browser (local runtime): 31 motion outcomes re-derived (Voted/Carried), 9 embedded motions synced (the minutes with 8 embedded / 0 rows now has 8 rows), 85 section + 85 agenda pipe titles cleaned, 123 titles replaced, 26 meetings moved to Executive / Strategic Planning / Secretariat committees (3 committees created), 142 meetings marked date-only, 48 quorum statements recorded (46 confirmed, 9 not met in total), 625 non-person attendee strings moved to evidence; a second run reports nothing to repair. 4 motions with "NeedsReview" outcomes stay undecided. 21 dates still have more than one meeting of the same body (true duplicates for a merge UI). Screenshots: `scratchpad/shots/impl-wpb-0[1-9]*.png`.

### Data model (all optional)

| ID | Field(s) | Where |
| --- | --- | --- |
| A1 | `motions.movedByPersonId`, `secondedByPersonId`; `minutes.detailedAttendance[].personId` + `representedOrganization`; `meetingAttendanceRecords.affiliation` + `representedOrganization` (the person link is the existing `directoryPersonId`); `tasks.assigneePersonId` + `sourceAssignee`; `minutes.actionItems[]` and `sections[].actionItems[]` `assigneePersonId`; `conflicts.directorId` now optional + `personId`, `personName`, `motionId`; `committeeMembers.personId` + `representedOrganization`; `signingAuthorities.directoryPersonId` | `convex/validators/meetingModel.ts`, `convex/tables/*` |
| A3 | `bylawRuleSets.bodyQuorumRules[] {body: general|board|committee, committeeId?, committeeName?, quorumType: fixed|percentage|all_members|majority, quorumValue?, quorumMinimumCount?, countBasis?}`; `committees.quorumRule` | kernel `shared/bodyQuorum.ts`, ctx adapter `shared/bodyQuorumPortable.ts`, used by the quorum snapshots in `shared/functions/meetings.ts` and `minutes.ts` |
| A9 | `agendaItems.itemNumber`, `requestedAction` (approve/receive/discuss/decide/information/none), `scheduledTimeText`, `consent` | `agendas:addItem/updateItem/syncForMeeting` accept them |
| A10 | consent item outcome `received` | `CONSENT_ITEM_OUTCOMES` in `shared/evidenceReview.ts`; option added to `MeetingEvidenceCard` |
| A11 | `motions.abstainedBy[]`, `opposedBy[]` (`{name, personId?, notes?}`), `dissentDocumentId` | motions table, embedded motions, snapshots |
| A12 | action item `status` (unknown/open/in_progress/ongoing/on_hold/completed/cancelled) + `sourceStatus` + `taskId`; `done` kept and derived | `shared/actionItemStatus.ts`; minutes create/update/upsertFromDraft normalize it |
| A13 | `meetings.scheduledAtPrecision` (date/datetime), `localStartText`, `localEndText`, `timeZone`, `sourceTitle` | `shared/meetingDates.ts`: `formatMeetingDate`, `meetingCalendarDate`, `meetingDatePrecision`, `isDateOnlyPlaceholder`, `parseLocalTimeText` |
| A16 | `minutes.nextMeetings[] {at?, dateText?, precision?, bodyKey?, committeeId?, location?, notes?}` | minutes create/update validators |
| A17 | `signingAuthorities.tiers[] {minCents?, maxCents?, signaturesRequired, roles?, notes?}` | `shared/signingAuthorityTiers.ts` (`normalizeSigningAuthorityTiers`, `signingTierForAmount`) |
| A18 | `meetings.hostBody` (own/external) + `externalOrganization` | validated in meetings create/update |
| C13/G-04 | `motions.sourceLocator {voteSummary, pageRef, evidenceText, sectionReference, quote, sourceExternalIds}`, `sourceOutcomeText`, `outcomeOverrideNote` | |

`DecidedBy` gains `chair_ruling` ("Chair's ruling"); `isDecidedWithoutVote` treats it like consent.

### Import contract

Meeting identity is calendar date + body (`shared/meetingBody.ts`, `importMeetingApply.ts`): variants fold into one meeting with one `importedSourceVersions` row per source (draft when the label says DRAFT; "approved/final" is noted but never treated as adoption). `body` / `committeeName` / `meetingType` / title resolve or create a committee (`committees.bodyKey`); `inferMeetingType` maps executive, operations, strategic planning/SPC, secretariat, working group, AQMP and any named committee to Committee. `meetingIdentityKey` separates two meetings of one body on one date. Payloads with no body information still match an exact same-day title.

Minutes payload additions: `body`, `committeeName`, `meetingStatus` (C14), `scheduledAtPrecision`, `localStartText`/`startTime`, `localEndText`/`endTime`, `timeZone`, `hostBody`, `externalOrganization`, `meetingIdentityKey`, `sourceVersionStatus`, `nextMeetings`, agenda item objects (C6), section `depth`/`publicVisible`/`motionIndex`/`sourceReference` (C7), action item `status` (C8), detailed attendance `representedOrganization` with status defaulting to `unknown` (C8). Motion payload additions: `decidedBy`, `sectionIndex`, `sectionTitle` (C4), `adoptsMinutes {meetingDate, body?, committeeName?, sourceExternalId?}` or `adoptsMinutesDate` (C3), `abstainedBy`, `opposedBy`/`dissentBy`, `dissentSourceExternalId`, `outcomeOverrideNote`, `meetingType`, `body`, `committeeName`. `voteSummary`/`pageRef`/`evidenceText`/`rawText` go to `sourceLocator` (C13). Person names resolve to `peopleDirectory` only on a unique exact match. Attendance names that are role words, organizations or headings are kept as evidence (`draftTranscript.nonPersonAttendance` + a review note) — `shared/attendanceNames.ts`.

Section kinds: policy adoption links from `adoptedAtMeeting`/`adoptedAtMeetingDate` (C9; document IDs are no longer read from payload strings), grant `requirements`/`useOfFunds`/`timelineEvents`/`keyFacts`/`contacts` (C10), financial statements `presentedAtMeeting`/`presentedAtMeetingDate` (C12), signing-authority `tiers`, attendance `affiliation`/`representedOrganization`. New bundle keys (C11): `committees`, `committeeMembers`, `members`, `directors` (+ `terms[]` ⇒ `boardRoleAssignments`), `tasks` (`sourceAssignee`, `statusHistory[]`, meeting link), `goals`, `commitments`, `fundingSources`, `grantReports` (`grantTitle`), `meetingMaterials` (meeting by date + body, first source document), `organizationSeats` (observations appended by `seatKey`), `conflicts`, `proxies`, `bylawRuleSets` (always Draft), `operatingBudgets` (the `budgets` table; the `budgets` key remains the org-history budget kind). Section records are promoted committees first, then people and grants, so later kinds can name them. Preflight (`shared/importBundlePreflight.ts`) accepts the documented field aliases.

### Motion validation (G-04)

`shared/motionValidation.ts`: counts must be whole numbers ≥ 0; Carried/Defeated must agree with the recorded tally for the resolution type (majority, two-thirds for special, no votes against for unanimous) unless `decidedBy` is consent / chair_ruling / automatic and `outcomeOverrideNote` is filled. Enforced in `motions:create/update/setStatus/recordVote` and in `minutes:create/update` for motions whose vote fields changed (unchanged legacy rows are not re-judged). Imports drop impossible counts instead of failing. UI: `src/pages/Motions.tsx` edit drawer (inline errors, Save disabled, Decided-by + override note, picking an outcome sets status Voted) and `src/components/MotionEditor.tsx` (an outcome contradicting the tally opens an override panel; a tally change that no longer supports the outcome resets it to Pending with a notice; the add-motion form blocks invalid saves).

## Gates

- `scripts/check-import-core-fidelity.ts` (local runtime) and `scripts/check-import-core-convex.ts` (real Convex schema): `npm run test:import-core`; the first also runs in `npm run test:meeting-intake-fidelity`.
- Extended: `check-meeting-quorum-fidelity.ts` (stated quorum survives promotion, per-body rule resolution), `check-structured-minutes-fidelity.ts` (section links, action status, agenda objects), `check-import-bundle-preflight.ts` (new keys and richer contract without losses).
- Passing: tsc -b, convex:typecheck, lint (0 errors), static-parity, authorization-policy, permissioned-mutation, workspace-access, portable-manifest, portable-conformance-matrix, intake-pipeline, meeting-history, import-* gates, motions-* gates, source-minutes-transposition; Playwright `interface-governance`, `interface-shared`, `interface-calendar-views` (desktop).

## Assumptions and decisions

- Meeting identity uses the body, not the time, because most sources give only a date. A "special" meeting of a body is a separate identity.
- File names that say APPROVED are recorded in the version note only; adoption still needs a carried adoption motion or explicit evidence.
- An imported adoption motion links `adoptsMinutesId` but does not stamp the referenced minutes approved (that freezes a legal record; it stays a reviewer action).
- Unknown task status from a source becomes task status `Unknown` (and `Cancelled` for cancelled) so historical actions do not count as open To do. The tasks UI lists only Todo/InProgress/Blocked/Done today.
- Imported bylaw rule sets are `Draft` so they never silently replace the active rules.
- Members created by import are `NeedsReview`; organizations as members (A2) are outside this package: the member's notes record the represented organization.
- Attendance screening errs toward keeping people: a single capitalized word ("Greg") stays a person; ambiguous company names that look like names ("Tidewater Midstream") also stay.
- The repair's committee reclassification only moves Board-typed meetings with no committee; AGM/Board merges are left for a human split.

## Deferred

- A2 (organization members/representative seats), A4–A8, A14, A15 and the B-list UI editors belong to other packages.
- The meetings list and detail pages still format `scheduledAt` themselves; they should switch to `formatMeetingDate` (meetings UI package).
- Grant opportunity URL/type, priority, fit score and next steps are still not promoted.
- Grant reports, meeting materials and proxies whose grant/meeting is created in the same import must be applied after that record (preflight blocks them otherwise).
- `convex/lib/bylawRules.ts` still has its own (unused) quorum computation; the live paths use the shared kernel.
- Wrong movers produced by the old parser ("industry without …" from "removed by") are not cleaned by the repair.
