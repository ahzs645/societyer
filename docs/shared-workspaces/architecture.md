# Shared workspaces and linked sign-in: architecture and contract

Status: implementation contract, November 8, 2026. It turns the
[feasibility review](../audits/2026-11-08-shared-workspaces-review.md) into
concrete tables, functions and screens. The operator steps are in
[operator-runbook.md](operator-runbook.md), the user-facing behaviour is in
[user-guide.md](user-guide.md), and the move from two deployments to one is in
[migration-and-cutover.md](migration-and-cutover.md).

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
| `accountLinkEvents` | Append-only audit of linked, unlinked and refused attempts | Link flow |

When a workspace has no policy row, the existing behaviour applies: sign-in is
`any` and storage follows the deployment default. Existing single-organization
deployments therefore behave exactly as before until an operator adds rows.

`users` rows are not changed. Each one is still one workspace membership bound
to one exact `authIssuer` and `authSubject`. Linking never rebinds a membership,
so authorship and history stay attached to the original membership IDs.

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
| `accountLinks:begin` (mutation, no args) | Identity A, fresh session | `{ status: "started", code, expiresAtISO }`, `{ status: "reauthentication-required" }` or `{ status: "unauthenticated" }`. It cancels A's earlier pending requests. Only the SHA-256 of the code is stored. |
| `accountLinks:preview` (query, `{ code }`) | Identity B, fresh session | `{ status: "ready", initiator, current, conflicts: [] }` or a failure status |
| `accountLinks:confirm` (mutation, `{ code }`) | Identity B, fresh session | `{ status: "linked" }` or a failure status. It consumes the code. |
| `accountLinks:cancel` (mutation, `{ code }`) | Either side | `{ status: "cancelled" }` |
| `accountLinks:overview` (query) | Any signed-in identity | `{ identities: [{ issuer, subject, email?, name?, current, linkedAtISO?, workspaces: [{ societyId, name, role, status }] }] }` |
| `accountLinks:unlink` (mutation, `{ issuer, subject }`) | An identity in the same person | `{ status: "unlinked" }` or `{ status: "not-linked" }` |

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

### Sign-in methods on one Better Auth user

Better Auth's explicit `linkSocial` adds a provider, such as Microsoft, to the
current user. `hostedAuth.ts` sets
`accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: [], allowDifferentEmails: true }`.
Implicit linking by matching email stays off. The Microsoft provider still
enforces its tenant, group, account-type and sign-in recency checks when linking.
Better Auth refuses a provider account that already belongs to another user. The
UI then offers **Link an existing account**.

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
                            canonicalOrigin?: string; logoUrl?: string; supportEmail?: string }>;
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
a canonical origin switches in place.

## Cross-domain session handoff

The destination tab starts every handoff, so a code can only be redeemed by the
browser tab that asked for it. If the source minted codes on its own, anyone
could mint one on their own session (with `curl` and a forged `Origin`) and send
a victim `https://<target>/handoff#code=…`; the victim's browser would redeem it
and work inside the attacker's session (login CSRF). Instead the target keeps a
random verifier in its `sessionStorage` and sends only its SHA-256 to the
source, as in OAuth PKCE. A planted code reaches a tab with no verifier, or the
wrong one, and is refused.

1. The switcher on the source goes to
   `<target>/handoff#from=<source>&workspace=<societyId>&next=<path>`.
2. The target strips the fragment, checks that `from` is another origin that
   `workspaceDomains:resolveOrigin` maps (so no trusted domain becomes an open
   redirect), stores `{ verifier, from, workspace, next }` for two minutes and
   goes to `<source>/handoff#issue=1&target=<target>&challenge=<sha256 hex>`.
3. The source strips the fragment, checks `target` the same way, asks a
   signed-out person to sign in there first, else calls `create` and goes to
   `<target>/handoff#code=<code>`.
4. The target strips the fragment, takes and deletes its stored request (none,
   or expired: refused without calling `redeem`), redeems with the verifier,
   selects the stored workspace only if the person is a member, and continues
   to the stored `next` if it is a same-origin `/app` path. Workspace and path
   never come from the code link.

Two Better Auth endpoints are served by a plugin in `shared/sessionHandoff.ts`
and registered in `hostedAuth.ts`. Both answer `Cache-Control: no-store`.

- `POST /api/auth/societyer-handoff/create`, with the session required and body
  `{ targetOrigin, challenge }`. The request `Origin` must be a trusted app
  origin, and the target a trusted `SITE_URL` origin that differs from it. The
  challenge must be 64 lowercase hex characters. The endpoint stores a
  verification value `societyer-handoff:<sha256(code)>` holding
  `{ sessionId, userId, targetOrigin, challenge }` with a 60-second lifetime,
  and returns `{ code, expiresAt }`.
- `POST /api/auth/societyer-handoff/redeem`, with body `{ code, verifier }` and
  the cross-domain client's `Better-Auth-Cookie` header. The value is deleted
  on first use, before any other check, so a misdirected or planted code is
  burned. The request `Origin` must equal the stored `targetOrigin`, and
  `sha256(verifier)` must equal the stored challenge (constant-time compare).
  The referenced session must still be valid and belong to `userId`. The
  endpoint then sets that same session through the cross-domain cookie
  transport. Create and redeem are throttled by IP.

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
  SharePoint connection is configured. `native` forces Convex storage, which then
  requires native uploads. `deployment-default` keeps today's behaviour.

Every native upload and document-version path passes the workspace ID to the
async guard. `workspaceStoragePolicies:forWorkspace` (a member query) returns
`{ nativeUploads: boolean, documentVersionProvider: "native" | "sharepoint" }`.
The UI uses it to hide upload controls, while the server guard is what actually
enforces the policy.

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
| Domain | Presentation and the default workspace only |
| Link | Fresh proof of both identities and no membership overlap |
| Handoff | The same session on another trusted origin. It grants nothing new. |
| Storage | Workspace policy within the deployment ceiling, enforced on the server |
