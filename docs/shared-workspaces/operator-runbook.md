# Shared workspaces: operator runbook

This runbook covers every operator task for shared workspaces and linked sign-in.
The current DDC/First Form domains, release evidence and retained source are in
[production-setup.md](production-setup.md); operational findings are in
[lessons-learned.md](lessons-learned.md).
Read [architecture.md](architecture.md) first. It defines the tables and functions
used here. Moving existing records from two deployments into one is a separate
procedure, in [migration-and-cutover.md](migration-and-cutover.md). Rehearse
everything here on staging first ([staging-setup.md](staging-setup.md)).

Every write in this runbook is an internal Convex function. Only someone with
access to the deployment (CLI or dashboard) can run it. Workspace Owners can't
change sign-in, domain or storage policy from the app.

## Before you start

### Deployments

| Name | Deployment | Frontend | Notes |
| --- | --- | --- | --- |
| DDC North production | `industrious-cricket-610` (project `societyer-ddcnorth`) | `https://portal.ddcnorth.com`, Pages project `societyer-ddcnorth` | Workspace Microsoft/group policies, SharePoint, mail, meeting-transfer Worker |
| First Form production | Shared `industrious-cricket-610` | `https://portal.1stform.ca`, alias `https://societyer-firstform.pages.dev`; Pages project `societyer-firstform` | Separate password logins, native workspace policy |
| Former First Form backend | `elated-bee-460` | No current frontend | Retained source; old client identities locked out to prevent split writes |
| Transfer rehearsal | `rapid-ox-123` | No published frontend | Isolated destination copy and completed rehearsal; temporary key revoked |
| Shared staging | created in [staging-setup.md](staging-setup.md) | Pages preview branches | Synthetic data only |

