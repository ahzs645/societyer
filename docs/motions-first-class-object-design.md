# Motions as First-Class Objects — Design Doc

Purpose: promote a motion from data embedded inside `minutes.motions[]` to a standalone, referenceable entity. A motion owns its own identity, wording, movers, votes, explicit status, and history. Meetings, agendas, minutes, and the backlog reference a motion by id instead of duplicating its data. Resolution types become a society-editable list that a motion references, with "majority" and "unanimous" baked in as non-deletable built-ins.

This doc is design-only. No schema has changed yet.

## Guiding Decisions

- **One motion store, backlog folded in (decided).** Collapse the five places motion data lives today into a single `motions` table. Everything else references it by id. `motionBacklog` is **not** kept as a separate table or a view — a backlogged item is just a motion with an early `status` (`Backlog`) plus a few backlog columns (`backlogPriority`, `source`, `seededKey`, `targetMeetingId`). One lifecycle, one row, from capture to vote to archive.
- **Votes model A + history.** Votes live on the motion (its current/most-recent tally). An append-only `history[]` records every consideration (meeting, status change, vote snapshot) so the March→May trail isn't lost. We deliberately do *not* normalize votes into a separate per-appearance table yet; graduate to that only if real re-vote/amendment workflows demand it.
- **Status is explicit and overridable, never inferred.** Split the overloaded `outcome` string into two axes: a lifecycle `status` (Backlog/Draft/Agenda/Moved/Tabled/Deferred/Withdrawn/Voted/Archived) and a decision `outcome` (Carried/Defeated). The unified status absorbs the old `motionBacklog.status` stages (see Glossary). The backlog list is a query on `status`, it does not guess via `isPostponedOutcome()`.
- **Snapshot-on-approval.** Drafts render the live motion by reference. On minutes approval, the motion's text + final votes + outcome are frozen into the minutes record so an approved legal record can never be silently rewritten by a later edit to the motion.
- **Resolution types are referenced, not hardcoded.** A motion carries `resolutionTypeId` pointing at a row in the society's editable `bylawRuleSet.resolutionTypes` list. The existing pure threshold logic (`thresholdFor` / `motionMeetsThreshold`) plugs straight in.
- **Keep `societyId` foreign keys and the static/local-first parity layer.** This follows the same staging discipline as the corporation rule-packs plan: facade and reference before any rename.

## Current State (the problem)

Motion data is smeared across at least five stores, with copying between them and no shared identity:

| Where | Stores | Issue |
|---|---|---|
| `minutes.motions[]` (`convex/tables/meetings.ts:144`) | text, movers, outcome, votes, resolutionType, sectionIndex/Title | the "live" copy |
| `minutes.sections[]` (`convex/tables/meetings.ts:112`) | `motionText`, `motionTemplateId`, `motionBacklogId` | motion-ish data *also* here, tied to `motions[]` by a fragile `sectionIndex`/`sectionTitle` string |
| agenda items (`convex/agendas.ts:386`) | `motionText`; `motionsFromAgendaItems()` **copies** it into `minutes.motions` | text duplicated on materialization |
| `motionBacklog` (`convex/tables/meetingWorkflow.ts:57`) | title, motionText, status, source minutes/section index | a second motion store; carries forward tabled/deferred items |
| `motionEvidence` (`convex/tables/meetings.ts:264`) | its own motionText, movers, outcome, voteSummary | a third store, populated from imports |

(`motionTemplates` at `convex/tables/meetingWorkflow.ts:43` is legitimately a *template*, not an instance — it stays as a template source but motions reference it by id.)

A single motion — "approve the budget", tabled in March and carried in May — can exist today as: an agenda item, a March `minutes.motions` row, a `motionBacklog` row, a *new* May `minutes.motions` row, and a `motionEvidence` row if imported. Five copies, nothing linking them.

Two specific defects this fixes:
1. **Inferred status.** `outcome` conflates decision (`Carried`/`Defeated`) with lifecycle (`Pending`/`Tabled`/`Deferred`); backlog eligibility is inferred in `motionGovernance.ts:37` (`isPostponedOutcome`). "Tabled" is not a real settable field.
2. **No cross-meeting identity.** A motion considered at two meetings has no continuity; history and provenance are reconstructed by string/index matching.

