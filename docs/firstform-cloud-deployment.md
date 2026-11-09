# First Form hosted workspace

Updated November 8, 2026. First Form now shares Convex production with DDC North.
It keeps its own workspace, website, members, roles, branding and storage policy.
See the [deployed setup](shared-workspaces/production-setup.md) for the complete
configuration and transfer evidence.

| Resource | Current target |
| --- | --- |
| Primary app | [portal.1stform.ca](https://portal.1stform.ca) |
| Pages alias | [societyer-firstform.pages.dev](https://societyer-firstform.pages.dev) |
| Pages project | `societyer-firstform`, Direct Upload |
| Shared production | [industrious-cricket-610](https://dashboard.convex.dev/t/ahmad-jalil/societyer-ddcnorth/industrious-cricket-610) |
| Development / qualification | `reminiscent-marlin-243`; not moved |
| Former production | `elated-bee-460`; retained with old client access locked |

## Release

Use locked dependencies and a clean, current checkout. Both production frontend
profiles name the shared backend. Backend deployment affects DDC too, so use an
explicit shared selector and preserve both workspaces' policies:

```sh
printf 'CONVEX_DEPLOYMENT=prod:industrious-cricket-610\n' > .env.convex-shared-production.local
npx convex deploy --env-file .env.convex-shared-production.local --codegen disable --typecheck enable --dry-run
npx convex deploy --env-file .env.convex-shared-production.local --codegen disable --typecheck enable
npm run deploy:firstform
```

`deploy:firstform` builds with `.env.firstform` into `tmp/firstform-dist` and
publishes with `deploy/firstform/wrangler.jsonc`. A frontend-only change does not
need a backend deploy. The old `.env.convex-firstform-production.local` selector
may still name `elated-bee-460`; do not use it for a shared release. Backend
secrets belong in shared Convex, never in `VITE_*`.

## Domain and access

`portal.1stform.ca` is a Pages custom domain and a proxied CNAME to
`societyer-firstform.pages.dev`. It is an exact trusted `SITE_URL` origin and
First Form's primary Active workspace mapping. The Pages alias remains trusted
and mapped as a secondary origin. Both use the same build and backend. See
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

## Verified release and retained source

[PR #77](https://github.com/ahzs645/societyer/pull/77) contains the shared frontend
configuration. Both production builds and six PR checks passed. The real
rehearsal, final row/reference/file/financial verification, role bindings, Owner
browser sign-in, reload and Pages-alias-to-custom-domain handoff passed. Real
third-party AI client authorization and a new native document-version upload
remain unqualified.

The former backend is not the current production target. Its old identities
are blocked to prevent split writes. Encrypted backups and recovery notes are
held privately outside Git. Once users write on shared production, reopening
that source does not recover those writes. Use the
[migration and rollback procedure](shared-workspaces/migration-and-cutover.md).
