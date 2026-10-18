# Sign-in hosted in Convex (`AUTH_MODE=convex`)

The simplest hosted deployment. Sign-up, sign-in, email verification, password
reset and sessions all run inside your Convex deployment, using Better Auth
through the [`@convex-dev/better-auth`](https://labs.convex.dev/better-auth)
component. You deploy two things: the static frontend and Convex. There is no
auth server, gateway or separate auth database to run.

Societyer's own rules are unchanged. A login account proves who someone is;
workspace access still comes only from creating a workspace (you become its
Owner) or accepting an invitation. Roles, invitations, disabling and the
last-Owner safeguard behave exactly as in the other modes.

## What you get, and what needs the gateway

| Works in this mode | Needs the Node gateway (choose `better-auth` or `clerk` instead) |
|---|---|
| Sign-up, sign-in, sign-out | API access tokens and webhooks |
| Email verification and password reset (with email configured) | n8n workflow document generation |
| Workspace creation, invitations, roles, Users page | Browser connectors and registry imports |
| All records, documents, uploads, AI chat routes | Microsoft Entra sign-in |
| | Demo seed/reset maintenance buttons |
| | PowerSync offline meeting preparation |

The gateway refuses to start in this mode, because it can't verify these sessions.
The app hides what can't work here: Browser apps, the BC Registry imports
(filing history, bylaws history, governance-document auto-fill), the GCOS file
import, and the n8n workflow templates. In the other modes the same features
stay off until the operator runs the service: `SOCIETYER_BROWSER_CONNECTORS=1`
for connectors, and the n8n webhook base and callback secret for n8n.

Why each needs the Node gateway today, and what moving it into Convex would take:

| Feature | Why it needs Node today | Moving it into Convex |
|---|---|---|
| API tokens / REST API (`/api/v1`) | Express routes; the gateway checks `soc_` tokens and signs short-lived JWTs to act as the token owner | Moderate: HTTP-action routes plus an internal "act as member" path; mostly mechanical across ~50 resources |
| Webhooks | Only the gateway sends them, and only for changes made through the REST API (edits in the app send none). Retries are in-memory timers lost on restart | Easy, and an improvement: emit from Convex mutations, deliver from scheduled actions, so app edits fire webhooks and retries survive restarts |
| Browser connectors (BC Registry, Wave, GCOS live) | Drive a real Chrome through Playwright in a separate container with saved sign-ins | Not feasible inside Convex; keep the runner as its own service and talk to it from Convex directly |
| Registry/bylaws imports | Need that browser session, local export folders and `pdftotext` | Hard while they depend on the runner; the GCOS uploaded-file import alone is easy to move |
| n8n document generation | Fills PDFs from template files on disk and stores the result on the gateway's disk | Easy to moderate: callback as an HTTP action, PDFs in Convex storage, `pdf-lib` in a Node action |
| Microsoft sign-in | Lives in the gateway's Better Auth; adds tenant pinning and verified ID tokens | Easy to moderate: the same provider code can be added to this mode's Better Auth; the Entra redirect URI changes |

## 1. Configure the Convex deployment

Set these on the Convex deployment (dashboard → Settings → Environment
variables, or `npx convex env set NAME value`):

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_MODE=convex` | Yes | Selects this broker |
| `SITE_URL` | Yes | The app's origin, e.g. `https://app.example.org`. Comma-separate extra origins (the first is the primary). Only these origins may call the sign-in routes or receive email links. |
| `BETTER_AUTH_SECRET` | Yes | At least 32 random characters, e.g. `openssl rand -base64 36`. Keep it stable: changing it signs everyone out. |
| `SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` | Recommended | Explicit authenticated enforcement, as for other hosted modes |
| `SOCIETYER_EMAIL_PROVIDER` | Recommended with both configured | `microsoft365` or `resend`; selects one delivery provider without automatic failover |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | For Resend | Email delivery for verification, password reset and email-bound invitations (see below) |
| `MICROSOFT_MAIL_TENANT_ID`, `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET`, `MICROSOFT_MAIL_SENDER` | For Microsoft 365 | Dedicated mail app and its single scoped sender mailbox; server only |
| `AUTH_SESSION_MAX_AGE_SECONDS` | Optional | Fixed session length, 300–86400 seconds (default 8 hours); used when persistent sessions are not configured |
| `AUTH_PERSISTENT_SESSION_DAYS` | Optional | Opt-in renewable sessions, 1–30 days. Overrides the fixed policy; refreshes on use after one day (after 12 hours for a one-day session). DDC North uses `7`. |
| `SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS` | Optional | Exact comma-separated allowed email domains, e.g. `ddcnorth.com`. Enforces verified email on backend access and closes sign-up until a mail sender is configured. Unset for unrestricted registration. |
| `SOCIETYER_AUTH_INSTANCE_NAME` | Optional | Name shown above the sign-in card, e.g. `DDC North` (up to 80 characters). Without it, a single allowed email domain shows as `ddcnorth.com workspace`; otherwise nothing is shown. |
| `SOCIETYER_AUTH_SUPPORT_EMAIL` | Optional | Address the sign-in pages offer for help, e.g. `it@ddcnorth.com`: the footer reads "Trouble signing in? Contact it@ddcnorth.com." as a mail link. Without it the footer says to contact the workspace administrator. An invalid address is ignored. |
| `SOCIETYER_MCP_OAUTH`, `SOCIETYER_MCP_OAUTH_REDIRECT_URIS`, `SOCIETYER_MCP_OAUTH_CONSENT_URL` | Optional | OAuth sign-in for AI connectors (claude.ai, ChatGPT, Claude Code, Codex). On by default once `SITE_URL` is set; the consent page is `<SITE_URL>/oauth/consent`. `SOCIETYER_MCP_OAUTH=0` turns it off. See [mcp-connector.md](mcp-connector.md#deployment-settings). |

`CONVEX_SITE_URL` is provided by Convex automatically; it becomes the token
issuer and the address that serves `/api/auth/*`.

The instance name and support email are display settings: the public
`http:authCapabilities` query returns them to anyone who opens the sign-in page,
so use a shared help address rather than a person's private one. Like the other
variables they are read at request time, so a change shows on the next page load
without a redeploy once a deployment that includes them is running.

Then deploy (`npx convex deploy`, or `npx convex dev` while developing).
Like the other modes, a change to `AUTH_MODE` takes effect on the next deploy,
because Convex reads the auth configuration and HTTP routes at deploy time.

### Email delivery, invitations and password reset

Both Microsoft 365 and Resend are supported. Configure the intended sender and
set `SOCIETYER_EMAIL_PROVIDER` to `microsoft365` or `resend`. Both sets of server
credentials can coexist; changing the selector changes the provider. A failed or
ambiguous send is never retried through the other provider automatically, which
could send duplicate verification links. Existing Resend deployments continue
working without a selector. Without a selector, a complete Resend configuration
takes precedence, then a complete Microsoft configuration. Explicitly selecting
an incomplete provider disables mail readiness even if the other is configured.

For Resend, use an API key with a sender on a domain you've verified with
[Resend](https://resend.com). These are the same variables the communications
module uses.

For Microsoft 365, use a separate Entra application and Exchange **Application
Mail.Send** role scoped to the dedicated sender mailbox. Keep the existing
SharePoint storage app unchanged. Do not add a tenant-wide Graph `Mail.Send`
application grant alongside the scoped role: Entra and Exchange grants are
additive. No mailbox-read permission is needed for sending. See the provisioning
steps below and Microsoft's [application RBAC guide](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

Microsoft delivery calls the fixed tenant OAuth endpoint and
`https://graph.microsoft.com/v1.0/users/{MICROSOFT_MAIL_SENDER}/sendMail` from a
Convex action. Credentials never go into `VITE_*`, the browser, or Cloudflare
Pages. Graph's `202` confirms acceptance, not arrival in the recipient's inbox;
the adapter's identifier is a request correlation ID, not a Microsoft message ID.
[Graph sendMail contract](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

#### Microsoft 365 provisioning

1. In the correct tenant, choose a licensed existing mailbox or a dedicated
   shared mailbox such as `societyer@ddcnorth.com`. Verify its actual Exchange
   eligibility before purchasing any license. Keep sender and recipient distinct
   for the first delivery test when possible.
2. Create a single-tenant Entra app named **Societyer DDC North email delivery**.
   Create its enterprise application/service principal and record its **service
   principal Object ID**, which differs from the app-registration Object ID.
   Create an expiring server credential after operator approval. Do not enable
   delegated sign-in or reuse the storage app's credential.
3. Connect using an Exchange Administrator/Organization Management account in
   Exchange Online PowerShell. Create the Exchange pointer with
   `New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id>`.
4. Create a resource scope matching only the chosen sender, for example
   `New-ManagementScope -Name 'Societyer DDC North sender' -RecipientRestrictionFilter "EmailAddresses -eq 'smtp:societyer@ddcnorth.com'"`.
   Preview the scope and verify exactly one mailbox matches. Use the exact SMTP
   address rather than a wildcard. Microsoft recommends `EmailAddresses` over
   `PrimarySmtpAddress` for [recipient filters](https://learn.microsoft.com/en-us/powershell/exchange/recipientfilter-properties?view=exchange-ps).
5. Assign `Application Mail.Send` to that app with
   `New-ManagementRoleAssignment -Name 'Societyer DDC North send only' -App <enterprise-app-object-id> -Role 'Application Mail.Send' -CustomResourceScope 'Societyer DDC North sender'`.
6. Use `Test-ServicePrincipalAuthorization` for the approved sender and an
   existing mailbox outside the scope: the send role must be in scope only for
   the approved sender. Separately inspect Entra to confirm there are no unscoped
   mail grants; this test excludes Entra grants. Exchange permission propagation
   can take 30 minutes to two hours. A simulated scope test alone does not prove
   live Graph authorization.
7. Put the four `MICROSOFT_MAIL_*` settings in the production Convex deployment.
   Store the secret directly in server environment settings. Select
   `SOCIETYER_EMAIL_PROVIDER=microsoft365`; leave Resend unconfigured until ready.
8. Run `npx convex run --prod emailQualification:sendTest '{"to":"Ahmad@ddcnorth.com"}'`
   and have the owner confirm receipt. This internal action is available only to
   deployment operators and sends a fixed test message, not a verification link.
   Then test signup, actual verification-link delivery, sign-in, reset, workspace
   setup and meeting uploads. The owner enters their own new account password.

Code and mocked provider tests do not establish that tenant permissions, sender
delivery or the full browser flow are configured. Confirm these live before
reporting that email is operational. To disable Microsoft mail, remove its
credential and revoke its Exchange assignment; if another verified provider is
ready, select it explicitly. Never remove domain/verified-email enforcement as a
workaround for missing delivery.

For this tenant, the initial Exchange PowerShell device-code sign-in was rejected
with error `530035`. Microsoft's [Security Defaults guidance](https://learn.microsoft.com/en-us/entra/fundamentals/security-defaults)
documents device-code blocking for new tenants from July 1, 2026. Use the normal
interactive browser sign-in instead; do not disable Security Defaults or add an
exception for provisioning. The owner completed interactive authentication, but
automatic approval review rejected subsequent input to that open PowerShell
session, including a read-only status check. The bounded runner
`scripts/connect-and-provision-ddcnorth-email.ps1` instead connects, runs only
the reviewed sender provisioning script, and disconnects in `finally`. It uses
a fresh interactive sign-in. Authentication alone does not establish that the
Exchange assignment exists; record the runner's authorization result and a
real Graph send separately. No application credential was created during the
rejected device-code sign-in.

The first bounded run authenticated successfully and created the Exchange
service-principal pointer, then `New-ManagementScope` reported that organization
customization was required. The provisioning script now checks
`Get-OrganizationConfig.IsDehydrated` and invokes the documented one-time
[`Enable-OrganizationCustomization`](https://learn.microsoft.com/en-us/powershell/module/exchange/enable-organizationcustomization)
prerequisite when needed. It stops if customization has not finished propagating;
it never substitutes an unrestricted mail grant.

On October 17, 2026, the corrected runner completed with `SenderInScope=true`,
`AhmadMailboxInScope=false`, and `ScopeMatches=1` for `Application Mail.Send`.
The enterprise application's Admin consent view also showed **No admin consented
permissions found for the application**, confirming there was no additive Graph
application mail grant at that check. Runtime credential setup and actual
delivery are separate qualification steps. The replacement six-month credential
was subsequently connected to production (expiry April 15, 2027). Both the
direct Microsoft Graph probe and production `emailQualification:sendTest` were
accepted. Both delivery-test messages and the real signup-verification messages
were subsequently observed in Ahmad's Microsoft 365 Inbox. Following the actual
verification link enabled normal sign-in. An unverified sign-in had first been
rejected with HTTP 403. The live UI then completed workspace onboarding and
meeting creation; see the DDC North deployment runbook for the qualification
record. Acceptance alone still must not be used as evidence of inbox delivery
for future deployments.

| | With email delivery | Without it |
|---|---|---|
| New accounts | Must open a verification link before signing in | Signed in immediately; email unverified |
| "Only this email address" invitations | Work | Can't be accepted (they require a verified email) |
| "Anyone with the link" invitations | Work | Work |
| Forgot password | Self-service from the sign-in page | Operator issues a reset link (below) |

**Share links.** On the Users page, choose *Anyone with the link* when inviting.
The link is the credential: whoever opens it first while signed in joins, with
no email match. So a share link:

- can grant Director, Member or Viewer, never Owner or Admin (an Owner promotes
  people after they join);
- works once and expires (1–30 days);
- isn't used up when a current member opens it.

The invitations list shows who joined through each link, so check that it was the
person you meant. Their email is recorded as unverified.

**Operator password reset.** Without email, someone with access to the Convex
deployment (CLI or dashboard) can issue a one-hour reset link and pass it to the
person:

```bash
npx convex run hostedAuth:issuePasswordResetLink '{"email":"sam@example.org"}'
# add "appUrl":"https://example.org/app" if the app is served under a sub-path
```

Using the link ends the account's other sessions. Workspace Owners can't do this
from the app on purpose: one login account can belong to several workspaces, so
resetting its password would also hand over those other workspaces.

### Sign-in throttling

Repeated attempts are limited in two independent ways, following the approach of
Convex's own auth library:

| Route | Per account email | Per client IP |
|---|---|---|
| Sign in | 10 failures in a row, then 1 more every 6 minutes; a successful sign-in resets it | 30 at once, refilling 60/hour |
| Sign up, forgot password, resend verification | 3/hour (limits mail sent to one address) | 10/hour |
| Reset password with a token | | 10/hour |

A throttled request gets "Too many attempts. Try again in N minutes." The
per-account limit works whatever the IP. That matters because:

- **Convex Cloud** sets the client IP itself.
- **A self-hosted backend** takes the IP from the client's `X-Forwarded-For`
  header, so put a reverse proxy in front that *overwrites* that header with the
  real address (for nginx: `proxy_set_header X-Forwarded-For $remote_addr;`).
  Without one, the per-IP limit can be bypassed, but the per-account limit still
  holds.

The tradeoff of the per-account limit: someone who knows an email address can
deliberately trigger the limit and lock that person out for a while. Lockouts
are temporary, never permanent. Passwords must be at least 10 characters.

## 2. Build the frontend

```dotenv
VITE_AUTH_MODE=convex
VITE_CONVEX_URL=https://your-deployment.convex.cloud
# Only when the HTTP actions origin can't be derived from VITE_CONVEX_URL
# (custom domains). Convex cloud's .convex.site and self-hosted :3210→:3211
# / :3220→:3221 are derived automatically.
# VITE_CONVEX_SITE_URL=https://auth.example.org
```

`VITE_*` values are baked in at build time. Rebuild after changing them. No
Clerk keys, `VITE_AUTH_BASE_URL` or gateway URL are needed. Serve the build as
a static site (`docker/frontend.Dockerfile` works as-is with these build
arguments), at the origin you put in `SITE_URL`.

## 3. Local development

```bash
npx convex dev                                   # writes VITE_CONVEX_URL/VITE_CONVEX_SITE_URL to .env.local
npx convex env set AUTH_MODE convex
npx convex env set SITE_URL http://127.0.0.1:5173
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 36)"
VITE_AUTH_MODE=convex npx vite --host 127.0.0.1 --port 5173
```

To exercise email locally without a Resend account, point
`RESEND_API_BASE_URL` at a stub that accepts Resend's `POST /emails` and
returns `{"id": "..."}`. `scripts/check-convex-hosted-auth-live.ts` includes one.

## 4. Verify the deployment

Fast checks (no deployment needed):

```bash
npm run test:multi-user-pipeline
```

Against a running deployment, with the mail stub settings from the script header:

```bash
LIVE_CONVEX_URL=… LIVE_CONVEX_SITE_URL=… LIVE_SITE_URL=… MOCK_MAIL_PORT=4599 \
  npx tsx scripts/check-convex-hosted-auth-live.ts
```

That runs the full pipeline over real HTTP and covers:

- sign-up and email verification;
- workspace creation (you become Owner);
- signing in again in a new browser to the same membership;
- invitations to a new account and to an existing account;
- password reset and disabling a member;
- rejection of a forged token;
- per-account throttling, plus per-IP throttling against a local backend (where
  the test can simulate addresses).

## Moving from another mode

Login accounts from the gateway's Better Auth database or from Clerk aren't
carried over, and Societyer never matches people by email. Existing workspace
memberships stay bound to their old issuer. To move a deployment, each person
creates an account here and is re-invited (or an operator rebinds memberships
explicitly), and you keep the old mode running until that's done.
