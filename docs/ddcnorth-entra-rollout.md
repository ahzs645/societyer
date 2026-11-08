# DDC North Entra sign-in rollout

Registered on November 7 and verified live on November 8, 2026 after operator
approval. Ahmad signed into the DDC North workspace and the separate staff admin
portal through Microsoft. Required-SSO enforcement is active; password sign-in
returns HTTP 403. Existing password sessions cannot authorize workspace access.

## Directory and access boundary

- Tenant: FirstForm, `220c85f6-1cb1-4bb2-a63b-55d9fd163b55`.
- Existing DDC North group: `815b3b71-596d-48fe-aafd-f5bf34aafa5c`.
- The reviewed group has three direct employee members. It is a Microsoft 365
  group, so the application validates its signed group claim rather than
  relying on security-group-only enterprise-app assignments.
- Dedicated single-tenant registration: **Societyer DDC North portal sign-in**.
- Client ID: `bfced040-9730-45b5-b943-345a06bb8b60`.
- Registration Object ID: `e926224a-47ea-45c3-970a-ea86066eeca8`.
- Web redirect:
  `https://industrious-cricket-610.convex.site/api/auth/callback/microsoft`.
- Frontend remains `https://portal.ddcnorth.com`; broker remains `AUTH_MODE=convex`.
- Verified frontend deployment: `https://f436db79.societyer-ddcnorth.pages.dev`.

Configure the registration to include the `email`, `acct` and `auth_time` ID-token optional
claims and group object IDs (`groupMembershipClaims: All`). The application asks
for `prompt=login` and independently requires recent `auth_time`. The live tenant issued
immediately expired tokens with `max_age=0`, so that parameter is omitted while
strict expiry validation remains enabled. Only the identity
scopes `openid profile email` are used. No Graph directory-read, file, mailbox,
offline-access or refresh-token permission is needed for this login design.

The app verifies the token signature, tenant-specific issuer, audience, issue
time and expiry. It then requires a member account (`acct=0`), the exact group
ID and authentication within five minutes. Group-claim overage, absent claims,
guests and another tenant fail closed; the app never follows a claim-supplied
directory endpoint. New directory accounts must also be explicitly provisioned
by a deployment operator before they can sign in.

## Credential and deployment settings

Use a dedicated certificate, not the storage or email app's credential. The
prepared certificate expires **May 6, 2027 at 5:07 PM America/Vancouver**. Arrange
overlapping rotation before expiry. Its private key is stored only in the encrypted
Convex deployment environment; temporary local key and environment-file copies
were removed after live token exchange succeeded. Entra received only the public
certificate. Mail credentials remain separate encrypted runtime secrets.

Server-only variables:

```dotenv
SOCIETYER_ENTRA_LOGIN=1
MICROSOFT_LOGIN_TENANT_ID=220c85f6-1cb1-4bb2-a63b-55d9fd163b55
MICROSOFT_LOGIN_CLIENT_ID=bfced040-9730-45b5-b943-345a06bb8b60
MICROSOFT_LOGIN_GROUP_IDS=815b3b71-596d-48fe-aafd-f5bf34aafa5c
MICROSOFT_LOGIN_PRIVATE_KEY=<PKCS8-private-key>
MICROSOFT_LOGIN_CERT_SHA256=<base64url-SHA256-certificate-thumbprint>
SOCIETYER_ENTRA_SSO_REQUIRED=1
```

The private key never belongs in `VITE_*`, Pages configuration, screenshots or
Git. Client assertions use PS256, the certificate's `x5t#S256`, the exact tenant
token endpoint, a unique `jti`, and a five-minute lifetime.

Deploy the backend and DDC North frontend, provision the reviewed accounts,
then pilot the live callback. Only after a successful pilot set
`SOCIETYER_ENTRA_SSO_REQUIRED=1`. That flag disables email sign-in/sign-up routes
and rejects existing sessions without a server-recorded Entra proof at the
backend, including direct Convex access. The login screen follows the same
server-owned capability; hiding the password form is not the enforcement.

## Users and existing roles

