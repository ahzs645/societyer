# Procurement source journal and precomputed analytics

The October 23 changes give Zoer a durable record change journal and prepare the ten common analytical views before Societyer activates a publication. Source facts, document bytes, review evidence and serving projections retain separate reuse rules. The collector still checks sources and produces an immutable SQLite archive; unchanged notice projections can be reused, and supported analytical pages read a bounded summary from Convex.

This continues the [October 22 rollout and efficiency findings](procurement-incremental-efficiency-2026-10-22.md). Execution timestamps below use UTC; October 23 at 07:00 UTC is midnight in Vancouver.

## Source changes and observations

The `bc-bid-monitor` catalog uses the existing managed SQLite database. A versioned semantic policy distinguishes notice facts from verified collector observation and transport fields. A new observation can update the observation table without replacing the retained factual record bytes. Unknown fields, user notes, tags, source facts and relevant nested provenance remain part of the factual input. Other plugins keep their existing catalog behavior.

The journal records a monotonic sequence, stable record ID, kind, operation and source revision. Explicit deletion creates a tombstone. Document, review and procurement component changes mark their owning notice dirty; component hashes suppress timestamp-only changes. Borrowed attachment changes propagate through the same unique-or-ambiguous source lookup used by the catalog reader. Shared browse URLs do not fan out invalidation across every award.

SQLite triggers enqueue affected parents. The single catalog writer flushes the queue and computes revisions inside the transaction that publishes the durable catalog. Publishers reject an incomplete baseline, an incompatible epoch or policy, a dirty queue and corrupt cache artifacts. A restore starts a new journal epoch and requires a complete verified baseline; consumer checkpoints are not transplanted.

Each publication consumer has a checkpoint scoped to its implementation fingerprint. Preparing a projection does not advance it. Integrated publication acknowledges an exact sequence only after the destination returns a verified serving receipt. Compare-and-swap detects competing publishers. Repeating the same factual output at the same fence performs no checkpoint write, even when the analytics clock or publication receipt changes.

The bounded API is `/api/databases/catalogs/bc-bid-monitor/journal`, with `/inventory`, `/checkpoint` and `/ack` under that path. It uses the existing deployment authentication. A source cursor does not grant archive authority: downstream deletion still requires explicit complete source coverage.

## Projection reuse

The private projection cache binds the canonical review profile, normalizer version and code hash, implementation hash and semantic policy. Each source key has a verified input hash and a sealed normalized JSONL row. Reuse preserves the exact prior normalized bytes and timestamps. Membership reconciliation detects added and removed keys, while journal components identify affected parents. Historical archives without a journal use a verified semantic inventory scan and do not claim journal coverage.

The normalizer remains pinned to `files-procurement-publication-v1`, SHA256 `7258656589c5321f8cb0e9c7c911f1de58773946e23840ed58dcb65ea9337e1c`. Changing the projection contract deliberately invalidates its cache; ordinary collection bookkeeping does not.

Fresh source publication verifies the retained remote document inventory against the exact prior source manifest, drive and folder. Every referenced blob must still exist with matching parts and sizes. Missing retained bytes stop publication; a local SQLite copy without a files directory cannot silently erase document availability.

## Common analytical views

Zoer invokes Societyer's shared analytical engine on a verified normalized export. It prepares Overview, Trends, Period comparison, Buyers, Suppliers, Award sizes, Procurement mix, Data quality, Opportunities and Decision insights. Each result is independently recomputed during local integrity preflight before network writes. The artifact manifest binds the workspace, folder, generation, publication, source archive, content and inventory hashes, analytical versions and clock.

Ten results and one bundle marker are staged atomically in indexed Convex tables. They remain inaccessible until the active publication matches. Activation checks the exact staged descriptor and freshness. If a paused import crosses a clock boundary, the operator can regenerate the sidecar and resume the same verified record batches without replaying them.

The reader keeps its existing authentication and response contract. A supported default request reads one matching artifact. Arbitrary filters, missing artifacts and expired windows use the existing bounded server computation. Validity ends at the earliest relevant deadline or Vancouver midnight, including daylight saving transitions. A later publication or explicit refresh must prepare a new clock when required; the implementation does not add a recurring scheduler.

