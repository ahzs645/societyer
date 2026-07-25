# Local-to-Convex promotion design

**Status:** Proposed  
**Scope:** One-way promotion of one local browser/Electron workspace into one hosted Convex deployment  
**Non-goal:** Two-way sync, ongoing replication, or general-purpose merge

## 1. Decision summary

Implement promotion as a resumable, staged import into a newly created, quarantined society:

1. The local client uploads an immutable snapshot in bounded chunks.
2. Hosted preflight validates the entire normalized snapshot against the deployed schema and a reviewed reference manifest. It produces a persistent, machine-readable report and makes no domain-row changes.
3. Pass 1 inserts rows in schema-derived dependency order and transactionally persists a `{table, local _id} → Convex _id` mapping.
4. The client uploads locally readable attachment bytes directly to the configured hosted storage.
5. Pass 2 rewrites all declared typed and string-held references, then validates and patches the final documents.
6. Reconciliation verifies row counts, mappings, attachments, and unresolved references before the society becomes visible.

For v1:

- Promotion creates a fresh society; importing into an existing society is refused.
- The changes journal is not imported.
- Secrets, authentication bindings, API tokens, billing state, webhooks, provider connections, caches, and other operational state are excluded.
- Retry is resumable but manually initiated.
- Production exposure depends on the trusted-principal work. The data pipeline can be built and tested as internal functions before that work, but it must not be exposed to end users while authorization still trusts `actingUserId`.

## 2. Existing constraints and findings

### 2.1 Native and durable identity

