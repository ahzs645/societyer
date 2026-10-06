# Offline document intake backups

`scripts/build-intake-backup.ts` turns extracted import-session bundles into a real `societyer.localWorkspaceSnapshot` (workspace schema version 3). It stages every record as **Pending** through the same portable handler used by the app, then verifies the JSON through the local restore and import-session query paths. It does not connect to Drive, extract source files, approve records, or apply them to legal/operational registers.

Provide an organization JSON object with an explicit `name`, `jurisdictionCode`, and `entityType`, plus any verified organization fields. Do not guess incorporation dates or numbers. This creates an isolated review workspace with a fresh local organization ID; it is not an update to an existing organization.

```sh
node --import tsx scripts/build-intake-backup.ts --organization organization.json --bundle intake-bundle.json --out intake-backup.json
node --import tsx scripts/check-intake-backup.ts
```

Repeat `--bundle` for independently reconciled batches. Each becomes a separate review session. Cross-batch deduplication is the extraction coordinator's responsibility. Preflight rejects unrecognized bundle collections and lossy normalization before any backup is written. Output creation refuses to overwrite existing files.

Restore the resulting JSON using the local/desktop workspace backup restore UI. **Restore replaces the complete current local workspace; it does not merge.** Back up existing work first, or use an isolated local workspace. After restoring, open `/app/imports` and review the Pending records. For an existing workspace, import the original bundles through `/app/imports` instead of restoring this snapshot. This file is not a direct hosted Convex database import.

The JSON preserves extracted payloads and source references, but **does not contain original attachment bytes**. Local attachment envelopes are storage references, not binary files. Keep a separately checksummed archive of the original Drive files, extracted text, inventory, and bundles; source links may still require Drive access. A `societyer.workspaceExport` v2 ZIP from `export-workspace-with-files.ts` is a different format and must not be presented as this restore artifact.

Subagents should work on disjoint inventory file IDs and return bundles with `google-drive:<fileId>` provenance, confidence, and review notes. Reconcile duplicate/conflicting claims and retain unsupported information as source evidence before running this compiler. Never treat successful backup creation as proof that extraction was complete or accurate.
