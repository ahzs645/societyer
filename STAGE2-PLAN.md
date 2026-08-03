# Stage 2 authentication migration

Goal: make every hosted authorization decision from a verified principal and its stored Societyer membership. Do not set `PORTABLE_ACCESS_ENFORCEMENT` to `true` until every preceding step is deployed, observed, and reversible.

## 1. Freeze the contract and add adversarial tests

1. Inventory every exported query, mutation, action, HTTP route, and portable registry entry. Classify it as public, authenticated user, or scoped service. The sources are `convex/*.ts`, `convex/http.ts`, `shared/functions/registry.ts`, and `shared/portable/define.ts`.
2. Extend `scripts/check-portable-principal.ts` and the Convex test suite with two societies, two users, an API service principal, an anonymous principal, and malicious `actingUserId`/foreign-ID inputs. Assert that cross-society reads return no data and writes make no changes.
3. Add deployment smoke tests for the Better Auth token endpoint, JWKS endpoint, Convex token acceptance, token expiry/refresh, sign-out, and key rotation. Keep `convex/auth.config.ts`, `server/auth-config.ts`, `src/lib/authClient.ts`, and `src/auth/AuthProvider.tsx` aligned on issuer, audience, algorithm, and JWKS URL.

Exit criterion: tests demonstrate the current Stage 1 gaps and can run with enforcement both disabled and enabled.

## 2. Make membership binding explicit and non-rebindable

1. Treat `(issuer, subject)` as the immutable external identity key. Add/verify a unique lookup for that pair in `convex/tables/platform.ts` and `convex/schema.ts`; do not use email as an authentication key.
2. Replace `users.resolveAuthSession` in `convex/users.ts` and `resolveAuthSessionPortable` in `shared/functions/users.ts` with an authenticated `ensureCurrentMembership({ societyId, invitationToken? })`. It must read `ctx.principal`, accept no subject, email, verification flag, user ID, or role from the client, and only update profile fields on the row already bound to the same `(issuer, subject)`.
3. Remove the current fallback that finds a user by email and then writes a new `authSubject`; that is the rebinding/account-takeover path. An unbound principal may join only by consuming a single-use, society-bound invitation from `convex/invitations.ts`/the invitations table, or by an explicit Owner/Admin linking workflow that records an audit event. Existing email matches must remain unlinked pending that workflow.
4. Backfill existing Better Auth rows in a dry-run migration. Fail on duplicate subjects, duplicate verified bindings, disabled users, or one subject bound to multiple people unexpectedly. Export a reconciliation report before applying changes.
5. Migrate societies created before creator binding by explicitly binding each stranded placeholder Owner with the operator-only mutation. Obtain the immutable subject from the verified Better Auth JWT/auth store, identify the exact `users` document ID independently (never by accepting a browser-supplied email), and run:

   ```sh
   ./node_modules/.bin/convex run --prod apiPlatform:bootstrapUserIdentity '{"userId":"<users document id>","authSubject":"<verified JWT subject>","serviceToken":"<API platform service token>"}'
   ```

   The deployment must configure `SOCIETYER_API_PLATFORM_TOKEN` (or the existing `CONVEX_INSTANCE_SECRET` fallback). The mutation refuses a row already bound to a different subject/provider, refuses a subject already used by another row, and writes an `identity-bound` activity record. This service credential is an operator secret and must never be placed in browser code or a client request.
6. Change `src/auth/AuthProvider.tsx` to call the new no-identity-input mutation after Convex confirms the JWT. Clear the stored local user ID when membership resolution fails; do not infer membership from the selected society or email.

Exit criterion: logging in cannot create, claim, or change a membership without an invitation/admin action, and changing an email cannot change the bound Societyer user.

## 3. Derive roles from principals everywhere

1. In `convex/lib/portable.ts`, keep constructing the hosted `PortablePrincipal` exclusively from `ctx.auth.getUserIdentity()`. Reject missing or malformed issuer/subject for authenticated functions.
2. In `shared/functions/access.ts`, make `requireRolePortable` call `requirePrincipalRole` with the real `ctx.principal`; delete `LEGACY_COMPATIBILITY_PRINCIPAL` and the `requireLegacyRole` fallback. Resolve the current `users` row by immutable subject, verify `status`, `societyId`, and the stored role, and never honor a caller-supplied actor.
3. Remove `actingUserId` from public Convex validators and portable handler argument types, starting with all files returned by `grep -R requireRolePortable convex shared/functions`. For audit fields such as `createdByUserId`, `completedByUserId`, and `uploadedByUserId`, derive the ID with `principalUserId(ctx, societyId)` inside the handler.
4. Preserve local/desktop behavior deliberately: `src/lib/staticConvexClient.ts` and `src/lib/dexieWorkspaceClient.ts` must provide a `trusted-workspace` principal containing the selected workspace's real `userId` and `societyId`. Do not let UI request payloads choose those values.
5. Implement `PortableRuntime.accessHook` in `shared/portable/define.ts`: enforce `public`, `authenticated`, and service scopes, propagate the same principal through nested calls, and default new functions to authenticated. Mark only intentionally public portal/application endpoints as public.

