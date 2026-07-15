# Workstream E — trusted portable principal design proposal

## Recommendation

Add a non-optional, runtime-derived `principal` to every portable context, make portable functions authenticated by default, and explicitly mark the small public surface. In hosted mode, the principal must come from a JWT verified by Convex through `ctx.auth.getUserIdentity()`; in local/Electron mode, it comes from the trusted workspace configuration. Caller-supplied `actingUserId` must never override it.

This closes the spoofing path without abandoning the shared portable handlers.

## 1. Findings

### Current `actingUserId` flow

The browser stores the selected user ID in `localStorage`; `useCurrentUserId()` returns it, and `useCurrentUser()` calls the currently unauthenticated `users.get` query with that ID ([useCurrentUser.ts:9](../src/hooks/useCurrentUser.ts:9), [useCurrentUser.ts:29](../src/hooks/useCurrentUser.ts:29), [useCurrentUser.ts:43](../src/hooks/useCurrentUser.ts:43)).

Components then put that value into query/mutation arguments. For example, document versions derive it directly from `useCurrentUserId()` ([DocumentVersions.tsx:38](../src/components/DocumentVersions.tsx:38)). The same pattern appears throughout finance, elections, users, documents, grants, secrets, AI, workflows, and integrations.

Convex validators accept the value and forward the whole argument object to shared handlers. `users.upsert`, for example, accepts `actingUserId`, passes it to `requireRole`, then removes it before writing ([convex/users.ts:66](../convex/users.ts:66), [convex/users.ts:80](../convex/users.ts:80)). `requireRolePortable` reads precisely that supplied user row and trusts its role ([access.ts:30](../shared/functions/access.ts:30), [access.ts:45](../shared/functions/access.ts:45)).

The REST gateway is somewhat safer at its outer boundary: it deletes a caller’s `actingUserId` and injects the gateway-resolved actor ([shared.ts:186](../server/api-gateway/shared.ts:186), [shared.ts:200](../server/api-gateway/shared.ts:200)). It resolves API-key, local-development, or Better Auth actors before dispatch ([api-gateway.ts:1442](../server/api-gateway.ts:1442), [api-gateway.ts:1476](../server/api-gateway.ts:1476)). However, its Convex client itself is unauthenticated ([api-gateway.ts:577](../server/api-gateway.ts:577)), so the injected argument is still only an assertion once it reaches Convex.

A read-only grep snapshot found:

- 927 `actingUserId` occurrences across 120 files.
- 159 Convex `actingUserId: v.optional(...)` validators.
- 112 shared-handler type/signature declarations.
- 260 frontend occurrences across 44 files.
- 43 direct `useCurrentUserId()` consumers.
- Approximately 133 frontend payload-shaped uses.

These are estimates rather than an AST inventory: some occurrences are types, audit attribution, nested calls, or legacy static-runtime cases. The 159 Convex validators are the best rough estimate of affected callable endpoints.

### Hosted authentication today

`VITE_AUTH_MODE` supports only `none` and `better-auth` ([authMode.ts:1](../src/lib/authMode.ts:1)). Better Auth is a separate Express/SQLite service started by `auth:server` ([package.json:49](../package.json:49), [auth-server.ts:19](../server/auth-server.ts:19)); its current configuration enables email/password sessions but no JWT/JWKS plugin ([auth-config.ts:29](../server/auth-config.ts:29)).

The React client uses the Better Auth cookie session, but wraps the data client in a plain `ConvexProvider` ([AuthProvider.tsx:101](../src/auth/AuthProvider.tsx:101), [main.tsx:160](../src/main.tsx:160)). The `ConvexReactClient` is created with only a URL; no token provider is installed ([convex.ts:1](../src/lib/convex.ts:1)). There is no `convex/auth.config.ts`, and the repository’s own security note confirms there are no `ctx.auth.getUserIdentity()` calls ([security-and-auth-posture.md:9](../docs/security-and-auth-posture.md:9)).

After a Better Auth session loads, the UI sends `authSubject`, email, display name, and `emailVerified` to a public Convex mutation ([AuthProvider.tsx:131](../src/auth/AuthProvider.tsx:131), [convex/users.ts:54](../convex/users.ts:54)). That mutation may:

