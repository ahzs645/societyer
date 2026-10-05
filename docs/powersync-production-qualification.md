# Production meeting preparation qualification

The rollout code promotes the meeting-preparation pilot into the actual Societyer
application. It preserves Clerk, tenant-restricted Better Auth Microsoft mode,
workspace roles and last-active-Owner protections. React Router and Convex remain
the routing and authoritative data layer. PowerSync owns SQLite persistence,
replication checkpoints and the durable command queue.

This follows the `990b3ba` interface baseline. The reconciled main baseline is
`4b15fd20f3b82baa6b18cb95be7b2c62404884b3`, including authentication commit
`cc52e24487f42c19f81b2d22385091006bc70b44`. The earlier 420-case interface
qualification remains historical evidence; it is not counted again in this rollout.

## Implemented release path

The feature-gated `/app/meetings/offline` page uses the existing authenticated
Convex client and HTTP token registry. Its broker derives identity and workspace
from the native session, signs an ES256 credential for the configured PowerSync
audience, and limits lifetime to five minutes. No production browser account
selector, local signer, cached JWT or alternative human login is introduced.

All seven public backend functions use the authorization policy registrations.
The connector checkpoint is internal/admin-only. Root native writer hooks cover
roles, user lifecycle, external identities, document/material ACLs, committee
access and online meeting content. Temporal access has durable scheduled refreshes
and a minute repair cron. Projection failures clear downloads and block sync access
without rolling back a successful security revocation. The selected materializer
is bounded to 50 memberships and 100 meeting aggregates per workspace.

The page independently watches native authorization so pending SDK work cannot
hide a revoked projection. Initial cached reads wait for verified authorization;
late credential refreshes and attachment downloads have generation fences.
Replaced/deleted agenda and parent mappings remove obsolete mirrored bodies.
Server-hydrated content is labelled downloaded, so it cannot be retained as
authored work after revocation. Attachment saving waits for its actual replicated
permission row and rechecks scope/hash/size inside the cache-write transaction.

Permanent authorization/validation/conflict rejections are quarantined in durable
history before acknowledging the SDK entry. Dependent commands are quarantined
without another server write. Authored commands and bytes remain exportable;
network and unknown server failures remain queued for retry. Accepted receipts
survive interrupted SDK acknowledgements without duplicating a server operation.
Unsaved minutes retain their original revision and cannot silently overwrite a
newer server edit. Quarantined edits no longer block the current authorized server
meeting from being restored; a separate review notice keeps recovery discoverable
even when its original meeting is absent. Workspace switches reset unfinished
create-form fields and selected attachments. Approval, adoption and filings remain
online operations.

## Evidence

Production invalidation has **12 passing groups** using the Convex transaction
oracle against the actual root handlers, including scheduled expiry, private
attachment sink denial, identity migration and oversized dataset revocation.
Oracle identity transport is injected; live transport is checked separately.
Existing pilot/native policy checks have **39 passing checks**.
The credential suite has **12 passing groups**, including the actual mounted
gateway and Better Auth session/token APIs; matching issuer/subject succeeds and
foreign identities cannot mint sync credentials. That gateway regression caught
and fixed an issuer argument that the earlier isolated broker tests missed.

The HTTPS production transport matrix passes **24/24** at 320, 390, 768 and
1440 pixels. It uses actual Better Auth sessions, root native Convex functions,
the production credential route and PowerSync's SQLite replica in a second
client. It verifies native attachment bytes, all five role views, foreign-workspace
credential denial, offline parent/child uploads, unsaved-revision conflicts,
quarantined descendants, restored canonical content, material ACL withdrawal,
real scheduled expiry and offline-reload durable work followed by online recovery.
The production stream allowlist is mounted directly; no isolation headers or
alternative human login are added. External production PostgreSQL TLS, deployment
export permissions and publicly routed origins still require target qualification.

The actual SDK/WASM/SQLite recovery matrix passes **24/24** at 320, 390,
768 and 1440 pixels. It covers injected permanent/dependency and authorization
rejections, transient retry, interrupted accepted acknowledgements, the offline
upload fence, obsolete mapped rows and revocable accepted content. These are
durable client contracts; they are not counted as additional live API calls.

The final browser evidence and exact command results are recorded in
`artifacts/offline/production-rollout-summary.json`. Built lazy-loading evidence
is in `frontend-lazy-loading.json`; native invalidation evidence is in
`production-invalidation-results.json`. Private keys, account passwords and
browser traces remain ignored. Failed attempts are retained and distinguished
from the final passing cases.

The reconciled security suite passes authentication, Clerk gateway, tenant-pinned
Microsoft mode, cross-workspace/module access, role/resource projections and
last-active-Owner protections. Server typechecking, interface contract checks,
combined Convex/TypeScript/frontend build and frontend transfer budgets pass.
Scoped offline lint reports zero errors and one style-limit warning for
the page function length.

To reproduce the isolated HTTPS two-client checks, follow
[the transport launcher instructions](../experiments/live-qualification/rollout/README.md).
The launcher accepts only the disposable native lab, retains existing user IDs and
roles, and restores the original lab issuer/bindings after qualification. Actual
public deployment follows the separate production runbook.

The lab was restored to its original HTTP issuer and all eight disposable user
bindings. Role, status, provider, subject and workspace snapshots are unchanged.
Actual Better Auth sign-in/token requests return 200; native Owner membership and
offline identity are bound. Disposable labelled meeting graphs are removed.
Private service processes/volumes remain intact; rerun the launcher deployment
step before reusing the temporary HTTPS lab.

Frontend transfer measurements and reproducible budgets are described in
[frontend-bundle-loading.md](frontend-bundle-loading.md). Measurements cover the
complete deduplicated static JS/CSS dependency closure, rather than only the
largest named chunk. Heavy editors and SDK WASM remain on-demand feature costs;
these are transfer measurements, not Lighthouse or physical-device timing scores.

## Activation and boundaries

Use the [production runbook](powersync-production-rollout.md) and its read-only
configuration validator. Actual production activation requires the public HTTPS
PowerSync origin/routing, root deployment export credential, verified-TLS
PostgreSQL storage and existing persistent auth configuration. The current
environment has no configured production secrets or service identities. Code
changes and isolated qualification do not establish an external deployment.

This adds selected meeting preparation, not offline copies of every Societyer
module. The pinned PowerSync Convex connector remains experimental; this evidence
qualifies the selected workflow and its isolated transport, not every dataset size
or an unrestricted offline application. The root app uses its existing authenticated session lifecycle; open
the page while signed in before disconnecting. The pilot's separate built PWA
offline-reload proof does not imply root hosted-auth startup without connectivity.
Clerk/Microsoft policy checks pass; their external provider sign-in flows, physical
devices, Safari, packaged Electron and external storage providers are not live
qualified by this rollout. Unreachable clients cannot learn new revocations.
Direct operator database changes use the repair cron rather than the ordinary
transactional writer hooks. No public deployment or main push is implied.
