# First Form hosted instance

- [Cloudflare Pages app](https://societyer-firstform.pages.dev)
- [Convex production](https://dashboard.convex.dev/t/ahmad-jalil/societyer-firstform/elated-bee-460)
- [Convex development](https://dashboard.convex.dev/t/ahmad-jalil/societyer-firstform/reminiscent-marlin-243)

Cloudflare Pages serves the app. Convex Cloud runs the database, application
functions, and Better Auth. First Form has its own project and database.
The Pages project uses Direct Upload from this repository.

## Release

Use Node and the locked dependencies from this repository. Target the
First Form deployment explicitly when running any Convex command.

```sh
npm ci --ignore-scripts --no-audit --no-fund
printf 'CONVEX_DEPLOYMENT=prod:elated-bee-460\n' > .env.convex-firstform-production.local
npx convex deploy --env-file .env.convex-firstform-production.local --typecheck enable --yes
npm run deploy:firstform
```

The Vite profile `.env.firstform` contains public production URLs. Backend
settings and credentials belong on the First Form Convex deployment.

## Access

Production uses `AUTH_MODE=convex`, with the Pages production URL as its
trusted sign-in origin. `SOCIETYER_AUTH_MANUAL_PROVISIONING=1` closes public
registration. An operator can create a login for a confirmed address from the
Convex dashboard or CLI. In the CLI, use the production selector from above.

```sh
npx convex run --env-file .env.convex-firstform-production.local \
  hostedAuth:provisionAccount '{"name":"Full Name","email":"confirmed@example.org"}'
```

Share the returned link privately with the account holder. It works once for
one hour and lets them choose their password. The operator confirms the email
address before provisioning. The command sends no mail and grants no workspace
membership. The first user can create the workspace and become its Owner.
For an expired link, use `hostedAuth:issuePasswordResetLink` with the same email.

First Form can offer authenticator apps through Better Auth. See
[two-factor authentication](two-factor-authentication.md) for the deployment
flag, enrollment, backup codes, and provider-specific setup.

## Invoice branding

`SOCIETYER_INITIAL_INVOICE_TEMPLATE=firstform` installs the First Form template
as the workspace default during organization setup. Its outlined horizontal
logo comes from the [First Form Brandkit](https://projects.ahmadjalil.com/brandkit/?brand=firstform)
and is bundled with the backend. The browser and PDF use the same saved
artwork. Workspace owners can change their default under **Invoices →
Templates**. Invoice numbering, customer details, tax details, and payment
instructions come from each workspace's own records.

`npm run test:brandkit` checks the vector rendering in HTML and PDF.

## Release checks

- Production Pages serves the First Form build and connects to its Convex
  WebSocket. The invoice route requires sign-in and public registration
  returns HTTP 403.
- On the development deployment, guided setup installed the invoice template.
  A draft saved and reloaded from Convex with the logo, and its downloaded PDF
  showed the same artwork and invoice totals.
- Operator provisioning was tested on the development deployment. A duplicate
  attempt was rejected, the setup link worked once, and the account signed in
  while public registration stayed closed.
