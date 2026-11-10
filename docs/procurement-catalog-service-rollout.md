# Procurement catalog service rollout

Status: **live for DDC North**, 2026-11-10. The Owner selected the catalog
service at **23:32:06.992 UTC** after three real matching publications and the
live publisher-hook test. Convex remains the parallel fallback until at least
**2026-11-24 23:32:06.992 UTC** (4:32 PM Vancouver time). No fallback deletion
is automatic.

## Confirmed choices

- Provision a derived catalog only for a workspace that enables the feature.
  DDC North is the initial workspace; First Form has no catalog file or service
  credentials provisioned.
- Use `catalog.ddcnorth.com`, reached through a dedicated Cloudflare Tunnel.
- Include this workspace's published review evidence in its own protected file.
- Require three distinct consecutive real publications to match before cutover.
- Keep publishing to Convex in parallel for at least **14 days after cutover**.
  The clock started at the cutover recorded above. No cleanup/deletion is automatic.

The implementation/run commands are in
[`server/procurement-catalog/README.md`](../server/procurement-catalog/README.md).
The [original plan](procurement-catalog-service-plan.md) records the design.
Zoer's `docs/societyer-sharepoint-publishing.md` documents its optional modes.

## Implemented

The builder verifies the existing five-file export, archives only when source
coverage explicitly permits it, and updates unchanged SQLite pages in place.
It retains exact source-line encoding and source order for the original table
inventory hashes. Evidence uses its actual source ordering; it is not assumed
to be sorted. New publication IDs do not rewrite unchanged payloads.

Activation verifies SQLite and original inventories, snapshots a release, builds
thin gzip lists, prepares the ten default analytical views and warms a worker
before the atomic pointer switch. Only the activated current/previous pointers
are readable; prepared directories are not public publications. Notice responses
include all stored document metadata and explicit archived state. File bytes
continue through the existing authenticated SharePoint broker.

The public HTTP listener requires ES256 grants scoped to the exact workspace,
folder, issuer and audience. Grants last at most ten minutes. The browser holds
them in memory, refreshes before the final 20 percent, retries one 401, and aborts
on reader closure. The private signing key is only in Convex; the service gets
the public key. Operator routes are on a different loopback-only listener and
are unavailable on the public listener even with the operator secret.

The reader omits `usePage`, preserves complete local filtering/sorting/grouping,
loads awards only when needed, prefetches on record hover/focus, reuses notice
requests, and prepares a replacement list before swapping readers. Body search
is explicit and bounded. Deadline-sensitive analytics refresh at boundaries
inside the same minute, as well as at minute/day changes.

Settings editors can open the catalog service preview from the snapshot-folder
settings. The preview shows the consecutive qualification count, enables switching
only after three matches and a loaded preview, and provides a Convex fallback
control after switching. The server independently enforces the same gates.
An administrator can also test `?catalogPreview=service` before the source flag changes.
The server requires settings-write permission for this preview; it does not
change the workspace source. Normal readers remain on Convex during qualification.

Zoer's default remains `convex`. `parallel` additionally publishes/qualifies the
service before ready/journal ACK. `service` is refused until the qualified
workspace completes its fallback period. Other workspaces are not provisioned
implicitly, and no project database is created or replaced.

## Live state and limits

- The shared Convex deployment has the additive grant, receipt and rollout
  functions/indexes. After cutover a real policy query returned
  `serviceOnlyAllowed: false`, `fallbackUntil: 1795563126992`, enforcing the
  full 14-day minimum before service-only publication can be considered.
- DDC-only signing configuration is installed. No other integration secrets,
  memberships or sign-in rules were replaced.
- Both Cloudflare Pages frontends have the reader and administrator source
  controls deployed, alongside the shared backend. Microsoft sign-in succeeds
  with the actual DDC Owner session. The first live service preview caught a
  native browser `fetch` receiver error hidden by an arrow-function mock; the
  client now binds its default transport to the browser global and the browser
  fixture preserves that receiver requirement. The corrected live Owner preview
  passed: 4,323 opportunities, all 21,877 awards, local title filtering, 23
  description-search results for `tariffs`, a complete real notice and all five
  of its document entries, plus award Overview and Opportunities analytics.
  The service switch remained disabled at two of three qualifications.
- The subsequent three-of-three preview and normal service reader show the same
  visible `Some sources unverified` caveat and publication-state notices as
  Convex. Source selection persisted through fresh reloads without a preview
  query parameter. Settings shows `This workspace reads the catalog service`
  and the `Use Convex fallback` control.
- The actual browser download of `Requirements & Specifications - Requirements
  and Specifications.pdf` succeeded through the existing SharePoint broker.
  The downloaded file is 205,384 bytes with SHA-256
  `9b66259d169273884bb72f15bf6dc23f56b8b7dea0404f579f3b15f5fddac41f`,
  matching this publication's `procurementDocuments` row for
  `opportunity:235592`. The browser automation download-event wait timed out;
  the downloaded file's timestamp, size, PDF header and hash supplied the
  completion evidence instead. No download failure was inferred from that wait.
  Repeating the download after actual cutover produced another matching file,
  with a modification timestamp after the source change.