An exact bundle replay writes zero rows. A newer clock can refresh the analytical artifacts without rewriting the active catalog or its original activation time. A stale publisher cannot replace a newer summary clock, and conflicting results for the same publication and clock fail closed.

## Local measurements

| Measurement | Result |
| --- | ---: |
| One-time journal baseline | 120,168 source records |
| Baseline qualification including before hash | 8.50 seconds |
| Qualification process final RSS | 567,574,528 bytes |
| Catalog size before and after additive journal | 485,482,496 to 536,842,240 bytes |
| Historical October 18 cold projection | 25,629 normalizer calls in 9.083 seconds |
| Current source projection | 4 calls, 25,628 reused, in 7.844 seconds |
| Unchanged current source repeat | 0 calls, 25,632 reused, in 7.591 seconds |
| Repeat against the complete live journal baseline | 0 calls, 25,632 reused, in 9.556 seconds |
| Ten-summary bundle on the retained export | 559,141 bytes |
| Largest summary in that bundle | 82,161 bytes |
| Independently verified analytical bundle reuse | 13.32 seconds locally |

The current source comparison contains three new opportunities and one changed opportunity, with every award unchanged. The historical projection proof used archives without a journal. A separate repeat against the qualified live journal baseline verified identical compact bytes and source-key inventory with zero normalizations; before-and-after hashes also verified the source, original cache and runtime unchanged. Both local proofs made no network requests. Full source and taxonomy scans, cache sealing, integrity checks and archive compression still take time. Normalizer-call reduction is therefore larger than elapsed-time reduction.

The previous nine comparable latest default jobs consumed 369 bounded input pages, 382,585,029 serialized input bytes and 145.144 seconds of compute in aggregate. These serialized bytes are internal input measurements, not billed database I/O. The previous Decisions job alone read 53,489,867 serialized input bytes, close to its 64 MB budget. Precomputed defaults avoid those whole-catalog jobs while valid; filtered requests retain that cost and budget.

## Production usage comparison

The Convex dashboard uses the October 18 to November 18 UTC window and combines production and development for this project. The final observation was captured at **13:46:23.955 UTC**, after the initial rollout, page checks and later analytical clock refresh. Several hours elapsed between the baseline and final checks.

| Metric | Before rollout | Final observation | Displayed change |
| --- | ---: | ---: | ---: |
| Function calls | 135K | 139K | About +4K |
| Action compute | 0.20 GB-hours | 0.21 GB-hours | +0.01 GB-hours |
| Database storage | 2.78 GB | 2.79 GB | +0.01 GB |
| Database I/O | 4.48 GB | 4.86 GB | +0.38 GB |
| Data egress | 51.9 MB | 52.41 MB | +0.51 MB |
| Search storage | 45.44 MB | 45.44 MB | No displayed change |
| Search queries | 0.36612 Query-GB | 0.36612 Query-GB | No displayed change |
| File storage | 0 B | 0 B | No change |
| Deployments | 14 | 14 | No displayed change |
| Convex AI Gateway | $0.00 | $0.00 | No displayed change |

The production backup itself reads data, and the deliberate award drill-down used the existing expensive fallback. Dashboard counters are rounded and delayed, and unrelated project traffic continued during the elapsed interval. These totals cannot isolate the cost of this change or prove a monetary saving. Direct job counts, result sizes and exact mutation receipts show the narrower result: four normalized notices, eight serving operations and no whole-catalog jobs for the ten supported defaults.

## Verification and recovery

The implementation tests cover factual and component invalidation, observation-only reuse, deletion and membership, borrowed attachments, failed publication and restore, exact trigger validation, stale fences, ready-only acknowledgement, lost-response reconciliation, corrupt or omitted analytics, staged invisibility, analytical parity, precise deadlines and daylight saving, arbitrary-filter fallback and paused-run sidecar refresh.