Convex `_id` values cannot be minted by the local runtime. The portable identity design therefore defines `entityId` as durable identity and `_id` as a runtime-native key ([shared/portable/ids.ts:4-14](../shared/portable/ids.ts#L4-L14)). The current schema has approximately 656 typed foreign-key declarations; a current mechanical count of `convex/schema.ts` and `convex/tables/*.ts` gives 660 `v.id()` occurrences.

`EntityIdMap` is currently only two in-memory `Map` instances, so it cannot support restart or retry by itself ([shared/portable/ids.ts:85-118](../shared/portable/ids.ts#L85-L118)). Promotion needs a persisted hosted mapping.

The local database now mints `entityId` during inserts, preserving one already supplied by the document ([shared/portable/localRowStore.ts:138-143](../shared/portable/localRowStore.ts#L138-L143), [shared/portable/localRowStore.ts:196-201](../shared/portable/localRowStore.ts#L196-L201)).

### 2.2 Critical `entityId` naming collision

Four hosted tables already use `entityId` to mean “the target of this activity/note/signature/custom value,” not the durable identity of the row:

- `activity` and `notes` ([convex/tables/governance.ts:59-80](../convex/tables/governance.ts#L59-L80))
- `signatures` ([convex/tables/treasury.ts:87-106](../convex/tables/treasury.ts#L87-L106))
- `customFieldValues` ([convex/tables/transcripts.ts:63-74](../convex/tables/transcripts.ts#L63-L74))

Because the local insert adapter treats a supplied `entityId` as the row’s durable identity, rows in these tables currently conflate two meanings. Promotion must not infer which meaning was intended.

**Required prerequisite:** rename the semantic target field to `subjectId` while retaining `entityType`, migrate existing rows and indexes, and then repurpose `entityId` exclusively as durable row identity. Promotion should require a local workspace schema version after this migration.

### 2.3 Snapshot boundaries

A snapshot contains workspace metadata, schemaless table arrays, attachment metadata, and a changes journal ([src/lib/localDexieRowStore.ts:30-60](../src/lib/localDexieRowStore.ts#L30-L60)). Export copies the current table, attachment, and change caches ([src/lib/localDexieRowStore.ts:267-275](../src/lib/localDexieRowStore.ts#L267-L275)).

The changes journal is a diagnostic window, not durable history: it is capped at 2,000 entries with 100 entries of pruning slack ([src/lib/localDexieRowStore.ts:62-66](../src/lib/localDexieRowStore.ts#L62-L66), [src/lib/localDexieRowStore.ts:465-489](../src/lib/localDexieRowStore.ts#L465-L489)). It cannot be treated as a complete event log.

Current snapshot validation checks only that tables are arrays of objects and that attachments are arrays containing string keys; it does not enforce hosted field types or required fields ([src/lib/localDexieRowStore.ts:546-574](../src/lib/localDexieRowStore.ts#L546-L574)).

Local migration also does not guarantee hosted validity. For example, it adds `jurisdictionCode`, `entityType`, `actFormedUnder`, and `updatedAtISO` to societies ([src/lib/localDexieRowStore.ts:601-628](../src/lib/localDexieRowStore.ts#L601-L628)), while hosted societies require `isCharity`, `isMemberFunded`, and numeric `updatedAt` ([convex/schema.ts:33-57](../convex/schema.ts#L33-L57), [convex/schema.ts:122-125](../convex/schema.ts#L122-L125)).

### 2.4 Files are not in the snapshot

`LocalAttachmentEnvelope` contains only metadata and a `storageKey`; it does not contain bytes ([src/lib/localDexieRowStore.ts:30-43](../src/lib/localDexieRowStore.ts#L30-L43)). Electron stores document bytes separately under the workspace filesystem and computes SHA-256 when writing them ([electron/documents.ts:40-70](../electron/documents.ts#L40-L70)). Reading currently loads the entire file into an `ArrayBuffer` ([electron/documents.ts:74-78](../electron/documents.ts#L74-L78)).

Hosted storage can use Convex `_storage` or the RustFS-backed provider through the shared `StorageCapability` interface ([shared/portable/capabilities.ts:70-78](../shared/portable/capabilities.ts#L70-L78), [convex/providers/capabilities.ts:34-59](../convex/providers/capabilities.ts#L34-L59)). For `_storage`, the final storage ID is known only after the upload POST completes ([convex/providers/capabilities.ts:41-45](../convex/providers/capabilities.ts#L41-L45)).

## 3. Goals and invariants

Promotion must maintain these invariants:

- No production domain row is inserted until the entire snapshot passes preflight.
- Every promoted row has exactly one durable `entityId`.
- Every inserted row has one persistent mapping from its source table and local `_id`.
- The same snapshot can be retried without creating duplicate rows or files.
- No local-format ID remains in a declared hosted reference after pass 2.
- The target society is inaccessible to ordinary application queries until reconciliation succeeds.
- Failure never causes an import to continue silently with dropped fields, unresolved references, or missing attachments.
- `_creationTime` is not preserved; Convex creates a new native timestamp. Domain timestamps such as `createdAtISO` are preserved when valid.
- A snapshot is never treated as authority for hosted credentials or authenticated identity.

## 4. Promotion data model

Add hosted-only control tables.

### `promotionRuns`

One row per normalized snapshot and target deployment:

```ts
{
  sourceWorkspaceId: string,
  sourceSchemaVersion: number,
  snapshotDigest: string,
  schemaFingerprint: string,
  targetSocietyId?: Id<"societies">,
  initiatedByPrincipal: string,
  state:
    | "staging"
    | "preflighting"
    | "preflight_failed"
    | "ready"
    | "inserting"
    | "awaiting_files"
    | "rewriting"
    | "reconciling"
    | "complete"
    | "rollback_pending"
    | "rolled_back"
    | "failed",
  dryRun: boolean,
  expectedChunkCount: number,
  receivedChunkCount: number,
  rowCounts: Record<string, number>,
  insertedCount: number,
  rewrittenCount: number,
  uploadedAttachmentCount: number,
  errorCount: number,
  warningCount: number,
  createdAtISO: string,
  updatedAtISO: string,
  completedAtISO?: string
}
```

Indexes:

- `by_workspace_digest` on `(sourceWorkspaceId, snapshotDigest)`
- `by_principal_state` on `(initiatedByPrincipal, state)`
- `by_target_society` on `targetSocietyId`

### `promotionStagedRows`

One normalized source row per document:

```ts
{
  promotionId,
  table,
  sourceLocalId,
  sourcePortableId,
  sourceChecksum,
  normalizedValue,
  dependencyLayer,
  status
}
```

Use indexes on `(promotionId, table, sourceLocalId)` and `(promotionId, status, dependencyLayer)`. Preflight must reject rows too close to Convex’s document-size limit after adding staging overhead.

### `promotionMappings`

The durable replacement for the in-memory `EntityIdMap`:

```ts
{
  promotionId,
  sourceWorkspaceId,
  targetSocietyId,
  table,
  sourceLocalId,
  sourcePortableId,
  targetNativeId: string,
  sourceChecksum,
  pass1Complete: boolean,
  pass2Complete: boolean
}
```

Application-enforced uniqueness is required for:

- `(promotionId, table, sourceLocalId)`
- `(targetSocietyId, table, sourcePortableId)`

The target ID is stored as a string because one mapping table cannot use a polymorphic `v.id()` validator.

### `promotionAttachments`

```ts
{
  promotionId,
  sourceAttachmentKey,
  sourceStorageKey,
  sourceDocumentId?,
  sourceVersionId?,
  expectedSha256?,
  observedSha256?,
  expectedSize?,
  observedSize?,
  targetProvider?,
  targetStorageKey?,
  targetStorageId?,
  status,
  verifiedAtISO?
}
```

### `promotionIssues`

Persist errors and warnings rather than returning a potentially oversized report:

```ts
{
  promotionId,
  severity: "error" | "warning",
  code: string,
  table?: string,
  sourceLocalId?: string,
  path?: string,
  expected?: string,
  actual?: string,
  targetTable?: string,
  targetLocalId?: string,
  message: string
}
```

Issues are queried with pagination. The promotion API returns summary counts and a report cursor.

## 5. Identity and hosted `entityId`

### 5.1 Canonical placement

For every promotable domain table:

- `row.entityId` is the canonical portable identity.
- For promoted rows, it equals the source row’s durable `entityId`.
- For pre-existing hosted rows, it is minted in hosted backfill.
- `promotionMappings.sourcePortableId` records promotion provenance.
- Do not add `sourcePortableId` to every domain row; that duplicates canonical identity and import metadata. The sidecar mapping is the authoritative provenance record.

Use table-prefixed IDs, as already supported by `mintEntityId(prefix)` ([shared/portable/ids.ts:74-82](../shared/portable/ids.ts#L74-L82)). Uniqueness is enforced per table through `by_entity_id` and guarded inserts.

### 5.2 Missing portable IDs

Promotion must not invent portable identity only in the hosted deployment. Doing so would make the “durable” identity depend on which promotion ran first.

Before export, a local workspace migration must:

1. Resolve the four semantic `entityId` collisions.
2. Mint and persist `entityId` for every existing local row that lacks one.
3. Bump the local workspace schema version.
4. Preserve those IDs in all future snapshots.

Preflight reports `MISSING_PORTABLE_ID` for an older snapshot and instructs the user to reopen it with a compatible local application. No hosted fallback minting is allowed in v1.

### 5.3 Idempotency and resume

The canonical snapshot digest is calculated over:

- normalized tables sorted by table and source local ID;
- attachment metadata sorted by attachment key;
- workspace ID and schema version.

It excludes `exportedAtISO` and the changes journal. Thus an unchanged workspace produces the same promotion identity even though it was exported at a different time.

Each pass-1 batch mutation:

1. Looks up the mapping by promotion, table, and source local ID.
2. If a mapping exists, verifies that the target row exists and has the expected `entityId`.
3. Otherwise inserts the target row and mapping in the same Convex transaction.
4. Marks the staged row complete only in that transaction.

A retry after an ambiguous network response therefore finds the mapping instead of reinserting the row.

Pass 2 and attachment finalization use the same check-before-write rule with source checksums and completion flags. State transitions use expected-state compare-and-set semantics so two clients cannot advance the run concurrently.

A different digest for the same workspace is a new promotion attempt. In v1 it cannot update a previous target: the previous incomplete target must be resumed or rolled back first.

## 6. Schema and reference manifests

### 6.1 Typed schema manifest

`convex/schema.ts` is composed from many imported table modules ([convex/schema.ts:1-30](../convex/schema.ts#L1-L30)), so scanning only that file is insufficient.

At build time, generate a versioned promotion schema manifest from the fully composed Convex schema validator JSON. The generator must emit:

- table name;
- complete validator tree;
- required and optional field paths;
- every nested `v.id()` path and target table;
- array, object, optional, and union structure;
- a deterministic schema fingerprint.

The generator must traverse nested arrays and objects. For example, typed references exist both directly and inside nested structures; simple textual field-name matching is not sufficient.

CI must fail if:

- the generated manifest differs from the checked-in artifact;
- a typed reference lacks a supported traversal rule;
- an importable table lacks an ownership classification;
- a hard required-ID cycle appears.

### 6.2 String reference manifest

The Convex schema cannot distinguish an internal ID held in `v.string()` from a name, external provider ID, token, or ordinary text.

Examples include:

- `sourceEvidence.targetTable` plus `targetId`, which is an explicit polymorphic internal reference ([convex/tables/meetingWorkflow.ts:208-229](../convex/tables/meetingWorkflow.ts#L208-L229)).
- `meetings.attendeeIds`, which is string-typed despite carrying record IDs in some paths ([convex/tables/meetings.ts:5-33](../convex/tables/meetings.ts#L5-L33)).
- `organizationRegistrations.representativeIds`, whose schema does not say whether each string is a record ID or a name ([convex/schema.ts:152-178](../convex/schema.ts#L152-L178)).
- `entityType` plus the semantic target currently called `entityId` in activity, notes, signatures, and custom fields.
- `sourceExternalIds`, provider IDs, Stripe IDs, and similar fields, which must not be rewritten.
- JSON strings such as `layoutJson`, `dataJson`, or source payloads, which may embed IDs but are opaque to the schema.

Add a manually reviewed `promotionReferenceManifest` with entries such as:

```ts
{
  table: "sourceEvidence",
  path: "targetId",
  kind: "polymorphic-internal",
  targetTableFrom: "targetTable",
  optional: true
}
```

Each relevant string field must be classified as one of:

- `internal-reference`
- `polymorphic-internal`
- `mixed-name-or-reference`
- `external-identifier`
- `opaque-json`
- `ordinary-string`

Reliability comes from this reviewed manifest, not from an `Id` suffix heuristic. CI may use suffixes to identify new candidates, but it must require an explicit classification.

Preflight should also compare every string value to the set of known local IDs. If a matching value appears outside a declared reference path, emit `UNCLASSIFIED_ID_LIKE_VALUE`. It must not rewrite it automatically.

Mixed fields such as `representativeIds` or potentially `attendeeIds` require a product decision. Until their semantics are made unambiguous, preflight should fail when a value matches a local ID rather than guessing.

Opaque JSON is not rewritten in v1. If it contains local IDs, preflight fails with a path-level error and recommends a dedicated versioned transformer.

## 7. Protocol

### 7.1 Snapshot preparation

Before contacting Convex, the local client:

1. Flushes outstanding local transactions.
2. Runs local workspace migrations.
3. Exports one immutable snapshot.
4. Verifies that exactly one source society is in scope.
5. Calculates the canonical digest.
6. Builds an attachment source inventory and tests whether each byte source is readable.
7. Keeps the snapshot immutable until promotion completes or is abandoned.

The snapshot’s changes journal is acknowledged in the report but excluded from promotion and digesting.

### 7.2 Hosted staging

The authenticated client calls `promotions.begin` with the workspace header, digest, expected chunk count, and dry-run flag. It uploads rows and attachment envelopes through bounded mutations.

Each chunk includes:

- promotion ID;
- sequence number;
- chunk checksum;
- rows grouped by table;
- no attachment bytes.

A repeated chunk sequence with the same checksum is accepted as idempotent. The same sequence with a different checksum fails the run.

`promotions.finishStaging` verifies that every expected chunk is present before changing the state to `preflighting`.

### 7.3 Preflight of the entire snapshot

Preflight has no domain-table or blob-storage side effects. It may write only promotion staging, issues, and progress.

Validation proceeds in this order:

1. **Envelope validation**
   - kind, workspace ID, supported local schema version;
   - one source society;
   - complete chunk set and matching digest.

2. **Table policy**
   - table exists in the deployed schema;
   - table is explicitly `import`, `transform`, `regenerate`, or `exclude`;
   - excluded tables containing rows produce a warning or error according to policy.

3. **Row identity**
   - nonempty local `_id`;
   - nonempty durable `entityId`;
   - no duplicate `(table, _id)` or `(table, entityId)`;
   - no collision with a different target row in the intended fresh society.

4. **Exact hosted shape**
   - strip only local system `_id` and `_creationTime`;
   - validate all remaining fields against the hosted validator;
   - reject missing required fields, wrong types, unknown fields, invalid nested shapes, and values over hosted limits;
   - interpret `v.id()` input values as source references during preflight rather than requiring them to already be Convex IDs.

5. **Ownership and tenant boundary**
   - every society-owned row resolves to the one source society;
   - no reference crosses to a second local society;
   - global/system tables follow their explicit policy.

6. **Reference integrity**
   - every typed reference resolves to a source row of the declared target table;
   - every declared string reference resolves according to the manual manifest;
   - optional absent references are accepted;
   - `_storage` references resolve through an attachment entry;
   - references to excluded rows fail unless an explicit resolver maps them to deployment-owned data.

7. **Dependency graph**
   - derive row-level hard and deferred dependencies;
   - detect uninsertable required cycles;
   - assign dependency layers.

8. **Attachment metadata and local readability**
   - envelope owner references exist;
   - source bytes are readable;
   - sizes and SHA-256 values are valid when supplied;
   - duplicate storage keys do not disagree on hash or metadata.

A preflight report has this shape:

```json
{
  "promotionId": "...",
  "snapshotDigest": "...",
  "schemaFingerprint": "...",
  "ok": false,
  "summary": {
    "tables": 42,
    "rows": 1840,
    "attachments": 37,
    "errors": 3,
    "warnings": 8
  },
  "issueCursor": "...",
  "errorsByCode": {
    "MISSING_REQUIRED_FIELD": 1,
    "UNRESOLVED_REFERENCE": 1,
    "UNCLASSIFIED_ID_LIKE_VALUE": 1
  }
}
```

A dry run stops here. A non-dry run may enter `ready` only when the error count is zero.

### 7.4 Pass 1: dependency-ordered inserts

Construct a graph edge `A → B` when a row in table A requires a row in table B before A can be inserted.

Reference handling during pass 1:

- Required scalar `v.id()` fields are rewritten using mappings from earlier dependency layers.
- Optional `v.id()` fields are omitted and deferred to pass 2.
- ID arrays may be inserted as empty arrays and deferred because `v.array()` permits an empty value.
- An optional enclosing object containing IDs may be omitted and deferred.
- A required nested object containing a required scalar ID creates a hard dependency.
- String-held references retain their source values temporarily and are rewritten in pass 2. This is safe only because the target society remains quarantined.
- `_storage` fields are deferred to the attachment phase.
- Non-reference data is inserted unchanged after hosted validation.
- `entityId` is inserted with the row.

Cycles are handled by strongly connected component analysis:

- Break a component by removing optional and deferrable edges.
- Use the selected runtime branch for union fields rather than treating every union alternative as simultaneously present.
- Fail preflight with `UNINSERTABLE_REQUIRED_ID_CYCLE` if an SCC still contains only hard scalar dependencies.

Existing schema cycles are expected to be breakable. For example, a society optionally references its primary registration and documents, while registrations and documents require the society ([convex/schema.ts:33-42](../convex/schema.ts#L33-L42), [convex/schema.ts:61-63](../convex/schema.ts#L61-L63), [convex/schema.ts:152-175](../convex/schema.ts#L152-L175)). Similarly, a meeting optionally references its minutes, while minutes require the meeting ([convex/tables/meetings.ts:31-33](../convex/tables/meetings.ts#L31-L33), [convex/tables/meetings.ts:75-78](../convex/tables/meetings.ts#L75-L78)).

The first production mutation creates the quarantined society and its verified Owner relationship atomically. It records the society mapping and `promotionRuns.targetSocietyId`. Subsequent layers run in bounded batches.

### 7.5 Attachment phase

After documents and document versions have native mappings:

1. Resolve each attachment’s source document and version through `promotionMappings`.
2. Read bytes through a source adapter:
   - Electron: workspace bridge and filesystem key;
   - browser: durable IndexedDB blob or self-contained data URL;
   - transient `blob:` URLs are accepted only if still readable in the current session;
   - unresolved or inaccessible sources fail the run.
3. Hash the bytes locally and compare with `LocalAttachmentEnvelope.sha256`.
4. Request a hosted upload target.
5. Upload bytes directly to Convex storage or RustFS; do not send file bytes through a mutation/action argument.
6. Record the returned hosted key or `_storage` ID in `promotionAttachments`.
7. Verify size and SHA-256 by hosted read-back when the provider supports it.
8. Mark the attachment complete only after verification.

For RustFS, use a deterministic key derived from the promotion, mapped society/document IDs, version, and sanitized file name. Existing hosted upload code already uses society/document/version-based keys and direct client PUTs ([convex/providers/storage.ts:27-35](../convex/providers/storage.ts#L27-L35), [convex/documentVersions.ts:32-71](../convex/documentVersions.ts#L32-L71)).

For Convex `_storage`, save the ID returned by the upload response. Pass 2 rewrites document or branding storage fields using that ID.

If hosted read-back hashing is unavailable, v1 should either:

- require a provider-supported checksum, or
- mark the upload `client_verified_only` and require an explicit product acceptance of that weaker guarantee.

Orphaned uploaded blobs remain associated with the promotion run and are deleted during rollback.

### 7.6 Pass 2: rewrite and final validation

For each staged row:

1. Load the source row, mapping, and reference manifest.
2. Traverse the exact validator path.
3. Rewrite every present typed `v.id()` using `(targetTable, sourceLocalId)`.
4. Rewrite every declared internal string reference.
5. Resolve polymorphic targets through the declared discriminant mapping.
6. Replace local storage provider/key fields with hosted attachment mappings.
7. Rebuild deferred arrays and optional nested objects.
8. Validate the complete resulting document against the deployed hosted validator.
9. Patch only the required fields.
10. Mark `pass2Complete` in the same transaction.

The rewriter never searches and replaces arbitrary strings.

### 7.7 Reconciliation and publication

Before completion:

- every staged import row has exactly one mapping;
- every mapping points to an existing target row;
- target `entityId` equals `sourcePortableId`;
- every imported row passed final schema validation;
- every declared reference contains a native target ID;
- every required attachment is uploaded and verified;
- inserted and rewritten counts equal preflight counts;
- no unresolved issue remains;
- the schema fingerprint still matches the preflight fingerprint.

If the deployed schema changed mid-run, set `failed` with `SCHEMA_CHANGED_DURING_PROMOTION`. The run must be re-preflighted; it must not continue under the old plan.

Only after reconciliation does the system mark the society visible and the run `complete`.

## 8. Execution environment

### Recommendation: client transport plus resumable Convex mutation pipeline

Use the client only for capabilities that must remain local:

- snapshot capture;
- file access;
- hashing;
- bounded staging calls;
- direct blob uploads;
- displaying progress.

Use Convex mutations and scheduled internal mutations for:

- staging metadata;
- full-snapshot preflight;
- promotion state transitions;
- inserts and mapping creation;
- reference rewriting;
- reconciliation;
- rollback.

Do not use one long-running action as the promotion coordinator. Actions are non-transactional, do not automatically retry side effects, and time out after ten minutes ([Convex actions](https://docs.convex.dev/functions/actions)). A server action also cannot read Electron’s local filesystem.

Do not make the client the authority for pass progression. A disconnected client must not lose mapping state or cause duplicate inserts. Once staging and required file uploads are present, scheduled internal mutations should be able to finish the database phases.

### Batch and limit policy

As of this design, Convex documents are limited to 1 MiB, function arguments to 16 MiB, Node action arguments to 5 MiB, and mutations have per-transaction read/write and execution limits ([Convex limits](https://docs.convex.dev/production/state/limits)).

Use deliberately lower application limits:

- maximum 100 rows per staging or import batch;
- maximum encoded argument size of 512 KiB;
- maximum staged row size of 900 KiB including envelope;
- adapt batch size downward using encoded Convex size;
- one mutation transaction per batch;
- attachment bytes never pass through function arguments.

Progress is persistent and queryable by phase, table, dependency layer, row count, byte count, and attachment count.

## 9. Hosted `entityId` migration

Promotion must not begin until every v1-importable table accepts canonical `entityId`.

### H0. Resolve existing semantic collisions — M

1. Add `subjectId` alongside the existing semantic `entityId` in the four collision tables.
2. Add replacement indexes using `(entityType, subjectId)`.
3. Dual-read `subjectId ?? entityId`.
4. Backfill `subjectId` from the old value.
5. Switch all writers and readers to `subjectId`.
6. Repurpose `entityId` as durable row identity.
7. Mint durable IDs for existing hosted and local rows.
8. Require `subjectId` where the old semantic field was required.
9. Bump local workspace schema version.

Estimated effort: 4–7 engineer-days.

### H1. Add optional durable IDs to roots and high-fan-in tables — M

Start with:

- `societies`
- `users`
- `documents`
- `members`
- `directors`
- `meetings`
- `minutes`
- `grants`
- `roleHolders`
- other tables identified as frequent `v.id()` targets

Add optional `entityId` and staged `by_entity_id` indexes. Keep application behavior unchanged.

Estimated effort: 4–7 engineer-days.

### H2. Add IDs to remaining v1 society-owned tables — L

Mechanically add optional `entityId` and staged indexes to every table classified `import` in the v1 ownership manifest. Promotion control tables receive their own identity and indexes as part of their creation.

Global, cache, and excluded operational tables can be migrated later unless normal hosted insert paths begin using the portable adapter.

Estimated effort: 8–12 engineer-days.

### H3. Backfill existing hosted rows — M

Use cursor-based internal mutations:

1. Scan one table in bounded pages.
2. Mint a table-prefixed `entityId` only when missing.
3. Persist cursor and counts.
4. Detect duplicate existing values and write a conflict report.
5. Resume safely after interruption.
6. Backfill high-fan-in tables before their dependents.

Do not derive `entityId` from native `_id`; that would make the durable ID deployment-specific.

Estimated effort: 4–7 engineer-days, excluding elapsed deployment time.

### H4. Enable indexes and enforce writes — S/M

After backfill:

- enable staged indexes;
- update every hosted and local insert path to ensure an `entityId`;
- add CI checks against missing IDs;
- make `entityId` required table-by-table once production verification shows no missing rows.

Estimated effort: 2–4 engineer-days.

## 10. Existing-target and merge policy

### V1 policy: refuse

A promotion must create its own new society. It must not accept a caller-supplied existing society ID.

This avoids ambiguous decisions about:

- duplicate people, documents, memberships, or registrations;
- conflicting natural keys;
- role and user reconciliation;
- deletion or overwrite precedence;
- attachment replacement;
- external connection ownership;
- partial rollback after existing users begin writing.

A “fresh society” means one created by the promotion run and still quarantined. A manually created but apparently empty society does not qualify.

### Possible later merge policy

If merge is added later:

- match only by durable `entityId`, never only by name/email/title;
- default to conflict rather than overwrite;
- define per-table `insert`, `upsert`, `append`, `regenerate`, and `refuse` policies;
- produce field-level conflicts before applying anything;
- maintain a compensating change log;
- make rollback a separately authorized operation.

## 11. Authorization and safety

### 11.1 Trusted-principal dependency

The current hosted design accepts and trusts caller-supplied `actingUserId` in many paths ([docs/trusted-principal-proposal.md:11-19](trusted-principal-proposal.md#L11-L19)). Hosted Convex authentication is not currently wired to a verified identity ([docs/trusted-principal-proposal.md:32-47](trusted-principal-proposal.md#L32-L47)).

Therefore:

- The promotion data model, preflight, manifest generation, and internal pipeline are independent implementation work.
- Internal tests and operator-only development invocations may precede trusted-principal rollout.
- **End-user production promotion is blocked on trusted-principal hosted JWT derivation and society-creation authorization.**
- No promotion endpoint may authorize using `actingUserId`.

The intended principal design requires a runtime-derived JWT identity and explicitly prohibits caller override ([docs/trusted-principal-proposal.md:3-7](trusted-principal-proposal.md#L3-L7)).

### 11.2 Authorization rules

A user principal may:

- create a promotion run for itself;
- inspect and retry only its own run;
- create exactly one new society through that run;
- become the verified first Owner through the atomic society-creation operation.

A service principal must carry a dedicated `promotions:create` or `promotions:admin` scope.

Promotion must not import local `authProvider`, `authSubject`, session state, or email verification as trusted identity. The trusted-principal proposal also requires the first hosted Owner to be created atomically for the verified principal ([docs/trusted-principal-proposal.md:210-219](trusted-principal-proposal.md#L210-L219)).

Other local users should be sanitized and imported as unbound `Invited` or `Disabled` users. Binding a source user row to the initiating hosted principal requires an explicit product decision.

### 11.3 Dry run

Dry run:

- uploads and validates snapshot metadata;
- checks graph integrity;
- reads and hashes local files;
- produces the complete paginated report;
- performs no domain inserts or hosted file uploads;
- expires staging data after a retention window.

Dry-run success is not permanently valid. A real run must recheck snapshot digest and hosted schema fingerprint.

### 11.4 Sensitive and operational data

V1 excludes:

- API token hashes and API clients requiring credentials;
- provider secrets and vault contents;
- authentication subjects and sessions;
- billing/subscription provider state;
- webhooks and external synchronization cursors;
- Paperless, Wave, AI, and similar connection configuration;
- pending outbound messages and scheduled side effects;
- transient caches, logs, notifications, and import sessions.

Excluded rows are reported. They are not silently dropped.

### 11.5 Rollback

Because v1 creates a quarantined society, rollback is a resumable delete job:

1. Stop further promotion work.
2. Delete uploaded blobs recorded in `promotionAttachments`.
3. Delete mapped target rows in reverse dependency order.
4. Delete the target society and promotion-created Owner relationship.
5. Retain a minimal tombstone/report for audit, or delete control rows after the retention period.
6. Mark the run `rolled_back`.

The mapping table—not a `societyId` scan—is the source of truth for deletion, because some rows may not carry `societyId`.

If the society has been published and accepts post-promotion writes, automatic rollback is no longer safe. The available options are a separately authorized whole-society deletion workflow or no rollback. There is no generic rollback for a future merge into an existing society without a compensating change log.

## 12. V1 scope cuts

### Included

- One local workspace containing exactly one society.
- One-way promotion into a promotion-created society.
- Explicitly allowlisted society-owned record tables.
- Exact hosted schema validation.
- Canonical durable IDs.
- Typed reference rewriting.
- Reviewed string-reference rewriting.
- Electron attachment files.
- Browser attachments only when bytes are durably readable.
- SHA-256 and size checking.
- Dry-run report.
- Persistent progress and mapping.
- Manual resume/retry.
- Rollback while the target remains quarantined.

### Excluded

- Existing-society merge.
- Two-way sync.
- Incremental promotion after completion.
- Changes-journal import.
- Deleted-row or historical mutation reconstruction.
- Automatic field coercion or silent field stripping.
- Rewriting arbitrary JSON strings.
- Guessing whether mixed string values are IDs.
- External provider credentials or connections.
- Replaying emails, workflows, notifications, scheduled jobs, or other side effects.
- Automatic background retries without an operator/user command.
- Cross-workspace or multi-society bundles.
- Large-file streaming IPC; v1 uses the current whole-file Electron read path and therefore needs an explicit file-size cap.

## 13. Implementation order and estimates

Sizing convention:

- **S:** 1–3 engineer-days
- **M:** 4–7 engineer-days
- **L:** 8–15 engineer-days

| Order | Stage | Size | Estimate | Deliverable |
|---|---|---:|---:|---|
| 1 | Product decisions and table ownership classification | M | 4–7 days | Import/exclude/regenerate policy; user and file policies |
| 2 | Resolve four `entityId` collisions | M | 4–7 days | `subjectId` migration; unambiguous durable identity |
| 3 | Local ID migration and export hardening | M | 4–7 days | All local rows persist portable IDs; new workspace schema version |
| 4 | Hosted `entityId` columns, backfill, and indexes | L | 10–15 days | IDs on all v1 tables; resumable hosted backfill |
| 5 | Generated schema manifest and reviewed string-reference manifest | L | 8–12 days | Validator graph, schema fingerprint, CI classification checks |
| 6 | Staging, preflight, report, and dry run | L | 8–15 days | Whole-snapshot validation with paginated issues |
| 7 | Pass-1 insert and persisted mapping pipeline | L | 8–15 days | Dependency layers, cycles, idempotent inserts, progress |
| 8 | Attachment transport and verification | M/L | 5–10 days | Electron/browser source adapters; RustFS/Convex mapping |
| 9 | Pass-2 rewriter and reconciliation | L | 8–12 days | Typed/string reference rewrite and publication gate |
| 10 | Auth integration, quarantine, and rollback | M/L | 6–10 days | Principal authorization, fresh society lifecycle, cleanup |
| 11 | UI, fault injection, and rollout hardening | M/L | 6–10 days | Progress/retry UI, fixtures, failure-boundary tests |

Estimated promotion-specific total: approximately **12–20 engineer-weeks for one engineer**, depending primarily on the number of v1-importable tables and ambiguous string/JSON fields.

The trusted-principal proposal estimates its broader migration separately at roughly 5–8 engineer-weeks ([docs/trusted-principal-proposal.md:324-335](trusted-principal-proposal.md#L324-L335)). Only its hosted identity, society creation, and scoped authorization stages are hard release dependencies for promotion; the rest may proceed concurrently.

## 14. Required tests

- Generated schema manifest matches the deployed schema fingerprint.
- Every v1 table has an ownership policy.
- Every typed `v.id()` path is classified and traversed.
- Every ID-like string field is explicitly classified.
- Golden preflight reports for missing fields, wrong types, unknown fields, broken references, mixed string references, and file failures.
- Required/optional cycle fixtures, including society-registration-document and meeting-minutes cycles.
- Fault injection before and after every row insert, mapping insert, attachment upload, pass-2 patch, and state transition.
- Retry after an ambiguous client timeout produces no duplicates.
- Same workspace with a different digest cannot mutate the first target.
- Schema fingerprint change halts the run.
- Cross-society references fail preflight.
- Forged `actingUserId` has no effect.
- Local auth subjects, API tokens, and credentials are never promoted.
- Rollback deletes exactly the rows and blobs recorded by the run.
- Completed reconciliation proves there are no unresolved declared references or local storage keys.
- Browser and Electron attachment-source failure modes are covered independently.

## 15. Decisions needed

1. **`entityId` collision migration:** approve renaming the existing semantic target field to `subjectId`. This is required before durable identity can be universal.

2. **V1 table allowlist:** decide which society-owned tables are records of truth and which are operational, cached, regenerated, or unsupported.

3. **Local users:** decide whether the initiating principal claims one selected local user row or receives a new hosted Owner row while all source users become unbound invitations.

4. **Mixed string fields:** define whether `meetings.attendeeIds`, `organizationRegistrations.representativeIds`, `relatedShareholderIds`, `controllingIndividualIds`, and similar fields contain internal references, names, external IDs, or a deliberately mixed representation.

5. **Opaque JSON:** decide which JSON fields require versioned ID-aware transformers. V1 recommendation: refuse ID-bearing opaque JSON rather than rewriting it heuristically.

6. **Browser attachments:** decide whether browser-local promotion supports only durable IndexedDB/data-URL bytes, or whether attachment byte persistence must be implemented before browser promotion is advertised.

7. **Maximum file size:** select a v1 cap compatible with the current Electron whole-file `ArrayBuffer` read. Larger files should wait for streaming IPC.

8. **Hosted storage target:** choose whether document versions use RustFS, Convex `_storage`, or deployment configuration. The promotion attachment mapping supports either, but integrity verification differs.

9. **Upload verification:** decide whether client-only SHA-256 verification is acceptable where hosted read-back hashing is unavailable. Recommendation: require end-to-end verification for v1.

10. **Excluded-row behavior:** decide which excluded operational tables produce warnings and which make preflight fail. Credentials and authentication bindings should always be hard exclusions.

11. **Quarantine visibility:** define the application-level mechanism that keeps a promotion-created society out of normal membership and society queries until completion.

12. **Staging retention:** set retention periods for failed/dry-run staging rows, issue reports, and rollback tombstones.

13. **Post-publication deletion:** decide whether the product offers a separately authorized whole-society deletion workflow. It is not part of promotion rollback.

14. **Future merge:** confirm that merge remains out of v1. If later approved, it requires a separate per-table conflict and compensation design.