- The dedicated Cloudflare tunnel is healthy with four connections. DNS for
  `catalog.ddcnorth.com` is proxied to it; HTTPS health succeeds, anonymous
  catalog access returns 401 and public operator routes return 404.
- The separate SSD Nodes VPS runs Ubuntu 24.04. Administrator SSH is restored
  with the existing key, and the temporary recovery console is disabled. The
  catalog and tunnel run under separate unprivileged accounts; catalog HTTP,
  operator HTTP and tunnel metrics bind only to loopback.
- The initial bootstrap wrote an invalid SSH Match directive and Ubuntu's
  concurrent updater restarted SSH. Console recovery could not reach the boot
  menu, so the owner approved a second clean reinstall. No catalog data was on
  that VPS. The installer now uses a restricted key in a root-owned account
  home, does not edit or reload global SSH, and its successful live installation
  preserved the pre-install SSH checksums. The publisher key also rejects an
  unrestricted shell command.
- The first real serving receipt and full parity report passed for publication
  `20261110T205755Z-ace12a8a0a72`: 4,209 opportunities, 21,877 awards,
  26,086 details, 3,149 documents, 91 evidence rows and 89,972 taxonomy terms.
  All five tables, both lists and ten analytical views matched Convex while
  that exact generation was serving. This counts as **one** real publication.
- The first full snapshot transferred 447,397,888 bytes. A real SQLite protocol
  retry transferred 4,114 bytes and read back the same immutable serving receipt.
  The handler was corrected to accept SQLite 3.54.1's normal and PATH-fallback
  launch forms, without evaluating their shell syntax. The repeated parity
  comparison stopped when Convex activated a newer real generation, preserving
  the original evidence. Retries reuse a retained report's analytical clock and
  compare the full data again before checking its immutable evidence hash.
- The second real publication, `20261110T221348Z-b31296725c45`, passed all
  comparisons with 4,323 opportunities, 21,877 awards, 26,200 details, 3,163
  documents, 91 evidence rows and 89,972 taxonomy terms. Its incremental
  transfer sent 25,478,784 bytes. Repeating its full parity comparison while
  the same generation remained current retained the analytical clock and
  produced the identical immutable evidence hash. A retry does not add a
  qualification.
- A code-only service update exposed a release-directory permission issue
  from a private staging archive. Explicit `0755` directory / `0644` bundle
  modes restored public and loopback HTTP health with one active workspace;
  both services are active and administrator SSH checksums remain unchanged.
  The installer now preflights service-account readability and checks HTTP
  readiness after restart. No catalog records were lost or source flag changed.
- The third real publication, `20261110T230124Z-71be4fbbef92`, also passed full
  parity: 4,383 opportunities, 21,877 awards, 26,260 details, 3,163 documents,
  91 evidence rows and 89,972 taxonomy terms. It transferred 25,491,618 bytes
  incrementally. Its full parity report hash is
  `3539f79504e7c55820e90798faa5a4e61da20fbec95e89b425481dd249ea4f19`.
  Source coverage remains explicitly incomplete; the unavailable attachment was
  not relabelled as downloaded.
- Source selection is **service** for DDC North. All three distinct consecutive
  real publications qualified before the Owner changed it. The existing local
  publication watcher now requires the catalog stages. The collector/publisher
  is independently maintained;
  coordinate exact tested commits and source hashes before changing its runtime.

## Release and publisher evidence

