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
- Now safe to **drop the deprecated `category` fields + `by_society_category`
  index** (Phase-4-of-restructure cleanup that was deferred for exactly this
  reason — Convex rejects docs carrying a field the schema no longer declares, so
  it must come after the embedded data is gone).

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
