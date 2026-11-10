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

An administrator can test `?catalogPreview=service` before the source flag changes.
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
- The new frontend reader and administrator preview have not been deployed yet.
- A dedicated Cloudflare tunnel is configured, but the hostname's DNS and live
  service activation are pending. The tunnel is not evidence of a working origin.
- The owner explicitly approved and performed an Ubuntu 24.04 reinstall on the
  separate SSD Nodes VPS. New operator SSH access was verified. Zoer's server,
  catalog and collector were not reinstalled or moved.
- During bootstrap an invalid `PermitUserEnvironment` directive was written
  inside an SSH `Match` block. Validation rejected it, but Ubuntu's concurrent
  updater restarted SSH before it could be removed. Remote SSH is unavailable;
  console recovery could not reach the boot menu. The owner approved a second
  clean reinstall with the existing SSH key, now in progress. No catalog data
  had been transferred or activated there. The installer now uses the dedicated
  account’s default key path in a root-owned home and does not change or reload
  global SSH configuration.
- Source selection remains **Convex**. No live parity publication has been
  marked successful. The active collector/publisher is independently maintained;
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

1. Recover SSH, run the corrected installer and verify both unprivileged units,
   the restricted publisher key and loopback-only ports.
2. Publish the exact currently serving verified export. Check the first full
   snapshot transfer, subsequent SQLite replication and failure recovery.
3. Connect DNS, verify TLS/health, unauthorized/foreign-origin rejection and
   operator-route isolation through the public hostname.
4. Use a real member's sign-in for the administrator preview; verify lists,
   filters, notice details, all document metadata, a real broker download, body
   search and time-sensitive analysis. Do not fabricate an identity for this.
5. Run complete parity while each exact generation is still serving in Convex.
   Retain the checksummed reports and qualify three distinct consecutive real
   publications. Coordinate adoption of the new Zoer source closure first.
6. Explicitly select the service, retain parallel publishing for 14 days, and
   monitor. Roll back by selecting Convex if needed. Backups and a separate
   bounded retirement review are prerequisites to any later cleanup.
