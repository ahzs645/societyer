# Hosted identity and provider launch gates

This workspace implements **Better Auth**, pinned by `package-lock.json` to **1.6.23**. It does not implement Clerk, Microsoft sign-in, enterprise SAML/OIDC, SCIM, or native OAuth. Research about those providers is evidence for a future integration, not proof that they are enabled here. The research register's Clerk choice does not replace the broker already used by this checkout.

## Current deployment contract

- The frontend, API gateway and Convex use one broker. `AUTH_MODE` and `VITE_AUTH_MODE` accept only `none` or `better-auth`; contradictions and unsupported providers fail. Clerk credentials cause a configuration error instead of enabling a second broker.
- An auth-disabled frontend cannot connect to a public hosted backend. Local browser/Electron/demo workspaces keep their current trusted local database behavior. Conventional loopback, private IPv4, container names and existing `.home`/`.local`/`.internal` self-hosted addresses are recognized as local configuration; their deployment operator still controls exposure.
- `BETTER_AUTH_BASE_URL` is the exact JWT issuer **and** audience. Configure the same spelling in the browser's `VITE_AUTH_BASE_URL` and on Convex. The public issuer requires HTTPS; no credentials, query, fragment or trailing slash are accepted. A private Convex `BETTER_AUTH_JWKS_URL` may remain the existing sidecar URL.
- ES256 tokens expire after five minutes. The database-backed broker session defaults to eight hours without sliding renewal. Set `AUTH_SESSION_MAX_AGE_SECONDS` between 300 and 86400 to choose a bounded duration. Application membership and identity-disabled state are read at each protected operation, so token expiry is not the revocation mechanism.
- Production with Better Auth requires the existing non-development `BETTER_AUTH_SECRET`. The sidecar uses the issuer origin as its trusted origin. Application roles remain Societyer's responsibility.
- The pinned package supports `account.accountLinking.disableImplicitLinking`; the configuration sets it to `true` with an empty trusted-provider list. Only the existing email/password login and JWT plugin are enabled. This is **not** evidence for disabled implicit linking in a future third-party provider or SSO plugin.

## Identity bindings and existing deployments

`externalIdentities` stores an immutable exact `(issuer, subject)` tuple for a person identity. Societyer's `users` rows continue to represent per-workspace memberships, with their existing IDs, roles and audit links. New hosted Owner/invitation bindings share the identity ID across societies. A matching subject under another issuer is a separate identity and acquires no existing memberships. Display name, email, provider label, Microsoft email domain and storage consent are never lookup keys.

Existing rows with an `authSubject` but no `authIssuer` deliberately do not authorize hosted access. The service-token-gated `apiPlatform.bootstrapUserIdentity` is the recovery/backfill path: an operator must validate the original broker account ID, target membership row and exact deployed issuer, then bind that row. It adds the current configured issuer and immutable identity reference; it never guesses from email and refuses to change an already-bound issuer or subject. Multiple memberships in different societies can share the same tuple; two bindings for the same tuple within one society are rejected. Run `npm run test:identity-binding -- --input <operator-export.json>` to report missing issuers and collisions before rollout.

Before enabling this change on an existing hosted deployment:

1. Back up the original auth database, application membership rows, role/audit history and deployed issuer configuration.
2. Dry-run the reconciliation against an authorized administrative export. Validate subjects using the broker's immutable IDs; stop on missing/ambiguous mappings.
3. Bind each intended legacy membership through the service-token-gated recovery function. Do not expose the service token to browser settings.
4. Verify retained user IDs, roles and workspace visibility with controlled accounts before production traffic. Preserve a recovery Owner under the established controlled recovery procedure.

A future broker replacement needs an explicit old-tuple to new-tuple mapping and a reviewed migration tool; this change does **not** provide a cutover switch. Missing mappings stop the migration. Revoke old sessions and derived keys at cutover, require fresh authentication, retain the original tuple exports, and rehearse rollback preserving membership IDs and audit history. Microsoft's 1.6 `sub` to 1.7 `oid` conversion must use verified directory/token evidence, never an email join or an assumption that an old account ID is an `oid`.

Workspace snapshot import strips `authProvider`, `authIssuer`, `authSubject`, `externalIdentityId`, verification/login timestamps, and the global `externalIdentities` table. It preserves local user row IDs, roles, profile data and historical legal persons/registers. A downloaded backup cannot confer hosted login access; promotion to hosted storage needs fresh verified operator/Owner binding. The currently implemented restore is local; there is no enabled generic hosted snapshot restore endpoint.