- Match by the asserted subject or email.
- Link a member by asserted email.
- Update verification state.
- Create the first Owner, a Member, or an arbitrary Viewer.

That behavior is in [shared/functions/users.ts:64](../shared/functions/users.ts:64) through [shared/functions/users.ts:130](../shared/functions/users.ts:130).

`users.list`, `get`, `getByEmail`, and `getByAuthSubject` have no access check ([convex/users.ts:30](../convex/users.ts:30)). More generally, authentication is absent from both query and mutation adapters: the hosted adapter constructs portable contexts with only the database, capabilities, and nested-call methods ([convex/lib/portable.ts:137](../convex/lib/portable.ts:137)).

### Local and Electron identity today

The portable context has no identity field ([shared/portable/ctx.ts:105](../shared/portable/ctx.ts:105)). `PortableRuntimeOptions` accepts only a database and capabilities, and every local invocation constructs a fresh context from those two values ([shared/portable/define.ts:48](../shared/portable/define.ts:48), [shared/portable/define.ts:90](../shared/portable/define.ts:90)).

The static/Dexie client constructs that runtime with `buildLocalCapabilities()` and no identity ([staticConvex.ts:1918](../src/lib/staticConvex.ts:1918)). Electron uses a blank Dexie seed for a real workspace, while browser/demo uses the fixture client ([localWorkspaceAdapter.ts:22](../src/lib/localWorkspaceAdapter.ts:22), [dexieWorkspaceClient.ts:4](../src/lib/dexieWorkspaceClient.ts:4)).

Local data mode always bypasses Better Auth and reports `isAuthenticated: true` ([AuthProvider.tsx:29](../src/auth/AuthProvider.tsx:29), [AuthProvider.tsx:46](../src/auth/AuthProvider.tsx:46)). Electron’s workspace metadata contains an ID and filesystem information but no user identity ([electron/workspace.ts:9](../electron/workspace.ts:9)). The UI still offers a local user picker that changes the acting user in browser storage ([UserPicker.tsx:127](../src/components/UserPicker.tsx:127), [UserPicker.tsx:174](../src/components/UserPicker.tsx:174)).

Therefore Electron is presently a single trusted device/workspace island, not a cryptographically authenticated single user. It can contain several logical user rows and lets the operator switch among them. The demo explicitly seeds Owner, Director, and Admin users ([staticConvexFixtures.ts:98](../src/lib/staticConvexFixtures.ts:98)).

## 2. Proposed portable principal

Add this discriminated union to the portable contract:

```ts
type RuntimeKind =
  | "convex-hosted"
  | "browser-local"
  | "electron-local"
  | "test";

type PortablePrincipal =
  | {
      kind: "anonymous";
      runtime: RuntimeKind;
      assurance: "none";
    }
  | {
      kind: "user";
      runtime: RuntimeKind;
      assurance: "verified-jwt" | "trusted-workspace";
      subject: string;
      issuer?: string;
      tokenIdentifier?: string;
      email?: string;
      emailVerified?: boolean;

      // Present for a resolved local principal; optional for a hosted identity
      // that may have one user row per society.
      userId?: string;
      societyId?: string;
    }
  | {
      kind: "service";
      runtime: RuntimeKind;
      assurance: "verified-jwt" | "trusted-internal";
      subject: string;
      societyId?: string;
      actorUserId?: string;
      clientId?: string;
      scopes: readonly string[];
    };
```

Then:

```ts
interface PortableQueryCtx {
  db: PortableDbReader;
  capabilities: PortableCapabilities;
  principal: PortablePrincipal;
  runQuery(...): Promise<unknown>;
}
```

The same field belongs on `PortableMutationCtx`.

Design rules:

- `principal` is never optional. Public calls receive an explicit anonymous principal.
- Hosted `issuer`, `subject`, and `tokenIdentifier` come only from Convex’s verified identity. The installed Convex type defines `tokenIdentifier` as issuer plus subject and exposes all three fields ([authentication.ts:100](../node_modules/convex/src/server/authentication.ts:100)).
- Do not place `role` in the trusted JWT principal. Resolve role/status from the current user row on every request, so disabling or demoting a user takes effect without waiting for token expiry.
- `userId` is optional for a hosted user because the current model permits one auth subject to have a separate user row in each society; the existing gateway query filters subject matches by `societyId` ([convex/apiPlatform.ts:639](../convex/apiPlatform.ts:639)).
- Never put the raw JWT, session cookie, secret, or arbitrary provider claims into the portable context.

Add shared helpers:

```ts
requireAuthenticated(ctx): PortableUserOrServicePrincipal

resolvePrincipalUser(ctx, societyId): Promise<UserRow>

requirePrincipalRole(ctx, societyId, required): Promise<{ user: UserRow }>

principalUserId(ctx, societyId): Promise<string>
```

`requireRolePortable` should become a compatibility wrapper over `requirePrincipalRole`. It must not look up `args.actingUserId` as the source of authority.

For functions whose society is known only after loading a target row, load that row first and then resolve the principal against `row.societyId`.

### Secure-by-default function metadata

Extend portable definitions, which currently carry only kind, name, and handler ([shared/portable/define.ts:22](../shared/portable/define.ts:22)):

```ts
type PortableAccess =
  | { audience: "public" }
  | { audience: "authenticated" }
  | { audience: "service"; scopes: readonly string[] };

definePortableQuery({
  name: "...",
  access: { audience: "authenticated" }, // default
  handler,
});
```

Defaulting to authenticated is important: otherwise every new handler must remember to call a helper. Role and society checks remain in domain handlers because many functions derive their society from a target record.

## 3. Hosted derivation and user resolution

### Establish Convex authentication

There are two viable provider choices:

1. Keep Better Auth and add its JWT/JWKS support, a `convex/auth.config.ts` custom JWT provider, and a React token bridge compatible with `ConvexProviderWithAuth`.
2. Replace the hosted login provider with a provider that already has first-class Convex integration.

The current repository does not contain enough wiring to select between these automatically. It only has Better Auth cookie sessions today, so retaining Better Auth requires new token issuance and JWKS configuration.

Change the hosted context builders to asynchronous factories:

```ts
async function toPortableQueryCtx(ctx, capabilities) {
  const identity = await ctx.auth.getUserIdentity();
  return {
    db: ...,
    capabilities,
    principal: identity
      ? hostedUserPrincipal(identity)
      : anonymousHostedPrincipal(),
    ...
  };
}
```

The generated Convex wrappers then await the context. Because the registry is already generated from Convex delegations ([portable-functions-architecture.md:195](../docs/portable-functions-architecture.md:195)), this should be a generator change rather than 773 hand edits.

### Replace `resolveAuthSession`

Replace the current public mutation with an authenticated mutation such as:

```ts
users.ensureCurrentMembership({
  societyId,
  invitationToken?: string
})
```

It accepts no `authSubject`, email, display name, verification flag, user ID, or role from the caller. It obtains those from the verified principal.

Schema changes:

- Add `authIssuer`.
- Add `authTokenIdentifier`.
- Index by `authTokenIdentifier`, preferably together with `societyId`.
- Keep `authSubject` temporarily for migration.

The current user table stores only provider and bare subject ([platform.ts:9](../convex/tables/platform.ts:9)). A bare subject is not sufficient if deployments may change or combine issuers.

Resolution policy:

1. Match `(societyId, authTokenIdentifier)`.
2. Otherwise accept a valid invitation explicitly issued to the verified email.
3. Optionally link a pre-existing user/member by verified email only if the product elects to preserve that behavior.
4. Never auto-link using an unverified email.
5. Never create a Viewer in an arbitrary existing society merely because a signed-in identity supplied its ID.
6. Create the first Owner only as part of an atomic “create society for current principal” operation.

The existing role bootstrap allows an unauthenticated first action and permits self-promotion if no qualified user exists ([access.ts:34](../shared/functions/access.ts:34), [access.ts:49](../shared/functions/access.ts:49)). Keep those recovery semantics only for trusted local workspaces, or replace them with a service-token recovery tool in hosted deployments.