Exit criterion: deleting every client-supplied `actingUserId` produces no authorization regression in hosted or local test matrices.

## 4. Bind tenant ownership at the data access boundary

1. Add shared helpers such as `requireSocietyMembership(ctx, societyId)` and `getOwned(ctx, table, id, societyId)` that resolve the principal once and compare the fetched row's `societyId`. For child rows, fetch and validate the parent in the same transaction.
2. Apply the helpers to every ID-based query and mutation, not only list functions. Prioritize:
   - `convex/secrets.ts`: `update`, `revealSecret`, and `remove`; derive the revealing user from the principal and verify the vault row's society before decrypting.
   - `convex/documents.ts`, `shared/functions/documents.ts`, and `convex/documentVersions.ts`: `get`, `getMany`, archive/delete/draft/version/download actions, and meeting-material access. Remove the branch that returns an unrestricted document when `actingUserId` is absent.
   - `convex/tasks.ts` and `shared/functions/tasks.ts`: all parent-ID queries plus `update` and `remove`; verify task and referenced committee/meeting/goal/document belong to the same society.
   - `convex/views.ts` and `shared/functions/views.ts`: `get`, `getHydrated`, update/remove, field add/update/remove/reorder, and object metadata joins. Validate the view, each view field, and metadata row before returning or writing.
3. Continue through every `convex/*.ts` ID path, including actions that call other functions. A caller must not be able to bypass a checked top-level function by invoking an unchecked child function directly.
4. Add compound indexes where an ID plus society lookup is needed frequently. Return a uniform not-found/forbidden result that does not reveal whether a foreign row exists.

Exit criterion: the adversarial suite can substitute every foreign Society B ID into every Society A function without observing or changing Society B data.

### Status (as of the §4 migration)

Done. `scripts/check-stage2-tenancy.ts` reports **0 leaked reads and 5 leaked writes**, down from 667 and 1214. Handlers use `requireOwnedRow` (derives the society from the row, then requires membership) or `getOwned`/`getOwnedChild` when an authoritative society is already in hand; `getGlobalOrOwned` covers rows that are legitimately global. All are in `shared/functions/access.ts`.

The 5 residual writes share one root cause and are baselined, not fixed:

    portable:assets:create            imageStorageId
    portable:inventoryHub:upsertItem  imageStorageId
    portable:society:setLogo          storageId
    portable:society:setDarkLogo      storageId
    portable:society:setLetterhead    storageId

Convex `_storage` rows carry no `societyId`, so no helper can prove that a storage ID belongs to the caller's society. The practical exposure: a member of Society A who learns a Society B storage ID can attach it to an A-owned row (for example, set B's uploaded image as A's logo) and thereby view it. It cannot write to or read any B database row.

Fixing it requires tenant-owned storage metadata — a table mapping `storageId -> societyId`, written whenever a file is stored, plus an ownership check in these five handlers. That is a schema change with a backfill for existing files, so it was scoped out of the §4 migration. Do it before treating §4 as fully closed.

## 5. Finish frontend authentication behavior

1. In `src/auth/AuthProvider.tsx`, expose separate Better Auth session, Convex-auth confirmation, membership-resolution, and fatal-error states. `src/components/AuthGate.tsx` must render application routes only when all three authenticated states are ready.
2. Make society selection membership-driven. `src/hooks/useSociety.ts`, routing/bootstrap code, and stored workspace state may select only societies returned for the current principal; clear stale society/user IDs on sign-out or membership loss.
3. Stop sending `actingUserId` from hooks, pages, and mutations. Keep local mode working through its trusted workspace principal rather than payload compatibility.
4. Add user-visible handling for expired sessions, revoked membership, disabled users, missing invitations, JWKS/token failures, and retryable network errors.

Exit criterion: no authenticated screen or mutation runs before Convex auth and membership are confirmed, and browser storage cannot select another tenant.

## 6. Make the REST gateway use the same principal model

