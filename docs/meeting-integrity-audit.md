# Read-only historical meeting integrity audit

This offline checker examines supplied records for duplicate candidates and broken or contradictory relationships. It does not connect to Convex, load credentials, deploy a function, edit a source export, or repair records. It reads the repository's current schema to identify typed references and adds the application's documented polymorphic links, such as signatures and source evidence.

**Implementation verification used synthetic records only. No production historical records were available to this session.** A report about an actual workspace requires an actual export. Source review and synthetic test counts are not evidence that its existing records are clean or corrupt.

## Run on an existing export

From the repository, with its dependencies installed and Node 20 or later:

```bash
node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-workspace-export.zip \
  --output /tmp/societyer-meeting-integrity.json
```

The input may be:

- A native Convex ZIP or its extracted directory, with `<table>/documents.jsonl` files.
- The application's `societyer.workspaceExport` JSON containing actual table rows. The metadata-only `exports.exportWorkspace` response, whose `tables` map is empty, is insufficient.
- A `societyer.localWorkspaceSnapshot` JSON.
- A Societyer `societyer.workspaceArchive` ZIP, version 1 or version 2, including the chunked database format. Database chunk sizes, SHA-256 hashes and counts are checked before auditing.
- A directory or ZIP from the existing workspace-with-files exporter, containing `workspace-export.json` and optionally `attachment-manifest.json`.
- An explicit JSON `{ "tables": { "meetings": [...], ... } }` bundle. Its coverage and consistency remain unknown unless separately declared.

The report goes to a newly created file with mode `0600`, or stdout when `--output` is omitted. Existing outputs are never overwritten. A report or scope-template path inside an input directory is rejected, because writing there would change the source fingerprint. Keep downloaded exports and reports outside the Git repository; exports can include private minutes, sign-in metadata and integration secrets even though this report omits their content.

Exit codes deliberately distinguish unresolved coverage from a clean result:

| Exit | Meaning |
| --- | --- |
| `0` | No issues found within the declared, complete, point-in-time scope. This is a relationship audit, not proof that every business or legal rule holds. |
| `1` | Confirmed errors exist in the supplied export, such as a cross-workspace reference, duplicate minutes, or a target absent from complete snapshot coverage. |
| `2` | Invalid arguments/input, checksum/count failure, unsupported format, refused output path, or a source that changed during processing. |
| `3` | Human review or coverage questions remain, including likely duplicate meetings, historical references, partial exports and non-atomic exports. |

Read `outcome`, `totals`, `scope.tableCoverage`, and individual findings together. Exit `3` is expected for an ordinary paginated workspace export even if its observed relationships match.

## Obtain a native Convex snapshot separately

An operator with an existing authorized CLI session can export the named deployment without deploying code:

```bash
npx convex export \
  --deployment industrious-cricket-610 \
  --path /tmp/societyer-meeting-snapshot.zip
```