The frontend boot sequence should become:

```text
Better Auth login
  → obtain JWT for Convex
  → Convex auth becomes ready
  → query users.currentMemberships
  → select an allowed society
  → load the application
```

That removes the current circular sequence in which the client first queries societies and then asserts which society and identity should be linked.

### Protect user and society discovery

- `users.list`: require membership plus `users:read`.
- `users.get`: allow self, or require `users:read` in the target user’s society.
- `getByEmail` and `getByAuthSubject`: make internal-only.
- Add `users.me`/`users.currentMemberships`; do not require a user ID argument.
- `society.list`: return only societies linked to the verified identity.
- `permissions.myPermissions`: derive the user from the principal rather than its current caller-supplied `userId` ([permissions.ts:21](../convex/permissions.ts:21)).

### Service and gateway calls

The API gateway already authenticates API keys and Better Auth sessions, but it calls Convex using an unauthenticated shared `ConvexHttpClient`. Before rejecting `actingUserId`, it needs a trusted Convex-side service identity.

Recommended approach:

- After the gateway verifies an API key/session, mint or exchange a short-lived signed JWT containing `principal_kind=service`, fixed `societyId`, scopes, client ID, and optional audit actor.
- Use a per-request authenticated Convex client/token context.
- Convex derives a service principal from the verified claims.
- Domain handlers require both society equality and the necessary scope.

Maintenance jobs and provider webhooks should remain internal/service-principal paths, not anonymous public mutations.

## 4. Explicit unauthenticated surface

These functions should remain public, subject to strict output shaping and abuse controls:

| Function | Reason |
|---|---|
| `transparency.publicCenter` | Drives `/public/:slug` ([PublicTransparency.tsx:9](../src/pages/PublicTransparency.tsx:9)); it already checks the public flag/module and returns published material ([transparency.ts:88](../shared/functions/transparency.ts:88)). |
| `publicPortal.volunteerIntakeContext` | Supplies the public volunteer form and checks public/module flags ([publicPortal.ts:34](../shared/functions/publicPortal.ts:34)). |
| `publicPortal.grantIntakeContext` | Supplies the public grant form and filters to open grants ([publicPortal.ts:68](../shared/functions/publicPortal.ts:68)). |
| `volunteers.submitApplication` | Public form submission ([VolunteerApply.tsx:22](../src/pages/VolunteerApply.tsx:22), [convex/volunteers.ts:43](../convex/volunteers.ts:43)). |
| `grants.submitApplication` | Public grant submission ([GrantApply.tsx:24](../src/pages/GrantApply.tsx:24), [convex/grants.ts:166](../convex/grants.ts:166)). |
| `partyPortals.center` | Bearer-token stakeholder portal ([partyPortals.ts:41](../convex/partyPortals.ts:41)); it rejects unknown, revoked, or expired tokens ([partyPortals.ts:55](../shared/functions/partyPortals.ts:55)). |
| `publicPortal.getSocietyBySlug` | Semantically public, although no repository caller was found. Decide whether it is an external API contract; otherwise remove it. It currently returns only selected public fields ([publicPortal.ts:18](../shared/functions/publicPortal.ts:18)). |

The two submission mutations need hardening. They currently take `societyId` directly, and the volunteer handler checks only module enablement—not the public-intake flag ([volunteers.ts:108](../shared/functions/volunteers.ts:108)). Prefer `{ slug, intakeToken, formData }`, re-resolve the society, and verify the relevant public flag inside the mutation. Ignore caller-supplied `memberId` and `source` on anonymous submissions. Add rate limiting, payload limits, and ideally CAPTCHA or an equivalent abuse control.

Public HTTP exceptions also remain externally reachable:

- Stripe, Resend, and Twilio callbacks, but only after their existing signature checks ([http.ts:403](../convex/http.ts:403), [http.ts:422](../convex/http.ts:422), [http.ts:509](../convex/http.ts:509)).
- The bearer-token calendar feed ([http.ts:585](../convex/http.ts:585)).
- The AI streaming endpoint must not remain public: it currently accepts `societyId` and `actingUserId` from the body and permits any origin ([http.ts:23](../convex/http.ts:23), [http.ts:178](../convex/http.ts:178)).

