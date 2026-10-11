# Intake extraction pipelines

Societyer has two intake paths:

1. **The AI-led intake pipeline** (`scripts/intake-run.ts`, `shared/intake/`,
   `intake:*` functions): turns a folder or a Drive inventory into native
   records plus gap items, with a source locator on every extracted value.
   Use this for new intake work.
2. **The subagent task harness** (`scripts/intake-extraction-pipeline.ts`,
   below): plans read-only tasks for external agents and merges their results.

## AI-led intake pipeline

```sh
# Local folder (recursive); output must be outside the repository
npm run intake:run -- /data/society-records --out /data/intake-out --name "Society records"

# Drive inventory (scripts/inventory-public-drive.py) with downloaded files
# under --files-root/<driveId>/<file> or each entry's localPath
npm run intake:run -- --drive-inventory /data/inventory.json --files-root /data/files --out /data/intake-out

# Schema-constrained LLM extraction (deterministic fallback per file)
OPENAI_API_KEY=… npm run intake:run -- /data/records --out /data/out --llm openai --model gpt-4.1-mini --budget-tokens 2000000
OPENROUTER_API_KEY=… npm run intake:run -- /data/records --out /data/out --llm openrouter --model openai/gpt-4.1-mini

# JSON Schemas of the extraction contract for offline agents
npm run intake:run -- --export-schemas /data/schemas
```

Stages: inventory → junk filter (AppleDouble, OS metadata, lock files,
zero-byte and empty-hash files) → text and layout extraction (DOCX with real
table blocks and page numbers, PDF text layer with page numbers and column
tables, XLSX cells with A1 references, MSG headers/body/attachments, legacy
DOC/XLS/PPT through LibreOffice when installed) → clustering (exact bytes
excluding the empty hash, SimHash near duplicates, format copies,
draft/approved versions, package-embedded documents) → classification priors →
field extraction (LLM `generateObject` or the deterministic minutes extractor)
→ span re-verification of every quoted locator → entity resolution →
reconciliation (draft vs approved via adopting motions, action carry-forward,
policy adoption, record gaps) → bundle and coverage report.

Outputs in `--out`: `run.json` (files, clusters, extractions with locators,
reconciliation, record gaps, people), `bundle.json` (Pending import bundle with
`sources`, `documentMap`, `meetingMinutes` and `representationGaps`),
`coverage.json` (native coverage per class, body and year), `processing-log.json`
(which file went to which provider, with redaction counts) and `extracts/`
(text and layout blocks that locators point into).

Every extracted value is a `FieldValue` `{value, status, confidence, locators}`
(`shared/intake/schemas`). Locators carry `blockIndex`, `page`, `sheet`, `cell`,
character offsets and a verbatim `quote`; quotes that cannot be re-found are
marked `span_mismatch` and counted as hallucinations.

Privacy: restricted classes (payroll/HR, banking, contact lists, consent forms,
mailboxes) are never sent to a model and their text is withheld from the
bundle; SINs, account and card numbers, phones, emails and postal codes are
masked (same length, so offsets stay valid) before any model call; the source
document is fenced as untrusted data in the prompt.

In the app, `intakeActions:extractRun` runs the same extraction against the
workspace's AI provider (AI settings → secret vault → environment keys), and
`shared/intake/stageRun.ts` stages a CLI run into a workspace through the
`intake:*` mutations (runs, files, extracts, clusters, extractions that are
re-verified server-side, field reviews, provenance, processing log).

### In-app intake and review (`/app/intake`)

Administration → **AI intake** runs the same pipeline from the app: choose
files or a folder (or, on the desktop, a native folder pick that also converts
legacy `.doc`/`.xls` with LibreOffice), and a web worker extracts text, clusters,
classifies and — in the local/desktop runtime — extracts fields
(deterministically, or with an AI provider whose key stays on the device).
Hosted workspaces extract fields on the server with `intakeActions:extractRun`.
`/app/intake/:runId/review` is the three-pane review: a risk-ordered queue by
version cluster, the source with the selected value's span highlighted
(DOCX, PDF page and text layer, XLSX grid, text blocks, version diff), and the
native form where each field is accepted, edited, rejected or marked "can't
represent" (a system gap). Bulk accept takes only stated, span-verified,
non-conflicting values at or above the per-field threshold, with a preview and
an undo window. Promotion writes the meeting, minutes, motions and agenda
through the import-session apply path, links the source documents and leaves a
`fieldProvenance` row per field, shown as **View source** on the meeting.

