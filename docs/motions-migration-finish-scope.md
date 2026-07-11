# Finish the Motions Migration — Scope

Goal: complete the migration described in `motions-first-class-object-design.md` so
the `motions` table is the **single source of truth**. Flip every read off the
embedded `minutes.motions[]`, drop the dual-write mirror, and retire the embedded
array. This ends the temporary duplication (a minutes-sourced motion currently
lives both in `minutes.motions[]` and as a regenerated `motions` row).

This is the doc's **Phase 3 (flip reads) + Phase 5 (drop dual-write)**, plus the
optional **Phase 4 (resolution-types editor)**. Phases 1–2 (table, dual-write,
backfill, procedural catalogue) already shipped.

## Where we are today

Done:
- `motions` table is first-class; `motionBacklog` folded in; procedural catalogue
  (`shared/proceduralMotions.ts`) auto-tags adjournment / previous-minutes.
- **Dual-write** (`syncMotionsForMinutes`) mirrors `minutes.motions[]` → `motions`
  on every minutes save (delete-by-minutes + reinsert).
- **Snapshot-on-approval is implemented** — `shared/functions/minutes.ts:456`
  freezes `minutes.motionSnapshots[]` when minutes are approved. This satisfies
  the "approved legal record can't change" rule, the hardest part of the flip.
- Read path exists: `api.motions.listForMinutes` / `listForMeeting` / `backlog`.
- The Motions master UI already reads the `motions` table.

Not done (this project):
- `minutes` still stores `motions: v.array(...)` (no `motionIds`); it is the read
  source for meeting/minutes rendering, exports, AI, and importers.
- The dual-write is still active — two representations coexist.

## Core design decision: how minutes reference motions after the flip

