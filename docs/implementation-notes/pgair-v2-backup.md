# PGAIR v2 review backup (OCR run): staging, round trip and fixes

This package produced the second restorable review backup of the PGAIR archive from the OCR corpus run
(`run9-ocr`, see [intake-ocr-quality](intake-ocr-quality.md); re-run as `run10-v2` after the reconciliation fix below) and fixed four bugs the staging found. The
archive, the backup, every real name and every real-data result stay in the session scratchpad; this note
describes the method, the fixes and aggregate behaviour only.

## Method

Production build (`npx vite build`, no runtime mode baked in), served with
`VITE_RUNTIME_MODE=local-indexeddb npx vite preview`, fresh Chromium profile, everything through the UI:

1. **Organization.** First-run setup → Start a new organization → Societies Act (BC society), legal name and
   registry number from the incorporation certificate, operating region British Columbia (as v1).
2. **Run.** AI intake → Import a run processed on another computer (the CLI output, hard-linked down to the
   extracts the review needs) → Add original files per source subfolder. Originals were chosen with the v1
   rule (minutes copies of reconciled meetings and their version-cluster members); the 7 GB corpus is not
   embedded.
3. **Review.** Bulk accept "Every document in the run" (the documented rule: stated, span re-verified, not
   conflicting, at or above the field threshold; OCR caps keep low-confidence scans out) → Add run people to
   directory → Promote all ready.
4. **Class records the review could not promote** (documents still missing a required field, or never
   reviewed): one import session built from the run's bundle, leaving out every record whose primary source
   the review had already promoted or covered, and agreements (step 5) → Approve evidence-verified → Create
   docs → Create minutes → Apply sections (per record). Blocked records: duplicates linked to the existing
   register record; records waiting for a meeting no source creates, and records needing a fix, deferred to
   Pending. Nothing outside the evidence rule was approved.
5. **Agreements.** Promotion wrote native draft agreements; the remaining unreviewed agreement extractions
   went through "Convert agreement gaps to agreements".
6. **Repairs.** Import sessions → Repair imported minutes; Tasks → Historical source actions → Tidy
   duplicates and statuses (disabled: promotion keeps minutes action items on the minutes, so there were no
   historical task rows); Coverage → System gaps → legacy evidence backfill (not offered: no untyped legacy
   evidence rows).
7. **Continuity.** Coverage → Expectations: store the BC rule pack; confirm only the Operations Committee and
   AQMP monthly cadences (82% and 90%); the board (57%) and executive committee (60%) suggestions stay
   suggestions. People duplicate suggestions stay pending.
8. **Compact this intake run**, then Settings → Runtime → Download ZIP backup; restore into a second fresh
   profile; download again and compare.

## Fixes

| Problem found | Fix | Gate |
| --- | --- | --- |
| The restored backup re-exported ~2,000 rows that differed from the backup (same tables, rows and ids): `ctx.db.replace` (minutes section sync rewrites agenda items) dropped `_creationTime` and `entityId` on both portable engines, and the legacy row API wrote uploaded document versions without an `entityId`, so the restore migration minted new identities | `replace` keeps the system fields the new document does not supply (`preservedSystemFields` in `shared/portable/ids.ts`, used by `MemoryDb` and `LocalStoreDb`; Convex keeps `_creationTime` the same way); `LocalDexieRowStore.upsertRow` keeps a stored row's `entityId`/`_creationTime` or mints them | `npm run test:row-identity` (new) |
| "Possible duplicates" never appeared in a browser-local or desktop workspace: the trusted local runtime keeps directory people unowned (no `societyId`), the directory lists them, but `personHistory:duplicateSuggestions` read only rows indexed by society | Suggestions read the same people the directory lists (owned plus unowned in a trusted local runtime; hosted unchanged) | `test:people-identity` (extended) |
| A meeting whose minutes exist as a standalone file and also inside the next meeting's package was promoted from the package copy whenever the package's file name sorted first (18 of the 36 package-canonical meetings on the archive), so the meeting showed the package's header (the next meeting's date) as its "as written in source" text. This contradicted the documented rule that a standalone copy is the record | Reconciliation ranks a standalone minutes file before an embedded copy (`<package>#part-N`) of the same record status; a more authoritative embedded copy (approved or signed) still wins (`shared/intake/reconcile.ts`). The corpus was re-run with the warm extract cache (12 min) and staged again | `test:intake-ai` (`check-intake-stages.ts`); private minutes golden set unchanged |
| Promotion failure messages ended in ".." | Issue texts lose their trailing full stop before joining | `test:intake-review` |

## Results (aggregate)

The full v1/v2 comparison is in the private findings. Every class now lands natively: meetings, motions,
attendance, actions, policies, bylaw rules, agreements, grants, filings, statements and insurance. OCR'd
documents now reach the registers.

| | v1 (run8, class records through import sessions) | v2 (OCR run, review of every class) |
| --- | ---: | ---: |
| Intake documents promoted / covered copies | 218 / 86 | 1,147 / 383 |
| Field provenance rows | 10,929 | 48,654 |
| Meetings / motions / minutes with a chair | 262 / 153 / 26 | 308 / 176 / 96 |
| Native draft agreements | 0 | 96 |
| Backup records / ZIP size | 80,758 / 175 MB | 103,380 / 321 MB |

Fewer grants, insurance policies and bylaw rule sets than v1 is expected: v1 created one register row per
file, copies included, while the review folds copies into the record of their version cluster ("covered").

Timings on four CPUs, production build, one browser:

| Step | Time |
| --- | ---: |
| Import the run | 93 s |
| Bulk accept 92,416 fields | 33 s |
| Promote all ready | 670 s |
| Class-record session | 30 s |
| Compaction | 17 s |
| Export | 25 s |
| Restore | 31 s |
| Re-export | 25 s |

The re-export has the same 47 tables, 103,380 rows, ids in every table and 548 included files as the
backup. The only differing row content is the society's `updatedAtISO`, which the restore stamps.

## Observations left open

- **Run people include topics and places.** "Add run people to directory" adds every full name the run
  found, including about a quarter that are agenda topics, places or phrases read as names from extractions
  nobody accepted. They link to almost no records (a dozen attendance rows), but they crowd the directory and
  its duplicate suggestions. A person-name screen (or adding only names from accepted fields) is needed.
- **Documents waiting for a required field.** About 850 documents had accepted fields but no accepted value
  for a required field (most often a date or identifying name below the bulk threshold, often from OCR). They
  stay in the review queue; some of their class records reached the registers through the import session when
  their key facts met the evidence rule, so promoting one later must be checked against the register first.
- **Header of package-only minutes.** When minutes survive only inside a later meeting's package (18 meetings
  on the archive), the promoted meeting's source record still takes its header lines from the start of the
  package, i.e. the later meeting's agenda header. The meeting's own date, body and content are right; the
  "as written in source" line is not. The source record should be built from the embedded part's blocks.
- **Open-ended cadences.** A confirmed monthly cadence counts missing meetings up to today, past the end of the
  archive; set an end date (or mark periods) when a committee stopped meeting.
- **Build mode matters.** A build with `VITE_RUNTIME_MODE=local-indexeddb` baked in is the e2e harness: its
  workspace contains the seeded demo society next to the real one. Real data belongs in a build without it
  (the PWA path, a browser-local workspace chosen at setup).
