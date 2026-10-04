# Clerk login and account management

Clerk handles sign-in, sign-up, sessions, and personal account profiles. Societyer
continues to manage workspace invitations, membership status, and
Owner/Admin/Director/Member/Viewer roles. Creating a Clerk account does not grant
access to an existing Societyer workspace. Clerk organization roles are not used
as Societyer roles.

The web frontend obtains a Clerk JWT for Convex; Convex verifies its issuer and
audience before resolving an issuer-bound workspace membership. The REST gateway
verifies that same bearer token and applies Societyer roles and scopes. API keys
and workflow callbacks retain the gateway's Better Auth signing keys; that
trusted issuer can represent a stored Clerk identity for machine requests.
In Clerk mode the public Better Auth user/session endpoints are disabled; its
JWKS endpoint remains available to Convex.

## Configure a Clerk application

1. Create a development application in the Clerk dashboard and select your
   desired sign-in methods. Configure the deployed application domain before
   using production keys.
2. Create a JWT template named `convex` using Clerk's Convex preset. Its audience
   must be `convex`. Keep the preset's identity and verified-email claims;
   invitation acceptance requires a verified email address. Do not put workspace
   roles or tenant IDs into client-controlled metadata to authorize access.
3. Copy the publishable key, backend secret key, and the exact HTTPS issuer URL
   for this instance. Development and production instances have different
   issuers and subjects.

## Configure the frontend and gateway

Use `.env.local` for development. Keep backend keys out of all `VITE_*` values.
These placeholders are not working credentials:

```dotenv
AUTH_MODE=clerk
VITE_AUTH_MODE=clerk
VITE_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE
VITE_CLERK_JWT_TEMPLATE=convex
CLERK_SECRET_KEY=sk_test_REPLACE
CLERK_JWT_ISSUER_DOMAIN=https://YOUR-INSTANCE.clerk.accounts.dev
CLERK_AUTHORIZED_PARTIES=http://127.0.0.1:5173,http://localhost:5173
BETTER_AUTH_BASE_URL=http://127.0.0.1:5173
BETTER_AUTH_SECRET=REPLACE-WITH-A-STRONG-RANDOM-SECRET
AUTH_DB_PATH=./data/auth.sqlite
```

`CLERK_AUTHORIZED_PARTIES` is a comma-separated list of exact frontend origins.
Use only the actual HTTPS application origin(s) in production. The gateway's
Better Auth secret and SQLite key database remain necessary for API-key and
workflow signing; preserve the database across gateway restarts. Production
must use a strong secret, not the committed development default.

Run `npm run dev:full` to start Vite and the gateway together. The Vite proxy
forwards `/api` to the gateway. Clerk profile management is available from the
signed-in user menu; Societyer's Users page remains the workspace role surface.

## Configure the Convex deployment

Repository `.env.local` does not configure hosted Convex functions. Set the
following variables on the actual Convex deployment using its dashboard or
`npx convex env set`, then deploy the schema/functions and auth configuration:

| Variable | Purpose |
|---|---|
| `AUTH_MODE=clerk` | Select the one human session broker on the Convex function deployment |
| `CLERK_JWT_ISSUER_DOMAIN` | Exact Clerk instance HTTPS issuer, matching the gateway |
| `BETTER_AUTH_BASE_URL` | Issuer used by the trusted gateway signer |
| `BETTER_AUTH_JWKS_URL` | Gateway JWKS URL reachable from Convex, e.g. `http://auth-server:8787/api/auth/jwks` inside local Compose |
| `SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` | Explicit authenticated enforcement for hosted deployments |
| `SOCIETYER_API_PLATFORM_TOKEN` | Shared gateway/operator service credential for internal API-platform calls |

Clerk-configured backends enforce authenticated access automatically; the
enforcement flag remains useful as an explicit deployment setting. The default
`none` mode, browser-only demo, and local Electron runtime retain their existing
behavior. Clerk credentials do not belong in offline desktop builds.

Do not change the existing gateway issuer during a Clerk cutover. Its verification
key remains trusted for API-key and workflow traffic. The Clerk subject and issuer
are checked together so another provider's account cannot claim a membership
merely by sharing its subject string. Older Better Auth bindings remain scoped
to Better Auth.

## Workspace access and existing users

