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

## 1. Configure the Convex deployment

Set these on the Convex deployment (dashboard → Settings → Environment
variables, or `npx convex env set NAME value`):

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_MODE=convex` | Yes | Selects this broker |
| `SITE_URL` | Yes | The app's origin, e.g. `https://app.example.org`. Comma-separate extra origins (the first is the primary). Only these origins may call the sign-in routes or receive email links. |
| `BETTER_AUTH_SECRET` | Yes | At least 32 random characters, e.g. `openssl rand -base64 36`. Keep it stable: changing it signs everyone out. |
| `SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1` | Recommended | Explicit authenticated enforcement, as for other hosted modes |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | For invitations | Email delivery for verification and password reset (see below) |
| `AUTH_CLIENT_IP_HEADER` | Optional | Turns on per-IP sign-in throttling (see below) |
| `AUTH_SESSION_MAX_AGE_SECONDS` | Optional | Session length, 300–86400 seconds (default 8 hours) |

`CONVEX_SITE_URL` is provided by Convex automatically; it becomes the token
issuer and the address that serves `/api/auth/*`.

Then deploy (`npx convex deploy`, or `npx convex dev` while developing).
Like the other modes, a change to `AUTH_MODE` takes effect on the next deploy,
because Convex reads the auth configuration and HTTP routes at deploy time.

### Email delivery is what makes invitations work

Accepting an invitation requires a verified email, so that a leaked invite link
can't be used by someone else's account. Verification needs a mail sender:

- **With `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set:** new accounts get a
  verification link and can't sign in until they open it. "Forgot your
  password?" appears on the sign-in page.
- **Without them:** accounts are created and signed in immediately, and people
  can create their own workspaces, but nobody can accept an invitation and there
  is no self-service password reset. The sign-in page hides the reset option.

Use a [Resend](https://resend.com) API key with a sender on a domain you've
verified with Resend. These are the same variables the communications module uses.

### Sign-in throttling

Better Auth limits repeated sign-in attempts per client IP address. Convex HTTP
actions don't receive the visitor's IP on their own, and without one every
visitor would share a single allowance. So throttling is off unless you set
`AUTH_CLIENT_IP_HEADER` to a header that a **trusted** proxy in front of Convex
sets to the real client IP (for example `x-forwarded-for` behind your own
reverse proxy, or `cf-connecting-ip` behind Cloudflare). Don't set it to a
header clients can supply themselves. Passwords must be at least 10 characters.

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
- rejection of a forged token, and per-IP throttling when `LIVE_CLIENT_IP_HEADER` is set.

## Moving from another mode

Login accounts from the gateway's Better Auth database or from Clerk aren't
carried over, and Societyer never matches people by email. Existing workspace
memberships stay bound to their old issuer. To move a deployment, each person
creates an account here and is re-invited (or an operator rebinds memberships
explicitly), and you keep the old mode running until that's done.