The shared production deployment is `industrious-cricket-610`. See
[the deployed setup](production-setup.md) and
[destination decision](migration-and-cutover.md#choose-the-destination-deployment).
This runbook calls the deployment you are changing `$TARGET`.

### Command conventions

Set the target once per shell and confirm it before any write:

```sh
TARGET=industrious-cricket-610        # or elated-bee-460, or the staging deployment
npx convex env get SITE_URL --deployment "$TARGET"
```

The printed `SITE_URL` tells you which deployment you reached. Stop if it isn't
the one you meant.

- Functions: `npx convex run <module>:<function> '<json>' --deployment "$TARGET"`.
  This guide passes `--deployment` on every command. In Convex CLI 1.49,
  `convex run`, `convex env`, `convex export` and `convex import` don't list an
  `--env-file` option, so don't rely on one.
- Code deploys use a selector file that holds only `CONVEX_DEPLOYMENT`, with
  `--dry-run` first. The files below are git-ignored (`.env.*.local`).

```sh
# DDC North. The existing .env.convex-ddcnorth-production.local holds settings, not a selector.
printf 'CONVEX_DEPLOYMENT=prod:industrious-cricket-610\n' > .env.convex-ddcnorth-deploy.local
# First Form. This file already exists with this content.
printf 'CONVEX_DEPLOYMENT=prod:elated-bee-460\n' > .env.convex-firstform-production.local
```

Those are the original per-project selectors, retained for source operations.
For a **current shared production release**, use a new explicit selector:

```sh
printf 'CONVEX_DEPLOYMENT=prod:industrious-cricket-610\n' > .env.convex-shared-production.local
```

Do not use the former First Form selector to release the shared backend. Keep
`--codegen disable` when deploying this checkout's tracked generated TypeScript
files, and run its real type checks. See the [release guide](../firstform-cloud-deployment.md#release).

### Record what you are about to change

Before changing a variable, print its current value and keep it outside the
repository:

```sh
npx convex env list --names-only --deployment "$TARGET"
npx convex env get SITE_URL --deployment "$TARGET"
npx convex env get SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS --deployment "$TARGET"
```

Don't save `env list --include-values` output into the repository. It contains
secrets.

### Find workspace and membership IDs

```sh
npx convex run --inline-query 'return (await ctx.db.query("societies").collect()).map((s) => ({ id: s._id, name: s.name }))' --deployment "$TARGET"

npx convex run --inline-query 'return (await ctx.db.query("users").collect()).map((u) => ({ id: u._id, societyId: u.societyId, email: u.email, role: u.role, status: u.status ?? "Active", authSubject: u.authSubject }))' --deployment "$TARGET"
```

`authSubject` is the Better Auth user ID of the login a membership is bound to.
Below, `DDC_ID` and `FF_ID` are the `societies` IDs of DDC North and First Form
on `$TARGET`. A DDC deployment can hold more than one DDC workspace (for example
the October live test workspace). Apply DDC's sign-in and storage policy to each
of them.

### Order at a glance

| Step | Where | Reversed by |
| --- | --- | --- |
| [1. Deploy the new code](#1-deploy-the-new-code-to-each-existing-deployment) | Both existing deployments | Redeploying the previous commit |
| [2. Workspace sign-in policy](#2-workspace-sign-in-policy) | Every deployment that hosts DDC workspaces | `workspaceSignInPolicies:clear` |
| [3. Deployment-wide sign-in settings](#3-deployment-wide-sign-in-settings-on-a-shared-deployment) | The shared deployment only | Restoring the recorded values |
| [4. Domains](#4-domains) | Each deployment, for its own origins | `upsert` with `"status":"Disabled"` |
| [5. Storage policies](#5-storage-policies) | Each deployment | `set` back to `allowed` / `deployment-default` |
| [6. Workspace defaults](#6-workspace-defaults) | The shared deployment | The Owner changes the default template |
| [7. Accounts and links](#7-accounts-provisioning-reset-links-and-microsoft-logins) | As needed | |
| [8. Link conflicts and unlink requests](#8-link-conflicts-and-unlink-requests) | As needed | |
| [9. Offboarding](#9-offboarding) | As needed | |

Steps 2, 4 and 5 are safe to run on the current separate deployments. They have
no visible effect while DDC keeps `SOCIETYER_ENTRA_SSO_REQUIRED=1` and
`SOCIETYER_DISABLE_NATIVE_FILE_STORAGE=1`, and they mean the rows are ready when
First Form joins. Step 3 only happens on the deployment that will hold both
organizations.

## 1. Deploy the new code to each existing deployment

Deploy the backend first, then the frontend, on each deployment. Build both
frontends from the same clean commit. Record the commit hash.

For the current consolidated production setup, deploy the shared backend once
and then both frontends. The separate-backend instructions below describe the
initial bootstrap; the retired First Form backend is not a routine release target.

### Is it backward compatible?

Mostly yes. With no rows in `workspaceSignInPolicies`, `workspaceDomains` or
`workspaceStoragePolicies`, I checked these paths in the code:

- Sign-in: `evaluateWorkspaceSignIn(null, …)` returns `{ ok: true }`
  (`shared/workspaceSignInPolicy.ts`). The deployment-wide checks in
  `hostedPrincipal` (`SOCIETYER_ENTRA_SSO_REQUIRED`, allowed email domains,
  verified email) are unchanged.
- Membership resolution still matches the exact issuer and subject, now through
  the `by_auth_identity` index. Without links, `linkedIdentityKeys` returns only
  the session's own identity.
- Storage: `effectiveWorkspaceStorage(null, env)` reproduces the deployment
  settings exactly. `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE` and
  `SOCIETYER_STORAGE_PROVIDER` keep their meaning.
- Domains: with no rows, `resolveOrigin` returns `null`. The frontend then keeps
  the old startup (remembered workspace, else the first one) and switches
  workspaces in place.
- Links in emails: with no primary domain, provisioning, reset and invitation
  links use the first `SITE_URL` origin, as before.

Exceptions you will notice:

1. **Account linking is live at once.** The **My workspaces**, **Sign-in
   methods** and **Link an existing account** pages and the `accountLinks:*`
   functions work as soon as the code is deployed. A person can link two logins
   that exist on the same deployment. This writes to the new `personAccounts`,
   `personIdentityLinks`, `accountLinkRequests` and `accountLinkEvents` tables.
   It never creates or reactivates a membership. On DDC, password sign-in is
   still refused, so both logins would have to be Microsoft logins.
2. **The JWT has a new claim.** Every Convex token now carries
   `societyer_session` (`{ id, createdAt }`). Consumers that read the raw JWT,
   such as the DDC staff admin at `https://ddcnorth.com/admin` and the
   meeting-transfer Worker, must accept an extra claim. Check the staff admin
   after deploying.
3. **The remembered workspace resets once.** The browser now stores the selected
   workspace per backend URL. After the frontend release, each person's first
   load opens their first workspace (or the domain's workspace, once domains are
   mapped). Later loads remember the choice again.
4. **Native uploads need a workspace.** Every native upload guard now takes the
   workspace ID and refuses a call without one. The app always sends one.
5. **Provisioning checks links.** `entraProvisioning:registerDirectoryMember`
   now refuses to add a membership when the person already holds one in that
   workspace through a linked login.
6. **The sign-in page waits for the domain lookup.** In convex mode, `/login`
   shows "Loading sign-in…" until `workspaceDomains:resolveOrigin` answers, for
   at most 8 seconds. A backend without the function reads as "unmapped". This
   is one more reason to deploy the backend first.

Policy rows change behaviour only for the workspaces they name.

### Commands

Type-check once from the release commit:

```sh
git status --short            # must be empty
git rev-parse HEAD            # record it
./node_modules/.bin/tsc -p convex/tsconfig.json --noEmit
```

DDC North backend, then frontend:

```sh
./node_modules/.bin/convex deploy --env-file .env.convex-ddcnorth-deploy.local --codegen disable --typecheck enable --dry-run
./node_modules/.bin/convex deploy --env-file .env.convex-ddcnorth-deploy.local --codegen disable --typecheck enable

./node_modules/.bin/vite build --mode ddcnorth
CLOUDFLARE_ACCOUNT_ID=479e77f49d4ac5d7498529ee360f194b ./node_modules/.bin/wrangler pages deploy dist \
  --project-name societyer-ddcnorth --branch main --commit-dirty=false
```

The meeting-transfer Worker has no changes in this release.

Before consolidation the First Form backend was deployed separately. For the
current shared deployment, deploy the backend **once** using the shared selector
above, then publish First Form's frontend:

```sh
./node_modules/.bin/convex deploy --env-file .env.convex-shared-production.local --codegen disable --typecheck enable --dry-run
./node_modules/.bin/convex deploy --env-file .env.convex-shared-production.local --codegen disable --typecheck enable

npm run deploy:firstform
```

`deploy:firstform` runs `build:firstform` (type checks, then
`vite build --mode firstform --outDir tmp/firstform-dist`) and publishes
`tmp/firstform-dist` through `deploy/firstform/wrangler.jsonc`.

### Check

On the intended deployment, inspect the actual rows (empty only before initial
policy setup; shared production must retain the configured policies):

```sh
npx convex run workspaceSignInPolicies:list --deployment "$TARGET"
npx convex run workspaceStoragePolicies:list --deployment "$TARGET"
npx convex run workspaceDomains:audit --deployment "$TARGET"
```

During initial setup, `audit` reports `site-url-unmapped` until step 4. Current
shared production should return `ok: true`. Then:

- Sign in to each production site as a real member and open a record.
- DDC: the normal login page is Microsoft-only. The shared broker can accept
  First Form passwords, but a password-only session cannot read DDC and sees it
  locked. A linked Microsoft provider alone is not session evidence.
- DDC: the separate staff admin accepts a valid Microsoft token and denies a
  First Form password token.

### Rollback

Redeploy the previous commit to the backend and frontend:

```sh
git checkout <previous-commit>
./node_modules/.bin/convex deploy --env-file <selector file> --codegen disable --typecheck enable --dry-run
```

If the old revision does not understand workspace policies or links, do not
roll shared production back to it while both organizations are live. A dry-run
schema refusal is a stop: do not empty production policy, domain or identity
tables to make old code deploy. Use a compatible fix or the coordinated
[recovery procedure](production-setup.md#backups-retained-source-and-rollback).
Disposable staging fixtures can instead be recreated deliberately.

## 2. Workspace sign-in policy

`workspaceSignInPolicies:set` takes:

| Argument | Type | Notes |
| --- | --- | --- |
| `societyId` | workspace ID | Required |
| `requiredMethod` | `"any"` or `"microsoft"` | Required |
| `microsoftTenantId` | UUID | `microsoft` only. Must equal the deployment's `MICROSOFT_LOGIN_TENANT_ID` |
| `microsoftGroupIds` | UUID array | `microsoft` only. At least one; each must be in `MICROSOFT_LOGIN_GROUP_IDS` |
| `allowedEmailDomains` | string array | Optional. Domain names without `@` or wildcards |
| `supportEmail` | string | Optional. Shown on the lock screen and on the sign-in page of a mapped domain |
| `reason` | string | Required, 1 to 500 characters, written to the workspace activity log |

`set` replaces the whole row. A field you leave out is cleared. It refuses a
`microsoft` policy unless `SOCIETYER_ENTRA_LOGIN=1` and the Entra settings parse.
A refused call writes nothing.

### DDC North

Run this for every DDC workspace:

```sh
npx convex run workspaceSignInPolicies:set '{
  "societyId": "'"$DDC_ID"'",
  "requiredMethod": "microsoft",
  "microsoftTenantId": "220c85f6-1cb1-4bb2-a63b-55d9fd163b55",
  "microsoftGroupIds": ["815b3b71-596d-48fe-aafd-f5bf34aafa5c"],
  "supportEmail": "<DDC support address>",
  "reason": "DDC North requires Microsoft sign-in from its directory group"
}' --deployment "$TARGET"
```

Leave out `supportEmail` if you don't have a shared help address. It is public
on the DDC sign-in page.

Don't set `allowedEmailDomains` for DDC. The email-domain rule only accepts a
session whose account email is verified. `registerDirectoryMember` creates
Microsoft-only accounts with `emailVerified: false`, so those members would be
locked out. The tenant and group check is the stronger rule anyway.

### First Form

```sh
npx convex run workspaceSignInPolicies:set '{
  "societyId": "'"$FF_ID"'",
  "requiredMethod": "any",
  "supportEmail": "<First Form support address>",
  "reason": "First Form accepts its provisioned password accounts"
}' --deployment "$TARGET"
```

An `any` row without `supportEmail` behaves exactly like no row. Its use is to
carry First Form's support address. On a mapped domain the sign-in page shows
only that workspace's `supportEmail`; it never falls back to the deployment-wide
`SOCIETYER_AUTH_SUPPORT_EMAIL`, which may belong to the other organization.
Without the row, First Form's page says "Contact your workspace administrator."

### Check

```sh
npx convex run workspaceSignInPolicies:list --deployment "$TARGET"
npx convex run workspaceSignInPolicies:get '{"societyId":"'"$DDC_ID"'"}' --deployment "$TARGET"
```

`get` reports duplicate rows as an error. Run `set` or `clear` to repair them.
While duplicates exist, access to that workspace fails.

On a deployment that still has `SOCIETYER_ENTRA_SSO_REQUIRED=1`, nothing visible
changes. On a shared deployment, a password session now sees DDC as **Needs
Microsoft sign-in**, and a direct backend call fails with "This workspace
requires a Microsoft sign-in from its organization. Sign in with Microsoft to
continue."

### Revoke AI connector grants and API tokens issued before the policy

AI connector (MCP) tokens act without a browser session, so the policy is
checked when a token is minted, not when it is used. `set` therefore revokes
the workspace's live AI connector grants whenever the new policy requires
Microsoft or an email domain; the audit entry says how many. Members connect
their assistants again from a session that meets the policy.

API tokens (**Settings → API keys**) are workspace integration credentials and
are not revoked automatically. Review them after setting a policy and rotate
any you no longer trust. To check what is still live:

```sh
npx convex run --inline-query 'return (await ctx.db.query("agentGrants").collect()).filter((g) => !g.revokedAtISO).map((g) => ({ id: g._id, societyId: g.societyId, kind: g.kind ?? "token", name: g.name, userId: g.userId, createdAtISO: g.createdAtISO }))' --deployment "$TARGET"

npx convex run --inline-query 'return (await ctx.db.query("apiTokens").collect()).filter((t) => t.status === "active").map((t) => ({ id: t._id, societyId: t.societyId, name: t.name, createdAtISO: t.createdAtISO }))' --deployment "$TARGET"
```

Revoke API keys in the app at **Settings → API keys** (`/app/settings/api-keys`).

### Rollback

```sh
npx convex run workspaceSignInPolicies:clear '{"societyId":"'"$DDC_ID"'","reason":"Rollback: <why>"}' --deployment "$TARGET"
```

`clear` returns `true` if it removed a row, and logs it. On a shared deployment,
**don't clear DDC's policy while `SOCIETYER_ENTRA_SSO_REQUIRED` is off.** That
would let password sessions into DDC. Fix the row with `set` instead.

## 3. Deployment-wide sign-in settings on a shared deployment

These variables still apply to every workspace on a deployment. On the
deployment that holds both organizations they must be set as follows.

| Variable | Shared value | Why |
| --- | --- | --- |
| `SOCIETYER_AUTH_MANUAL_PROVISIONING` | `1` | Keeps public sign-up closed. The October records show DDC with sign-up enabled; if the variable still isn't set there, DDC's sign-up is closed today only because required SSO blocks the email routes. Any signed-in account without a membership may create a workspace, so open sign-up is not acceptable. Also required by `hostedAuth:provisionAccount`. |
| `SOCIETYER_ENTRA_SSO_REQUIRED` | removed (or `0`) | When `1`, every session on the deployment needs Microsoft evidence and email sign-in returns 403, which locks out every First Form account. Turn it off last, as below. |
| `SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS` | unset | When set, the backend treats every other domain as anonymous, and account creation, sign-in and email changes are refused for other domains. It must be unset, or list every domain used by any account on the deployment. First Form accounts can use any domain, so unset it. Per-workspace restrictions belong in `allowedEmailDomains` of a sign-in policy. |
| `SOCIETYER_ENTRA_LOGIN`, `MICROSOFT_LOGIN_*` | DDC's values | One Entra registration, tenant and group list per deployment. Workspace policies can only name that tenant and those groups. |
| `SOCIETYER_AUTH_INSTANCE_NAME`, `SOCIETYER_AUTH_SUPPORT_EMAIL` | unset, or neutral | Shown on unmapped origins. A mapped domain shows its workspace's name and its policy's `supportEmail` instead. A mapped domain whose policy has no `supportEmail` shows none (never the deployment value). |
| `AUTH_PERSISTENT_SESSION_DAYS`, `AUTH_SESSION_MAX_AGE_SECONDS` | no effect | While Entra login is on, every session (password sessions too) is a fixed 8 hours with no renewal. First Form users will see this. |
| `SOCIETYER_AUTH_TOTP_ENROLLMENT` | as First Form needs | Deployment-wide. Lets any account enrol an authenticator. Workspace MFA requirements stay per workspace. |
| `SITE_URL` | every frontend origin | See [step 4](#4-domains). |
| Storage variables | see [step 5](#5-storage-policies) | |
| `SOCIETYER_INITIAL_INVOICE_TEMPLATE` | unset | See [step 6](#6-workspace-defaults). |

Compare the two deployments' variable names before cutover:

```sh
npx convex env list --names-only --deployment industrious-cricket-610 | sort > /tmp/ddc-env-names
npx convex env list --names-only --deployment elated-bee-460 | sort > /tmp/ff-env-names
diff /tmp/ddc-env-names /tmp/ff-env-names
```

Anything First Form relies on that is missing on the destination (mail,
`RUSTFS_*` or `R2_*`, TOTP, AI connector settings) has to be added there.

### Turning off required SSO

Do this only on the deployment that holds both organizations, in this order:

1. `npx convex env set SOCIETYER_AUTH_MANUAL_PROVISIONING 1 --deployment "$TARGET"`
2. Set the DDC sign-in policy on **every** DDC workspace (step 2). A workspace
   without a row accepts any sign-in method once the flag is off. Check:
   `npx convex run workspaceSignInPolicies:list --deployment "$TARGET"`.
3. Map the DDC domains (step 4), so `portal.ddcnorth.com` keeps showing only
   **Continue with Microsoft**. The password form is hidden there because the
   mapped workspace requires Microsoft, not because of the deployment flag.
4. Set the DDC storage rows (step 5) before you remove the storage ceiling.
5. Turn the flag off:
   `npx convex env remove SOCIETYER_ENTRA_SSO_REQUIRED --deployment "$TARGET"`
6. Verify:
   - `portal.ddcnorth.com/login` shows only **Continue with Microsoft**.
   - A DDC member signs in with Microsoft and opens DDC.
   - An account that has a password (for example Ahmad's, which has both) signs
     in with its password on an unmapped or First Form origin. DDC shows
     **Needs Microsoft sign-in**. The lock screen offers **Continue with
     Microsoft for DDC North**.
   - With that password session, a direct call such as `society:getById` for DDC
     fails with the Microsoft sign-in message.
7. Only when First Form accounts arrive, unset the domain allowlist:
   `npx convex env remove SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS --deployment "$TARGET"`

Rollback: to protect DDC, fix its policy row. Setting
`SOCIETYER_ENTRA_SSO_REQUIRED=1` again also protects DDC, but it locks every
First Form password user out of the shared deployment. Use it only as an
emergency stop. Restore other variables from the values you recorded.

## 4. Domains

A domain mapping picks which workspace an origin opens first, its sign-in page
branding and the origin used in links. It never grants access.

### SITE_URL must list every frontend origin

Better Auth only trusts origins in `SITE_URL`, and `workspaceDomains:upsert`
refuses an origin that isn't there. List every exact origin, comma-separated,
with no paths. The first entry is the fallback for links and for the cross-domain
plugin, so keep DDC's custom domain first on a deployment that hosts DDC.

On a shared deployment:

```sh
npx convex env get SITE_URL --deployment "$TARGET"     # record the old value
npx convex env set SITE_URL 'https://portal.ddcnorth.com,https://societyer-ddcnorth.pages.dev,https://ddcnorth.com,https://www.ddcnorth.com,https://societyer-firstform.pages.dev,https://portal.1stform.ca' --deployment "$TARGET"
```

The First Form custom domain is attached and listed above. Add a future customer
origin only after its frontend domain is verified.
Only list origins whose frontend build points at `$TARGET`. A domain whose build
uses another backend breaks sign-in and switching.

On a separate deployment, map only the origins already in its own `SITE_URL`.

AI connectors (MCP) on the shared deployment: each `SITE_URL` origin has its
own server URL, and sign-in for it is approved on that origin's consent page:

- DDC North: `https://<deployment>.convex.site/mcp/portal.ddcnorth.com`
- First Form: `https://<deployment>.convex.site/mcp/portal.1stform.ca`

Settings → AI connectors shows the right one on each domain; members paste that
into claude.ai, ChatGPT, Claude Code or Codex. Plain `/mcp` still works and
approves on the first `SITE_URL` origin (DDC), so a First Form member must use
First Form's URL. Leave `SOCIETYER_MCP_OAUTH_CONSENT_URL` unset: when set it is
the consent page for every URL. Every origin must send the consent page headers
(`/oauth/*`, see [mcp-connector.md](../mcp-connector.md#hosting-requirements)).
Check each URL's metadata names itself:

```sh
curl -s "https://<deployment>.convex.site/.well-known/oauth-protected-resource/mcp/societyer-firstform.pages.dev"
```

Removing an origin from `SITE_URL` stops its MCP URL and the OAuth connections
made through it. Test both organizations on staging.

### Map the origins

`workspaceDomains:upsert` takes `{ origin, societyId, primary, status, note? }`.
`status` is `"Active"` or `"Disabled"`. Re-running it updates the same row.

```sh
npx convex run workspaceDomains:upsert '{"origin":"https://portal.ddcnorth.com","societyId":"'"$DDC_ID"'","primary":true,"status":"Active","note":"DDC North custom domain"}' --deployment "$TARGET"
npx convex run workspaceDomains:upsert '{"origin":"https://societyer-ddcnorth.pages.dev","societyId":"'"$DDC_ID"'","primary":false,"status":"Active","note":"Pages default domain"}' --deployment "$TARGET"
npx convex run workspaceDomains:upsert '{"origin":"https://societyer-firstform.pages.dev","societyId":"'"$FF_ID"'","primary":false,"status":"Active"}' --deployment "$TARGET"
npx convex run workspaceDomains:upsert '{"origin":"https://portal.1stform.ca","societyId":"'"$FF_ID"'","primary":true,"status":"Active"}' --deployment "$TARGET"
```

Rules:

- One Active row per origin. Mapping an origin that already opens another
  workspace is refused. Disable the old row first.
- One Active primary per workspace. A new primary demotes the old one. The
  primary origin is the workspace's canonical origin.
- Map only one workspace per origin. If DDC has several workspaces, map the
  domain to the main one. The others open in place.
- Origins are stored normalized (lowercase host, no trailing slash).

### Attach a customer's frontend domain

This is currently an operator workflow, not an end-user settings screen. Reuse
the intended frontend project and shared backend; a custom hostname does not
require a separate Convex deployment.

1. Verify control of the requested domain and inspect existing records before
   changing it. For this rollout, `1stform.ca` was already an active zone in the
   Pages project's Cloudflare account, and `portal.1stform.ca` had no record.
2. Add the hostname under the intended Pages project's **Custom domains** first.
   For First Form the project is `societyer-firstform`.
3. Set the required DNS record. The deployed record is:

   | Type | Name | Target | Proxy | TTL |
   | --- | --- | --- | --- | --- |
   | CNAME | `portal.1stform.ca` | `societyer-firstform.pages.dev` | Proxied | Auto |

   Pages used HTTP validation for this same-account zone and requested no TXT
   record. If a future attachment returns a TXT verification challenge, publish
   that exact name/value as well. Do not invent a token.
4. Wait for Pages ownership and HTTPS validation to become Active. A DNS record
   alone does not attach the hostname to Pages. Check the rendered app in a real
   browser; a command-line edge block is not an app authentication result.
5. Add the exact `https://` origin to the shared `SITE_URL`, retaining the
   existing origins. Set sign-in and storage policy for a new workspace before
   opening it; domain mapping itself grants no access.
6. Upsert the Active mapping with `primary: true` only when the host is ready.
   This demotes the previous primary for that workspace; keep the old domain as
   a trusted secondary while it remains useful. Run `workspaceDomains:audit`.
7. Test the new login branding, **My workspaces → Open**, the authenticated
   handoff, clean final URL and a reload. Check the new domain-specific MCP
   resource metadata and canonical reset/invitation link origin.

The existing Microsoft redirect is on `.convex.site`, so this frontend-only
host change did not need a new Entra redirect or credential. No build was needed:
the existing First Form bundle obtains the hostname and mapping at runtime.
Steps that change application configuration or code still require the normal
release checks. [Cloudflare's custom-domain guide](https://developers.cloudflare.com/pages/configuration/custom-domains/)
describes the Pages attachment/DNS distinction.

### Audit

```sh
npx convex run workspaceDomains:audit --deployment "$TARGET"
npx convex run workspaceDomains:list --deployment "$TARGET"
```

`audit` returns `{ ok, siteUrls, issues }`. Each issue resolves to "unmapped" at
runtime:

| `kind` | Meaning | Fix |
| --- | --- | --- |
| `site-url-missing` | `SITE_URL` is missing or invalid | Set `SITE_URL` |
| `site-url-unmapped` | A trusted origin has no Active mapping. It opens the remembered workspace | Map it, or accept it as a neutral entry |
| `mapping-not-trusted` | An Active mapping's origin is no longer in `SITE_URL` | Add it back, or disable the mapping |
| `origin-not-normalized` | A row was written outside `upsert` | Disable it and upsert again |
| `missing-workspace` | The workspace was deleted | Disable the mapping |
| `ambiguous-origin` | Two Active rows for one origin. It resolves to nothing | Disable one |
| `multiple-primaries` | Links fall back to the first `SITE_URL` origin | Upsert the right primary again |

### What mapping changes

- The sign-in page on that origin shows the workspace's name and logo, and its
  support address. If the workspace requires Microsoft, only **Continue with
  Microsoft** is shown.
- After sign-in, the mapped workspace opens if the person can reach it. If it is
  locked, its lock screen opens. If the person isn't a member there, they see
  "No access to <workspace>" with their other workspaces. Another organization
  never opens silently.
- In the workspace switcher on a mapped origin, a workspace whose canonical
  origin is another mapped origin opens through a session handoff on that
  origin. A workspace without a canonical origin opens in place.
- Provisioning, password-reset and invitation links for a workspace use its
  canonical origin.
- A mapping is what lets non-members find a workspace to **request access** to.
  Requests are off by default and each workspace's Owners or Admins turn them
  on from the **Users** page; there is nothing for an operator to configure.
  Disabling the mapping (or removing the origin from `SITE_URL`) stops new
  requests at once. Pending requests stay with the workspace's Owners and
  Admins. See [user-guide.md](user-guide.md#access-requests).

The handoff starts on the destination origin, which sends the browser back to
the source for a single-use code bound to a challenge only the destination
holds. It works only between mapped origins. See
[architecture.md](architecture.md#cross-domain-session-handoff).

### Rollback

```sh
npx convex run workspaceDomains:upsert '{"origin":"https://societyer-firstform.pages.dev","societyId":"'"$FF_ID"'","primary":true,"status":"Active"}' --deployment "$TARGET"
npx convex run workspaceDomains:upsert '{"origin":"https://portal.1stform.ca","societyId":"'"$FF_ID"'","primary":false,"status":"Disabled"}' --deployment "$TARGET"
```

Promote the working alias before disabling the custom domain so canonical links
do not fall back to DDC. There is no delete function. A Disabled row resolves to
nothing. After checking the alias, remove only the retired origin from `SITE_URL`
and detach its Pages custom domain/DNS record if appropriate. Retain all other
trusted origins, especially those used by the staff admin.

## 5. Storage policies

`workspaceStoragePolicies:set` takes `{ societyId, nativeUploads, documentVersionProvider, reason }`:

- `nativeUploads`: `"allowed"` or `"disabled"`. This covers Convex `_storage`
  uploads (attachments, images, receipts, pulled source documents, offline
  meeting files).
- `documentVersionProvider`: `"deployment-default"`, `"native"` or
  `"sharepoint"`. `native` means the deployment's non-SharePoint version storage
  (RustFS or R2 when configured). New document versions in a `native`
  workspace need `RUSTFS_*` or `R2_*` on the deployment. Without them, version
  uploads fail with "Live upload storage is not configured."
- `reason`: required, at most 500 characters.

`set` refuses `sharepoint` unless the SharePoint connection is configured, and
refuses `sharepoint` with `nativeUploads: "allowed"`. It refuses `allowed` or
`native` while `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE` is set.

```sh
# Every DDC workspace
npx convex run workspaceStoragePolicies:set '{"societyId":"'"$DDC_ID"'","nativeUploads":"disabled","documentVersionProvider":"sharepoint","reason":"DDC keeps files in its private SharePoint site"}' --deployment "$TARGET"

# First Form (after the native-storage ceiling is removed on the shared deployment)
npx convex run workspaceStoragePolicies:set '{"societyId":"'"$FF_ID"'","nativeUploads":"allowed","documentVersionProvider":"native","reason":"First Form uses native storage"}' --deployment "$TARGET"
```

Each call returns the effective policy, for example
`{ "nativeUploads": false, "documentVersionProvider": "sharepoint" }`.

### Ceilings that must go on a shared deployment

The deployment and build flags are ceilings. A workspace row can only narrow
them.

| Flag | Where | On a shared deployment |
| --- | --- | --- |
| `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE` | Convex | **Remove.** While set, no workspace can upload natively, so First Form can't. Remove it only after every DDC workspace has its `disabled` / `sharepoint` row. |
| `SOCIETYER_STORAGE_PROVIDER=sharepoint` | Convex | May stay. It is the default for workspaces whose row says `deployment-default` or that have no row. Give every workspace an explicit row so the default doesn't matter. |
| `SHAREPOINT_*` | Convex | Keep. DDC's connection is the only SharePoint connection on the deployment. |
| `VITE_DISABLE_NATIVE_FILE_STORAGE=1` | `.env.ddcnorth` | **Remove** when the DDC build points at a shared deployment. It hides native upload controls for every workspace opened in that build, including First Form when a dual member opens it in place. |
| `VITE_DOCUMENT_STORAGE_PROVIDER=sharepoint` | `.env.ddcnorth` | **Remove** with the line above. It also turns native uploads off in that build. Without both lines, the server's policy decides what each workspace shows. |

After removing the two `VITE_` lines, check on staging that a DDC workspace in
the DDC build still offers SharePoint version uploads and no native upload
controls, and that First Form offers native uploads.

Order on a shared deployment:

1. Set the DDC rows.
2. `npx convex env remove SOCIETYER_DISABLE_NATIVE_FILE_STORAGE --deployment "$TARGET"`
3. Set the First Form row.
4. Rebuild and publish the DDC frontend without the two `VITE_` lines.

### Check

```sh
npx convex run workspaceStoragePolicies:audit --deployment "$TARGET"
npx convex run workspaceStoragePolicies:list --deployment "$TARGET"
npx convex run workspaceStoragePolicies:get '{"societyId":"'"$FF_ID"'"}' --deployment "$TARGET"
```

Audit issue kinds: `duplicate-policy` (every upload is refused until one row
remains; run `set` to collapse them), `missing-workspace`,
`native-above-ceiling`, `native-versions-above-ceiling`,
`sharepoint-unconfigured`, `sharepoint-native-allowed`.

### Meeting-source uploads

Meeting originals sent through the meeting-transfer Worker go to the
deployment's SharePoint site. `meetingSources:allocate` refuses any workspace
whose effective `documentVersionProvider` isn't `sharepoint`, so on a shared
deployment First Form members can't store files in DDC's site.

### Rollback

There is no `clear`. This row behaves exactly like no row:

```sh
npx convex run workspaceStoragePolicies:set '{"societyId":"'"$FF_ID"'","nativeUploads":"allowed","documentVersionProvider":"deployment-default","reason":"Rollback to deployment default"}' --deployment "$TARGET"
```

Put `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE=1` back with
`npx convex env set SOCIETYER_DISABLE_NATIVE_FILE_STORAGE 1 --deployment "$TARGET"`.
An upload that started under the old provider is refused when it completes.

## 6. Workspace defaults

`SOCIETYER_INITIAL_INVOICE_TEMPLATE=firstform` installs the First Form invoice
template in **every** workspace created on that deployment. Leave it unset on a
shared deployment. If First Form's deployment becomes the shared one, remove it
there before any DDC workspace is created or imported.

Install the template for one workspace instead:

```sh
npx convex run workspaceDefaults:installInvoiceTemplate '{"societyId":"'"$FF_ID"'","template":"firstform"}' --deployment "$TARGET"
```

It returns `{ templateId, replaced }`. It runs on behalf of the workspace's
longest-standing Active Owner, so it fails with "The workspace has no Active
Owner to install the template for." when there is none. Running it again
refreshes the same template (`replaced: true`) and leaves other workspaces
alone.

Rollback: an Owner picks another default under **Invoices → Templates**. There
is no uninstall function.

## 7. Accounts: provisioning, reset links and Microsoft logins

### Password accounts (First Form)

Requires `SOCIETYER_AUTH_MANUAL_PROVISIONING=1`. Pass `societyId` so the link
opens on that workspace's canonical origin:

```sh
npx convex run hostedAuth:provisionAccount '{"name":"Full Name","email":"confirmed@example.org","societyId":"'"$FF_ID"'"}' --deployment "$TARGET"
```

It returns a one-time, one-hour link
(`https://portal.1stform.ca/reset-password#token=…`). Send it
privately. It grants no membership. Follow it with an invitation from the
workspace's **Users** page. The email must be in
`SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS` if that is still set.

Reset link for an existing account:

```sh
npx convex run hostedAuth:issuePasswordResetLink '{"email":"sam@example.org","societyId":"'"$FF_ID"'"}' --deployment "$TARGET"
```

`appUrl` overrides the origin (use it for a sub-path build). Using the link ends
the account's other sessions on every workspace.

### Microsoft logins (DDC)

Microsoft sign-in can't create accounts (`disableSignUp`), and people can't add
Microsoft to their own login. Connecting a provider from **Sign-in methods** is
disabled. The operator provisions a Microsoft login:

```sh
npx convex run entraProvisioning:registerDirectoryMember '{"societyId":"'"$DDC_ID"'","objectId":"<Entra object ID>","email":"person@ddcnorth.com","name":"Full Name"}' --deployment "$TARGET"
```

This creates a Microsoft-only login and an Active **Viewer** membership in DDC.
Change the role on the DDC **Users** page.

A DDC member who also has a First Form password login then uses **Link an
existing account** to join the two logins (see the
[user guide](user-guide.md#link-an-existing-account)). After that, a Microsoft
session reaches both workspaces, and a password session still sees DDC as
locked.

If the Microsoft account and the existing password login use the **same email
address**, `registerDirectoryMember` without `existingAuthUserId` fails with
"Explicitly select the existing auth account; accounts are never merged by
email." Then attach Microsoft to that login instead:

```sh
npx convex run entraProvisioning:registerDirectoryMember '{"societyId":"'"$DDC_ID"'","objectId":"<Entra object ID>","email":"<that login'"'"'s email>","name":"Full Name","existingAuthUserId":"<Better Auth user ID>"}' --deployment "$TARGET"
```

`existingAuthUserId` is the `authSubject` of the person's existing membership
(see [Find workspace and membership IDs](#find-workspace-and-membership-ids)).
`email` must equal that login's email. The result is one login with both a
password and Microsoft. That is how Ahmad's DDC login was set up. Confirm the
person's identity out of band before using it.

## 8. Link conflicts and unlink requests

### See what happened

To see who one login is linked to, with every linked login's memberships and
the recent link events, inspect it by issuer and subject. The issuer is the
memberships' `authIssuer` (the deployment's `.convex.site` URL); the subject is
the membership's `authSubject` (see
[Find workspace and membership IDs](#find-workspace-and-membership-ids)):

```sh
ISSUER="https://$TARGET.convex.site"   # must equal the rows' authIssuer
npx convex run --inline-query 'return [...new Set((await ctx.db.query("users").collect()).map((u) => u.authIssuer))]' --deployment "$TARGET"
npx convex run accountLinks:operatorInspect '{"issuer":"'"$ISSUER"'","subject":"<Better Auth user ID>"}' --deployment "$TARGET"
```

`state` is `none`, `linked` or `blocked` (several Active links, or a Disabled
person; `people` shows which). Each entry in `identities` lists its
`memberships` with `userId`, workspace, role and status.

The whole history, unfiltered:

```sh
npx convex run --inline-query 'return await ctx.db.query("accountLinkEvents").order("desc").take(20)' --deployment "$TARGET"
npx convex run --inline-query 'return (await ctx.db.query("personIdentityLinks").collect()).filter((l) => l.status === "Active")' --deployment "$TARGET"
```

Events have `action` (`linked`, `unlinked`, `refused`), the acting identity, the
identities involved and, for refusals, `reason` (`conflict` or
`identity-disabled`). Operator unlinks have actor `operator` /
`deployment-operator` and your reason.

### A link was refused with a conflict

The person sees "Can't link these logins. Both logins are members of
<workspace>." Both logins (or people already linked to either) hold a
membership in the same workspace. Disabled memberships count. The person's
role is never chosen for them.

To resolve it, retire one membership in favour of the other. Agree with a
workspace Owner which one to keep (usually the one with the history that
matters, and the right role), confirm out of band that both logins are the same
person, then:

```sh
# Both memberships, from the inspect output of either login (identities[].memberships[].userId)
npx convex run accountLinks:operatorInspect '{"issuer":"'"$ISSUER"'","subject":"<one login>"}' --deployment "$TARGET"
npx convex run users:operatorRetireMembership '{"retireUserId":"<users ID to retire>","keepUserId":"<users ID to keep>","reason":"<ticket / who asked>"}' --deployment "$TARGET"
```

It refuses rows in different workspaces, a kept row that isn't Active and
bound to a login, a row already merged, and retiring the last Active Owner
(unless the kept row is an Active Owner). The retired row stays, Disabled and
unbound, with `mergedIntoUserId`, so records it wrote still resolve to it. No
login can reach, re-bind, reactivate or invite it again. The kept row's role is
never changed. If the retired row had the higher role, the result has
`roleNotCarried` and the workspace's activity row says so; a workspace Owner
then decides whether to change the kept row's role on the **Users** page.
References to the retired ID are not moved to the kept row. Keep the result
outside the repository: `retiredIdentity` is the binding that was removed.

Then the person starts the link again. It now passes the conflict check, and
both logins resolve to the kept membership.

Alternative without the operator: a workspace Owner removes one membership on
the **Users** page (row menu → **Remove access**; disabling isn't enough).
Records written by a removed membership keep its old ID, which then points at a
deleted user, so prefer retiring.

### The person wants to unlink

They do it themselves: **Sign-in methods → Linked logins → Unlink**, from either
login. Each login keeps working on its own, and roles don't change. Unlinking
the last other login removes the person account.

If the person can no longer sign in to a login (or a login was linked by
mistake), unlink it as the operator. Confirm the request out of band first:

```sh
npx convex run accountLinks:operatorUnlink '{"issuer":"'"$ISSUER"'","subject":"<Better Auth user ID to unlink>","reason":"<ticket / who asked>"}' --deployment "$TARGET"
```

Same effect as the person's own unlink: that login stops reaching the other
logins' memberships at once, roles don't change, and a person left with one
login is removed (`personRemoved: true`). It also clears a `blocked` login (a
Disabled person, or duplicate links), so the person can link again. Check with
`operatorInspect` afterwards; `state` should be `none`.

## 9. Offboarding

To remove someone from one organization only:

1. A workspace Owner or Admin opens **Users** in that workspace and sets the
   member's status to **Disabled** (row menu → **Edit user**), or uses
   **Security disable** for an incident.
   Membership checks refuse that workspace at once. The person's other
   workspaces, linked or not, are untouched. Linking never reactivates a
   Disabled membership.
2. DDC only: remove the person from the Entra group, so their next Microsoft
   sign-in fails. An existing session can last up to 8 hours. To end it now:

   ```sh
   npx convex run entraProvisioning:revokeMemberSessions '{"objectId":"<Entra object ID>"}' --deployment "$TARGET"
   ```

   Repeat while the result has `"more": true`. This ends **every** session of the
   login that owns that Microsoft account. If that login also has a password
   (or is the person's only login), they are signed out of First Form too and
   can sign back in with the password. A JWT already issued can stay valid for
   up to 5 minutes. The disabled membership is still refused.
3. Revoke the person's AI connector grants and API tokens in that workspace
   (**Settings → AI connectors**, **Settings → API keys**).

Unlinking is not needed for offboarding. It doesn't remove access the person
holds through their own login.

## 10. Rollback summary

These individual reversals are not a complete production data rollback. After
consolidation, keep code that enforces workspace policies, and reconcile any
destination writes before reopening the old source. Do not delete real policy
or link rows just to satisfy an older schema.

| Change | Undo |
| --- | --- |
| Code deploy | Choose a revision compatible with live policies/links. A schema refusal requires a recovery plan, not deleting production tables. |
| DDC sign-in policy | Fix it with `set`. Clear only while required SSO is on. |
| First Form sign-in policy | `workspaceSignInPolicies:clear` |
| `SOCIETYER_ENTRA_SSO_REQUIRED` removed | Set it to `1`. This locks out First Form. |
| `SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS` removed | Set the recorded value. This locks out other domains. |
| `SITE_URL` | Set the recorded value |
| Domain mapping | `upsert` with `"status":"Disabled"` |
| Storage row | `set` to `allowed` / `deployment-default` |
| `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE` removed | Set it to `1` |
| Invoice template | Owner picks another default |
| A link | The person unlinks. Operator: `accountLinks:operatorUnlink`. |
| A retired membership | No undo function. In the dashboard, restore the recorded binding and status and clear `mergedIntoUserId` / `mergedAtISO`, only after unlinking the logins (otherwise the workspace becomes ambiguous). |
