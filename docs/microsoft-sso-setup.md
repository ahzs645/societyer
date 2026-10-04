# Company Microsoft SSO with Better Auth

This optional provider lets company users sign in to Societyer with their
Microsoft Entra account when `AUTH_MODE=better-auth`. Clerk deployments can
configure Microsoft sign-in in the Clerk dashboard instead; they do not also
start a Better Auth user session. Societyer remains the authority for workspace
memberships and roles in either mode.

The supplied URL `https://1stform.sharepoint.com/_layouts/15/sharepoint.aspx/discover`
identifies a SharePoint Online hostname with the `1stform` prefix. It does not
establish tenant ownership, licensing, administrator rights, or the Entra
directory UUID. Its discovery page is not a document library. An administrator
must confirm the directory and choose a site/library separately for storage.

## Register the sign-in application

In your company's Microsoft Entra admin center:

1. Confirm the company directory and copy its **Directory (tenant) ID**.
2. Register a Web application with **Accounts in this organizational directory
   only**. Copy its **Application (client) ID**.
3. Add the exact Web redirect URI:
   `https://YOUR-APPLICATION-ORIGIN/api/auth/callback/microsoft`.
   For local development, register the matching loopback callback, for example
   `http://localhost:5173/api/auth/callback/microsoft`. Use the same hostname in
   your browser and `BETTER_AUTH_BASE_URL`.
4. Create a client secret and securely configure its **value**, not its secret
   identifier. Record the expiry and arrange rotation before it expires.
5. Configure the ID token's optional `email` claim if your accounts do not
   already receive it. The provider requires an email claim; it does not replace
   it with a mutable UPN.
6. Apply company consent, assignment, MFA, and Conditional Access policies.
   Restrict application assignments if only selected staff should sign in.

The provider requests only `openid profile email`. It uses an authorization-code
flow with state and PKCE, verifies the tenant-specific ID token's signature,
issuer, audience, and lifetime, and rejects another tenant. Tenant membership
does not itself grant a Societyer role. Entra B2B guests may be in your directory;
Societyer invitations or explicit operator binding still control their access.

## Configure Societyer

Set these on the **auth/API server**, not in frontend build variables:

```dotenv
AUTH_MODE=better-auth
VITE_AUTH_MODE=better-auth
BETTER_AUTH_BASE_URL=https://YOUR-APPLICATION-ORIGIN
VITE_AUTH_BASE_URL=https://YOUR-APPLICATION-ORIGIN
BETTER_AUTH_SECRET=REPLACE-WITH-A-STRONG-RANDOM-SECRET
MICROSOFT_CLIENT_ID=YOUR-APPLICATION-UUID
MICROSOFT_CLIENT_SECRET=YOUR-SECRET-VALUE
MICROSOFT_TENANT_ID=YOUR-COMPANY-DIRECTORY-UUID
```

All three Microsoft settings must be present together. No settings leaves the
existing password login unchanged; partial or invalid configuration refuses to
start the Better Auth server. Tenant aliases such as `common`, `organizations`,
`consumers`, and the SharePoint prefix are not accepted. Use HTTPS for production.

Configure the Convex deployment's `BETTER_AUTH_BASE_URL` and reachable
`BETTER_AUTH_JWKS_URL`, deploy the auth configuration, and enable
`SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1`. Without hosted enforcement, an anonymous
compatibility path can remain reachable even if the login screen requires SSO.
The local `.env.local` file does not configure Convex deployment variables.

Serve browser authentication through the application's same-origin `/api/auth`
proxy. The gateway does not configure browser CORS for a separate auth host;
`BETTER_AUTH_BASE_URL` and `VITE_AUTH_BASE_URL` should use the application origin.

The login screen displays **Continue with Microsoft** only when the safe
`GET /api/auth/providers` response confirms the Better Auth Microsoft provider
is enabled. The discovery response contains no credentials. Callback destinations
stay within the application, including Societyer invitation URLs.

Production Compose forwards the Microsoft settings to the API service; the
Kubernetes API already imports `societyer-app-secret`. The frontend needs only
its auth mode/base URL, never Microsoft client secrets. Restart the gateway
after credential changes and rebuild the frontend if its build settings change.

## Bind users and retain workspace roles

Microsoft authenticates the account; Societyer checks its stored workspace
membership. A newly authenticated user does not acquire access to existing
workspaces. New workspace creation binds its creator as Owner.

Implicit social-account linking is disabled. An existing password account is
not silently merged with a Microsoft account sharing its email. Use deliberate
account/membership migration rather than changing workspace roles based on
Microsoft email, group, or tenant claims.

Microsoft ID tokens commonly omit a trustworthy email-verification claim.
Societyer does not treat the presence of an email or tenant membership as proof
of mailbox ownership. If the Microsoft profile lacks explicit verification,
email invitations cannot be redeemed until mailbox verification is implemented
or the membership is explicitly bound by an operator. For an initial company
rollout, use operator binding for staff's existing workspace memberships.

The existing service-token-gated `apiPlatform:bootstrapUserIdentity` can bind
an unbound membership using its `userId`, the new **Better Auth user ID** created
by Microsoft login as `authSubject`, `authProvider: "better-auth"`, and
`authIssuer: BETTER_AUTH_BASE_URL`. Supply the operator `serviceToken` through
your deployment's secure administrative tooling. Do not use the Microsoft `oid`
or directory ID as the Better Auth subject. This operation refuses to overwrite
an already-bound membership and records an audit event. Existing password-bound
memberships require a deliberate migration; this flow does not reassign them.

## SharePoint access is separate

This login provider does not request `User.Read`, offline access, SharePoint,
or file permissions, and it does not fetch profile photos from Graph. It is not
a document-storage connector. A future SharePoint integration should use its
own explicit Graph authorization, preferably an application with `Sites.Selected`
and a grant to the chosen company site. Changing storage or granting those
permissions is not part of enabling this sign-in provider.

## Verify before enabling production

Run `npm run test:microsoft-sso`, the Clerk/auth token checks, and the normal
build. In a configured staging application, verify Microsoft sign-in and
callback, sign-out, invitation/operator-bound membership behavior, disabled-user
denial, and existing API-key/workflow access. Confirm that an account from
another directory cannot sign in, and that a directory user without Societyer
membership cannot open existing workspace data.

Local checks do not establish ownership of the `1stform` tenant or verify live
Microsoft credentials, consent, MFA policies, or callback/network configuration.


## Boundaries of this sign-in option

This optional Better Auth provider is preserved alongside Clerk as an alternative
human broker; it does not run as a second human session provider in Clerk mode.
Set matching `AUTH_MODE=better-auth` on the gateway and Convex function deployment
and `VITE_AUTH_MODE=better-auth` in the frontend. Better Auth sessions expire after
the configured bounded lifetime without automatic sliding renewal.

A tenant UUID includes approved directory guests; do not replace assignment and
Societyer invitations with an email-domain rule. Existing password sessions can
still access their active memberships: this option does **not** implement an
SSO-required workspace rule. Enterprise connection/session evidence, existing
session rejection, guest/offboarding behavior, MFA/Conditional Access and recovery
must be approved and tested before any such requirement is advertised. The pinned
Microsoft account identifier is `sub`; a 1.7 migration to verified `oid` must use
administrator/token evidence, never email. See [identity launch gates](hosted-identity-and-provider-gates.md).
