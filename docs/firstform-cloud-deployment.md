# First Form hosted workspace

Updated November 19, 2026. First Form shares Convex production and the production
frontend with DDC North. Its custom-domain attachment and DNS now target the
shared Pages project; Cloudflare domain validation is active. It keeps its own
workspace, website, members, roles, branding and storage policy.
See the [deployed setup](shared-workspaces/production-setup.md) for the complete
configuration and transfer evidence.

| Resource | Current target |
| --- | --- |
| Primary app | [portal.1stform.ca](https://portal.1stform.ca) |
| Legacy Pages alias | [societyer-firstform.pages.dev](https://societyer-firstform.pages.dev); retained prior release |
| Production Pages project | `societyer-ddcnorth`, Direct Upload |
| Production frontend release | `bf8ab44f-d9cb-464f-9197-4029737631af`, source `7dcad5ef` |
| Shared production | [industrious-cricket-610](https://dashboard.convex.dev/t/ahmad-jalil/societyer-ddcnorth/industrious-cricket-610) |
| Development / qualification | `reminiscent-marlin-243`; not moved |
| Former production | `elated-bee-460`; deleted November 19, 2026; First Form development and shared production retained |

## Release

The frontend release commands now use the shared build and target Pages project
`societyer-ddcnorth`. See the [shared frontend release guide](shared-workspaces/shared-frontend-release.md)
and [November 19 release evidence](shared-workspaces/production-setup.md#november-19-2026-shared-frontend-release).
The shared backend was deployed from the same released source before the frontend.

Use locked dependencies and a clean, current checkout. Both production frontend
profiles name the shared backend. Backend deployment affects DDC too, so use an
explicit shared selector and preserve both workspaces' policies:

```sh
printf 'CONVEX_DEPLOYMENT=prod:industrious-cricket-610\n' > .env.convex-shared-production.local
npx convex deploy --env-file .env.convex-shared-production.local --codegen disable --typecheck enable --dry-run
npx convex deploy --env-file .env.convex-shared-production.local --codegen disable --typecheck enable
npm run deploy:shared
```

`deploy:shared` builds with `.env.shared` into `dist` and publishes both custom
domains through the root `wrangler.jsonc`.
`deploy:firstform` and `deploy:ddcnorth` are aliases for that command. The old
First Form project/configuration is retained only for compatibility and rollback.
A frontend-only change does not need a backend deploy. The old
`.env.convex-firstform-production.local` selector is obsolete: its target
`elated-bee-460` was deleted on November 19. Use the shared selector above for
production releases. Backend secrets belong in shared Convex, never in `VITE_*`.

## Domain and access

`portal.1stform.ca` is a Pages custom domain and a proxied CNAME to
`societyer-ddcnorth.pages.dev`. It is an exact trusted `SITE_URL` origin and
First Form's primary Active workspace mapping. The Pages alias remains trusted
and mapped as a secondary origin. It retains deployment
`72aa7753-dd02-46ac-8b25-086cddbe0f16` from commit `03f5dcfa` for existing sessions
and rollback, while the custom domain targets the shared frontend. Both use the
same Convex backend. See
[domain onboarding](shared-workspaces/operator-runbook.md#4-domains).

Public sign-up is closed with `SOCIETYER_AUTH_MANUAL_PROVISIONING=1`. For an
operator-confirmed person, pass the intended workspace ID so the private setup
link uses First Form's canonical origin:

```sh
npx convex run hostedAuth:provisionAccount '{"name":"Full Name","email":"confirmed@example.org","societyId":"<First Form societies ID>"}' --deployment industrious-cricket-610
```

This sends no email and grants no membership. Share the one-hour, single-use
link privately with the account holder, who chooses a password and then signs
in. Add membership through a targeted invitation or, for a transfer, bind the
exact destination login with the transfer tool. Do not match accounts by email.
An operator can issue a new private link with `hostedAuth:issuePasswordResetLink`
and the same `societyId` if it expires.

The migrated Owner/Admin roles remain on separate password logins, not
implicitly linked to DDC accounts. People can prove and link their logins
explicitly. A Microsoft button here does not create a First Form membership.
All app sessions have a fixed eight-hour lifetime while Entra is enabled.
Authenticator enrollment is enabled; workspace MFA policy remains independent.
See [two-factor authentication](two-factor-authentication.md) and the
[shared-workspace user guide](shared-workspaces/user-guide.md).

## Storage and invoice branding

First Form has an explicit `allowed/native` policy; DDC remains
`disabled/sharepoint`. Native attachments use Convex storage. Live native
**document versions** additionally require a configured RustFS/R2 adapter, which
was not configured or newly qualified in this cutover.

The imported invoice template remains a First Form workspace record. Leave the
deployment-wide `SOCIETYER_INITIAL_INVOICE_TEMPLATE` unset. To install/refresh the
First Form default deliberately, use `workspaceDefaults:installInvoiceTemplate`
for that workspace only. Owners choose defaults under **Invoices → Templates**.
Invoice numbers, customers, tax settings and payment instructions stay scoped.

## Historical November 8 migration and November 19 retirement

[PR #77](https://github.com/ahzs645/societyer/pull/77) contains the shared frontend
configuration. Both production builds and six PR checks passed. The real
rehearsal, final row/reference/file/financial verification, role bindings, Owner
browser sign-in, reload and Pages-alias-to-custom-domain handoff passed. Real
third-party AI client authorization and a new native document-version upload
remain unqualified.

The former backend's old identities were blocked after migration to prevent
split writes. `elated-bee-460` was deleted on November 19 at
`2026-11-19T18:02:22Z`; the subsequent lookup returned HTTP 404. Only that
deployment was deleted. Shared production and First Form development remain,
and the legacy Pages alias continues to use the shared backend for hosting
rollback. The November 8 record identifies encrypted backups and recovery notes
held privately outside Git; those files were not reverified during retirement.
Recovery from those exports would require a fresh deployment and reconciliation
of subsequent shared-production writes. Use the
[migration and rollback procedure](shared-workspaces/migration-and-cutover.md).