## Tenant, guest, session and lifecycle gates

A session from the current email/password broker proves that broker account, not employment in an Entra tenant, upstream MFA or SharePoint permissions. There is no enterprise-required workspace switch because the current token has no verified enterprise connection evidence. Do not infer tenant membership from an email suffix or set `email_verified=true` to make a login succeed.

Before offering an enterprise-required workspace, retain all of these reviewed decisions and passing controlled tests:

- Administrator-confirmed tenant UUID and app registration, chosen tenant-bound SAML or evaluated tenant OIDC connection, assigned employees and approved guests. Microsoft social `common` login is not a company tenant gate.
- Session-level evidence of the intended enterprise connection, and denial of older password/social sessions, foreign/personal/unassigned users, removed guests, and duplicate-email identities in another tenant. Local invitations and current roles still apply to every account.
- Supported claim mappings and issuer/audience/signature verification. Resolve Clerk's `acceptMappedClaims` guidance against Microsoft's multitenant warning with the vendor/administrator; no workaround is supplied here.
- Enforced Conditional Access/MFA for members and guests, approved device rules, session limits, measured revocation delay, sensitive-operation reauthentication, credential/certificate rotation owner, and narrowly audited recovery. A report-only policy or a Microsoft button does not establish coverage.
- Directory provisioning source ID, signed webhook contract, transactional idempotency/out-of-order handling, workspace-scoped suspension, multi-directory and sole-directory-removal semantics, manual-removal preservation, and last-Owner security recovery. Session deletion alone does not prevent later sign-in.

No directory webhook is enabled and no SCIM event is accepted by this implementation. An operator-controlled disabled external identity denies every membership linked to that identity; a disabled membership denies only that workspace. Genuine security disabling must deny access even for the last Owner; an ordinary UI action preserves active Owner continuity. Provider synchronization timing and remote MFA are unverified until an approved tenant proof of concept is performed.

## Clerk fit gate

AUTH-B01 remains blocked on supported Clerk controls or an explicitly accepted identity policy. Clerk can merge same-email upstream identities **before** Societyer sees a subject; the local tuple table cannot prevent that provider merge. Test every proposed social, enterprise and directory path, including same-email cross-tenant accounts, provider switching, account recreation and provisioning, and retain the vendor's supported configuration/response. Do not launch strict enterprise access or migrate existing memberships until this is resolved. AUTH-B02's claims-mapping conflict is an independent gate.

Operator-managed connections are the planning default. Clerk Organizations, self-service SSO, pricing/entitlements, directory sync and a provider upgrade remain evaluated options, not active UI settings. List prices in the attached research are not an instance quote.

## Separate storage and desktop trust

Sign-in consent and storage consent are independently revocable. Better Auth does not grant a SharePoint library. Storage operations must use current Societyer workspace permission even while an app-only Graph credential remains usable. Never put Graph access/refresh tokens in a broker's public profile fields.

The interface shows local/offline state separately from broker-backed hosted access. No native OAuth callback or token-custody flow is implemented. Any future native hosted sign-in needs an external-browser PKCE flow, bounded one-use callbacks and OS-protected token custody. Remote revocation cannot retract already-downloaded offline files; administrators must approve the offline-data policy.

## Evidence and limits

- `scripts/check-hosted-identity.ts`: two issuers sharing a subject and email, changed email, no implicit legacy binding, ambiguous membership rejection, direct-user-ID mismatch, immutable operator bindings, shared person identity across societies, immediate disabled-identity denial, local compatibility, broker/config errors and actual snapshot-import stripping.
- `scripts/check-auth-broker.ts`: uses the pinned Better Auth package with a temporary local auth database; verifies emitted ES256 tokens, exact issuer/audience, expiry, invalid signature, denied origin, and token issuance without a session. It also checks the explicit-linking configuration.
- `scripts/check-identity-binding.ts`: current expiring hashed invitations, creator binding, no same-email membership capture, non-rebinding and operator audit.

These are local checks. They do not prove a deployed Convex endpoint, browser/gateway origin policy in an actual reverse proxy, Microsoft tenant, Clerk account-linking behavior, MFA coverage, SCIM payloads, hosted native OAuth or migration rollback. Those remain visible launch gates.
