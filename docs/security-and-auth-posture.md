# Security & auth posture

This document makes the project's **current** identity/authorization model explicit, because it
is a load-bearing deployment assumption that is not obvious from the code.

The [Convex-hosted authentication pathways](convex-hosted-auth-pathways.md) compare
native Convex Auth with the Better Auth Convex component, including the membership
schema migration and the component's enterprise SSO limitation. That evaluation
does not enable a new broker or change the current posture documented here.

> **Status: rewritten 2026-08-03.** An earlier revision described a "client-asserted
> authorization" model where Convex functions trusted a caller-supplied `actingUserId`. That is
> no longer accurate — the Stage 2 migration replaced it. See `STAGE2-PLAN.md` for the plan and
> per-section status.

## TL;DR

- Convex functions **do** verify identity. `convex/auth.config.ts` registers the selected human broker; in Clerk mode the Better Auth issuer remains a trusted machine signer, `src/auth/AuthProvider.tsx:217` sets the token on the Convex client, and
  `convex/lib/portable.ts:163` builds the principal from `ctx.auth.getUserIdentity()`.
- Authorization is **principal-derived**. Roles resolve from the verified principal's stored
  membership, and every ID-based function binds the row to the caller's society.
- Cross-tenant access is **measured, not assumed**: `npm run test:stage2-tenancy` substitutes
  foreign Society B IDs into Society A calls across the whole portable surface and currently
  reports **0 leaked reads and 0 leaked writes**, against an empty baseline. Any regression
  fails the check.
- `PORTABLE_ACCESS_ENFORCEMENT` defaults to **true**. Public application entry points also apply the shared action policy, independently of this compatibility flag.

## What the flag actually gates

`PORTABLE_ACCESS_ENFORCEMENT` (`shared/portable/define.ts`) does **not** switch authorization on
and off. Tenant binding, membership checks and principal-derived roles are always active. The
flag only decides what happens to a caller with **no resolvable principal**
(`shared/functions/access.ts:294`):

| Caller | Flag `false` (explicit compatibility setting) | Flag `true` (default) |
|---|---|---|
| Verified hosted principal | Principal-derived role + tenant binding | Same |
| `trusted-workspace` (desktop/local) | Principal-derived role + tenant binding | Same |
| **Anonymous / unresolved** | Legacy role helper can fall back to caller-supplied `actingUserId`; shared application action policy still rejects protected calls | Rejected |

The compatibility fallback applies only to the legacy role helper. Hosted and portable
application entry points independently require the current principal's matrix permission;
an `actingUserId` never grants that authority. Explicit public intake, invitation/token,
service-token and identity endpoints retain their narrower handler-specific checks.

Configuring server `CLERK_JWT_ISSUER_DOMAIN` forces enforcement even if the flag is
set to `0`; merely selecting Clerk in the frontend does not alter local runtime trust.
For other deployments, enable enforcement with `SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` (or
`VITE_SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` in Vite runtimes). It is config-driven precisely
so staging and canary can enable and roll it back without a code change. `STAGE2-PLAN.md` §9
has the rollout runbook.

`npm run test:stage2-enforced` runs 21 suites with enforcement forced ON and currently passes
21/21, so readiness is verified continuously rather than discovered at flip time.

## Auth modes

| | `AUTH_MODE=none` (default) | `AUTH_MODE=better-auth` | `AUTH_MODE=clerk` |
|---|---|---|---|
| App login | None — user picker | Better Auth login/session sidecar (`npm run dev:full`) | Clerk sign-in and profiles |
| Convex data path | Local/static runtime supplies a `trusted-workspace` principal | Verified JWT → issuer-bound membership | Verified Clerk JWT → issuer-bound membership |
| REST gateway | API key or local-dev actor (fenced, see below) | API key or Better Auth session + scopes | API key or verified Clerk bearer + Societyer roles |

See [Clerk setup](clerk-setup.md) for account configuration and existing-user migration, and [identity launch gates](hosted-identity-and-provider-gates.md) for the exact tuple model, evidence-gated migration, session constraints and unresolved enterprise/provider requirements. Set matching AUTH_MODE on the API and Convex function deployment and VITE_AUTH_MODE on the frontend.
API-key and workflow traffic retains the Better Auth machine signer in Clerk mode.
Only that trusted issuer may convey a stored user's exact configured Clerk issuer/provider in a bridge
token; claims with the same names in Clerk tokens are ignored. Clerk's public
account profiles and organization claims never grant Societyer workspace roles.

The desktop / offline runtime always uses `none`. Its `trusted-workspace` principal is derived
from the local database, not from request payloads — the local database file is itself the trust
boundary, and it may legitimately contain several societies.

## Role policy and action checks