Everything else should require a user or service principal by default.

## 5. Local and demo derivation

Add a principal provider to `PortableRuntimeOptions`:

```ts
interface PortableRuntimeOptions {
  db: TransactionalDb;
  capabilities: PortableCapabilities;
  principalProvider:
    () => PortablePrincipal | Promise<PortablePrincipal>;
}
```

Every local query, mutation, and nested call must use the same principal for that invocation chain.

### Electron/local workspace

Treat the workspace as one trusted operator unless the product explicitly adopts local multi-user authentication.

- Add a local principal identity such as `local:<workspaceId>`.
- Persist or deterministically resolve a `principalUserId` for each society.
- When the first local society is created, atomically create its Owner user and bind that user to the workspace principal.
- Do not take the authority-bearing user ID from function arguments.
- The local user picker may remain as an explicit “audit attribution/demo impersonation” feature, but changing it must update the runtime’s principal provider—not individual function arguments.

This is still trust in possession of the workspace/device, not proof of a human identity. That is consistent with the current local capabilities: Electron has local data and native files but no live collaboration or server actions ([runtimeMode.ts:76](../src/lib/runtimeMode.ts:76)).

### Demo

Seed the demo principal as:

```ts
{
  kind: "user",
  runtime: "browser-local",
  assurance: "trusted-workspace",
  subject: "demo:static_user_owner",
  userId: STATIC_DEMO_USER_ID,
  societyId: STATIC_DEMO_SOCIETY_ID
}
```

Those stable IDs already exist ([staticIds.ts:1](../src/lib/staticIds.ts:1)), and the corresponding row is an Owner ([staticConvexFixtures.ts:98](../src/lib/staticConvexFixtures.ts:98)). Optional role-simulation controls can deliberately swap the entire demo principal.

## 6. Staged migration

| Stage | Work | Compatibility behavior | Rough effort |
|---|---|---|---|
| 0. Provider decision and tests | Select JWT issuer; define public allowlist; add forged-actor, anonymous-access, and cross-society tests. | No runtime behavior change. | 2–4 engineer-days |
| 1. Principal plumbing | Add principal types, async hosted adapters, local principal provider, definition access metadata, service-principal shape, schema indexes/backfill tooling. | `actingUserId` still accepted. Hosted calls require a verified principal except allowlisted public functions. | 4–7 days |
| 2. Identity boundary | Replace `resolveAuthSession`; secure society/user/permissions discovery; implement onboarding/invitation policy; wire gateway service JWTs. | If an arg is supplied in hosted mode, reject a mismatch and ignore a matching value. Local legacy fallback logs a development warning. | 4–7 days |
| 3. High-risk families | Migrate direct comparisons and attribution to principal helpers. | Arg remains validator-compatible but is never authoritative. Emit telemetry/deprecation warnings. | 6–10 days |
| 4. Broad mechanical migration | Remove frontend payloads, shared signatures, validators, nested forwarding, and static-runtime cases. | Old clients may still send the now-ignored field where validators temporarily permit it. | 8–15 days |
| 5. Enforcement cleanup | Delete the compatibility resolver and old field; make unauthenticated non-public calls fail consistently. | Legacy clients break unless kept on an explicitly fenced legacy deployment. | 3–5 days |

Estimated total: roughly 5–8 engineer-weeks, excluding identity-provider procurement, production deployment coordination, and external API client migration.

Recommended family order:

1. `users`, society onboarding, permissions, API keys/webhooks, service authentication.
2. Secrets, AI provider settings, billing/subscriptions, accounting and other money paths.
3. Communications/email/SMS, documents/storage/material access, signatures, elections.
4. Workflows, AI actions, Paperless, grant integrations, generic HTTP.
5. Remaining CRUD and audit-attribution uses.

Any field representing “who performed this action”—`createdByUserId`, `reviewedByUserId`, `approvedByUserId`, and similar—should normally come from the principal. If administrators need “act on behalf of,” model it explicitly as a delegated target plus reason and audit both the real principal and represented user.

## 7. Capabilities dependency

