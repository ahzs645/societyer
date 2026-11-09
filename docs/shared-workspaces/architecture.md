# Shared workspaces and linked sign-in: architecture and contract

Status: implementation contract, November 8, 2026. It turns the
[feasibility review](../audits/2026-11-08-shared-workspaces-review.md) into
concrete tables, functions and screens. The operator steps are in
[operator-runbook.md](operator-runbook.md), the user-facing behaviour is in
[user-guide.md](user-guide.md), and the move from two deployments to one is in
[migration-and-cutover.md](migration-and-cutover.md). The index is
[README.md](README.md); staging is in [staging-setup.md](staging-setup.md) and
test coverage in [acceptance-tests.md](acceptance-tests.md).

## Goal

Several organizations (for example DDC North and First Form) share one Convex
deployment and stay separate. Each keeps its own members, roles, branding, sign-in
requirement, storage and domain. One person can reach every workspace they belong
to through one personal account and switch between them without signing out. That
works even when their memberships were created under two different logins.

## Two questions, kept apart

1. **Who is this person, and how did this session authenticate?** Better Auth
   answers this. `hostedPrincipal` turns the verified JWT into a
   `PortablePrincipal`, and its `sessionEvidence` records how this session was
   proven (a session id, sign-in time, and validated Microsoft evidence when
   present).
2. **Can this session use this workspace?** `resolvePrincipalUser` answers this.
   It needs exactly one Active membership in the workspace, bound to the session's
   identity or to an identity linked to it. The session must also satisfy the
   workspace's sign-in policy and MFA policy, and then the operation's permission.

A linked login method is never session evidence. A password session stays a
password session, even when the person has also linked a Microsoft account.

## Data model

All new tables are in `convex/tables/sharedWorkspaces.ts`.

| Table | Purpose | Who writes it |
| --- | --- | --- |
| `workspaceSignInPolicies` | `requiredMethod` (`any` / `microsoft`), the Microsoft tenant and groups, an optional email-domain allowlist, and a support email | Deployment operator (internal mutation) |
| `workspaceStoragePolicies` | `nativeUploads` (`allowed` / `disabled`) and `documentVersionProvider` (`deployment-default` / `native` / `sharepoint`) | Deployment operator |
| `workspaceDomains` | Exact frontend origin → workspace, `primary` canonical origin, `Active` / `Disabled` | Deployment operator |
| `personAccounts` | One person | Link flow |
| `personIdentityLinks` | An exact issuer and subject proven to belong to a person | Link flow |
| `accountLinkRequests` | Short-lived, single-use code proving that a fresh session for identity A started a link | Link flow |
| `accountLinkEvents` | Append-only audit of linked, unlinked and refused attempts | Link flow, `accountLinks:operatorUnlink` |

