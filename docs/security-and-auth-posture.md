# Security & auth posture

This document makes the project's **current** identity/authorization model explicit, because it
is a load-bearing deployment assumption that is not obvious from the code.

> **Status: rewritten 2026-08-03.** An earlier revision described a "client-asserted
> authorization" model where Convex functions trusted a caller-supplied `actingUserId`. That is
> no longer accurate — the Stage 2 migration replaced it. See `STAGE2-PLAN.md` for the plan and
> per-section status.

## TL;DR

- Convex functions **do** verify identity. `convex/auth.config.ts` registers the Better Auth
  issuer, `src/auth/AuthProvider.tsx:217` sets the token on the Convex client, and
  `convex/lib/portable.ts:163` builds the principal from `ctx.auth.getUserIdentity()`.
- Authorization is **principal-derived**. Roles resolve from the verified principal's stored
  membership, and every ID-based function binds the row to the caller's society.
- Cross-tenant access is **measured, not assumed**: `npm run test:stage2-tenancy` substitutes
  foreign Society B IDs into Society A calls across the whole portable surface and currently
  reports **0 leaked reads and 0 leaked writes**, against an empty baseline. Any regression
  fails the check.
- `PORTABLE_ACCESS_ENFORCEMENT` still defaults to **false**. Read "What the flag actually
  gates" below — this is the one place where the old trust model survives.

## What the flag actually gates

`PORTABLE_ACCESS_ENFORCEMENT` (`shared/portable/define.ts`) does **not** switch authorization on
and off. Tenant binding, membership checks and principal-derived roles are always active. The
flag only decides what happens to a caller with **no resolvable principal**
(`shared/functions/access.ts:294`):

| Caller | Flag `false` (today) | Flag `true` |
|---|---|---|
| Verified hosted principal | Principal-derived role + tenant binding | Same |
| `trusted-workspace` (desktop/local) | Principal-derived role + tenant binding | Same |
| **Anonymous / unresolved** | Falls back to the legacy caller-supplied `actingUserId` | Rejected |

So the residual Stage 1 exposure today is precisely: *an anonymous caller who can reach the
deployment can still supply an `actingUserId`.* Everything else is enforced.

Enable enforcement with `SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` (or
`VITE_SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` in Vite runtimes). It is config-driven precisely
so staging and canary can enable and roll it back without a code change. `STAGE2-PLAN.md` §9
has the rollout runbook.

`npm run test:stage2-enforced` runs 21 suites with enforcement forced ON and currently passes
21/21, so readiness is verified continuously rather than discovered at flip time.

## Auth modes

| | `AUTH_MODE=none` (default) | `AUTH_MODE=better-auth` |
|---|---|---|
| App login | None — user picker | Better Auth login/session sidecar (`npm run dev:full`) |
| Convex data path | Local/static runtime supplies a `trusted-workspace` principal | Verified JWT → Convex identity → principal |
| REST gateway | API key or local-dev actor (fenced, see below) | API key or Better Auth session + scopes |

The desktop / offline runtime always uses `none`. Its `trusted-workspace` principal is derived
from the local database, not from request payloads — the local database file is itself the trust
boundary, and it may legitimately contain several societies.

## Guards that exist (verified by checks, not by inspection)

- **Tenant binding** — `requireOwnedRow` (derives the society from the row, then requires
  membership), `getOwned`, `getOwnedChild`, `getGlobalOrOwned`, all in
  `shared/functions/access.ts`. They return a uniform `"<table> not found."` for missing,
  wrong-table and foreign-society rows, so they cannot be used to probe whether a foreign row
  exists. Covered by `test:stage2-tenancy`.
- **Identity binding is non-rebindable** — login cannot claim or move a membership. Joining
  requires a single-use, society-bound invitation; email is never an authentication key.
  Covered by `test:identity-binding`.
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
  `BETTER_AUTH_SECRET` (`server/auth-config.ts`) — production with `AUTH_MODE=better-auth`
  refuses to start on the committed dev secret.
- **Local maintenance routes** are fenced to non-production *and* local requests, and are not
  registered in production at all.

## What this means for deployment

- **Desktop / single-tenant self-host:** unchanged and safe.
- **Multi-tenant or internet-exposed:** the authorization work is done and verified, but
  complete the operational prerequisites below and enable enforcement before exposing it.

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
`test:connector-tenancy`, `test:outbound-url-policy`, and `test:portable-principal`.
