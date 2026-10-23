# Procurement incremental processing and rollout findings

This handoff covers the October 22 production rollout, the follow-up checks on the local Zoer instance, measured resource use, and the remaining opportunities to reduce work. Zoer/files remains responsible for collection and normalization, SharePoint holds immutable publications and original documents, and Societyer serves bounded pages and analytical results from Convex. The immediate efficiency goal is to reuse unchanged inputs at each stage and send only verified changes downstream.

The [October 23 journal and analytics rollout](procurement-journal-analytics-2026-10-23.md) implements the per-record journal, projection reuse and upstream default summaries discussed below. It records the subsequent production measurements and remaining fallback costs.

Dates in execution evidence are UTC. The rollout crossed midnight into October 23 UTC while it was still October 22 in Vancouver.

## What the 51258 updates mean

The rollout changed the projection schema and added normalized money, buyer mapping, review lineage, quality fields, and other analytical inputs. There were **25,629 existing notices**, comprising 3,752 opportunities and 21,877 awards. Each has a list row and a detail row in the hosted reader:

| Serving operation | Count |
| --- | ---: |
| Update existing list rows | 25,629 |
| Update existing detail rows | 25,629 |
| Insert new notices | 0 |
| Archive notices | 0 |
| Change document or evidence rows | 0 |
| Total operations | 51,258 |

These were projection updates, not 51,258 collection requests, document downloads, or model reviews. The source was the retained October 18 archive. A deliberate schema or parser backfill can touch every projection once; ordinary publications compare stable keys and payload hashes and apply only changed rows. Comparing or hashing an input still costs local work even when it produces zero serving updates.

## Responsibilities and reuse boundaries

| Stage | Input and output | Work that should trigger processing |
| --- | --- | --- |
| Source discovery | Source listing to stable notice identities | Newly seen identities, source changes, or due refresh checks |
| Detail capture | Source page to factual notice content | New or changed notices, stale capture versions, failed capture, or explicit refresh |
| Document acquisition | Source attachment to content-addressed bytes | New or changed attachment content or missing bytes |
| Text extraction | Document hash and extractor version to text | Changed bytes or extractor version; retry failed extraction |
| Review preparation | Notice facts, chosen documents and preparation version to bundle | Changed review inputs; collection bookkeeping should not change the bundle |
| Model review | Bundle, instructions, model and configuration to result | Missing current successful result, changed dependencies, failed work or explicit force |
| Publication preparation | Verified snapshot, profile and projector to compact artifacts | Changed snapshot bytes, projection contract or projector code |
| Serving import | Verified baseline and target inventories to mutations | Insert, changed payload, or coverage-authorized archive |
| Analytics | Publication, metric version, mapping, filters and clock to result | Missing or expired matching result, changed analytical inputs or time basis |

A newly observed timestamp is useful collection evidence, but it is not by itself new procurement content. Source facts and uncertainty must remain visible. A source revision that changes relevant facts, a new document, or changed review instructions must still invalidate affected results. Missing input is never equivalent to an empty collection.

## Production implementation completed