1. In `server/api-gateway.ts` and `server/api-gateway/shared.ts`, keep API-key tenant/scopes server-derived and change Better Auth resolution to use the verified subject plus an explicit membership. Do not use request `societyId` to discover who the actor is.
2. Set a Convex auth token on `server/api-gateway/convex-client.ts` calls made for a Better Auth user, or call narrowly scoped internal/service functions that carry a typed service principal. Do not translate the actor back into `actingUserId` arguments.
3. Retain actor-wins request validation, but move tenant enforcement into each Convex function as the authoritative boundary. Keep the gateway's ID preflight as defense in depth, not as the only check.
4. Tenant-bind all non-generic ID routes in `mountPlatformRoutes`, `mountBrowserConnectorRoutes`, `mountWorkflowBridgeRoutes`, and `ACTION_ROUTES`, including API client/token revocation, webhook subscription status, documents, filings, tasks, callbacks, and generated files.
5. Separate local unauthenticated maintenance routes from production route registration so `AUTH_MODE=none` cannot be exposed accidentally in production.

Exit criterion: direct Convex and REST calls enforce identical roles and tenancy, including API key and Better Auth sessions.

## 7. Namespace connector sessions and browser profiles

1. Extend the gateway-to-runner protocol in `server/api-gateway/convex-client.ts`, `server/api-gateway.ts`, and `services/connector-runner/src/types.ts` with a signed/internal `tenantKey` derived from `actor.societyId` (and optionally user ID for personal profiles). Never accept that namespace from the browser.
2. In `services/connector-runner/src/server.ts`, store `tenantKey` on `ActiveSession`; index sessions by `(tenantKey, sessionId)`; filter `/sessions`; and require the namespace for finish, stop, paste, confirm, action, and VNC WebSocket access. A raw session UUID must never authorize access.
3. In `services/connector-runner/src/profileKeys.ts` and `blitzBrowserBackend.ts`, derive the persisted browser `userDataId` from a one-way hash of `tenantKey + connectorId + requested profile label`. Return only an opaque display key. Namespace deletion and validation the same way.
4. Update `src/pages/BrowserConnectors.tsx`, `server/integrations/connector-run-recorder.ts`, `convex/financialHub.ts`, and `convex/workflows.ts` so stored session/profile references include society ownership and are checked before reuse. Migrate or invalidate unnamespaced profiles; do not silently attach them to the first tenant that asks.
5. Bind VNC/live-view URLs to short-lived, tenant-scoped tickets rather than the runner's shared secret.

Exit criterion: Society A cannot list, attach to, act through, view, validate, or delete Society B sessions/profiles even with a leaked session ID or profile label.

## 8. Restrict outbound URLs and redirects

1. Create one outbound URL policy shared by the gateway/runner and a Convex-compatible equivalent. Require `https` except explicit development allowlists; reject credentials, fragments where irrelevant, nonstandard schemes, localhost, link-local, private/reserved IPv4 and IPv6 ranges, IPv4-mapped IPv6, and internal DNS suffixes.
2. Resolve DNS before connecting, reject every private/reserved answer, pin the approved address for the request where the runtime permits, and revalidate every redirect. Set short connect/read timeouts and response-size limits.
3. Apply the policy when saving and delivering `targetUrl` in `server/api-gateway.ts`, `server/api-gateway/convex-client.ts`, and `convex/apiPlatform.ts`. Revalidate at delivery time so old rows and DNS rebinding cannot bypass creation-time checks.
4. Apply connector navigation allowlists in `services/connector-runner/src/server.ts` and `connectors.ts`: ignore arbitrary `startUrl`, `url`, and `proxyUrl` unless permitted for that connector; block page redirects and subresource requests to private networks; keep authentication-provider origins explicit per connector.
5. Apply the same restrictions to user/config-derived fetches in `convex/workflows.ts`, `convex/workflowCatalog.ts`, and `convex/grantSources.ts`. Separate trusted operator-configured endpoints from tenant-authored URLs and audit every rejection.

Exit criterion: tests cover decimal/octal IPs, IPv6, redirects, DNS rebinding, internal hostnames, cloud metadata addresses, and connector navigation escapes.

## 9. Shadow, canary, then flip last

1. Deploy schema/index changes, identity binding, tenant checks, connector namespacing, and URL policy while `PORTABLE_ACCESS_ENFORCEMENT` remains `false`. Log the decision the Stage 2 policy would make, without logging tokens, secrets, or decrypted values.
2. Compare shadow decisions with real traffic; repair every anonymous hosted call and every unresolved membership. Run the complete portable, Convex, REST, connector, and local desktop suites.
3. Enable enforcement first in a staging clone, then for internal canary societies. Monitor auth failures, cross-tenant denials, token refresh, invitation consumption, connector session ownership, and webhook failures. Keep a rollback that disables enforcement but does not restore unsafe email rebinding or unnamespaced connector reuse.
4. After the canary is clean, set `PORTABLE_ACCESS_ENFORCEMENT = true` in `shared/portable/define.ts`. Remove the shadow path and remaining legacy arguments only after a full release window.

The flag flip is the final migration action, never the mechanism used to discover missing authorization work.
