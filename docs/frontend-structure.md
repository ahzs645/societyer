# Frontend structure & the "where does this go?" rule

This documents how `src/` is organized, the one rule for deciding where a new file
belongs, and the staged plan for finishing a consolidation that's currently only
half-adopted. It's a living document — update the **Status** section as slices land.

## Why this exists

The codebase already has a good pattern — `features/<x>/{components,lib,pages}` —
but three older buckets predate it and code keeps leaking back into them:

- **`components/`** — ~1 in 3 flat files import domain code, so "shared" isn't shared.
- **`lib/`** — one folder doing three unrelated jobs (utils + runtime infra + leaked
  domain logic).
- **`modules/`** — a category of one (`object-record`), which is really a *record
  engine*, not a generic "module."

Nothing enforced the boundary, so it drifted. The fix is to **finish the pattern and
add a guardrail**, not to invent a new structure.

## The rule (decidable in 5 seconds)

| Bucket | Test | Examples |
| --- | --- | --- |
| `components/` | *"Could I publish this to npm unchanged?"* Zero domain-entity knowledge. | `Modal`, `Select`, `DataTable`, `Toast`, `DatePicker` |
| `features/<x>/` | Knows a domain entity — imports a Convex table or references a business concept (motion, grant, asset). | `MotionEditor`, `DraftMinutesPicker`, `DocumentVersions` |
| `platform/<engine>/` | Reusable framework the features are built *on* — not itself a user feature. | `record-engine` (was `modules/object-record`) |
| `lib/` | Domain-agnostic non-UI: pure utils + app/runtime infra. | `csv`, `format`, convex client, `static-convex` |
| `app/` | The shell that composes everything (allowed to be domain-aware). | `Layout`, nav config, command registry |

One-line version: **a domain word in its props or imports → `features/`. Otherwise →
`components/` or `lib/`.**

## Target shape

```
src/
  app/             # shell: Layout, nav config, command/shortcut registry, routing
  components/      # GENERIC UI only (Modal, Select, DataTable, Toast, ...)
    display/ feedback/ input/ layout/ navigation/ theme/   # (already exist)
  features/
    meetings/ grants/ financials/ assets/ tasks/ commitments/ ai/   # (exist)
    documents/ legal/ filings/ jurisdiction/ compliance/            # (new homes)
      components/  lib/  pages/
  platform/
    record-engine/  # was modules/object-record (+ the record-* UI from components/)
  lib/
    static-convex/  runtime/   # + true generic utils at the root
```

## What's misfiled today (the moves)

**`components/` → feature homes** (the reliably domain-aware ones):

| Files | → destination |
| --- | --- |
| `Global{Asset,Meeting,Task,Commitment}Create` | `features/{assets,meetings,tasks,commitments}/` |
| `MotionEditor`, `DraftMinutesPicker` | `features/meetings/components/` |
| `RecordShowPage`, `useDataTable`, `CustomFieldsPanel`, `RecordTableMetadataEmpty`, `MergeRecordsModal` | `platform/record-engine/` |
| `DocumentVersions`, `SignaturePanel`, `PaperlessDocumentAction` | `features/documents/` (new) |
| `SectionRedline`, `LegalGuide` | `features/legal/` (new) |
| `FilingBotRunner` | `features/filings/` (new) |
| `Layout`, `Layout.internal` | `app/` (allowed shell exception) |
| `NotificationBell`, `NotesPanel`, `ActivityTimeline` | borderline — decide per file |

Everything else in `components/` (Modal, Select, Kanban, CommandPalette, `DataTable`,
FilterBar, ...) is genuinely generic and **stays put**. Note `DataTable` is generic and
used broadly — it belongs in `components/`, not the engine.

**`lib/` → carve into three:**

| Cluster | → |
| --- | --- |
| `staticConvex*`, `staticIds`, `staticRuntime` | `lib/static-convex/` |
| `convex*`, `runtimeMode`, `store`, `optimistic`, `authClient`, `local*`, `dexie*` | `lib/runtime/` |
| `motionGovernance`, `bylawSections`, `jurisdictionGuide*` + packs, `compliance/`, `equity/`, `bankCsv` | into `features/*` |
| `csv`, `format`, `html`, `markdown`, `clipboard`, `pdf`, `docx`, `zip`, `wordDiff`, `useIsMobile`, ... | stay in `lib/` |

## The guardrail

It leaked because nothing enforced the boundary. `eslint.config.js` now carries
(warn-only for now):

- `components/**` may not import `@/features/**`, `@/pages/**`, or `@/platform/**`.
- `lib/**` may not import `@/features/**` or `@/pages/**`.
- `max-lines` (500) / `max-lines-per-function` (150) flag god-files as they're written.
  Data/definition files (fixtures, metadata catalogs) are expected exceptions.

Flip these from `warn` to `error` once the misfiled files above are relocated. A future
upgrade to `eslint-plugin-boundaries` can add the cross-feature rule (feature A may not
deep-import feature B).

## Rollout — each slice a green no-op

Every slice = pure move + import-path fix (no logic change), ending on `tsc -b` +
`npm run convex:typecheck` + relevant `check-*` scripts, its own commit.

1. **Guardrail (warn) + this doc.**
2. **`modules/object-record` → `platform/record-engine`** (uniform `@/` barrel rename).
3. **`Global*Create` → features** (4 trivial 1:1 files).
4. **`lib` carve** (`static-convex/`, `runtime/`) — static-parity is a known risk; run
   the static-parity check after.
5. **`components/` domain de-leak** into meetings/legal/documents/filings — per-file,
   mostly relative-path importers so each needs its import graph rewritten carefully.

## Status

- [x] **Slice 1** — guardrail rules added to `eslint.config.js` (warn); this doc.
- [x] **Slice 2** — `modules/object-record` → `platform/record-engine`. All 40 importers
      used the `@/modules/object-record` barrel, rewritten to `@/platform/record-engine`;
      `src/modules/` removed; stale path comments in `convex/` + `shared/` refreshed.
- [ ] **Slice 2b (deferred)** — relocate the record-* UI components out of `components/`.
      Deferred because they're imported via relative paths (not the `@/` alias), so each
      needs its own import-graph rewrite; and `DataTable` is generic and should *stay*.
- [x] **Slice 3** — `Global{Asset,Meeting,Task,Commitment}Create` moved from `components/`
      into their features (`features/assets|meetings/components|tasks|commitments/`).
      Importers repointed to `@/` alias. Verified: tsc -b, lint. (commit 7cf03ba)
- [ ] **Slice 4 (assessed, not started)** — `lib/` carve into `static-convex/` + `runtime/`.
      Lowest user-value slice (grouping already-coherently-named files) and the fiddliest:
      `staticRuntime` has 17 importers in heterogeneous alias/relative forms. No backend
      coupling (the `shared/` references are stale doc comments, not imports). Run
      `npm run test:static-parity` after, since this touches migration-sensitive code.
- [ ] **Slice 5** — `components/` domain de-leak (meetings/legal/documents/filings).