## Target Model

### `motions` table (new)

```ts
motions: defineTable({
  societyId: v.id("societies"),

  // Identity / content
  title: v.optional(v.string()),       // short name (was Motion.name)
  text: v.string(),                    // operative wording
  category: v.optional(v.string()),    // governance | finance | membership | operations | bylaws | other

  // Movers — denormalized display name + optional structured refs (as today)
  movedBy: v.optional(v.string()),
  movedByMemberId: v.optional(v.id("members")),
  movedByDirectorId: v.optional(v.id("directors")),
  secondedBy: v.optional(v.string()),
  secondedByMemberId: v.optional(v.id("members")),
  secondedByDirectorId: v.optional(v.id("directors")),

  // Classification → references the editable resolution-types list
  resolutionTypeId: v.optional(v.string()),    // id within bylawRuleSet.resolutionTypes
  resolutionTypeLabel: v.optional(v.string()), // denormalized snapshot for display & legacy data

  // Explicit lifecycle — overridable, never inferred. Unified vocabulary that
  // absorbs the old motionBacklog stages (see Glossary).
  status: v.string(),                  // Backlog | Draft | Agenda | Moved | Tabled | Deferred | Withdrawn | Voted | Archived
  outcome: v.optional(v.string()),     // Carried | Defeated (meaningful only when status = Voted)
  statusIsManual: v.optional(v.boolean()), // true once a human overrides the computed status

  // Backlog columns (folded in from motionBacklog — no separate table)
  backlogPriority: v.optional(v.string()), // high | normal | low
  source: v.optional(v.string()),          // pipa-setup | manual | imported
  seededKey: v.optional(v.string()),       // idempotent seed key (e.g. pipa-setup items)
  targetMeetingId: v.optional(v.id("meetings")), // where it's *planned* to go (vs. primaryMeetingId = last considered)

  // Votes (model A — current/most-recent tally on the motion itself)
  votesFor: v.optional(v.number()),
  votesAgainst: v.optional(v.number()),
  abstentions: v.optional(v.number()),
  recordedApprovers: v.optional(v.array(v.string())), // for resolution types needing named consent

  // Placement / provenance (references, not copies)
  primaryMeetingId: v.optional(v.id("meetings")),   // meeting where it was last considered
  agendaItemId: v.optional(v.id("agendaItems")),
  motionTemplateId: v.optional(v.id("motionTemplates")),
  sourceMotionEvidenceId: v.optional(v.id("motionEvidence")),
  sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  sourceExternalIds: v.optional(v.array(v.string())),

  // History — append-only consideration / status trail (model A's safety net)
  history: v.optional(v.array(v.object({
    at: v.string(),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    status: v.string(),                 // status entered at this event
    outcome: v.optional(v.string()),
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),
    note: v.optional(v.string()),
  }))),

  createdAtISO: v.string(),
  updatedAtISO: v.string(),
})
  .index("by_society", ["societyId"])
  .index("by_society_status", ["societyId", "status"])     // drives the backlog list
  .index("by_society_seeded", ["societyId", "seededKey"])  // idempotent seeding (from motionBacklog)
  .index("by_meeting", ["primaryMeetingId"])
  .index("by_target_meeting", ["targetMeetingId"])
```

### References replace embedded copies

- `minutes`: replace `motions: v.array(...)` with `motionIds: v.optional(v.array(v.id("motions")))`, plus `motionSnapshots[]` (see Snapshot-on-approval). `sections[].motionId: v.optional(v.id("motions"))` replaces the per-section `motionText`/`motionBacklogId` linkage.
- `agendaItems`: add `motionId: v.optional(v.id("motions"))`; stop copying `motionText` into minutes — materializing an agenda creates/links a motion row instead.
- `motionBacklog`: **folded into `motions`** (decided). A backlogged item is a motion with `status = Backlog` (or `Tabled`/`Deferred`) and the backlog columns above; the "backlog" UI is the `by_society_status` query. The table is deprecated and dropped after backfill — no separate table, no view. Existing `motionBacklogId` references on `minutes.sections[]`/agenda items are rewritten to `motionId`.
- `motionEvidence`: stays as the raw import-extraction record, but reconciliation creates/links a `motions` row and sets `motion.sourceMotionEvidenceId`.