The source release overlays only inspected files on the exact currently deployed Zoer image and typechecks the complete resulting backend. It preserves the frontend, runtime dependencies, installed plugin package and paused collector state. Deployment uses the existing maintenance drain and resume sequence with the backend and plugin-runner image changed together. Recovery retains the previous image, exact source artifacts, immutable publications and the verified Convex backup. A rollback must pause work first; a source archive with a journal must be validated by compatible software before restoration.

### Live journal and frozen publication

| Release input | Scoped revision |
| --- | --- |
| Societyer analytics and import | `248b64ca` with generated bindings `266385ef` |
| Operator profile preservation | `062cb00b` |
| Zoer journal runtime | `1525bd8dc9e8826446acbc04cfb68d2d5213de12` |
| Zoer publishing pipeline | `3e4b3eccac38260ee77efdf7478024669f14d5b9` |
| Production backup before deployment | SHA256 `95bd4ff45fd874399721aadcfb93071e6072efd9e54464c2338a1b9e0435d7c2` |

The protected backup and detailed execution receipts are retained under `/Users/ahmadjalil/.local/share/societyer-rollouts/20261023T072234Z-journal-analytics`. The scoped [Zoer deployment audit](/Users/ahmadjalil/github/zoer/output/ui-audit/2026-10-23-procurement-journal-analytics/README.md) records the eight runtime file hashes, tests, resources and rollback image. These are local scoped commits; this rollout did not push a GitHub release or create a pull request.

The live backend is `docker.io/zoer-local/backend:dev-procurement-journal-1792742556-1525bd8`, derived from the exact WordPress-enabled image `wp-static-20261022-1792730961`. The frontend remains on its existing release. Maintenance resumed with no active or paused work. The post-bootstrap comparison verified all source facts, six collector checkpoints, 139 batches, all workflow history and installed plugin assets unchanged. At the later resource observation the pod was Ready with zero restarts and 374 MiB memory.

The journal epoch is `6d5ef30d-b0d9-45f4-90c4-ccdf7b77b18e`. Its baseline contains 120,168 live revisions, no tombstones, no dirty parents and sequence zero. Sequence zero means the journal started from a complete current baseline; it does not claim that the current source is identical to the older served archive.

The frozen source is `20261023T080950Z-c9772b5b2651`, serving 3,755 opportunities and 21,877 awards. Its VACUUM archive has 531,202,048 bytes, SHA256 `c9772b5b2651c9f73410d6bae2b55e2c980bb3e59eca1e461d1051be19003b6e`, and 88,443,161 compressed bytes in 13 parts. It retains the existing 1,806 document blobs. The verified live copy before VACUUM has SHA256 `e961518428aac69d534d74737fe7f1194382214da7e2b5a78de32c75376a9b93`.

The actual journal-qualified preparation normalized four notices and reused 25,628. Python and TypeScript independently agreed on eight serving operations: four list rows and four details, with zero archives or document, evidence and taxonomy changes. The target content hash is `f11408b913886b530ff2f2a812b06cd04c80cc879e4aaee251d8b322dec39287`; the target inventory is `d231b7f59c24456a1899ff496db5ecd6e3bb325c9e250de01a22aff5e14ed6ac`.

### Profile preservation

Local preflight caught an exporter profile mismatch before publication. The isolated exporter omitted `publicationNormalization`, which would have changed all 25,632 detail rows even though the compact source bytes were unchanged. Restoring that retained field reduced the plan from 25,636 to eight operations. The exporter now rejects schema 1 compact input whose declared profile hash differs from its canonical operator profile. A regression test verifies that normalization policy and version metadata survive projection.

Pin the consumer export profile as well as the producer normalizer. An apparently small allowlist change can cause a full projection backfill; the exact baseline-to-target inventory must be checked before applying it.

## Serving and browser results

Generation `20261023T080950Z-c9772b5b2651-reader-v2` activated at **08:24:22.449 UTC**. All eight operations committed in one batch with one exact digest receipt. The reader gate was held from 08:24:20.797 to 08:24:22.449, **1.652 seconds**. Import-job validation through readiness took 4.275 seconds. Taxonomy reused its existing 89,972-term release; zero document blobs were uploaded or pruned.

