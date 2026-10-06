# Drive archive transposition with host subagents

This offline pipeline creates read-only extraction tasks for the host's subagents,
validates their results, and produces an `/app/imports` candidate bundle. It does
not call an LLM service, modify Drive, approve records, or apply them to an organization.
Keep downloaded source documents and task results outside the source repository.

## Plan from an inventory

The inventory uses schemaVersion 1 and has rootFolderId, completeness, entries,
folders, and errors. File entries have id, name, mimeType, path, kind: "file",
excluded, and optional localPath, downloadStatus and sha256. Folder entries are
not extraction tasks. Public HTML listings can be incomplete; completeness and
folder errors remain visible in the final coverage report.

```sh
node --import tsx scripts/transposition-pipeline.ts plan /data/inventory.json /data/tasks 8
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

## Merge and review

```sh
node --import tsx scripts/transposition-pipeline.ts merge /data/tasks/plan.json /data/results /data/output
node --import tsx scripts/check-transposition-pipeline.ts
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