The [DDC North procurement reader](https://societyer-ddcnorth.pages.dev/app/procurement-review/home?section=analytics) now uses publication-scoped server summaries, 50-row party directories and award drill-downs, complete deterministic current-review selection, explicit quality disclosures, and separate source/publication/serving status. Ordinary browsing and requested documents remain separate bounded requests. The hosted browser no longer assembles the whole analytical catalog or downloads SQLite for charts.

The shared contract now carries strict money parsing and raw provenance, stable source identities, proposed buyer mappings, review lineage, consistent lifecycle rules and a shared clock. Buyer labels are proposals rather than verified legal entities. Coverage remains incomplete where the retained source does not establish completeness. Unknown contract or justification fields remain distinct from confirmed missing values.

Import preflight verifies every required table, explicit empty files, counts, byte sizes, checksums, references and archive eligibility. Missing or corrupt input fails before locking or changing the serving catalog. Incremental deltas bind the exact base and target inventories, validate previous payload hashes, and preserve replay-safe batch receipts.

Publication now has a durable destination lease, conditional manifest commit, bounded Graph retries and upload recovery, independent source and serving receipts, progress and exact-run resumption. Old source archives and document objects are retained. The operator can reuse its authenticated Convex client rather than spawning a new CLI for each batch, while keeping the same transaction bounds and digests.

The collector's strict amount parser preserves original values and rejects ambiguity. Stable identity reconciliation preserves physical IDs and existing links; unresolved legacy identities remain explicit. Its award importer builds one bounded identity inventory per action/revision rather than rescanning the entire award catalog for each row.

## Rollout and correctness evidence

| Item | Verified state |
| --- | --- |
| Societyer deployment | Convex `industrious-cricket-610` |
| Pages production | `6d165f76-e03e-40f3-8ffa-33ba1de74dde` |
| Frontend build | `ad77d67baa676153bdceeaa0e9a1e7b131d365a8` |
| Operator release | `codex/procurement-production-20261022`, commit `962ea2396646d65c27a6bfcc89e37de8560d28bb` |
| Source archive | `20261018T170258Z-1138c2082de4`, 481,095,680 bytes |
| Source SHA256 | `1138c2082de44e7c77f938f4b87ce2ac74a514899a5fd2cb61982754101f1fe1` |
| Normalized publication | `20261018T170258Z-1138c2082de4-d4c00b146763ea09` |
| Serving generation | Publication ID plus `-reader-v2` |
| Target content hash | `5cac6909c0e861e92ad7f0e1b93931a92f04b0ef7da5b521540a7ed5fb89a242` |
| Target inventory hash | `ca7119238f95cc73670082689d5fbbae829e8d08e53bf82621fe7d44ba65223b` |
| Serving tables | 25,629 lists; 25,629 details; 2,371 document references; 91 evidence rows |
| Shared taxonomy | 89,972 terms |
| Collection time and coverage | Unknown collection time; incomplete coverage retained honestly |

Independent Python and TypeScript validation agreed. Signed-in desktop and 390 by 844 browser checks covered every analytical section, period comparison, quality, directories, bounded drill-down, compact-reference search, ordinary lists, source/serving timestamps and an original SharePoint PDF. Browser observations showed bounded Convex requests and no SQLite catalog transfer.

During the later idle-tab check, the page displayed an authorization error. Its Retry control restored the existing session and the same overview without another sign-in. Idle token refresh deserves a separate reliability check; this observation does not establish a cause in the publication pipeline.

The overview reconciled to 13,231 included awards, CAD 34,396,825,201.89 total recorded award value, CAD 200,000 median, 296 proposed buyer groups and 5,200 suppliers. The Transportation chart and its drill-down both matched 930 awards.

Source quality remains relevant to both interpretation and efficiency. Of 21,877 awards, 12,215 had contract-based identities and 9,662 retained explicitly unresolved legacy identities. Buyer mapping produced 296 proposed groups; 830 award mappings needed review. Contract-number information was unavailable for 8,584 awards and justification information for 16,646. These absences must not trigger repeated attempts to invent missing facts. Supplier canonical IDs are not supplied by the current source.

The initial in-place backfill protected readers for **22 minutes 15.264 seconds**, from 00:04:43.108 to 00:26:58.372 UTC. The first transport committed 11,120 operations; the persistent client resumed the same run for the remaining 40,138 operations. All 1,282 batches completed. The new transport preserved the exact 40-row batch boundaries and byte budgets. It improved throughput without introducing concurrent writes.

## Usage after the rollout

The [Convex dashboard](https://dashboard.convex.dev/t/ahmad-jalil/settings/usage?projectSlug=societyer-ddcnorth) uses the October 18 to November 18 UTC billing window and combines this project's production and development environments. The refreshed observation was captured at **2026-10-23 01:11:13 UTC**. Counters are rounded and delayed; unrelated project traffic continues between observations.

| Dashboard metric | Last immediate observation | Refreshed observation | Displayed change |
| --- | ---: | ---: | ---: |
| Function calls | 123K | 130K | About +7K |
| Action compute | 0.15 GB-hours | 0.19 GB-hours | +0.04 GB-hours |
| Database I/O | 3.66 GB | 4.46 GB | +0.80 GB |
| Data egress | 50.06 MB | 51.9 MB | +1.84 MB |
| Database storage | 2.12 GB | 1.34 GB | -0.78 GB |
| Search storage | 64.63 MB | 19.06 MB | -45.57 MB |
| Search queries | 0.36612 Query-GB | 0.36612 Query-GB | No displayed change |
| Convex file storage | 0 B | 0 B | No change |
| Deployments | 14 | 14 | No change |
| Convex AI Gateway | $0.00 | $0.00 | No displayed change |

Usage did change. The table does not isolate the price of the backfill or attribute storage decreases to the latest test. Previous generation retirement and delayed metering affect the comparison. Convex AI Gateway is also not a measurement of model spending through other providers. Cloudflare Pages showed no Functions data and had Web Analytics disabled, so its display does not establish zero traffic.

### Direct execution measurements

| Measurement | Observed result |
| --- | --- |
| New overview input | 21,877 rows, 44 bounded pages, 45,989,492 serialized bytes |
| Overview time from reservation to ready | 18.376 seconds cold |
| Overview result | 56,292 bytes |
| Largest default result | Trends, 82,175 bytes |
| Decisions input | 25,720 rows, 53 pages, 53,489,867 bytes |
| Analytical input budget | 64,000,000 bytes; Decisions uses about 84 percent |
| Ten observed analytical jobs | All succeeded; no retries or conflicts |
| Cold page database reads | 65,491,986 bytes across 53 pages |
| Cached input pages | 360 pages, zero additional database reads; internal transfer still occurs |
| Node computation in that observation | 166.50 seconds at 512 MB |
| Observed import slice | 66 batches in 56.2 seconds, about 47 operations per second |

Small browser responses do not mean small server work. Cold analytical jobs still read substantial input, and each distinct uncached filter can require another computation. The current cache reduces database reads but still moves cached input internally. The Decisions input is already close enough to its budget that upstream aggregation and slimmer analytical rows are the next significant improvements.

A later bounded 500-event observation from 00:31:59 to 01:13:06 UTC showed cached reading with zero database writes and no new analytical computations. All ten target analytical jobs remained ready. One unauthenticated analytics request was correctly rejected before writing. The broader health view also contained two import concurrency-retry warnings during the rollout; the zero-conflict statement in the earlier measurement applies only to its sampled execution window.

## Verified unchanged publication test

At 01:16 UTC, an isolated copy of the sealed current export was planned against the last successful normalized baseline. It produced **zero operations** with identical base and target inventory hashes. The existing operator then checked the actual production serving pointer under a read-only network guard. It made one serving-state query, plus an existing-login authorization exchange, and made no mutations, imports, gate changes or analytical jobs. The ready receipt retained the original 00:26:58.372 UTC activation time.

This proves an exact repeat can avoid the 51,258-row backfill entirely. The operator still validates the local artifacts, which costs local scanning. A genuinely new publication with changed source metadata must continue to update honest source/serving receipts; skipping it merely because some notice payloads match would be incorrect.

### Reusing prepared companion artifacts

The local Zoer publishing CLI now caches verified compact preparation by source SHA256 and byte count, snapshot identity, canonical profile hash, projector version/code hash and preparation implementation hash. It verifies every cached compressed part. A second sealed receipt binds prior remote byte verification to the exact drive, folder, manifest, item ID, ETag, size and content hash. Missing or changed remote versions require read-back; corrupt local files, symlinks or receipts are rejected.

An exact same-source companion repeat preserves its publication ID, original published timestamp and manifest SHA. It skips SQLite projection, taxonomy normalization, compression, companion uploads and pointer replacement. The optional activation callback remains available to recover a source publication whose serving activation was interrupted. Such recovery still uses the destination lease and exact source-pointer fence; it is different from a read-only repeat.

| Real retained-source test | Cold preparation | Repeat with verified cache |
| --- | ---: | ---: |
| Elapsed time | 34.93 seconds | 5.26 seconds |
| Notices normalized | 25,629 | 0 |
| Compact bytes downloaded for verification | 10,022,748 | 0 |
| Graph writes | 0 | 0 |
| Graph metadata/read requests | 6 | 6 |

This read-only test against the existing SharePoint publication was about **85 percent faster** on repeat. Both runs verified the actual 481 MB source SHA; the repeat also hashed the roughly 10 MB local compact cache. It did not apply a new source publication or call the serving activation callback. A fresh full-source publication still snapshots/compresses the whole SQLite catalog, and changed archive bytes or projection code currently cause all notices and taxonomy to be projected locally again. Only the changed serving rows are sent to Convex. Per-record preparation reuse needs a source change journal; it is not implemented by this cache.

### New and changed items already in the collector

A read-only copy of the current collector catalog was streamed directly to private local storage. Its before, after and local SHA256 values all matched `a9dc2cae099257cb5c4b1828f9d12e1f11eec3bae84a0951bbc701297ea1d7f3`; SQLite quick_check passed. Compared with the retained October 18 archive:

| Source rows | New | Updated | Unchanged | Removed |
| --- | ---: | ---: | ---: | ---: |
| Opportunities | 3 | 1 | 3,751 | 0 |
| Awards | 0 | 0 | 21,877 | 0 |

The new opportunities are `234981` (TA1490 Findley FSR - Morice), `235048` (Mobile MRI Rental trailer for Interior Health), and `235069` (PS-26-07). Opportunity `224427` (Team With Us - Digital Service Resources) has changed commodity/detail-capture fields. Eight opportunity-classification rows were added; all 89,972 taxonomy terms stayed unchanged. This is a comparison of records already collected, not a new source collection or a publication to Societyer.

Using the same pinned normalizer and profile as production, the compact comparison needs **eight serving operations**: four list upserts and four detail upserts. Documents, evidence and taxonomy remain unchanged, and there are zero archives. The three new opportunities and one updated opportunity account for every operation. Comparison artifacts are explicitly unpublished and have no usable activation file; this test does not advance the production source pointer.

Independent Python and TypeScript planners produced byte-equivalent delta manifests, and Societyer's fully local apply dry-run passed. The comparison activation file is retained as `activation.local-comparison.json` so the normal apply command cannot consume it accidentally. The publisher's 52 tests passed with 369 assertions and its scoped strict TypeScript check passed.

## Local Zoer review preparation update

The local/main backend now runs `docker.io/zoer-local/backend:dev-procurement-incremental-1792718467-3d878d5`, based on the exact prior deployed image. The scoped source commit is `3d878d5d8707c48cca137892b29030a09d39e2de`, on `codex/procurement-observation-fingerprint`. Only `backend/src/procurement/prepare.ts` was overlaid in the runtime; its SHA256 is `97d5b704de98d59fcdd61b0ee9dd5f58b5a410c09335f667d0ca1e5aef62b1df`. The frontend, collector plugin 0.35.4, dependencies, browser runtimes and persistent storage were retained. The saved OTE backend image tag was updated for later deployments.

The change excludes known observation timestamps and collection-run IDs from rendered notice evidence, excludes CanadaBuys daily-feed filename/hash/HTTP timestamps only for that connector, and removes capturedAt only from the two known collector-owned provenance paths. Real source URLs, source facts, published revisions, unknown provenance and identically named fields inside raw source data remain evidence. Recognized collector-derived revision digests no longer duplicate the facts already rendered; unrecognized or actual published revisions remain visible.

Twenty-nine preparation and pipeline tests passed with 249 assertions. The pipeline proof made two model calls initially, zero after an observation-only refresh, two when explicitly forced, and one after a real notice change while reusing its unchanged document. Failed work remained retryable, retained its failed history, and reused the later successful result on repeat. The exact target image passed a full backend TypeScript check with a 3 GB memory cap.

On the qualified actual collector copy, the old/new renderer comparison changed 2,900 opportunity renderings and zero award renderings, removing 461,824 bookkeeping characters. These are characters, not measured model tokens or billed usage. Previously processed affected notices can have a one-time canonical bundle change when explicitly processed again. No historical evidence, offsets or results were rewritten and no automatic bulk rerun or migration was started. Subsequent observation-only refreshes reuse the canonical input.

The source collector already has targeted and missing-detail modes that select new, changed or stale capture-version rows, and enrichment writes only changed derived fields. Its explicit full scrape intentionally captures all current details; use a targeted mode for routine checks. This update changes review-input reuse rather than silently changing the meaning of a full scrape.

The runtime used the normal maintenance drain and safe-restart check: zero active, paused or blocking workflow steps and zero worker pods. The backend and isolated-worker image changed together; health and exact source hashes passed before maintenance resumed zero steps. An operator qualification-receipt error stopped the initial attempt before any restart; the corrected qualification bound the full commit, source hash and tested image digest before activation.

At 01:27:22 UTC, the same bounded proof ran inside the deployed image against real CanadaBuys, BC Bid and bids&tenders rows. Each kept the identical rendered-text hash and triage bundle ID for observation-only in-memory changes, and changed both for a factual content change. It made zero model calls and zero catalog writes. The full catalog SHA256 matched before and after deployment, as did all six checkpoint hashes, all 139 batch hashes and every collector package file. SQLite quick_check passed. The complete 1,303-run workflow inventory remained terminal, including the same 226 collector runs; there were no active/queued collector runs or worker pods. The new backend was ready with zero restarts. The browser Procurement page loaded successfully afterward with the same 3,755 saved opportunities and existing coverage.

## Efficiency priorities

1. **Keep change detection before expensive work.** Compare factual content and dependency fingerprints before document extraction, bundle preparation or model calls. Retain separate observation timestamps and counters. Failed or explicitly forced work must remain eligible.
2. **Reuse verified publication preparation.** Bind the cache to actual archive bytes, the profile, projector version/code and every output-affecting option. Revalidate cached artifacts. Preserve the existing immutable publication on an exact repeat so an unchanged run does not reupload the companion, activate a new generation or warm nine analytical jobs.
3. **Persist a source change journal.** Track stable identity, factual revision, document hashes and affected stages. Coalesce repeated observations into one pending revision. Consumer checkpoints must advance only after durable success, with explicit tombstones limited by complete source coverage. This is a future optimization, not a replacement for current integrity validation.
4. **Precompute common analytics in Zoer.** Publish verified overview, trends, party rankings, quality, comparison inputs and decision coverage with the same metric version, currency rules, mapping version, coverage and as-of time used by Societyer. Import small aggregate records and keep bounded drill-downs over notice rows. Use exact recomputation for medians and distinct counts; bucket totals cannot generally be added to produce those metrics.
5. **Reduce preparation inputs.** Publish a dedicated analytical projection rather than complete detail payloads. Keep full descriptions, source JSON, text and historical reviews in the archive/detail path. Measure whether the 53.49 MB Decisions input falls comfortably below its limit.
6. **Batch source persistence.** Zoer's catalog persistence can serialize and fsync the full database after each changed outer transaction. Coalesce bounded writes and checkpoint batches rather than persisting after every field. A local synthetic benchmark showed batching benefits, but it is not a production latency measurement.
7. **Keep ordinary updates small.** Retain the last successful export as the next baseline, reuse content-addressed documents/taxonomy and apply only changed rows. Keep immutable rollback evidence. A brief guarded pause remains part of in-place imports; continuous availability would require staged independent serving generations and additional storage/writes.

## Recovery and operating lessons

An interrupted in-place delta must resume with the exact same immutable inputs and batch receipts. Removing its read gate would expose mixed publications. Pointing at an old logical publication does not undo changed physical rows. Restore procurement from the verified backup into a **fresh unused generation** when rollback is actually needed; the [operator runbook](procurement-convex-catalog.md#retention-and-rollback) contains the guarded procedure.

The first collector upgrade used clean source `1d9d522a2d759bca9725df215c93a5b6f26eb329`, based on the exact previously installed `feb431b6` source. Building from the older dirty files checkout would have omitted deployed fixes. The plugin became version 0.35.4 with no new permissions, hosts or capabilities. Its full 485,482,496-byte catalog hash and all 139 batch/checkpoint hashes matched before and after the upgrade. No collection or resume was issued. Paused work stayed paused.

A verification helper incorrectly JSON-serialized a 485 MB Buffer inside the collector pod and caused an OOM restart at 00:15:49 UTC. Health returned by 00:15:54. It issued no catalog writes; SQLite quick_check, counts and prior workflow state checks passed afterward. No pre-incident byte hash existed, so equality across that restart is not claimed. Subsequent checks used streaming hashes and bounded SQL, and the plugin upgrade caused no additional restart. Large binary data must never be returned as JSON through an inspection helper.

The local/main Zoer instance is `https://zoer.k8s.overtheedgepaper.ca`, an internal hostname managed by Proxmox-Playbook and the OTE kubeconfig. `zoer.k8s.ahmad.sh` is a different environment. Preserve active/paused work and exact deployed source when updating. Publisher CLI changes run locally and do not require a backend image rollout; changes to hosted review preparation do require a scoped backend rollout.

## Retained evidence and related runbooks

Private source exports, database backup, immutable receipts, normalized baseline/target inventories, plugin packages, source bundle, checkpoint comparisons and recovery instructions are under `$HOME/.local/share/societyer-rollouts/20261022T235043Z` with directory mode 0700. Keep data and credentials outside Git. The successful normalized export is retained under `$HOME/.config/zoer/procurement-publication-work/2026-10-22-verified-oct18-5c5d6eb765/normalized-export-preflight` for the next verified delta.

Follow-up evidence includes `incremental-followup/build-qualified.json`, `rollout.log`, `usage-dashboard.json`, `no-op-live-proof.json` and `prepare-evidence/final-verification.json`. `repeat-publication-proof-etag/real-source-repeat-proof.json` records the cold/warm Graph measurements. `current-catalog-comparison/` retains the read-only source-copy receipt, exact source-row differences and unpublished compact comparison. Source patch/bundle and test receipts are retained with the preparation evidence; the runtime source branch is `codex/procurement-observation-fingerprint`.

The scoped publisher source patch and hash manifest are retained under `publisher-source-evidence/`. They include the earlier owned implementation plus the new cache and exclude unrelated shared-checkout changes. The [Zoer publishing handoff](../../zoer/docs/societyer-sharepoint-publishing.md#repeating-an-unchanged-companion) contains the publisher's cache/recovery operating details.

- [Hosted catalog and operator runbook](procurement-convex-catalog.md)
- [Procurement access and publishing operations](procurement-review-operations.md)
- [Zoer publishing handoff](../../zoer/docs/societyer-sharepoint-publishing.md)
- [Zoer development and deployment](../../zoer/docs/agent-development.md)
- Private detailed evidence: `rollout-evidence.json`, `publication-runbook-2026-10-22.md`, `rollback-procurement.md`, and `collector-release/`
- Local browser captures: `tmp/production-rollout/desktop-overview.png`, `phone-overview.png`, `phone-pdf.png`, `usage-refreshed-20261023.png`, `desktop-incremental-followup.png`, and `zoer-incremental-updated.png`