Users & access displays the fixed `ROLE_MATRIX` and workspace module switches.
It is a policy viewer, not a complete report of effective access: shared hosted and portable
action guards require the current matrix permission, while document ACLs, service scopes,
and specialized public/token handlers impose additional restrictions. Viewer retains the
existing broad read matrix; document visibility can further limit individual records.
Module switches hide features and do not revoke server permissions. Individual module
overrides are not implemented.

Module configuration requires Admin or Owner. Admins can manage Director, Member and
Viewer profiles and roles; only Owners can manage Owner/Admin memberships or remove users.
Both hosted and local handlers protect the last active Owner from ordinary removal,
demotion or status changes. The separate security-incident disabling action can disable a
sole Owner immediately and marks the workspace as requiring operator recovery.
Permission inspection requires the user's own membership or Admin/Owner access to the
same workspace. `test:workspace-access` and `test:authorization-policy` verify these
boundaries, role denials, specialized exceptions and current API-key authority.

## Guards that exist (verified by checks, not by inspection)

- **Tenant binding** — `requireOwnedRow` (derives the society from the row, then requires
  membership), `getOwned`, `getOwnedChild`, `getGlobalOrOwned`, all in
  `shared/functions/access.ts`. They return a uniform `"<table> not found."` for missing,
  wrong-table and foreign-society rows, so they cannot be used to probe whether a foreign row
  exists. Covered by `test:stage2-tenancy`.
- **Identity binding is non-rebindable** — login cannot claim or move a membership. Joining
  requires a single-use, society-bound invitation; email is never an authentication key.
  New bindings store an immutable person identity separately from workspace membership IDs; issuerless legacy rows require verified operator backfill, and snapshot restore strips hosted auth bindings. Covered by `test:identity-binding` and `test:hosted-identity`.
- **Storage ownership** — `_storage` IDs are claimed at attach time via the `storageOwnership`
  table, so a storage ID belonging to another society cannot be attached to your row. Upload-URL
  mint points require an authenticated membership.
- **Connector isolation** — runner sessions are indexed by `(tenantKey, sessionId)` and browser
  profiles hash to `tenant + connector + label`; a raw session UUID authorizes nothing. Covered
  by `test:connector-tenancy`.
- **Outbound URLs / SSRF** — shared policy requiring https, rejecting credentials, encoded IPs,
  private/reserved IPv4+IPv6, mapped IPv4, cloud metadata and internal DNS; DNS is resolved and
  the approved address pinned, and every redirect revalidated, at save *and* delivery. Covered by
  `test:outbound-url-policy`.
- **Production secrets fail hard** rather than falling back to dev defaults: `API_TOKEN_PEPPER`
  (`server/api-gateway/shared.ts:281`), `API_SECRET_ENCRYPTION_KEY` (`:322`), and
  `BETTER_AUTH_SECRET` (`server/auth-config.ts`) — production with `AUTH_MODE=better-auth` or `clerk`
  refuses to start on the committed dev secret.
- **Local maintenance routes** are fenced to non-production *and* local requests, and are not
  registered in production at all.

## What this means for deployment

- **Desktop / single-tenant self-host:** unchanged and safe.
- **Multi-tenant or internet-exposed:** tenant, role and identity boundaries are covered by
  focused checks. Complete the operational prerequisites and identity/provider launch gates
  before exposure; broad inventory counts alone do not establish production readiness.

## Operational prerequisites before enabling enforcement

1. **Run the `storageOwnership` backfill** (`convex/storageOwnershipBackfill.ts`). Existing
   deployments have rows referencing storage IDs with no ownership record; until it runs, those
   attachments cannot be proven. It is idempotent, and reports rather than guesses if one storage
   ID is referenced from two societies.
2. **Bind stranded placeholder Owners.** Societies created before creator-binding have an Owner
   row with no `authSubject`. Use the operator-only `apiPlatform:bootstrapUserIdentity`
   (service-token gated; see `STAGE2-PLAN.md` §2 step 5). Without this, nobody can authenticate
   into those societies once enforcement is on.
3. **Expect connector re-authentication.** Legacy unnamespaced browser profiles are deliberately
   invalidated rather than adopted by the first tenant that asks, so connector profiles must be
   re-authenticated once.
4. **Shadow first.** Enable decision capture, compare against real traffic, and repair any
   anonymous hosted calls or unresolved memberships *before* flipping. `STAGE2-PLAN.md` §9.

## Verifying this document

Do not trust this file over the checks. Enumerate and run them:

```sh
python3 -c "import json;s=json.load(open('package.json'))['scripts'];[print(k) for k,v in s.items() if k.startswith('test:') and 'playwright' not in v]"
```

`test:exports:db` requires a live `VITE_CONVEX_URL` and is expected to fail locally. The
security-relevant ones are `test:stage2-tenancy`, `test:stage2-enforced`, `test:identity-binding`,
`test:connector-tenancy`, `test:outbound-url-policy`, `test:clerk-auth`, `test:clerk-gateway`,
and `test:workspace-access`.
