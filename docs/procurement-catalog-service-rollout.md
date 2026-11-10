# Procurement catalog service rollout

Status: **in progress**, 2026-11-10. The workspace still reads Convex. This is
not a completed service cutover or an instruction to delete the fallback.

## Confirmed choices

- Provision a derived catalog only for a workspace that enables the feature.
  DDC North is the initial workspace; First Form has no catalog file or service
  credentials provisioned.
- Use `catalog.ddcnorth.com`, reached through a dedicated Cloudflare Tunnel.
- Include this workspace's published review evidence in its own protected file.
- Require three distinct consecutive real publications to match before cutover.
- Keep publishing to Convex in parallel for at least **14 days after cutover**.
  The 14-day clock has not started. No cleanup/deletion is automatic.

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
  functions/indexes. A real operator policy query returned
  `serviceOnlyAllowed: false`, `fallbackUntil: null`.
- DDC-only signing configuration is installed. No other integration secrets,
  memberships or sign-in rules were replaced.
- Both Cloudflare Pages frontends have the reader and administrator source
  controls deployed, alongside the shared backend. Microsoft sign-in succeeds
  with the actual DDC Owner session. The first live service preview caught a
  native browser `fetch` receiver error hidden by an arrow-function mock; the
  client now binds its default transport to the browser global and the browser
  fixture preserves that receiver requirement. Repeat the signed-in preview
  after deploying this correction before recording it as verified.
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
- Source selection remains **Convex**. Two live parity publications are qualified; one more
  distinct consecutive real publication is still required before cutover. The active collector/publisher is independently maintained;
  coordinate exact tested commits and source hashes before changing its runtime.

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

## Remaining rollout gates

1. Adopt and qualify the optional parallel publisher in its agreed private
   runtime, including its complete source closure, pinned SQLite transport,
   restricted workspace key, existing operator authorization and a full Node
   22 run. Do not restart the independent collector or backend for this step.
2. Qualify the next legitimate real publication through that active publisher;
   do not replay or invent publication IDs to satisfy the third-match gate.
3. Foreign-origin rejection is verified (403); verify the real signed-in Owner
   through the public hostname after the browser transport correction.
4. Complete the administrator preview; verify lists,
   filters, notice details, all document metadata, a real broker download, body
   search and time-sensitive analysis. Do not fabricate an identity for this.
5. Run complete parity while each exact generation is still serving in Convex.
   Retain the checksummed reports and qualify three distinct consecutive real
   publications. Coordinate adoption of the new Zoer source closure first.
6. Explicitly select the service, retain parallel publishing for 14 days, and
   monitor. Roll back by selecting Convex if needed. Backups and a separate
   bounded retirement review are prerequisites to any later cleanup.