The operator tool `entraProvisioning:registerDirectoryMember` accepts the
directory Object ID and an explicitly selected existing auth-user ID. The
reviewed mapping preserves Ahmad's Owner and Amir's Admin membership in the
DDC North workspace, including Amir's separate workspace membership. The remaining member, Fryderyk, was provisioned as Viewer. Provisioning is internal-only, audited and
idempotent. It refuses to merge accounts merely by email or reactivate disabled
identities/memberships. It sends no invitations or notification messages.

The Microsoft account key for this new connection is its immutable `oid`.
Existing Node-broker Microsoft connections retain their prior `sub` key.
Microsoft sign-in does not assert that a user's mailbox is verified. Explicit
directory membership can authorize the bound workspace account, while email
invitations continue to require their existing mailbox-verification rules.

This is group-gated login with explicitly provisioned users, not a full Graph
directory mirror or SCIM service. Adding a future group member requires the
same operator provisioning. Workspace roles remain under app administration.

## Refresh, reauthentication and offboarding

- App sessions have a fixed eight-hour lifetime; no sliding renewal. The older
  seven-day persistence setting does not apply while Entra login is enabled.
- Convex API JWTs last five minutes. The client refreshes them in the background
  while the app session remains valid; refreshing a JWT does not extend the
  eight-hour session or change the authenticated group evidence.
- After expiry, a fresh Microsoft sign-in is required. Authentication timestamps
  and proof expiry are also checked by the backend. Another user's or session's
  proof is never reusable.
- Keep organizational MFA in Entra. Apply a dedicated app-scoped Conditional
  Access policy where licensed; do not change tenant-wide MFA/session policies
  as part of this rollout. The app does not manufacture an MFA claim from a
  successful first-factor login.
- Removing a user from the group or disabling them in Entra prevents their next
  Microsoft sign-in. An existing app session may remain valid for up to eight
  hours. For urgent offboarding, disable their Societyer membership immediately
  and run the internal `entraProvisioning:revokeMemberSessions` using their
  directory Object ID. Repeat if its `more` result is true. A previously issued
  JWT can remain valid for up to five minutes; ordinary membership checks still
  enforce the disabled membership on protected operations.
- Signing out ends the Societyer session, without signing the user out of all
  Microsoft 365 apps. Password recovery remains an operator-controlled fallback
  by disabling the required-SSO flag; do not weaken group or tenant validation.

## Verification

`npm run test:hosted-entra` exercises the installed Better Auth engine with real
OAuth routes, PKCE/state and the Convex cross-domain one-time-token plugin,
signed fixture tokens and certificate assertions. It tests group/guest/age
denial, stable account binding, per-session evidence, expiry and password-bypass
rejection. Real Convex mutation tests cover Viewer defaults, preserved Owner
authority, disabled-account rejection and audit records. The existing Microsoft,
persistent-session and identity-binding checks also pass, as does the DDC North
production build. Fixtures do not prove a live Entra registration or consent.

Live verification confirmed Ahmad’s Microsoft login to the existing DDC North
workspace and staff administration at `https://ddcnorth.com/admin`. The admin
portal rejects an existing session without Entra evidence. Both frontends now
redeem the cross-domain one-time callback token before mounting session guards;
regression checks cover concurrent mounts and invalid tokens. Staff API calls
continue across short-token renewal. Other staff were provisioned and their
roles preserved, but were not interactively tested without their participation.

## Rollback

Set `SOCIETYER_ENTRA_SSO_REQUIRED=0` first to restore password access, then
disable `SOCIETYER_ENTRA_LOGIN` if necessary. Existing account IDs and roles
remain intact. Revoke the dedicated certificate/registration if abandoning the
integration, and remove the private key from the deployment. Revoking Entra
credentials alone does not invalidate already-issued app sessions.

## Sources

- [Microsoft certificate assertions](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials)
- [Group claims and immutable group IDs](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-fed-group-claims)
- [Group-based application assignment](https://learn.microsoft.com/en-us/entra/identity/users/groups-saasapps)
- [Microsoft reauthentication guidance](https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-policy-persistent-browser-session)
- [Better Auth Microsoft provider](https://better-auth.com/docs/authentication/microsoft)