The capability roadmap already separates pure database operations from connected/server-only work ([portable-functions-architecture.md:130](../docs/portable-functions-architecture.md:130)). Interfaces and throwing stubs may be developed before principal support, but side-effecting implementations should not be exposed first.

Principal is a release prerequisite for:

- **Secrets/keychain:** create, update, list, reveal, and delete. `secrets.list` currently has no role check, while reveal trusts a supplied user ID ([convex/secrets.ts:120](../convex/secrets.ts:120), [convex/secrets.ts:236](../convex/secrets.ts:236)).
- **Billing:** checkout creates external financial state using caller-supplied society, plan, email, and name ([subscriptions.ts:109](../convex/subscriptions.ts:109)). Require either an authenticated member principal or a narrowly scoped, expiring public checkout token.
- **Email/SMS:** these capabilities cause external communications; authorization must constrain society, purpose, and recipients before provider invocation. The hosted capability bag already wires email and SMS ([capabilities.ts:61](../convex/providers/capabilities.ts:61)).
- **Generic HTTP, accounting/OAuth, Paperless, and workflow relay:** require a user/service principal and scope checks. Electron HTTP must also retain the proposed destination allowlist to avoid becoming an SSRF proxy ([electron-native-capabilities.md:177](../docs/electron-native-capabilities.md:177)).
- **LLM/transcription:** require principal authorization before sending organization data to a provider.
- **Private storage:** upload and private download URLs must be principal-gated; only explicitly published documents may be resolved for an anonymous public context.

The existing roadmap lists billing, email/scheduler, storage, accounting/HTTP, Paperless, transcription, and generic HTTP as capability-tier work ([local-portable-migration-backlog.md:228](../docs/local-portable-migration-backlog.md:228)). Principal should be inserted before its external-services batch, not after it.

## 8. Open product decisions and risks

1. **Hosted provider:** retain Better Auth and add JWT/JWKS, or adopt another Convex-compatible provider. Current Better Auth is cookie-only from Convex’s perspective.

2. **Provisioning:** decide whether verified-email matching is sufficient, invitations are mandatory, or both are allowed. The current “unknown user becomes Viewer” behavior should not survive by accident.

3. **First-owner recovery:** decide on operator/service-token recovery for hosted orphaned societies. Do not retain the public bootstrap/self-promotion exceptions.

4. **Local multi-user:** if Electron must defend against several people sharing a machine/workspace, the trusted-workspace principal is insufficient; it needs local login, session locking, and credential-backed user switching. Today the UI picker is only attribution/impersonation.

5. **Existing deployments:** removing `actingUserId` will break old SPAs, API clients, and the current gateway unless migration flags and service principals are deployed first. Use `legacy → audit → enforce`, but prohibit `legacy` in internet-exposed production.

6. **Identity backfill:** existing rows have only `authProvider` and bare `authSubject`. Backfill may be ambiguous if multiple issuers or duplicate email links exist; generate a conflict report instead of choosing silently.

7. **Public abuse:** volunteer/grant intake, token portals, calendar feeds, and published downloads need rate limiting, token rotation, redaction tests, and enumeration resistance.

8. **Cross-society access:** every handler must derive or load the target society and compare it to the resolved membership/service scope. Authentication alone does not prevent tenant crossover.

9. **Provider/webhook distinction:** signed provider callbacks are authenticated machines, not anonymous users. Keep their externally reachable transport endpoints, but route their database work through internal or scoped service-principal functions.

## Completion criteria

The principal migration is complete when:

- A forged `actingUserId` never changes authorization or attribution.
- Every non-public query, mutation, action, and HTTP action rejects an anonymous hosted caller.
- Public endpoints return only reviewed DTOs and cannot accept a raw society ID to bypass public flags.
- `users.me`, memberships, and society selection work without caller-supplied user IDs.
- Role changes and account disabling take effect from database state.
- Electron/demo work offline with a runtime-populated principal.
- The REST gateway uses a verified service principal.
- No frontend payload contains `actingUserId`, except explicit compatibility tests.
- Billing, email, secrets, private storage, LLM, and HTTP capabilities have principal/scope tests before being enabled.