When a workspace has no policy row, the existing behaviour applies: sign-in is
`any` and storage follows the deployment default. Existing single-organization
deployments therefore keep their access rules until an operator adds rows. The
few visible differences after deploying (linking pages are live, a new JWT
claim, the remembered workspace resets once) are listed in the
[runbook](operator-runbook.md#is-it-backward-compatible).

`users` rows are not changed by linking. Each one is still one workspace
membership bound to one exact `authIssuer` and `authSubject`. Linking never
rebinds a membership, so authorship and history stay attached to the original
membership IDs. The only addition is `mergedIntoUserId` / `mergedAtISO`, set
by the operator's `users:operatorRetireMembership` on a retired duplicate (see
[Known limitations](#known-limitations)).

## Session evidence

`convex/hostedAuth.ts` adds a `societyer_session` claim to the Convex JWT,
holding `{ id, createdAt }` from the Better Auth session. Convex flattens it to
`identity["societyer_session.id"]` and `identity["societyer_session.createdAt"]`.
`hostedPrincipal` (in `convex/lib/authIdentity.ts`) builds
`principal.sessionEvidence` from these claims:

- `sessionId` and `authenticatedAt` (epoch ms) come from the claim.
- `microsoft` is set only when the existing `societyer_entra.*` proof passes
  `validEntraProof` against the deployment's tenant and groups, and its `userId`
  equals the JWT subject.

The deployment-wide `SOCIETYER_ENTRA_SSO_REQUIRED=1` keeps its meaning: every
session on the deployment needs Microsoft evidence. A shared deployment turns it
off and relies on per-workspace policy instead.

## Workspace sign-in policy

The evaluator lives in `shared/workspaceSignInPolicy.ts`:

```ts
type WorkspaceSignInPolicy = { requiredMethod: "any" | "microsoft"; microsoftTenantId?: string;
  microsoftGroupIds?: string[]; allowedEmailDomains?: string[]; supportEmail?: string };
type SignInRequirement = "microsoft" | "email-domain";
function evaluateWorkspaceSignIn(policy: WorkspaceSignInPolicy | null | undefined,
  principal: PortablePrincipal, now?: number): { ok: true } | { ok: false; requirement: SignInRequirement };
```

The `microsoft` requirement is met when `sessionEvidence.microsoft` exists, its
`tenantId` equals the policy tenant, it shares at least one group with
`microsoftGroupIds`, and `expiresAt > now`. The `email-domain` requirement is met
when the session's email domain is in `allowedEmailDomains`.

`resolvePrincipalUser` (in `shared/functions/access.ts`) checks the policy right
after it resolves an Active membership for a `verified-jwt` principal, and before
it checks MFA. A failure throws `WorkspaceSignInRequiredError`, which carries a
`requirement` field. Gateway service principals skip this check, as they already
skip the MFA check.

`workspaceSignInPolicies:set` is an internal mutation. It refuses a `microsoft`
policy unless Entra login is configured on the deployment and the tenant and
groups are a subset of `MICROSOFT_LOGIN_TENANT_ID` and `MICROSOFT_LOGIN_GROUP_IDS`.
Otherwise no session could ever satisfy the policy.

## Person accounts and linking

### Resolution

`linkedIdentityKeys(ctx)` returns the principal's own exact issuer and subject.
If that identity has an Active `personIdentityLinks` row whose `personAccounts`
row is Active, it also returns every other Active link of that person whose
`externalIdentities` row is Active.

`resolvePrincipalUser`, `currentPrincipalMemberships`,
`ensureCurrentMembershipPortable` and the membership enumerations in
`shared/functions/society.ts` collect `users` rows across those keys through the
`by_auth_identity` index. Rules:

- More than one membership in the requested workspace across the linked
  identities means `ambiguous`. The resolver returns no membership and never
  picks the higher role.
- A Disabled membership stays Disabled. Linking never reactivates anything.
- Sign-in policy, MFA and `secondFactorVerified` always come from the current
  session, not from the identity the membership happens to be bound to.
- API tokens, service principals, `trusted-workspace` principals and scheduled
  workflow grants do not follow links.

### Link protocol

The functions are in `convex/accountLinks.ts`, with portable logic in
`shared/functions/accountLinks.ts`. A session counts as fresh when
`authenticatedAt` is within 15 minutes. A code lives for 10 minutes.

| Function | Caller | Result |
| --- | --- | --- |
| `accountLinks:begin` (mutation, no args) | Identity A, fresh session | `{ status: "started", code, expiresAtISO }`, `{ status: "reauthentication-required" }`, `{ status: "identity-disabled" }` or `{ status: "unauthenticated" }`. It cancels A's earlier pending requests. Only the SHA-256 of the code is stored. |
| `accountLinks:preview` (query, `{ code }`) | Identity B, fresh session | `{ status: "ready", initiator, current, conflicts: [] }` or a failure status |
| `accountLinks:confirm` (mutation, `{ code }`) | Identity B, fresh session | `{ status: "linked" }` or a failure status. It consumes the code. |
| `accountLinks:cancel` (mutation, `{ code }`) | Either side | `{ status: "cancelled" }`, `{ status: "invalid" }` or `{ status: "unauthenticated" }` |
| `accountLinks:overview` (query) | Any signed-in identity | `{ identities: [{ issuer, subject, email?, name?, current, linkedAtISO?, workspaces: [{ societyId, name, role, status }] }] }` |
| `accountLinks:unlink` (mutation, `{ issuer, subject }`) | An identity in the same person | `{ status: "unlinked" }`, `{ status: "not-linked" }` or `{ status: "unauthenticated" }` |

The failure statuses are `invalid`, `expired`, `same-account`, `already-linked`,
`reauthentication-required`, `conflict` (with
`conflicts: [{ workspaceName }]`), `identity-disabled` and `unauthenticated`.
`initiator` and `current` have the shape
`{ email?, name?, workspaces: [{ name, role, status }] }`.

Confirm rules:

- The code is pending and not expired. B differs from A. B's session is fresh.
- Neither external identity is Disabled. The external identity rows are created
  if they are missing.
- **Conflict check:** the union of both sides' identities, including people
  already linked on either side, may hold at most one membership of any status
  per workspace. Otherwise the link is refused and a `refused` event is written.
- If neither side has a person, a new person is created with both links. If one
  side has a person, the other identity joins it. If both have different people,
  B's person's links move to A's person and B's person is set to Disabled.
- A `linked` event lists every identity in the resulting person.

Proof of both sides: A proves control by holding a fresh session when the code
is issued, because the code is returned only to that session. B proves control
by completing its own normal sign-in, under the destination's own rules, within
the window. The browser keeps the code only in `sessionStorage`, never in a URL.
The confirm screen shows the email address and workspaces of both accounts, so a
person cannot be tricked into confirming a link to an account they don't
recognise.

Unlinking removes one identity from the person. Each identity keeps its own
Better Auth user and credentials, so every identity can still sign in on its own.
A person left with a single link is removed.

Operator functions (internal, deployment access only):

| Function | Result |
| --- | --- |
| `accountLinks:operatorInspect` (query, `{ issuer, subject }`) | `{ state, person, people, identities: [{ issuer, subject, email?, name?, linkedAtISO?, externalIdentity, memberships: [{ userId, societyId, workspaceName, role, status }] }], events }`. `people` lists every person the identity is actively linked to (explains `blocked`). `events` are the last 50 link events about those people or identities. |
| `accountLinks:operatorUnlink` (mutation, `{ issuer, subject, reason }`) | Same semantics as `unlink`, for every Active link of the identity, including a Disabled person. Writes `unlinked` with actor `operator` / `deployment-operator` and the reason. `{ status: "unlinked", people: [{ personAccountId, personRemoved }] }` or `{ status: "not-linked" }`. |
| `users:operatorRetireMembership` (mutation, `{ retireUserId, keepUserId, reason }`) | Both rows in one workspace; keep Active and bound; retire not the last Active Owner. See [Known limitations](#known-limitations). Writes a `membership-merged` activity row (actor "Deployment operator"). Returns `{ status: "retired", societyId, retiredUserId, keptUserId, keptRole, retiredRole, retiredIdentity, roleNotCarried? }`. |

On a domain whose workspace requires Microsoft, `/login` shows only Microsoft,
except during "Link an existing account" (`?linkAccount=1`, or a redirect to
`/account/link` or `/account/link/confirm`): then a password form appears below
it, unless the deployment requires Microsoft (`authCapabilities.microsoft.required`,
which refuses `/sign-in/email`). The rule is `signInOptions` in
`src/auth/signInOptions.ts`. A password session there still can't open the
workspace; the link pages sit outside the workspace gate.

### Sign-in methods on one Better Auth user

Provider linking is off. `hostedAuth.ts` sets
`accountLinking: { enabled: false, disableImplicitLinking: true, trustedProviders: [] }`,
so neither a matching email nor Better Auth's `linkSocial` can add a provider to
a login. `linkSocial` is disabled because the Convex cross-domain plugin sets
`skipStateCookieCheck`: an attacker could start a Microsoft link and have a
victim finish it in another browser, attaching the victim's Microsoft identity
to the attacker's login.

The **Sign-in methods** page is therefore read-only for providers. It still
lists linked logins (the person-level links above) with **Unlink**. A person who
needs Microsoft sign-in gets an operator-provisioned Microsoft login
(`entraProvisioning:registerDirectoryMember`) and joins it to their existing
login with **Link an existing account**. An operator can still attach Microsoft
to an existing login with `registerDirectoryMember`'s `existingAuthUserId`,
after confirming the person out of band.

## Membership lookup returned to the app

`http:currentPrincipalMemberships` returns:

```ts
{
  status: "bound" | "needs-invitation" | "membership-disabled" | "ambiguous-binding"
        | "mfa-required" | "sign-in-required" | "unauthenticated";
  authSubject?: string; authIssuer?: string; authProvider?: string;
  memberships: Array<{ userId; role; user; society /* + logoUrl, logoDarkUrl, letterheadUrl */;
                       canonicalOrigin?: string; viaLinkedIdentity: boolean }>;
  lockedWorkspaces: Array<{ id; name; reason: "mfa" | "microsoft" | "email-domain";
                            canonicalOrigin?: string; logoUrl?: string; supportEmail?: string;
                            allowedEmailDomains?: string[] /* email-domain locks only */ }>;
  workspaceMfaAvailable: boolean; secondFactorVerified: boolean;
  sessionMethods: { microsoft: boolean };
  linkedIdentityCount: number;
}
```

When nothing is accessible but some workspaces are locked, the status is
`mfa-required` if every lock is an MFA lock, and `sign-in-required` otherwise.

## Domains

`shared/workspaceDomains.ts` normalizes origins and looks them up. The table
stores exact origins.

- `workspaceDomains:upsert` (internal) takes `{ origin, societyId, primary, status, note? }`.
  It requires the origin to appear in the deployment's `SITE_URL` list, and it
  keeps at most one Active primary per workspace and one Active row per origin.
- `workspaceDomains:list` and `workspaceDomains:audit` (internal) are for
  operator inspection.
- `workspaceDomains:resolveOrigin` (public query, `{ origin }`) returns `null`
  or `{ societyId, workspaceName, origin, logoUrl?, logoDarkUrl?, signIn: { requiredMethod, supportEmail? } }`.
  It only exposes what that domain's own sign-in page already shows.

Frontend startup on a mapped origin:

1. An explicit choice wins: a handoff `workspace` parameter or
   `refreshMembership(id)`.
2. Otherwise the mapped workspace opens if the person can reach it.
3. If the mapped workspace is locked, the lock screen offers the missing step
   (for example **Continue with Microsoft for DDC North**).
4. If the person has no membership there, a "no access to this workspace" page
   lists their other workspaces. It never opens a different organization silently.

An unmapped origin behaves as before: it uses the remembered workspace, else the
first one. On a mapped origin, the switcher sends a workspace that has a
different canonical origin through a handoff to that origin. A workspace without
a canonical origin switches in place. A handoff only runs between two mapped
origins.

Provisioning, reset and invitation links follow the canonical origin. AI
connector OAuth consent follows the server URL the person connected with:
`<convex site>/mcp/<app host>` is approved on that `SITE_URL` origin, and the
completion is accepted only from the origin stored with the request. Plain
`/mcp` uses the first `SITE_URL` origin, and `SOCIETYER_MCP_OAUTH_CONSENT_URL`
overrides both. Settings → AI connectors shows the URL for the domain it's on.
See [mcp-connector.md](../mcp-connector.md#shared-deployments).

## Access requests

A signed-in person who isn't a member can ask to join a workspace, if that
workspace allows it; its Owners and Admins approve or decline. Tables are in
`convex/tables/accessRequests.ts`, logic in `shared/functions/accessRequests.ts`,
and the hosted wrappers in `convex/accessRequests.ts`. Local and demo runtimes
reject the writes (`STATIC_UNSUPPORTED_WRITES`).

| Table | Purpose |
| --- | --- |
| `workspaceAccessRequestSettings` | `{ societyId, enabled, defaultRole: "Viewer" \| "Member", message?, updatedAtISO, updatedByUserId }`. No row means off. |
| `workspaceAccessRequests` | `{ societyId, requesterIssuer, requesterSubject, requesterAuthProvider?, email?, emailVerified, name?, note?, status: "pending" \| "approved" \| "declined" \| "withdrawn", createdAtISO, decidedAtISO?, decidedByUserId?, grantedRole?, membershipId? }`, indexed `by_society_status` and `by_requester` (issuer, subject, createdAtISO) |

**Discovery rule.** A non-member can only name a workspace through its domain:
`resolveOrigin` gives the `societyId` for the origin they're on. A workspace is
open for requests only when it has an Active `workspaceDomains` row whose origin
is in `SITE_URL` and resolves uniquely to it, **and** an enabled settings row.
Otherwise every requester function behaves as if requests were off, so an ID
alone reveals nothing. There is no directory of workspaces.

**Requester.** Only a deployment-signed user session (`verified-jwt`, with a
`societyer_session` id, not a gateway or workspace-scoped principal) can ask. The
request stores that session's exact issuer and subject, never anything from the
client.

| Function | Caller | Result |
| --- | --- | --- |
| `accessRequests:availability` (query, `{ societyId }`) | Signed-in person | `{ enabled: false }`, or `{ enabled: true, message?, alreadyMember, existing?: { id, status, createdAtISO } }`. `alreadyMember` and `existing` are only the caller's own. |
| `accessRequests:submit` (mutation, `{ societyId, note? }`) | Signed-in person | `{ status: "requested" \| "already-requested", id, createdAtISO }`, or `unavailable`, `email-unverified`, `identity-disabled`, `already-member`, `rate-limited`, `unauthenticated` |
| `accessRequests:withdraw` (mutation, `{ id }`) | The exact identity that asked | `withdrawn`, `not-pending`, `not-found`, `unauthenticated` |
| `accessRequests:mine` (query) | Signed-in person | Own `pending` and last-30-days `declined` requests: `[{ id, societyId, workspaceName, status, createdAtISO, decidedAtISO? }]` |
| `accessRequests:listForWorkspace` (query, `{ societyId }`) | Owner or Admin | Pending requests plus the 10 latest decided: `{ id, status, email, emailVerified, name, note, createdAtISO, decidedAtISO?, grantedRole?, decidedBy? }`. No issuer or subject. |
| `accessRequests:approve` (mutation, `{ id, role }`) | Owner or Admin | `{ status: "approved", membershipId }`, or `not-pending`, `already-member`, `identity-disabled`, `email-in-use` |
| `accessRequests:decline` (mutation, `{ id }`) | Owner or Admin | `declined` or `not-pending` |
| `accessRequests:getSettings` (query, `{ societyId }`) | Owner or Admin | `{ enabled, defaultRole, message?, requestOrigin? }` |
| `accessRequests:setSettings` (mutation, `{ societyId, enabled, defaultRole, message? }`) | Owner or Admin | `null` |

Rules:

- `submit` needs a verified email (approvers decide on it), refuses anyone with a
  membership row of **any** status in the workspace across `linkedIdentityKeys`
  (a Disabled member goes through an administrator), returns the existing pending
  request instead of a second one, and allows 5 new requests per identity per 24
  hours across workspaces (withdrawn ones count) and 100 pending per workspace.
- `submit` writes an `activity` row and an addressed `notifications` row for each
  Active, bound Owner and Admin, and schedules `accessRequests:deliverEmail`: a
  plain-text email naming only the verified requester email, the workspace and
  the Users page link. The note is shown only on the Users page.
- `approve` and `decline` use `requireMembershipManager`; a missing or foreign
  request id gives the same "Access request not found." error. `approve` accepts
  Admin, Director, Member or Viewer, and only an Owner grants Admin. Owner is
  never granted from a request.
- `approve` re-checks at decision time that the requester (and every identity
  linked to it) has no membership row there, that their external identity isn't
  Disabled, and that no user in the workspace already has that email. It then
  inserts one Active `users` row bound to the stored issuer and subject through
  `ensureExternalIdentityPortable`, and records the decision and an audit row.
- Approval grants nothing more: `resolvePrincipalUser` still applies the
  workspace's sign-in policy and MFA to every session, so an approved password
  login on a Microsoft workspace sees the lock screen.

The "No access to <workspace>" screen (and, for a person with no workspace at
all, `AuthGate` on a mapped origin) shows the request form when `availability`
is enabled. **My workspaces** lists `mine`. The Users page has the decision list
and the settings.

## Cross-domain session handoff

Each frontend origin keeps its own copy of the session (the cross-domain plugin
stores it in that origin's `localStorage`), so a second domain starts signed out.
The handoff gives the destination the **same** session. It starts on the
destination, so a link minted somewhere else can't sign a victim in as the
attacker.

1. The source navigates to
   `<targetOrigin>/handoff#from=<sourceOrigin>&workspace=<societyId>&next=<same-origin path>`.
2. The destination checks that `from` is a mapped origin (`resolveOrigin`),
   creates a random nonce in its own `sessionStorage`, and navigates to
   `<sourceOrigin>/handoff#issue&target=<targetOrigin>&challenge=<sha256(nonce)>`.
3. The source, signed in, calls `POST /api/auth/societyer-handoff/create` with
   `{ targetOrigin, challenge }`. The target must be a trusted `SITE_URL` origin
   other than the request origin. The endpoint stores a verification value
   `societyer-handoff:<sha256(code)>` holding the session, user, target origin and
   challenge, valid for 60 seconds, and the source navigates to
   `<targetOrigin>/handoff#code=<code>`.
4. The destination removes the fragment from history at once and calls
   `POST /api/auth/societyer-handoff/redeem` with `{ code, verifier: nonce }`.
   The request `Origin` must equal the stored target origin, and
   `sha256(verifier)` must equal the stored challenge. The value is deleted on
   first use. The referenced session must still be valid and belong to the
   stored user. The endpoint then delivers that same session through the
   cross-domain cookie transport.
5. The destination selects the workspace only if the person is a member, and
   continues to `next` if it is a same-origin `/app` path.

Both endpoints are throttled per client IP. Handoff only runs between mapped
origins.

Because the session itself is shared rather than copied, its expiry, Entra proof
and second-factor state carry over unchanged. A handoff can never upgrade a
password session into a Microsoft session. Signing out on either domain ends the
shared session.

## Storage policy

`shared/workspaceStoragePolicy.ts` resolves the effective policy for a workspace:

- `nativeUploads` is disabled when the deployment sets
  `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE` or the workspace row says `disabled`.
  The deployment flag is a ceiling.
- `documentVersionProvider: "sharepoint"` is only possible when the deployment
  SharePoint connection is configured, and requires `nativeUploads: "disabled"`.
  `native` uses the deployment's non-SharePoint version storage (RustFS or R2
  when configured) even where SharePoint is the deployment default, and requires
  native uploads. `deployment-default` keeps today's behaviour.

Every native upload and document-version path passes the workspace ID to the
async guard. `workspaceStoragePolicies:forWorkspace` (a member query) returns
`{ nativeUploads: boolean, documentVersionProvider: "native" | "sharepoint" }`.
The UI uses it to hide upload controls, while the server guard is what actually
enforces the policy. The build flags `VITE_DISABLE_NATIVE_FILE_STORAGE` and
`VITE_DOCUMENT_STORAGE_PROVIDER` remain a ceiling for every workspace opened in
that build.

Meeting-source uploads through the meeting-transfer Worker go to the
deployment's SharePoint connection, so `meetingSources:allocate` refuses any
workspace whose effective provider isn't SharePoint.

## Workspace defaults

`SOCIETYER_INITIAL_INVOICE_TEMPLATE` still applies to workspaces created on that
deployment, and a shared deployment leaves it unset. To install the First Form
template for one workspace, the operator runs
`workspaceDefaults:installInvoiceTemplate({ societyId, template: "firstform" })`.

Provisioning, password-reset and invitation links use the workspace's canonical
origin when one is configured, and otherwise the first `SITE_URL` origin.

## Access-boundary summary

| Request | Decided by |
| --- | --- |
| Reading or writing workspace data | Exactly one Active membership across linked identities, then the sign-in policy and MFA on the current session, then the role or permission |
| Domain | Presentation, the default workspace, and which workspace a non-member may ask to join |
| Access request | An Owner or Admin approving it, within their own role authority |
| Link | Fresh proof of both identities and no membership overlap |
| Handoff | The same session on another trusted origin. It grants nothing new. |
| Storage | Workspace policy within the deployment ceiling, enforced on the server |

## Known limitations

- AI connector (MCP) tokens can't show session evidence when used, so the
  sign-in policy is checked when they are minted. Setting a policy that
  requires Microsoft or an email domain revokes the workspace's existing
  connector tokens. API tokens are workspace integration credentials and are
  not affected by sign-in policy.
- Offline meeting downloads are precomputed per membership without a live
  session (`sessionChecksDeferred`); the sign-in policy and MFA are enforced on
  the real session when downloads are fetched.
- Operators unlink with `accountLinks:operatorUnlink` and see a person's links
  with `accountLinks:operatorInspect` (internal functions; the event actor is
  `operator` / `deployment-operator`). Two memberships in one workspace are
  reconciled with `users:operatorRetireMembership`, not merged: the retired row
  stays (so ids in history still resolve) but becomes Disabled, loses its
  binding (`authIssuer`, `authSubject`, `authProvider`, `externalIdentityId`)
  and gets `mergedIntoUserId` / `mergedAtISO`. Unbound, it no longer matches
  `by_auth_identity`, so resolution, the link conflict check, the picker and
  invitations ignore it; it can't be reactivated, re-bound or invited. The kept
  row's role never changes; a higher retired role is only reported. References
  to the retired id are not re-pointed.
- Records move between deployments only through the operator's workspace
  transfer (`convex/workspaceTransfer.ts`, internal functions); see
  [migration-and-cutover.md](migration-and-cutover.md#workspace-transfer).