Evaluation: `npm run test:intake-eval` grades the extractor against the
committed synthetic golden fixture and, with `SOCIETYER_GOLDEN_SET` (and
`SOCIETYER_GOLDEN_FILES`, `SOCIETYER_GOLDEN_HOLDOUT`), a private golden set kept
outside the repository. Metrics: motion recall/precision, mover/seconder/outcome
accuracy, attendance precision/recall and category, header fields, action items
and the hallucination rate. `npm run test:intake-ai` runs all intake gates.

## Subagent task harness

This offline pipeline creates read-only extraction tasks for the host's subagents,
validates their results, and produces an `/app/imports` candidate bundle. It does
not call an LLM service, modify Drive, approve records, or apply them to an organization.
Keep downloaded source documents and task results outside the source repository.

Upstream `minutes:transposeSource*` is native in-app transposition. This script performs the offline extraction stage before import; it does not replace native transposition.

### Plan from an inventory

The inventory uses schemaVersion 1 and has rootFolderId, completeness, entries,
folders, and errors. File entries have id, name, mimeType, path, kind: "file",
excluded, and optional localPath, downloadStatus and sha256. Folder entries are
not extraction tasks. Public HTML listings can be incomplete; completeness and
folder errors remain visible in the final coverage report.

```sh
node --import tsx scripts/intake-extraction-pipeline.ts plan /data/inventory.json /data/tasks 8
```

This writes plan.json and one task JSON per source, with bounded scheduling batches.
Have the host delegate tasks to its agents. Each task contains identity, source
location, and instructions to consult the current normalization and record-kind
code. Do not trust a stale static catalog to define available fields. Each agent
reads the source and returns one JSON file in a separate results directory:

```json
{
  "planId": "copy from task",
  "taskId": "copy from task",
  "sourceId": "google-drive:copy-id-from-task",
  "coverage": {
    "outcome": "unsupported",
    "notes": "Read pages 1–3; document contains a layout that requires manual review.",
    "unsupportedDetails": ["Describe the unsupported source information and its page reference."]
  },
  "bundle": {}
}
```

Outcomes: `extracted` requires native structured records; `evidence-only` means
content was read but represented only as evidence; `unsupported` requires details;
`unreadable` and `excluded` must not contain extracted records. Do not classify a
filename-only inventory as evidence extraction. Every structured record must cite
its task's exact sourceId through sourceExternalIds. Cross-source reconciliation
is a later, explicit review step, not an extraction agent's identity override.
Avoid raw credentials and restricted identifiers in general notes or reports.

Use checkpoint `id`, source `assertion`, `boundary`, `eligibleCount` for eligible people present, `eligiblePopulation` for the total eligible population, and `sourceReference` for the locator. Imports force evidence review to pending and reject adopted consent items or pins. Source catalog HTTP(S) URLs populate row citations when available; external IDs plus a locator can support pending evidence when no URL exists.

### Merge and review

```sh
node --import tsx scripts/intake-extraction-pipeline.ts merge /data/tasks/plan.json /data/results /data/output
node --import tsx scripts/check-intake-extraction-pipeline.ts
```

Use a new output directory for each merge; the CLI refuses to overwrite an existing directory. Merge requires every planned task exactly once. It checks plan/source identity,
coverage, citations, and import normalization losses. It canonicalizes accepted
collection aliases and retains the source catalog and document map for
unreadable files (excluded files remain only in coverage), clearly labeling their outcome. Unsupported details and task
metadata are retained in coverage-report.json and import bundle metadata. Source
catalog additions from agents remain in the coverage report; inventory identity
controls the imported catalog.

Exact identical records are deduplicated; conflicting records sharing an explicit
ID preserve both payloads in the conflict report and block bundle production.
No semantic conflict detection is claimed for records with different IDs. Inspect
possible contradictions and multiple historical versions during review.

A successful import-bundle.json is suitable for creating a Pending import session.
It is not a database backup. Use the companion local backup builder to produce a
restore-format workspace containing the Pending session, then review and approve
inside the app. Links/localPath values alone do not embed source file bytes; keep
the source archive alongside the deliverable and verify file handling separately.