The installed CLI uses `--deployment`, not `--deployment-name`. Confirm the deployment is the intended one before running the export. The checker itself never runs this command or opens an authentication flow. See [Convex's export documentation](https://docs.convex.dev/database/import-export/export).

After the export command has completed successfully, and only for its unmodified complete result:

```bash
node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-meeting-snapshot.zip \
  --complete-snapshot \
  --output /tmp/societyer-meeting-integrity-snapshot.json
```

`--complete-snapshot` is an explicit operator assertion about provenance. The checker cannot prove that a file named “snapshot” is authentic or unfiltered. It marks **present** tables as complete, unredacted, point-in-time deployment coverage. An omitted table stays missing; it is never silently converted into an empty table. If an empty required table is omitted by the exporter, supply a separately verified export or accept that its absence cannot be established from this input. Do not fabricate an empty table to obtain a clean exit.

File storage bytes are not required to inspect database relationships, and the example does not request them. An absent `_storage` table leaves storage references unresolved; the report cannot certify the existence or contents of an unbundled file. This version does not checksum native Convex storage binaries, even if they are included in a snapshot. `--verify-files` applies to bundled files with Societyer archive/attachment-manifest metadata.

### Restrict the workspace or component

Use `--society-id` to inspect one workspace while retaining the supplied foreign records as possible reference targets:

```bash
node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-meeting-snapshot.zip \
  --complete-snapshot \
  --society-id ACTUAL_SOCIETY_ID \
  --output /tmp/societyer-one-workspace-integrity.json
```

This does not remove private records from the input. It limits which source rows are inspected. Orphan rows whose workspace cannot be resolved are reported as excluded; repeat without the workspace filter to inspect those rows. A selected workspace pointing to an observed foreign document is still reported.

The default component is the root archive prefix. Tables from another prefix are never merged with root tables. The report lists `otherComponentsNotInspected`; audit a relevant component separately with `--component` set to its exact archive prefix, as shown in that list. Prefixes depend on the export structure; the checker does not guess which component holds Societyer records. `--component` is rejected for workspace JSON/archive formats.

## Coverage is evidence, not just a row count

A workspace UI export can be permission filtered and can combine several pagination transactions. Its manifest's counts describe supplied rows, not an independent database total. Local exports can also observe writes while being produced. Matching counts alone do not prove that every referenced document is present.

The checker classifies a missing ordinary reference as a confirmed `dangling_reference_in_snapshot` only if every allowed target table is:

1. Present and explicitly declared complete for the source row's scope.
2. Declared to include full, unredacted fields.
3. Part of a declared point-in-time input.

Otherwise it emits `reference_not_resolved_in_export`, with unresolved certainty. An already observed wrong-table or cross-workspace link can be reported without inventing absent records; it still describes the supplied export, not a live authorization exposure or the deployment's current state. A non-atomic export can contain relationships that changed between pages, so verify those findings against a fresh consistent snapshot before planning repairs.

### Hash-bound scope manifest

For a deliberately scoped extract, first create a conservative template:

```bash
node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-workspace-export.json \
  --write-scope-template /tmp/societyer-scope.json \
  --output /tmp/societyer-initial-review.json
```

The template records the exact SHA-256, component, actual row counts, scope and known consistency. It does **not** upgrade unverified tables to complete. A declaration has this shape:

```json
{
  "kind": "societyer.meetingIntegrityScope",
  "version": 1,
  "inputSha256": "EXACT_SHA256_FROM_THE_TEMPLATE",
  "component": "",
  "consistency": "non-atomic",
  "scope": { "kind": "workspaces", "societyIds": ["ACTUAL_SOCIETY_ID"] },
  "tables": {
    "meetings": { "complete": false, "rows": 12, "fields": "unknown" },
    "documents": { "complete": false, "rows": 47, "fields": "redacted" }
  }
}
```

Change a coverage assertion only when the export's provenance independently supports it. In particular, do not change a normal UI export to `point-in-time` just to silence unresolved findings. A trusted, consistent extract can use `point-in-time`; its scope may be `deployment` or a nonempty list of `workspaces`. `unknown`, `partial` and `redacted` coverage remain valid and useful for review.

Then run:

```bash
node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-workspace-export.json \
  --scope-manifest /tmp/societyer-scope.json \
  --output /tmp/societyer-scoped-review.json
```

The manifest must match the exact input hash, component and per-table row counts. A declaration cannot turn an absent table into an empty table, override a count discrepancy in the export's own manifest, or declare full fields when that export explicitly lists removed fields. Because the application lists globally redacted fields without a complete per-table map, the checker conservatively marks every table in such an export as redacted. Tables omitted from the scope declaration retain their original conservative status. Keep the scope manifest outside an input directory, since adding it inside would change that directory's hash. `--complete-snapshot` and `--scope-manifest` are mutually exclusive.

## What is inspected

The main graph includes meetings, minutes, agendas, agenda items, motions, motion evidence, attendance, meeting materials, meeting sources/source text, transcripts, transcription jobs/pages, and minute-book items. The checker also selects records with schema-defined incoming links to this graph, follows its documents/tasks/evidence/signatures, and includes their document versions. User, society, directory-person, template, committee and other tables are consulted as referenced targets; unrelated rows in those tables are not recursively treated as meeting records.

| Check | Interpretation |
| --- | --- |
| Several distinct minutes IDs for one meeting | Confirmed multiplicity in the export. Preserve all versions and approved snapshots; the checker does not choose a survivor. |
| Same exported table/ID appears twice | Export inconsistency, possibly overlapping pagination. Only the first occurrence is reconciled; it is not counted as two distinct minutes records. |
| Matching meeting title/date/type/body/committee | Review candidate. Normalization and recorded meeting time zone are used, with UTC fallback when none is recorded. Different sessions can legitimately match. |
| Meeting/minutes, motion/minutes, material/agenda, source/job and transcript/job links disagree | Observed relationship inconsistency, or an explicit review flag where carry-forward/history may explain it. |
| Repeated motion IDs, agenda position collisions, legacy embedded motions | Duplicate or migration review; no motion text is overwritten or discarded. |
| Signature subjects, approval meeting links, source documents, tasks, file versions and material grants | Existence/ownership reconciliation using known schema and application contracts. |
| Historical source-version identifiers/predecessors and malformed retained JSON | Structural review of the retained history. Source content is omitted from the output and remains untouched. |
| Missing historical snapshot/motion-history targets | Unresolved historical reference, even for a complete snapshot. Deleted or merged records can intentionally remain in history. |
| Approved record lacks today's frozen snapshot fields | Review flag; older records may predate that format. |
| Attendance on an unheld meeting, inconsistent quorum fields, legacy automatic quorum flags, absent/regrets marked quorum-counted | Evidence-review flag. These checks cannot establish actual attendance, proxy eligibility, legal quorum, or valid adoption. |

Typed IDs inside nested arrays/objects are inspected. Documented polymorphic strings, including signature `entityId`/`subjectId`, source-evidence targets and material access-grant subjects, are also interpreted. Arbitrary `v.any` fields, embedded source JSON, free-text attendee names, provider identifiers and storage keys are not guessed to be live document IDs. Source JSON is checked for JSON syntax only. This is a relationship audit, not a complete schema-validation or legal-compliance engine.

The report includes IDs, table/field names, counts, severity, certainty, coverage, a schema-reference catalog fingerprint and generic explanations. It omits titles, meeting discussions, names, emails, transcript text, file names, tokens and source text. IDs can still be sensitive operational identifiers; the report belongs with the original private export.

## File evidence, resource bounds and read-only guarantees

For a Societyer archive containing file bytes:

```bash
node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-workspace-with-files.zip \
  --verify-files \
  --output /tmp/societyer-files-integrity.json
```

The reader checks included file paths and declared sizes where available. With `--verify-files`, it also compares bundled SHA-256 hashes to the file inventory. The report records both inventory and checksummed-entry counts. `checksummed` does not mean every inventory entry was bundled; unavailable/external files remain unverified and are never downloaded. A manifest/hash mismatch describes the supplied archive, not necessarily the live attachment. Database IDs alone never establish binary integrity.

Inputs are fingerprinted before reading and again before accepting the report. A file hash covers its exact bytes; a directory hash covers the sorted relative file names and their SHA-256 hashes. The CLI refuses to publish a report if that fingerprint changed. It opens no database clients and performs no writes inside the input. Symlinks/special files, unsafe ZIP paths and encrypted ZIP entries are rejected; archive entries are read without extraction.

Default limits are 512 MiB expanded record bytes, one million rows, 50,000 input files, and 10,000 detailed findings. `--max-record-mib`, `--max-rows`, `--max-files` and `--max-findings` adjust them. One bundled file checked with `--verify-files` must also fit the record-byte limit. ZIP directory metadata is capped at 64 MiB. The reader uses the application's ZIP32 inventory parser and bounded Node zlib inflation; ZIP64/archives over approximately 4 GiB are unsupported. A large native snapshot can be extracted with a trusted external utility and passed as a directory instead. The audit indexes supplied records in memory, so the byte cap is not a heap-memory guarantee. Full finding counts remain available if detailed findings are truncated.

Run the synthetic regression suite with:

```bash
node --import tsx scripts/check-meeting-integrity-audit.ts
```

It exercises full/partial/missing/foreign scopes, duplicate distinctions, approved historical records, reference/parent mismatches, native ZIP/directory and Societyer archive formats, malformed/unsafe inputs, manifest binding, attachment hashes, privacy of output, input hash preservation and CLI exit/output behavior. These fixtures are entirely synthetic. Actual cleanup requires a separate reviewed plan based on an actual snapshot; this tool has no repair option.
