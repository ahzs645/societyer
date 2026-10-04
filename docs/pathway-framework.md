# Pathway registry and preparation pipelines

Societyer registers an incorporation preparation route once in
[`shared/pathways/registry.ts`](../shared/pathways/registry.ts). The workspace setup
selector, legal subtype options, preparation guide, post-incorporation steps and
packet compatibility checks derive from that registry. A route marked
`review_required` can remain visible as an option while document preparation is
blocked. A preparation route does not assert that its drafts have received legal
review or that an organization has been incorporated.

## Registry API

`PathwayDefinition` contains a stable `key`, a `version`, display copy,
`availability`, and explicit eligibility lists for jurisdictions, entity types,
governing Acts and legal subtypes. Its `setup` record supplies the workspace
selector. Optional `preparation` and `flow` records supply the existing guide and
post-incorporation interfaces. `packetKeys` lists the templates the route owns;
`pipeline` defines the preparation graph. An optional `packetContexts` record
declares extra-provincial packet keys and explicit target jurisdictions, allowing
registration preparation to differ from the home incorporation scope.

- `getPathway(key)` retrieves a production registry entry without choosing a
  fallback.
- `resolvePathway(entity, registry?)` returns `{ allowed, message, pathway? }`.
  It canonicalizes known jurisdiction aliases and requires a unique registered
  entity/jurisdiction route. An absent or unsupported entity/jurisdiction is
  denied. For compatible legacy profiles, an explicit supported entity and
  jurisdiction may omit Act/subtype; a supplied conflicting Act or unsupported
  subtype is denied. This compatibility rule is not evidence of adopting articles
  or bylaws. Member-funded society classification conflicts and registered
  charity combinations are also denied.
- `pathwayForPacket(entity, packet, registry?)` requires both a compatible
  home jurisdiction (or explicitly registered extra-provincial target context)
  and ownership of the packet key. Selecting a key manually cannot
  bypass that check, including for post-incorporation packets.
- `validatePathwayRegistry(entries)` checks registration consistency, ambiguity
  and graph references. `createPathwayRegistry(entries)` validates an extension
  registry before it is passed to the same resolver.

Compatibility exports in `shared/entitySetup.ts`,
`shared/incorporationPreparation.ts`, `shared/postIncorporationSteps.ts` and
`shared/jurisdictionWorkspace.ts` keep their existing public interfaces while
using the registry. Do not create an additional entity switch in a page to select
preparation data. Statutory deadline rulepacks and legal guide sources have their
own schemas and review processes; a pathway entry does not approve them.

## Graph and input API

[`shared/pathways/pipeline.ts`](../shared/pathways/pipeline.ts) accepts a bounded,
declarative `PipelineGraph` with `version: 1`, optional `inputFields` and `nodes`.
Input fields support `text`, `boolean`, `select` and `number`. Every input has a
stable key and label; select fields declare their permitted options. Nodes have a
stable key, title, kind and `dependsOn` list. Supported node kinds are `manual`,
`document`, `approval` and `submission`.

Document nodes can require evidence and reference an owned `packetKey`. Approval
nodes can declare an action permission and require an approver distinct from the
initiator. Submission nodes name an adapter and can provide an HTTPS official
filing link. Flat input conditions support `equals`, `not_equals`, `exists` and
`in`. They reference declared fields; there are no executable expressions or
client-provided HTTP dispatch scripts.

`validatePipelineGraph(value)` rejects duplicate node/input keys, unknown or
duplicate dependencies, dependency cycles, undeclared condition inputs,
malformed condition values and submissions without an approval ancestor.
`validatePipelineInputs(graph, value, complete?)` validates declared field types,
select options and, when `complete` is true, required input values.
`evaluatePipeline(graph, inputs, steps)` derives ready, blocked and skipped nodes
alongside recorded step states. A skipped optional branch satisfies that branch's
dependency; it does not supply the independent approval required for submission.

`canonicalPipelineJson(value)` and `pipelineSha256(text)` provide canonical
payload serialization and SHA-256 hashing for approvals and dispatch. They do
not determine legal validity, signing authority or government acceptance.

## Saved runs and authorized transitions

[`shared/functions/pathways.ts`](../shared/functions/pathways.ts) implements the
portable `pathways` handlers used by the shared runtime. The handlers accept these
endpoint arguments:

| Endpoint | Arguments | Behavior |
| --- | --- | --- |
| `pathways:status` | `societyId` | Reads saved runs, derived nodes and permitted actions. |
| `pathways:start` | `societyId` | Snapshots the registered pathway version and validated graph into a new run. |
| `pathways:saveInput` | `runId`, `inputs` | Validates declared inputs before the first recorded transition. |
| `pathways:completeStep` | `runId`, `nodeKey`, optional `documentId`, `notes` | Completes a ready manual/document node with required owned evidence. |
| `pathways:approve` | `runId`, `nodeKey`, optional `notes` | Records a permitted human review and hashes of the submission payloads it approves. |
| `pathways:reject` | `runId`, `nodeKey`, `notes` | Records a permitted human rejection with a reason. |
| `pathways:requestSubmission` | `runId`, `nodeKey` | Revalidates evidence and approval, then records an idempotent outbox handoff. |
| `pathways:recordManualReceipt` | `runId`, `nodeKey`, `documentId`, `reference`, optional `notes` | Records a human attestation backed by an uploaded official receipt. |