**Option A — `minutes.motionIds: v.optional(v.array(v.id("motions")))`** (the
design doc's choice). Order is preserved by the array; a small backfill sets it
from the current mirror; the dual-write maintains it. Cleanest references.

**Option B — query by `minutesId`** via the existing `by_minutes` index (no new
field). Simpler to add, but the mirror rows carry **no order field**, so array
ordering (which minutes rendering depends on) would be lost unless we also add an
explicit `order` to `motions`.

**Recommendation: A.** It matches the doc, preserves order for free, and gives
real references instead of an implicit join.

**Read rule (both options):** a single accessor returns **`motionSnapshots[]` for
approved minutes** (immutable, already frozen) and the **live motions for drafts**.
Every read site goes through this accessor so the flip is one change, not forty.

## Phases

### Phase 0 — Accessor + read-site inventory (S–M, low risk)
Introduce one function, e.g. `motionsForMinutes(minutes, motionsById)` →
`approved ? minutes.motionSnapshots : liveMotions`. Do a read-pass over the ~40
touch points (below) and route **all** of them through it, still backed by
`minutes.motions[]` for now. No behavior change; this is the seam the flip pivots
on.

### Phase 1 — `motionIds` + backfill (M, low risk)
- Add `minutes.motionIds` (optional). Keep `minutes.motions[]` writing in parallel.
- Backfill: for each minutes, set `motionIds` from its mirror rows **in order**.
- Extend the dual-write to maintain `motionIds` on every save.

### Phase 2 — Flip reads (L — the bulk of the work)
Point the Phase-0 accessor (and the sites) at the table/snapshot instead of the
embedded array, category by category, verifying each:
- **Core render/edit:** `minutesRenderer.ts`, `MotionEditor.tsx`,
  `useMeetingMinutesColumn.tsx`, `MeetingDetail.tsx`, `meetingDetailHelpers.ts`,
  `Minutes.tsx`, `MeetingMinutesPreviewPage.tsx`.
- **Meeting creation / materialization:** `meetings.ts`, `meetingTemplates.ts`,
  `agendas.ts` (agenda → motion becomes create/link, not text copy).
- **Exports / packets:** `minuteBook.ts`, `EvidenceRegisters.tsx`, `filingBot.ts`,
  `paperless.ts` / `paperlessHelpers.ts`.
- **AI / transcripts:** `aiAgents.ts`, `transcripts.ts`, `providers/llm.ts`.
- **Importers:** `importSessions.ts` + `importSessionHelpers/*` (4 files) —
  reconcile extracted motions into `motions` rows.
- **Conflicts / analytics:** `conflictMotions.ts`, `MeetingConflictsCard.tsx`,
  `annualCycle.ts`, `organizationHistory.ts`.
- **Static/local-first parity:** every new/changed `motions:*` query needs a
  counterpart in `staticConvex.ts` + `staticConvexFixtures.ts`, and must pass
  `staticConvexParity.ts`. Budget real time here — this is the doc's named risk.

### Phase 3 — Resolution-types editor (M, optional / separable)
The editable `bylawRuleSet.resolutionTypes` list + a Bylaw Rules card +
`evaluateResolution`, replacing the hardcoded `RESOLUTION_TYPE_OPTIONS`. Independent
of the read-flip; can ship before, after, or never as part of this project.

### Phase 4 — Drop the dual-write (M)
- Stop writing `minutes.motions[]`; keep it as a **deprecated optional pass-through**
  first (like `agendaJson`), then delete once nothing reads it.
- Remove `syncMotionsForMinutes` and the inference helpers (`isPostponedOutcome`
  et al.).
- Now safe to **drop the deprecated `category` fields** (Phase-4-of-restructure
  cleanup that was deferred for exactly this reason — Convex rejects docs carrying
  a field the schema no longer declares, so it must come after the embedded data
  is gone).

> **Correction (2026-07-11):** the "`by_society_category` index" named above does
> **not** exist on the `motions` table — that index (`meetingWorkflow.ts:60`)
> belongs to the sibling **`motionTemplates`** table. The `motions` table only
> carries a deprecated `category` **field** (`meetingWorkflow.ts:72`). See the
> detailed teardown plan below for the corrected scope.

**See "Phase 4 teardown — detailed implementation plan (2026-07-11)" at the end of
this doc** for the staged, verified-per-stage breakdown that supersedes this sketch.

## Risks & mitigations
- **Ordering** — mitigated by Option A (`motionIds` array) or an explicit order field.
- **Approved-record immutability** — already mitigated (snapshots exist); the
  accessor must read snapshots for approved minutes.
- **Static parity** — every read-flip query needs a static counterpart + fixtures,
  or the demo build breaks. Largest hidden cost.
- **Exports / AI / importers read the embedded shape** — flip them behind the
  accessor so it's mechanical, not scattered.
- **Migration ordering** — backfill before flip; flip before drop; never remove a
  schema field before every doc is cleared.

## Testing strategy
- Route reads through the accessor first, so a single conformance test covers the
  flip.
- Reuse `check-motion-governance`, `check-meeting-governance`,
  `check-static-convex-parity`, `check-portable-*`.
- Add: a motions read-flip parity script; a snapshot-immutability test (edit a
  motion after approval → approved minutes unchanged); export golden-file diffs.

## Effort & sequencing
Large — a multi-session project; **Phase 2 dominates**. Recommended order:
**0 → 1** (low-risk foundation, no behavior change) → **2 by category behind the
accessor** → **4 (drop + field cleanup)**. **3** is separable. Get a precise
estimate out of Phase 0's read-pass; until then treat Phase 2 as the long pole.

## Resolved decisions
1. **Reference model: Option A** — `minutes.motionIds: v.optional(v.array(v.id("motions")))`.
2. **Resolution-types editor (Phase 3): folded into this project.**
3. **Cutover: chunked-incremental (lightweight).** Data is disposable dummy data
   and nothing else is built on the embedded shape, so Phase 1 is a reseed, not a
   careful in-place backfill, and the dual-write coexists only until reads flip.
   We still land the flip in a few verifiable chunks rather than one 40-file
   commit — because the app can't be screenshotted from this environment, so each
   chunk is validated via tsc + the `check-*` scripts + targeted `convex run`
   rather than by eye. The Phase-0 accessor makes the *read* flip nearly central
   (one function's internals), leaving the write/materialization side as the real
   per-site work.

---

# Phase 4 teardown — detailed implementation plan (2026-07-11)

Supersedes the "Phase 4 — Drop the dual-write" sketch above. Grounded in a fresh
code sweep, not the earlier notes — two premises in the sketch turned out wrong
(see the corrections flagged inline).

## Status going in
- Read-flip (accessor Phases 0–2C) **merged** (PR #28).
- Write-side (1) reconcile-by-identity, (2) agenda-sync dedup **merged** (PR #28).
- Write-side (3) backfill dedup, (4) motionBacklog carry-forward/convert onto the
  resolver — **PR #29** (branch `motions-write-side-3-backfill-dedup`).
- Reads come from the table via `resolveMinutesMotions` (draft → `motionIds` →
  rows; approved → `motionSnapshots`). The dual-write still stores `minutes.motions[]`.

## The load-bearing constraint (dictates ordering)
The **MotionEditor still reads the raw `minutes.motions[]`**, not the resolved
list: `MeetingDetail.tsx:2292` (`motions={(minutes?.motions ?? []) as Motion[]}`)
and `useMeetingMinutesColumn.tsx:125`. The frontend `Motion` type
(`MotionEditor.tsx:47-69`) does not even declare `motionId`; it only survives an
edit because the reconcile back-links it into the array and object spreads carry
it at runtime. **Therefore the frontend must be repointed onto the resolved
`displayMotions` BEFORE the backend can stop storing the array** — otherwise the
editor loads empty.

## Data gate (once per environment with real data)
Every minutes needs `motionIds` + mirror rows before the array stops being stored:
reseed, or run `backfillFromLegacy` (shipped write-side 3). The demo deployment is
already backfilled.

## Stages (each independently verifiable; commit/PR per stage)

### 4A — Retire `minutesSourcedMotions` *(independent, corrective — do first)*
- Remove the synthesizer (`shared/functions/motions.ts:84`) from `listPortable`
  (`:135`); the master list returns just the table rows.
- **Fixes a verified live double-count:** on demo data `motions:list` returns 3
  real mirror rows AND 3 synthetic `from-minutes:` entries for the same motions,
  because mirror rows carry `minutesId` but not `sourceMinutesId`, so they miss the
  `alreadyConverted` set. (The memory's `convex/motions.ts:221` reference is stale —
  the synthesizer exists only in `shared/functions/motions.ts`.)
- Verify: `motions:list` has no `from-minutes:` ids, count == mirror-row count;
  add a check-script assertion. Prereq: all minutes mirrored (data gate).

### 4B — Repoint the frontend editor + index sites onto `displayMotions` *(riskiest UI change; isolate it)*
- Source the editor `motions` prop and the index-based sites from
  `minutesMotionsForDisplay(minutes)` instead of `minutes.motions`:
  `MeetingDetail.tsx:2292`; the section-scoped editor `useMeetingMinutesColumn.tsx:125`;
  `carriedForwardMotions` (`MeetingDetail.tsx:732`); scroll-to-`motion-${i}`
  (`MeetingDetail.tsx:263`); the section delete/reorder/assign remaps in
  `useMeetingMinutesColumn.tsx` (`:268-286`, `:789-821`, `:1018-1063`); `saveAgenda`
  remaps (`MeetingDetail.tsx:1414-1434`).
- Add `motionId` to the frontend `Motion` type so it is explicit, not untyped ride-along.
- **No backend change** — editor still submits `patch.motions`; behavior-preserving
  today because `displayMotions` ≡ `minutes.motions` while both are maintained.
- Verify: load/edit/save; id stability across saves (reconcile); carry-forward +
  section reorder intact.

### 4C — Stop persisting `minutes.motions[]`; freeze snapshots from the table *(point of no return)*
- Strip `motions` from the minutes-row write in `createPortable`
  (`shared/functions/minutes.ts:426`), `updatePortable` (`:519`),
  `upsertFromDraftPortable` (`:572`,`:581`); pass it only to `syncMotionsForMinutes`.
- `syncMotionsForMinutes` (`:355`): stop patching `minutes.motions`; keep `motionIds`.
- Repoint the two snapshot freezes to `await resolveMinutesMotions(...)`:
  `updatePortable:526` and `applyAdoptionApprovals:483`.
- Verify: create→edit→approve; snapshot freezes from the table; approve-then-edit
  leaves the frozen record unchanged; resolve-parity + reconcile suites; live e2e.
  Portable functions → covered on hosted Convex + Dexie + static automatically.

### 4D — Route the remaining array-writers through the reconcile *(materialization gaps)*
Sites that write `minutes.motions[]` and must reconcile after 4C:
- `seedToMinutesPortable` (`shared/functions/motionBacklog.ts:566`) — patches directly,
  **bypasses** `syncMotionsForMinutes` (the gap flagged in write-side 4).
- Meeting-from-template scaffolding `shared/functions/meetings.ts:618` (`:646`) —
  inserts minutes with motions and **does not** call `syncMotionsForMinutes`.
- Importers `shared/functions/importSessions.ts:427`,`:501` — verify they reconcile.
- Already fine (insert/patch immediately followed by `syncMotionsForMinutes`):
  `agendas.ts:350`/`:354` (startMinutesFromAgenda) and `agendas.ts:486`/`:490`
  (syncMeetingAndMinutesFromAgenda). Seed inserts (`seed.ts:162/241/834`) are
  reconciled by the finalization pass (`seed.ts:1738`).
- Verify: each path's motions appear via `resolveMinutesMotions` immediately (no
  stale next-save requirement).

### 4E — Drop the deprecated `motions.category` field *(corrected scope)*
- **Correction:** there is **no `by_society_category` index on `motions`** to drop —
  that index (`meetingWorkflow.ts:60`) is `motionTemplates`'. The `motions` table
  has only the deprecated `category` **field** (`meetingWorkflow.ts:72`).
- Remove its one real reader (fallback badge `src/pages/MotionBacklog.tsx:234`) and
  the writers: `category` in `motionContent` (`convex/motions.ts:32`) + the backlog
  arg surfaces (`convex/motionBacklog.ts:45,59,79,93`); the hardcoded/forwarded
  writes in `shared/functions/motionBacklog.ts` (`:200`,`:220`,`:267`,`:320`,`:348`,
  `:487`) and the `PIPA_SETUP_MOTIONS` `category` values (`:34,43,52,61`). Then drop
  the field (`meetingWorkflow.ts:72`). `syncMotionsForMinutes` never sets `category`,
  so no dual-write change.
- **Separate, related decision** (own PR): `motionTemplates.category`
  (`meetingWorkflow.ts:49`, "superseded by tags; no longer written") + its
  `by_society_category` index (`:60`), reader `src/pages/MotionLibrary.tsx:34`.
  Different table; not required to retire the embedded array.
- Leave `documents` / `assets` / `accounting` / `financialTransactions` category +
  indexes untouched (unrelated).

### 4F — Final teardown *(trailing cleanup)*
- Once `minutes.motions` is neither read nor written: drop the schema field,
  collapse `syncMotionsForMinutes` from "mirror an array" into a direct materializer,
  and remove `resolveMinutesMotions`' embedded fallback.

## Ordering
4A first (independent live fix) → **4B before 4C** (hard requirement) → 4C → 4D →
4E (independent once writes removable) → 4F. 

## Risks
- Static/Dexie parity on every portable change (4C/4D are portable → auto-covered;
  still run `portable-live-runtime`).
- Snapshot-freeze timing — test approve-then-edit doesn't mutate the frozen record.
- Positional-index alignment in 4B — `displayMotions` order ≡ `motionIds` order ≡
  editor render order.