### Resolution types list (the editable settings the user asked for)

On `bylawRuleSets`:

```ts
resolutionTypes: v.optional(v.array(v.object({
  id: v.string(),               // stable slug: 'ordinary' | 'special' | 'unanimous' | custom-...
  label: v.string(),            // "Majority", "Special", "Unanimous", or user text
  builtIn: v.optional(v.boolean()),    // ordinary/special/unanimous → cannot be deleted
  base: v.string(),             // votesCast | eligibleMembers | quorum  ("number of total people")
  thresholdPct: v.number(),     // the %
  requiredApprovers: v.optional(v.array(v.string())), // named consent ("specific person")
  tieBreak: v.optional(v.string()),    // fails | chairCasts
  order: v.optional(v.number()),
}))),
```

Seeded from the existing `ordinaryResolutionThresholdPct` / `specialResolutionThresholdPct` / `unanimousWrittenSpecialResolution` fields, which remain for back-compat and as the seed source. The motion dropdown (`RESOLUTION_TYPE_OPTIONS` in `src/components/MotionEditor.tsx:70`) is replaced by this list; a new card on the Bylaw Rules page (`src/pages/BylawRules.tsx`) edits it. Statutory floors come from the jurisdiction pack so a custom type can't drop a special resolution below 2/3.

### Threshold evaluation evolves the phase-1 work

The pure helpers added in the in-flight phase 1 (`ResolutionThresholds`, `thresholdFor`, `motionMeetsThreshold`, `bylawRulesToThresholds` in `src/lib/motionGovernance.ts`) generalize to:

```ts
evaluateResolution(motion, resolutionType, { eligibleMemberCount, quorum }): {
  carries: boolean | null;     // null = no votes / not yet voted
  reason: string;              // "needs ≥66.7% of votes cast", "missing required approver: Founder", …
}
```

`base = votesCast` is today's logic; `base = eligibleMembers | quorum` divides by a different denominator (needs the member/quorum context — already computed in `convex/lib/bylawRules.ts:computeRequiredQuorum`). `requiredApprovers` checks `motion.recordedApprovers`.

## Votes Model A + History (the chosen design)

The motion carries one current tally (`votesFor/Against/abstentions`) and one current `status`/`outcome`. Each consideration appends to `history[]`:

- Moved at meeting A, tabled → `history += { meetingId: A, status: Tabled }`, top-level `status = Tabled`, no outcome.
- Resumed and carried at meeting B → `history += { meetingId: B, status: Voted, outcome: Carried, votes… }`, top-level reflects B.

This keeps the common single-vote case trivial while preserving the cross-meeting trail. If amendments/re-votes ever need first-class diffs, the `history[]` entries are already the seam to promote into a `motionConsiderations` table without reshaping the motion.

## Snapshot-on-Approval (legal-record immutability)

Minutes are frozen once approved (`minutes.approvedAt`). Because meetings will reference a *live* motion, editing the motion later must not mutate an approved record. Rule:

- **Draft minutes**: render motions live by id (reactive, editable).
- **On approval**: write `minutes.motionSnapshots[]` — an immutable copy of each referenced motion's `{ text, movedBy, secondedBy, resolutionTypeLabel, status, outcome, votesFor, votesAgainst, abstentions }` at approval time. Approved minutes render from the snapshot; the live motion may continue to evolve (e.g. re-raised later) without touching history.

This also makes the public-copy export deterministic and removes the read-time dependency on the motions table for historical minutes.

## Migration / Phasing

