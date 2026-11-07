# DDC North portal and Microsoft Entra ID

## Domain configuration (2026-11-07)

The existing Cloudflare Pages project `societyer-ddcnorth` serves
`https://portal.ddcnorth.com`. Its original `societyer-ddcnorth.pages.dev`
address is retained.

- Cloudflare account: `479e77f49d4ac5d7498529ee360f194b`.
- DNS zone: `ddcnorth.com` (`693d6db450e026fc01b4f5829efe50f4`).
- Pages custom domain: `portal.ddcnorth.com`.
- Proxied CNAME: `portal.ddcnorth.com` → `societyer-ddcnorth.pages.dev`.
- Convex production deployment: `industrious-cricket-610`.
- Convex `SITE_URL` is now
  `https://portal.ddcnorth.com,https://societyer-ddcnorth.pages.dev,https://ddcnorth.com,https://www.ddcnorth.com`.
  The first origin is primary for links; the others remain trusted origins.
- Meeting upload Worker `societyer-ddcnorth-meeting-transfer` accepts the exact
  portal and original Pages origins through its comma-separated `SITE_ORIGIN`.
  Requests from other browser origins remain denied.

No frontend rebuild or change of authentication broker is required for this
hostname. Authentication sessions are stored per frontend origin, so someone
already signed in at the Pages address may need to sign in at the portal.

## Recommended SSO design

Keep Pages for the frontend and `AUTH_MODE=convex` for the current Better Auth
component. Add Microsoft OAuth/OIDC sign-in to that component. The browser
returns to the portal after authenticating with the company's Entra directory;
Convex continues checking Societyer workspace memberships and roles.

The current Convex broker does **not** configure a Microsoft provider. The
existing tenant-restricted implementation in `server/microsoft-sso.ts` belongs
to the separate Node broker. Setting its environment variables alone will not
enable Microsoft login in the deployed application.

Implementation sequence:

1. An Entra administrator registers a dedicated, single-tenant Web application
   for Societyer sign-in. With the current auth host, register this exact redirect:
   `https://industrious-cricket-610.convex.site/api/auth/callback/microsoft`.
2. Store the tenant ID, client ID and expiring credential on the Convex deployment,
   never in `VITE_*`, Git, Pages assets or chat. Track credential rotation.
3. Adapt the existing Microsoft provider and tenant/token validation for
   `convex/hostedAuth.ts`, using the Convex auth base URL. Add safe provider
   discovery and **Continue with Microsoft** to the Convex login flow. Preserve
   fixed-tenant validation, identity-only scopes and explicit account linking.
4. Require assignment to the Entra enterprise application; assign approved staff
   or a staff group. Apply the organization's MFA/Conditional Access policies
   where licensed. Keep storage and mail service principals separate.
5. Deliberately link or migrate existing login identities and workspace memberships.
   Do not silently merge accounts by matching email. A successful Microsoft login
   must not create workspace permissions automatically.
6. Pilot with an approved administrator. Test existing-user migration, a newly
   invited staff member, an unassigned user, a different tenant, a guest, logout,
   account disabling and session revocation. An SSO-only requirement also needs
   backend enforcement and treatment of existing password sessions; hiding a
   password button is insufficient.

This preserves the current hosting arrangement. Moving to the Node auth broker
would be another option, but would add a service/database and require an explicit
identity migration.

## Optional Cloudflare Access gate

For a staff-only portal, Access can authenticate users with Entra before serving
the site. The account currently has Zero Trust team domain
`ahzs645.cloudflareaccess.com`, an email-code login method, and no Access apps
or Entra identity provider. No Access policy was enabled as part of the domain work.

An Access Entra registration uses a different redirect:
`https://ahzs645.cloudflareaccess.com/cdn-cgi/access/callback`.
Configure the Entra identity provider, test it, and attach a reusable Allow policy
for approved identities/groups to a self-hosted application covering the portal.
Use confirmed group IDs and a pilot before broader enforcement.

Access is an additional login gate; it does not create a Societyer session or
replace Convex authorization. To claim an edge gate protects the entire site,
also protect preview URLs and protect or redirect the original Pages hostname.
Direct Convex endpoints and the transfer Worker still require application-level
authentication and authorization. Keep webhook and machine access requirements
in scope when designing any broader gate.

## Validation and rollback

The portal serves the frontend over HTTPS, and anonymous auth session requests
return successfully with the portal's CORS origin. The existing
`test:meeting-sources` suite and Worker deployment dry run passed, including both
allowed origins and rejection of lookalike origins. These checks do not establish
that Microsoft SSO or an authenticated production upload has been tested.

To undo the hostname move, restore the previous Convex `SITE_URL`:
`https://societyer-ddcnorth.pages.dev,https://ddcnorth.com,https://www.ddcnorth.com`.
Remove the portal CNAME and Pages custom-domain association, then restore the
Worker's original origin/config if desired. The previous Worker version was
`ecc4429b-cd1d-4d4c-8870-4c05dfa2376e`; the domain update deployed version
`167decdb-9fc4-4f10-861d-3b8e56a8eeb3`.

## References

- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Entra ID with Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/entra-id/)
- [Better Auth Microsoft provider](https://better-auth.com/docs/authentication/microsoft)
- [Restrict an Entra application to assigned users](https://learn.microsoft.com/en-us/entra/identity-platform/howto-restrict-your-app-to-a-set-of-users)
- [Existing Convex hosted auth setup](convex-hosted-auth-setup.md)
- [Existing Node Microsoft provider setup](microsoft-sso-setup.md)