The initial ten-view analytical JSONL bundle contained **559,149 bytes**, with 509,930 bytes of stored result strings. Seeding took 122.628 ms, reading 4,544 database bytes and writing 527,529. The default warm check took 96.760 ms, reading 527,110 bytes and writing zero. The scheduled wrapper took 118.660 ms. These are sampled function measurements, not invoice attribution.

Signed-in DDC checks rendered all ten default views. A complete 121-event browser capture showed ready results from the stored 08:23 UTC analytical clock, with result strings from 1,564 to 82,161 bytes and no SQLite or catalog-part request. The overview retained 13,231 included awards, about CAD 34.4 billion in recorded value, CAD 200,000 median, 296 proposed buyer groups and 5,200 suppliers. The new Mobile MRI notice, source ID 235048, appeared in search and opened with its details. Certificate Services, source ID 210923, retained its original documents; a 125 KB SharePoint PDF rendered its actual one-page content.

The matching-awards dialog displayed 1–50 of 13,231 rows. This request uses the existing `awards` fallback: it computed over 21,877 rows in 44 pages, read 45,989,492 serialized input bytes and took 19.081 seconds. Its sampled input pages read 56,755,147 database bytes. It was the only analytical job in the new generation during the initial post-DDC observation; **the ten default views created zero whole-catalog jobs**. A small browser response does not establish a cheap fallback computation.

The bounded 08:24:22.190–08:32:14.873 observation contained 191 procurement completions and zero failures. An earlier observation overlapping activation included one failed `get`; its cause was not classified. A later full reload hit the previously observed workspace-token error. Retry restored the existing session without another sign-in. The completed checks establish the procurement flow, while the intermittent token-refresh issue remains a separate reliability concern.

The serving-success checkpoint persisted at 08:24:26.855 UTC. Post-ACK checks again verified every source fact, six collector checkpoints, 139 batches, workflow history and plugin assets unchanged. A read-only ACK replay at 13:41:37 UTC made one GET and zero POSTs, reconciled the existing checkpoint and left the entire primary catalog SHA256 unchanged at `324dfb133011134fd28b9485a20c721a7856012db92b8ca479d3d3d5f8cc1bb6`.

## Remaining processing costs

The default artifacts expire honestly at a source deadline or Vancouver midnight. The initial Opportunities and Decisions artifacts expired at 09:00 UTC. A later exact-import replay rejected that stale bundle before network access. Refreshing the clock regenerates the summaries for the same verified publication; it must preserve notice rows and the original activation time.

The live clock refresh completed with `asOf` **13:43 UTC**, a 559,149-byte bundle and manifest SHA256 `a1fbf8f5802d0329db08e61296aa3be38b317f82db81698fe81230a85077337a`. All ten refreshed views rendered in DDC, and a complete 102-event capture returned that stored clock with no SQLite request. Opportunities and Decisions remain valid until **14:15:00.001 UTC**; the other eight views remain valid until **October 24 at 07:00 UTC**. After those instants the existing fallback preserves correct results until another upstream refresh.

The refresh wrote ten analytical summaries, no notice rows and no activation timestamp. An immediate exact replay then reported `reused; 0 default summaries written` and preserved activation at 08:24:22.449 UTC. The integrated journal ACK reconciled its existing checkpoint rather than advancing or rewriting it.

Full source publication and its resume path still scan, compress, upload and verify the archive and compact metadata. They can replay identical archive parts; the per-record cache reduces normalization and serving mutations rather than eliminating archive transport. A dedicated summary-only refresh path would reduce that repeated transport. Scheduling upstream refreshes before relevant deadlines would also avoid expiry falling back to whole-catalog computation; no recurring scheduler was installed in this task.

Filtered analyses and the matching-awards fallback still use the existing whole-catalog input engine. Indexed drill-down queries or narrower analytical input projections are the next material server-side improvements. The current browser also sends bounded reservation requests for defaults; a matching prepared artifact makes these return without creating a job or writing rows.