1. **Schema + writes, behind existing UI.** Add the `motions` table and `bylawRuleSet.resolutionTypes`. Add Convex mutations (`motions.create/patch/setStatus/recordVote/appendHistory`). Keep `minutes.motions[]` writing in parallel (dual-write) so nothing breaks.
2. **Backfill.** One-off migration: for every `minutes`, create a `motions` row per embedded motion, map `outcome` → (`status`,`outcome`) per the table below, set `primaryMeetingId`/`history[0]`, and link `minutes.motionIds`/`sections[].motionId`. Migrate every `motionBacklog` row into a `motions` row (carry `backlogPriority`/`source`/`seededKey`/`targetMeetingId`, map its stage per the status table), then rewrite dangling `motionBacklogId` references to `motionId`. Reconcile `motionEvidence` by `sourceMotionEvidenceId`.
3. **Flip reads.** Point minutes rendering (`src/features/meetings/lib/minutesRenderer.ts`), the editor (`MotionEditor` + `useMeetingMinutesColumn`), `MeetingDetail`, backlog, and exports at the table. Add snapshot-on-approval. Update the static/local-first adapter (`src/lib/staticConvex.ts`, `staticConvexFixtures.ts`) and `staticConvexParity.ts`.
4. **Resolution-types editor.** Replace the hardcoded dropdown with the list; ship the Bylaw Rules card; wire `evaluateResolution`.
5. **Drop dual-write.** Remove `minutes.motions[]` (keep as deprecated optional pass-through first, like `agendaJson` at `meetings.ts:30`), delete inference helpers.

### `outcome` → (`status`, `outcome`) backfill map

| legacy `minutes.motions[].outcome` | `status` | `outcome` |
|---|---|---|
| Pending / "" | Moved | — |
| Carried | Voted | Carried |
| Defeated | Voted | Defeated |
| Tabled | Tabled | — |
| Deferred | Deferred | — |
| Withdrawn | Withdrawn | — |
| (unknown) | Moved | — (preserve raw in `note`) |

### `motionBacklog.status` → `motions.status` map

| legacy `motionBacklog.status` | `motions.status` |
|---|---|
| Backlog | Backlog |
| Agenda | Agenda |
| MinutesDraft | Draft |
| Adopted | Voted (`outcome = Carried`) |
| Deferred | Deferred |
| Archived | Archived |

## Risks & Tradeoffs

- **Convex joins.** Reads become "fetch motions by meeting" instead of one embedded array. Convex reactivity handles this fine; index `by_meeting` + `by_society_status`. Slight extra query plumbing.
- **Static/local-first parity.** `staticConvex.ts` hand-implements queries by name (e.g. `bylawRules:getActive` at line 1761). Every new `motions:*` query/mutation needs a static counterpart and fixtures, or those builds break. Non-trivial — budget for it.
- **Dual-write window.** Until reads flip, two sources of truth exist; the backfill + dual-write must stay consistent. Mitigate with a parity check script (mirror `scripts/check-*`).
- **37 files reference `.motions`.** Importers, AI harness (`convex/aiAgents.ts`, `convex/transcripts.ts`), filing/export paths, and the import-session reconcilers all read the embedded shape. Flip them behind a small accessor so the change is mechanical.
- **Over-normalization risk.** Model A keeps this from ballooning; resist adding the appearance table until a concrete re-vote workflow needs it.

## Resolved Decisions

- **Backlog: folded into `motions`** (2026-06-27). `motionBacklog` is migrated into `motions` and dropped — no separate table, no view. A backlogged item is a motion with `status in (Backlog, Tabled, Deferred)` plus `backlogPriority`/`source`/`seededKey`/`targetMeetingId`. The seeding path (`seededKey`, `source: pipa-setup`) is preserved via the `by_society_seeded` index so idempotent seeds (e.g. PIPA setup) still de-dupe.

## Open Questions

- **Are movers intrinsic to the motion or to the consideration?** Model A puts them on the motion. If a re-raise can have a different mover, they move into `history[]`. Defaulting to on-the-motion.
- **Resolution-type id stability across bylaw versions.** Types live on a versioned `bylawRuleSet`; a motion references `resolutionTypeId` + a denormalized `resolutionTypeLabel` so a superseded rule set doesn't orphan old motions.

## Glossary / Canonical Values

- **status**: `Backlog | Draft | Agenda | Moved | Tabled | Deferred | Withdrawn | Voted | Archived` (explicit, settable; unified across the old motion + backlog lifecycles). `Backlog` = captured, unscheduled; `Agenda` = placed on an agenda; `Moved` = formally moved, awaiting vote; `Archived` = closed without action.
- **outcome**: `Carried | Defeated` (set only when `status = Voted`).
- **resolution type base**: `votesCast | eligibleMembers | quorum`.
- **built-in resolution type ids**: `ordinary` (Majority), `special`, `unanimous` — non-deletable; custom ids are slugged from the label.