The implementation merged through [Societyer #89](https://github.com/ahzs645/societyer/pull/89)
as `6d8339b56547277794ebc0d1ce7018d9d95a10f3`. All nine CI checks passed
for implementation head `2f13a0ecfccdc925a817f3c4f9f7d85a40e5e45b`.
The shared coverage-summary correction and recovery guide then merged through
[Societyer #90](https://github.com/ahzs645/societyer/pull/90) as `8639205a`,
with all seven applicable CI checks passing at tested head `55e8ddd3`.
This final state update is documentation only; these checks were not rerun for
prose changes.

The live Pages deployments contain that tested implementation:

| Frontend | Custom domain | Deployment |
| --- | --- | --- |
| `societyer-ddcnorth` | `portal.ddcnorth.com` | `cdb8c094` |
| `societyer-firstform` | `portal.1stform.ca` | `878c06ef` |

Both are direct uploads to their existing projects. Their public configuration
still targets the same shared Convex deployment, `industrious-cricket-610`.
The service code is `211a30dd`; the subsequent browser fix and installer
readiness check do not change its bundled server code.

An isolated 17-file operator source closure was also qualified using the exact
Mac binary referenced by the finite publication conductor: **Node 24.22.1 /
SQLite 3.53.4**, Convex 1.49.0, tsx 4.21.0 and JSZip 3.10.1. This is distinct
from the OTE backend's Node 22 environment. The Mac runtime reused this task's
installed dependencies, with their versions, package hashes, target and lockfile
hash recorded explicitly; source files were copied independently.

The same real second publication transferred 4,114 bytes through pinned
`sqlite3_rsync` 3.54.1, read back the immutable ready receipt, and passed all five
tables, two list projections and ten analytical views again. The retained full
parity report hash is
`37279f1affaceb55645f1c0f03007bfd43a8feccd00a282bd8954b087c2c369f`.
The private runtime qualification manifest records source, binary, dependency,
transport, strict known-hosts, restricted-key fingerprint and configuration
hashes. Its location was handed to the existing publisher operator for review;
private keys and configuration values are not committed here.

Automatic mirroring is **enabled in the existing local finite watcher**. After
exact Convex serving readback and before baseline advancement, it publishes the
service and completes full parity. It records a durable intent and owned child
PID/process group before a GO handshake permits execution. A failure retains
that wave in a catalog-only recovery phase. Twenty initial process/ACK/recovery
tests passed, followed by 22 targeted cases for capacity guards and permanent
child terminal receipts.

The actual catch-up hook completed at `2026-11-10T23:30:07.282676Z` for the third
publication, retaining its identical receipt and parity hashes. Both owned
children exited, the baseline and wave counter stayed unchanged, the pending
phase cleared, and the watcher returned to `watching_partial_source` with
`catalogRequired: true` and the current `catalogAck`. This verifies the hook;
it does not count as a fourth distinct publication.

A subsequent **new collected-data publication** exercised the entire watcher
path after cutover: source snapshot, Convex ready, catalog activation, full
parity, then baseline ACK. Publication `20261110T233730Z-a41c904c3706` completed
at `2026-11-10T23:45:42.492095Z`, with 4,443 opportunities and 21,877 awards.
All five tables, both lists and ten analytical views matched; the retained
report hash is
`1dc460d81c10936f596c4be1b150ca5462fb087174e5378c8a0791239ac4e442`.
The wave counter advanced once, from five to six, only after catalog ACK. The
Owner's open portal updated from 4,383 to 4,443 opportunities without a reload
or sign-in, preserving the coverage warning and service source setting.

This is a Mac-side publisher, not an always-on publisher installed on the VPS
or OTE backend. Keep the Mac and reviewed watcher running for automatic updates.
The watcher uses explicit local/source storage headroom checks, preserves all
originals/backups, and stops for inspection on unknown outcomes. Moving it to a
server requires its own complete runtime/credential qualification; the Node 22
FTS smoke alone does not establish that readiness.

This state must be updated from observed results after recovery and each rollout
gate. Never infer serving readiness from an export, upload, directory or test.

## Verification so far

Local database, grant, Convex-authority, real HTTP/worker, client cancellation and
forced-SSH boundary checks pass. The original procurement source-status and
publication checks pass. The persistent operator was reviewed against installed
Convex CLI 1.49.0 in addition to retained 1.42.1: deployment authorization and
encoded function contracts are unchanged, strict host/env checks and replay tests
pass, and a real bounded policy query succeeds without impersonating a user.

A retained real export prepared locally with 25,914 notices (21,877 awards,
4,037 opportunities), 3,067 documents, 91 evidence rows and 89,972 taxonomy rows.
Preparation took about eight seconds; list gzip sizes were 448,541 and 2,721,623
bytes. This was an older retained publication, **not** the currently serving
Convex generation and not live parity. The bundled Node service also verified
all five table fingerprints and ten default views against that local copy.

Desktop and phone browser fixtures exercise 21,877 synthetic awards, lazy loading,
notice reuse and the twelfth addendum. They use the application's constrained
page-scroller geometry; an unconstrained fixture incorrectly makes virtualization
fill a document of all cards. These are local/emulated checks, not physical-phone
or production network measurements. Boundary-refresh coverage is separate.

Zoer's ten focused publisher tests and backend typecheck pass on Bun 1.4.4 with
its frozen lockfile. The live OTE backend also passed an in-memory Node 22.22.2 /
SQLite 3.51.2 FTS5/trigram self-test; a complete new publisher run on that host is
still unverified. Production service qualification uses Node 26.7.0.

The repository's existing export-coverage check fails before service-table
coverage because its portable and Convex export lists already differ. These
unchanged lists and the existing schema coverage gaps are outside this change;
the two new service tables are explicitly non-exportable operator state and have
reviewed workspace-transfer skip policies. Transferred workspaces reset their
source choice to Convex and do not inherit deployment-bound service receipts.

## Continuing operations

1. Keep the reviewed local watcher running and publish to Convex in parallel
   through at least the fallback deadline. Complete parity while each exact
   generation is current and retain its checksummed evidence before baseline ACK.
2. Source collection is still partial. Preserve the visible coverage caveat
   and unavailable attachment evidence; finishing notice collection is not proof
   that the attachment audit or other retained sources are complete.
3. Roll back from Catalog source settings using `Use Convex fallback` if needed.
   Re-enabling the service after rollback starts a new 14-day minimum.
4. No cleanup is scheduled. Backups and a separate bounded retirement review are
   required before deleting fallback records or older derived releases.

Signed-in Owner reads, complete lists, filters, notice metadata, real broker
downloads, body search and live analytics are verified. Exact within-minute
deadline refresh is additionally covered by the browser fixture; the production
clock was not changed to test it.