A new user can create a workspace as its Owner or accept a Societyer invitation.
An invite grants the role recorded by Societyer. Disabling a workspace membership
removes access to that workspace even if the person's Clerk session is active.
Clerk profile changes do not elevate workspace roles.

Existing Better Auth user IDs differ from Clerk user IDs. An operator must
explicitly bind or migrate the existing Societyer membership; signing in with
the same email does not transfer access. Preserve each membership's existing
role and society. Use a verified Clerk user ID and issuer from the intended
Clerk instance, and perform a backed-up staging cutover before production.

The service-token-gated Convex mutation `apiPlatform:bootstrapUserIdentity` binds
an unbound membership with `userId`, `authSubject`, `authProvider: "clerk"`, and
the configured `authIssuer`. For an existing binding, use
`apiPlatform:migrateUserToClerk` with `userId`, `authSubject` (the new Clerk ID),
`expectedAuthSubject`, and the exact existing `expectedAuthProvider` and
`expectedAuthIssuer` when present. Migration also requires `mappingEvidenceRef` (a reviewed immutable old/new account mapping) and `identityPolicyEvidenceRef` (supported provider linking controls or an explicitly accepted identity policy). Both operations require the operator `serviceToken`.
Migration rejects stale expected bindings and conflicts within the workspace,
preserves the Societyer user ID and role, and records an audit event. Repeat
explicitly for each workspace membership; no email-based bulk reassignment runs.

## Container and Kubernetes builds

The frontend embeds public Clerk configuration at build time. Supply
`VITE_AUTH_MODE=clerk`, `VITE_CLERK_PUBLISHABLE_KEY`, and
`VITE_CLERK_JWT_TEMPLATE=convex` when building `docker/frontend.Dockerfile`.
Changing only a running container's environment does not update a built SPA.
The production Compose file forwards these build arguments and the gateway's
runtime variables. Pass the chosen environment file explicitly to Compose if
it is not named `.env`.

For the container image workflow, repository variables `SOCIETYER_AUTH_MODE`,
`VITE_CLERK_PUBLISHABLE_KEY`, and optionally `VITE_CLERK_JWT_TEMPLATE` configure
the frontend build; its default remains `none`. Backend keys are deployment
secrets, never frontend build arguments or repository variables.

The Kubernetes examples retain `AUTH_MODE=none`. To enable Clerk, change that
mode, deploy a frontend image built for Clerk, add the Clerk gateway variables
to `societyer-app-secret`, and set the Convex deployment variables above. The
manifests expose optional Clerk references but do not activate authentication or
provision a Clerk application themselves.

## Validate the configured deployment

Run the Clerk identity and gateway checks and the normal build. With real keys
configured in staging, verify the following before enabling the production mode:

- Sign in, sign out, account profile changes, and session refresh work.
- A fresh Clerk account has no access to existing workspaces without an invite.
- An invitation binds only the intended verified email and keeps its assigned role.
- Switching workspaces cannot read or modify another workspace's records.
- Disabling a membership blocks both Convex and REST access.
- API keys and workflow callbacks still resolve the correct migrated user.
- Invalid tokens, wrong issuers/audiences/origins, and anonymous direct backend
  calls fail closed.
- Browser-only `/demo` and offline Electron still work without Clerk.

Code-level checks cannot prove your Clerk account configuration, live keys, or
network reachability. A successful staging login is required to verify those.


## Provider linking is a separate migration gate

Clerk can merge same-email upstream accounts before Societyer sees their subject.
The local issuer/subject table cannot prevent such a provider merge. Preserve
current Clerk account/profile support, but do not migrate identities or launch
strict enterprise restrictions until supported controls or the explicitly
accepted identity policy and adversarial tests are retained. Do not set an
unverified Microsoft email claim to true or publish an `acceptMappedClaims`
workaround. See [hosted identity launch gates](hosted-identity-and-provider-gates.md).

Configure the same human broker in API/frontend/Convex. Clerk mode accepts its
exact configured issuer and `convex` audience; the Better Auth issuer serves
machine calls only. The gateway rejects pending Clerk sessions, missing authorized
party claims, and foreign issuer/audience values. Clerk lifetimes/MFA/recovery are
provider policies, not the Better Auth session duration setting.