The tables in [`convex/tables/pathways.ts`](../convex/tables/pathways.ts) are
`pathwayRuns`, `pathwaySteps`, `pathwaySubmissionOutbox` and `pathwayAudit`. Run
inputs freeze on the first recorded transition. Each evidence step retains a
document/version snapshot; changing the reviewed evidence requires a new run.
Approved payloads bind the graph, inputs and ancestor evidence. Audit events
retain the action, actor and timestamp.

Starting and advancing require the applicable current action permissions.
Approval/rejection additionally require a human Owner, Admin or Director with the
review permission, and a different reviewer from the initiator unless the
trusted graph explicitly changes that policy. Submission and receipt attestation
require filing permission. Transitions recheck the current entity route, registry
version, initiator authority and evidence access. A changed route/version blocks
advancing an earlier run while retaining its snapshot; start a reviewed current
run. When evidence is inaccessible, status suppresses its details and actions.

The saved pathway card on Post-incorporation presents these backend-derived
states and rights. A completed run, approved review or manually attested filing
does not update the organization's verified incorporation state. The separate
profile transition still requires official certificate evidence.

## Submission boundary

[`shared/pathways/submissions.ts`](../shared/pathways/submissions.ts) separates a
manual handoff from a trusted integration. The built-in `official-portal` adapter
is manual: it directs an authorized person to the official service. Opening that
service or completing a preparation approval does not establish filing or
acceptance. Retain official receipt and certificate evidence separately.

`createSubmissionAdapterRegistry(adapters)` installs trusted server-side adapter
implementations. An adapter supplies an identifier, current configuration check,
idempotency capability and `submit(request)` implementation. Duplicate/reserved
identifiers are rejected; there is no generic client URL adapter.
`dispatchSubmission({ submissionId }, dependencies)` uses a durable store with
`load`, atomic `claim` and matching-attempt `complete` operations, the registered
adapters and an `authorize` callback. Authorization must re-read the actor's
current workspace status, action permission, approval validity and document ACLs.
It runs before dispatch and again after the durable claim.

Dispatch checks the exact approved payload hash and binds the claim to the
submission identity, route, actor and documents. Manual routes return
`manual_required`; absent or unconfigured adapters return `adapter-unavailable`.
Provider acceptance requires a provider reference. Timeouts, transport errors,
lost receipt writes and abandoned claims require reconciliation and do not cause
automatic resend. Terminal receipts are retained by the durable store. Adapter
implementations must return receipt fields safe to store and must not include
credentials or bearer URLs.

No live government filing integration is claimed by the shipped manual routes.
A new trusted adapter needs provider-specific testing, approved configuration,
durable claim/receipt storage and authorization checks before use.

## Adding a pathway

1. Review the entity, jurisdiction, Act and subtype scope and collect current
   primary sources. Register an unresolved route as `review_required`.
2. Add one `PathwayDefinition` to `PATHWAY_REGISTRY`, including version, setup
   copy, explicit eligibility and the preparation/flow data it uses. The
   incorporation factory is a convenience for the existing incorporation
   families; a new family can supply its definition directly.
3. Add templates to the appropriate packet catalog and explicitly include their
   keys in the pathway. Declare required/review packet fields in the packet
   schema and collection fields in the graph; these serve different purposes.
4. Define graph nodes, dependencies, evidence requirements, conditions and
   independent approval. Use `official-portal` for manual filing unless a reviewed
   server adapter has been installed and tested.
5. Increment the pathway version when changing executable preparation behavior.
   Keep historical run, input, graph, document and approval snapshots; a newer
   registry definition must not rewrite the evidence behind an existing run.
   Preparation approval is a workflow record, not legal adoption, execution or
   registry acceptance. Verify the certificate through the separate formation
   evidence transition.
6. Run `npx tsx scripts/check-pathway-registry.ts` and the applicable pipeline,
   packet, incorporation preparation, authorization and static parity checks.
   Include denied classifications and ambiguous routes, a new synthetic route,
   conditional branches, evidence replacement and approval/submission boundaries.

Adding a jurisdiction's aliases, legal compliance rules or storage/submission
integration may also require those modules' reviewed data and adapters. The
single registration removes repeated preparation selectors; it does not replace
those domain-specific requirements.

## Hosted dispatch and backups

The hosted wrapper is `convex/pathways.ts`. Queuing an automated submission
schedules its trusted internal dispatcher after the transaction commits.
`convex/lib/pathwaySubmissionAdapters.ts` is the server installation point used
by both capability reporting and dispatch. The installed API allowlist is
currently empty. Configuration checks inspect deployment configuration without
network I/O; provider calls run only in the internal action. Unknown or
unconfigured adapters cannot enqueue an automated filing through the hosted
wrapper. No client-provided URL becomes a submission target.

Local snapshots and workspace exports include the four pathway history tables.
Restoring a local snapshot marks runs `imported_readonly` and blocks pending
outboxes; completed receipts and audit history remain available. A backup does
not restore approval or dispatch authority. Start a new reviewed run after
restoration. A changed registered version also blocks advancing older runs while
preserving their saved definitions.

The three built-in incorporation pipelines require a different permitted human
reviewer from the initiator. A workspace with one user must add an appropriate
reviewer before that gate can advance. This preparation review does not replace
statutory director, member or shareholder approval. Official name approvals,
manual filing receipts and retained certificate evidence require uploaded files;
preparation evidence may be a generated working document.

Verification commands:

```bash
npm run test:pathway-framework
npm run test:pathway-ui
npm run verify:reconciled
npm run test:exports
npm run test:local-snapshots
```
