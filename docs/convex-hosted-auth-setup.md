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
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Recommended | Email delivery for verification, password reset and email-bound invitations (see below) |
| `AUTH_SESSION_MAX_AGE_SECONDS` | Optional | Session length, 300–86400 seconds (default 8 hours) |

`CONVEX_SITE_URL` is provided by Convex automatically; it becomes the token
issuer and the address that serves `/api/auth/*`.

Then deploy (`npx convex deploy`, or `npx convex dev` while developing).
Like the other modes, a change to `AUTH_MODE` takes effect on the next deploy,
because Convex reads the auth configuration and HTTP routes at deploy time.

### Email delivery, invitations and password reset

Use a [Resend](https://resend.com) API key with a sender on a domain you've
verified with Resend. These are the same variables the communications module uses.

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
