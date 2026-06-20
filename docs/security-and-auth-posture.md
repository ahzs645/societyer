# Security & auth posture

This document makes the project's **current** identity/authorization model explicit, because
it is a load-bearing deployment assumption that is not obvious from the code. It describes how
things work today and what must change before a network-exposed, multi-tenant deployment.

## TL;DR

- The product UI talks **directly to Convex**, not through the REST gateway.
- **Convex functions do not verify identity.** There is no `convex/auth.config.ts`, the app
  uses a plain `ConvexProvider` (no auth token is set on the client), and there are zero
  `ctx.auth.getUserIdentity()` calls in `convex/`.
- Authorization is therefore **client-asserted**: role checks (`requireRole`,
  `requirePermission`) trust an `actingUserId` that the client passes in the function args
  (see `convex/users.ts:21`). A caller who can reach the deployment can pass any `actingUserId`.
- This is an intentional trade-off for the **local-first / single-tenant** target (desktop app,
  or a trusted self-hosted instance). It is **not** safe for an untrusted multi-tenant
  deployment as-is.

## Auth modes (and what each actually enforces)

| | `AUTH_MODE=none` (default) | `AUTH_MODE=better-auth` |
|---|---|---|
| App login | None — user picker; `AuthProvider` returns `isAuthenticated: true` | Better Auth login/session sidecar (`npm run dev:full`) |
| Who can load the SPA | Anyone | Authenticated users |
| Convex data path | No identity layer | **Still no identity layer** — Better Auth gates the *UI*, but Convex functions are unchanged |
| REST gateway (`server/api-gateway.ts`) | API key or local-dev actor (fenced, see below) | API key or Better Auth session + scopes |

The desktop / offline (`local-data`) runtime always uses `none` and the static mirror; there is
no server to authenticate against.

Key point: **`better-auth` mode hardens the front door (the SPA login), not the Convex
endpoint.** Because the Convex client carries no auth token and functions don't check
`ctx.auth`, anyone who can reach the Convex deployment URL can still call its functions
directly. Treat the Convex endpoint as trusted infrastructure today.

## Guards that DO exist (verified)

- The `none`-mode "super-actor" (`scopes: ["*"]`) on the REST gateway is fenced to
  **non-production AND local requests**:
  - `requireLocalMaintenanceAccess` — `server/api-gateway.ts:610` (blocks unless
    `AUTH_MODE!=none` is false *and* not production *and* request is local).
  - `resolveLocalDevActor` — returns `null` in production or for non-local requests
    (`server/api-gateway.ts:1489-1490`).
- Secrets fail hard in production rather than falling back to dev defaults:
  - `API_TOKEN_PEPPER` required in production — `server/api-gateway/shared.ts:264`.
  - `API_SECRET_ENCRYPTION_KEY` required in production — `server/api-gateway/shared.ts:305`.
- `BETTER_AUTH_SECRET` ships as `"change-me-before-production"` in `.env.local.example`; the
  Better Auth path is expected to reject this default outside development.

## What this means for deployment

- **Desktop app / single trusted user / single-tenant self-host:** the current model is fine.
  Data is scoped by `societyId` and the client is trusted.
- **Multi-tenant or internet-exposed Convex:** the current model is **not** sufficient. A
  knowledgeable user can call any Convex function with any `actingUserId` / `societyId`.

## Hardening checklist (for true multi-tenant — not yet done)

1. Add `convex/auth.config.ts` and switch the app to `ConvexProviderWithAuth` so the Convex
   client sends a verifiable token.
2. Derive the acting user from `ctx.auth.getUserIdentity()` **inside** Convex functions instead
   of trusting `args.actingUserId`; reject mismatches.
3. Enforce `societyId` membership server-side from the authenticated identity (not from the arg).
4. Add a gate test asserting that privileged mutations reject a forged `actingUserId`.

Until those land, keep the default `none` mode for local/desktop use and do not expose the
Convex deployment to untrusted networks.
