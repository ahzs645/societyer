# AI connectors: the remote MCP endpoint

Societyer's hosted deployments serve a [Model Context Protocol](https://modelcontextprotocol.io)
endpoint, so an AI client the user already runs (claude.ai, ChatGPT, Claude Code, Codex
CLI, MCP Inspector, the OpenAI Responses API) can read the workspace through the same
agent tools the browser offers over WebMCP (see [agent-tools.md](agent-tools.md)).

- **URL:** `https://<deployment>.convex.site/mcp` (the deployment's HTTP actions origin,
  `CONVEX_SITE_URL`). Settings → AI connectors shows the exact URL.
- **Auth:** OAuth 2.1 sign-in (claude.ai, ChatGPT, and Claude Code or Codex without a
  pasted token; see [Connecting with OAuth](#connecting-with-oauth)), or a personal
  access token (`Authorization: Bearer soc_mcp_…`). Both end in the same kind of grant.
- **Hosted only.** The local, desktop and demo runtimes have no endpoint and don't show
  the card.

## Privacy and the workspace opt-in

Data a connector reads goes to the AI company the user connected, under that user's own
account and plan with them. Under BC PIPA the organization stays responsible for personal
information it lets leave, so:

- **Off by default.** An Owner or Admin turns on **Allow AI connectors for this workspace**
  (Settings → AI connectors). While it's off, nobody can create a token and every
  request with an existing token gets `403`. Turning it off doesn't delete tokens.
- **A token never adds access.** Each call runs as the person who created the token (or
  approved the OAuth connection). Its
  effective permissions are that person's *current* role permissions ∩ the token's
  scopes, checked on every request, so a demotion narrows access on the next call and a
  removed or disabled member's tokens stop working at once.
- **In-camera content is never sent** (decision A5). Reading in-camera minutes needs
  `minutes:write`, which no connector scope includes, whatever the creator's role.
  Every token gets the redacted view ("In-camera session — not shown"), including
  "In-camera item" for agenda items in an in-camera session and no working notes on a
  minutes meeting that had one. Documents holding in-camera content come back as an
  "In-camera material" placeholder with no title, file, tags or text
  (`restricted: "in_camera"`): any document filed under a meeting whose minutes record
  an in-camera session (whatever its category) or under an agenda item inside the
  session, documents in-camera minutes cite
  (imported sources, the source record's documents, dissent reports of in-camera
  motions), and duplicates and versions linked to any of those (followed at most four
  links out and 500 documents per workspace: a longer chain of copies is an accepted
  residual). A library document only attached as a material of an in-camera item is not
  in-camera material (the material link is withheld from the meeting's listings
  instead). Tasks made from in-camera action items read "In-camera action" with no
  wording, people or notes, in `list_tasks` and the snapshot. Whether a task is in camera
  is decided when it is read, against the current minutes: the task records the section
  its action came from (index and title, read from the minutes by the server), so a
  section marked in camera later hides its tasks and one unmarked shows them again; a
  minutes action task with no section it can be matched to, under a meeting with an
  in-camera session, counts as in camera. Import bookkeeping rows are never returned as
  documents. `minutes:in-camera` is
  reserved for a future explicit scope (off by default, Owner-only, audited) and is not
  implemented; it is refused.
- **Transcripts are for minute-takers** (decisions A1, A2). `get_transcript` is only
  offered when the token's creator holds `minutes:write` in their current role (Owner,
  Admin, Director) and the token has `meetings:read` and `minutes:read`. A Member's or
  Viewer's token never reads transcripts. When every in-camera session of the meeting
  is marked in the recording, the transcript comes back with those segments replaced by
  "[In-camera session — not shown]"; otherwise a meeting with an in-camera session has
  its transcript withheld whole.
- **Writes are proposals** (decision A4). A write tool (`create_governance_tasks`)
  never changes records. It stores a pending draft and returns
  `{ status: "pending_approval", draftId, title, approvePath, approveUrl, message }`;
  `approveUrl` (`SITE_URL` + `/app/ai-agents?section=chat&draft=<id>`) opens AI agents →
  AI tool drafts at that draft, where someone with the tool's permissions approves or
  rejects it. Approval runs the change as the approver.
- **User-written text is marked as data.** Results keep the `{ untrusted: "…" }`
  wrappers, and the server's instructions tell the model to treat them as data.
- **Audit.** Every `tools/call` writes an `aiAgentAuditEvents` row (`agentKey:
  "mcp_connector"`, `eventType: "tool_call"`) with the tool name, token id, outcome and
  duration, never the arguments or the records returned. A write also records
  `tool_draft_proposed` (tool, grant, draft id) and, once someone approves it,
  `tool_draft_approved` (approver, tool). Creating and revoking tokens,
  connecting and disconnecting OAuth apps, revoking one session, OAuth token issuance,
  replayed codes and refresh tokens, denied consents (`oauth_consent_denied`), a consent
  decided in a browser that didn't start it (`oauth_consent_binding_failed`), failed
  code exchanges (`oauth_code_exchange_failed`: wrong client, redirect URI or PKCE
  verifier, flagged `possibleInterception`), revocation by the app (RFC 7009,
  `oauth_token_revoked`) and switching the opt-in are audited too. A dynamic client
  registration belongs to no workspace, so it is logged (`mcp_oauth_client_registered`
  in the Convex logs) and the workspace's `oauth_grant_created` row records the
  client's registration time. No secret is ever logged.

## Creating a token

Settings → AI connectors → **Create token** (also under AI agents → Connectors, which
members without Settings access can open).

| Field | Rules |
| --- | --- |
| Name | 1–80 characters, e.g. "Codex on my laptop" |
| Expires after | 30, 90 (default), 180 or 365 days; the server allows 1–365 |
| Scopes | **Read-only (recommended)**: every read scope your role holds. **Custom**: pick record types. **Create tasks** (`tasks:write`) is the only write scope, off unless chosen, and only for roles that hold it; it only proposes tasks for approval |

Scopes come from the agent-tool registry: the `requires` and `enrichesWith` permissions
of the remote read tools (`society:read`, `meetings:read`, `minutes:read`,
`documents:read`, `tasks:read`, `deadlines:read`, `filings:read`, `commitments:read`)
plus the write tools' (`tasks:write`). A scope your role doesn't hold is refused when
the token is created. The API (`agentConnectors:mintToken`) also takes `allowedTools`
to limit a token to named tools.

The token is shown once. Only its SHA-256 is stored, with `soc_mcp_…` and its last four
characters for recognising it. Each person can hold 10 active tokens per workspace. You
can revoke your own tokens; Owners and Admins see and can revoke everyone's.

## Client setup

```sh
export SOCIETYER_MCP_TOKEN="soc_mcp_…"
```

**Codex CLI**

```sh
codex mcp add societyer --url https://<deployment>.convex.site/mcp --bearer-token-env-var SOCIETYER_MCP_TOKEN
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.societyer]
url = "https://<deployment>.convex.site/mcp"
bearer_token_env_var = "SOCIETYER_MCP_TOKEN"
```

**Claude Code**

```sh
claude mcp add --transport http societyer https://<deployment>.convex.site/mcp --header "Authorization: Bearer $SOCIETYER_MCP_TOKEN"
```

**MCP Inspector**

```sh
npx @modelcontextprotocol/inspector --cli https://<deployment>.convex.site/mcp --transport http --method tools/list --header "Authorization: Bearer $SOCIETYER_MCP_TOKEN"
```

The Inspector's web UI works through its local proxy (the default). Its "direct"
browser mode sends an `Origin` header, so add the Inspector's origin (for example
`http://localhost:6274`) to `SOCIETYER_MCP_ALLOWED_ORIGINS` first.

**OpenAI Responses API**

```json
{ "type": "mcp", "server_label": "societyer", "server_url": "https://<deployment>.convex.site/mcp",
  "authorization": "soc_mcp_…", "require_approval": "always" }
```

**claude.ai and ChatGPT** can't use a static token; they connect with OAuth (below).

## Connecting with OAuth

OAuth needs no token to copy. The AI app sends you to Societyer, you sign in as usual,
pick the workspace and what the app may read, and approve. The approval becomes a grant
like a personal token's: the same opt-in, role ∩ scopes on every call, rate limit,
revocation and audit.

**First, an Owner or Admin** turns on **Allow AI connectors for this workspace**
(Settings → AI connectors). The consent page lists only workspaces where that is on and
you're an active member.

The server URL to paste everywhere is the endpoint itself:
`https://<deployment>.convex.site/mcp` (Settings → AI connectors shows it).

**claude.ai (web, Desktop, mobile)**

1. Settings → Connectors → **Add custom connector**. On Team and Enterprise plans an
   Owner adds it under the organization's connector settings first; members then connect.
2. Name it "Societyer", paste the server URL, leave the OAuth client fields empty
   (Claude identifies itself with its Client ID Metadata Document) and add it.
3. Click **Connect**. A Societyer tab opens: sign in if asked, choose the workspace and
   scopes, and **Approve**. You return to claude.ai.

**ChatGPT**

1. Turn on developer mode (Settings → Apps → Advanced settings; OpenAI renames these
   menus often), then create an app or connector with the server URL and **OAuth**
   authentication.
2. ChatGPT reads the metadata, identifies itself (Client ID Metadata Document, or dynamic
   registration) and opens the Societyer consent page. Approve.

ChatGPT's callback is `https://chatgpt.com/connector_platform_oauth_redirect` or a
per-connector `https://chatgpt.com/connector/oauth/<id>`; both are accepted.

**Claude Code**

```sh
claude mcp add --transport http societyer https://<deployment>.convex.site/mcp
```

then run `/mcp` in Claude Code, choose societyer and **Authenticate**. Claude Code opens
the consent page and receives the code on `http://localhost:<port>/callback`.

**Codex CLI**

```sh
codex mcp add societyer --url https://<deployment>.convex.site/mcp
codex mcp login societyer
```

Codex identifies itself (dynamic registration or a metadata document), opens the consent
page and listens on a loopback port.

**The consent page** (`<app>/oauth/consent`) names the app by what Societyer can check.
An app with a metadata document keeps its own name in the title ("Connect Claude"), with
"Published by <host>" (the document's host). A self-registered app is named by the host it
returns to ("Connect an app at claude.ai", or "Connect an app on this computer" for a
loopback address) under an **Unverified** badge; the name it gave itself is only quoted
("Calls itself “Claude (verified)”"), so a registration can't borrow a trusted name. The
page also lists the host it returns to. A loopback return address gets a warning: any program on the computer
can listen there, so only continue if you just started connecting. Reads you hold are
ticked by default; **Can propose changes for you to approve** (`tasks:write`, draft-only
under decision A4) is always off until you tick it. A self-registered app's own website
(`client_uri`) is shown only as "unverified, self-declared"; names and hosts lose
invisible and direction-changing characters. **Approve** turns on once the page has been
visible and focused for half a second, so a window that pops up under the pointer can't
catch a click, and only after you tick **I just started connecting <app> myself** (`<app>` is
the same verifiable name as the title, e.g. "the app at claude.ai"): an app's
sign-in link someone else started and sent you would connect *their* app to your
workspace. Connecting the same app to the same workspace again keeps one connection
(its scopes become the ones you chose) and adds a new **session**.

**Finish in the same browser.** After you decide, the page posts your decision back to
Societyer's sign-in server, which checks that it came from the consent page and that
this browser holds the cookie it set when the app started connecting. A consent link
opened in another browser, or sent to you by someone else, can't be completed: you see
"Finish connecting in the browser where you started", and nothing is connected. The
first person to answer a request owns the answer; anyone else gets "Someone else already
answered". That means someone who learns your pending request link can answer it first and
block your own answer (they still can't complete it from your browser). The request then
expires within 10 minutes; start connecting again from the app. This denial of service is
an accepted residual.

**Disconnecting.** Settings → AI connectors lists your connected apps (Owners and Admins
see everyone's) next to personal tokens, with each app's **sessions**: one per approval,
with when it started, when it was last used and where it returns. **Revoke** on a
session ends just that one (say, a session you don't recognise); **Disconnect** stops
all of the app's access and refresh tokens at once. Turning the workspace opt-in off makes every call `403` and
blocks token refresh, without deleting connections. Each row's badge says where it stands:
**Active**; **Paused** ("Connectors are off for this workspace") for tokens and apps that work
again once the opt-in is back on, and can still be revoked; **Expired**; **Revoked** for a
token after **Revoke** and **Disconnected** for an app after **Disconnect**, with the date
it happened instead of its expiry. A connection lasts 90 days from
approval; then the app asks you to connect again.

**Troubleshooting**

| Symptom | Cause and fix |
| --- | --- |
| The app says it couldn't reach the server / no sign-in window | Use the URL ending in `/mcp`. Check that `<deployment>.convex.site/.well-known/oauth-protected-resource/mcp` returns JSON; a `404` means OAuth is off on this deployment (see [Deployment](#deployment-settings)). |
| "Can't connect this app to Societyer" page | The app's redirect URI isn't one Societyer allows, its metadata document couldn't be fetched or doesn't match its URL, or the link was malformed. Operators can allow extra exact redirect URIs. |
| "No workspace allows AI connectors" | An Owner or Admin has to turn on the opt-in. |
| "This connection request expired" | Requests last 10 minutes. Start connecting again from the app. |
| "Finish connecting in the browser where you started" | The consent page was opened in another browser (or profile) than the one the app opened, or the link came from someone else. Start again from the app and finish in the window it opens. Browsers that block all cookies for `*.convex.site` can't connect. |
| Worked, then stopped after a while | The connection was disconnected, its 90 days ran out, the opt-in was turned off, your membership changed, or the app replayed an old refresh token (which revokes its tokens). Connect again. |
| A tool is missing | Your role or the scopes you approved don't include it. Connect again to change the scopes. |

**Not supported:** confidential clients that authenticate with `private_key_jwt`,
`client_credentials` (no-user) tokens, OpenID Connect ID tokens or a UserInfo endpoint,
refresh tokens without rotation, step-up (`insufficient_scope`) challenges, and Microsoft
Entra or other external authorization servers.

## Tools

The remote surface offers every registry tool except browser-only `open_governance_view`,
filtered by the token's effective permissions and `allowedTools`:

| Tool | Kind | Needs |
| --- | --- | --- |
| `get_governance_snapshot` | read | `society:read` (+ deadlines, filings, meetings, tasks if held) |
| `list_meetings`, `get_meeting` | read | `meetings:read` (`get_meeting` adds minutes with `minutes:read`) |
| `get_transcript` | read | `meetings:read`, `minutes:read`, and a creator whose role holds `minutes:write` |
| `search_documents`, `get_document` | read | `documents:read`, plus the document access rules |
| `list_tasks` | read | `tasks:read` |
| `list_deadlines` | read | `deadlines:read` |
| `list_commitments` | read | `commitments:read` |
| `create_governance_tasks` | write (draft) | `tasks:write` (only with the Create tasks scope); creates a pending draft |

With a read-only token a Member sees `get_governance_snapshot`, `list_meetings`,
`get_meeting`, `search_documents`, `get_document` and `list_tasks`; a Viewer sees every
read but `get_transcript`; Directors, Admins and Owners see all reads.

## Protocol

Hand-written JSON-RPC 2.0 over Streamable HTTP (`shared/mcp/server.ts`; no MCP SDK):

- **Stateless, JSON only.** One message per `POST`, answered with `application/json`. No
  SSE stream and no `Mcp-Session-Id`. `GET` and `DELETE` answer `405` with
  `Allow: POST, OPTIONS`.
- **Versions** `2025-11-25` (latest), `2025-06-18`, `2025-03-26`. `initialize` echoes a
  supported version or answers with the latest; other requests with an unsupported
  `MCP-Protocol-Version` header get `400`.
- **Methods** `initialize` (capabilities `{ tools: { listChanged: false } }`, server info,
  instructions), `ping`, `tools/list` (`title`, `inputSchema`, `outputSchema` with an
  object root, `annotations`), `tools/call`. Notifications and client responses get `202`.
  Anything else is `-32601`.
- **`tools/call`** validates arguments with the tool's zod schema; bad arguments come back
  as a tool error (`isError: true`) the model can correct. Results are `structuredContent`
  plus the same JSON as text. Tool failures are `isError: true`; a tool the token may
  not use is `-32602`.
- **No batches.** MCP dropped JSON-RPC batching in 2025-06-18; an array gets `-32600`.
- **Limits:** 64 KiB request bodies (`413`); 60 requests per token per minute in a fixed
  window (`429` + `Retry-After`; set `SOCIETYER_MCP_RATE_LIMIT_PER_MINUTE` to change it).
- **Origin:** requests without `Origin` (CLI clients) are fine. A browser `Origin` must be
  listed in `SOCIETYER_MCP_ALLOWED_ORIGINS` (comma-separated), or the request gets `403`,
  as the MCP spec requires against DNS rebinding.
- **401s** carry `WWW-Authenticate: Bearer realm="societyer-mcp"` plus, with OAuth on,
  `resource_metadata` and `scope`, and `error="invalid_token"` when a token was sent
  (unknown, revoked, expired, bound to another resource, or its creator is no longer an
  active member).

### OAuth 2.1 authorization server

Societyer is its own authorization server, on the same origin as `/mcp` (the issuer is
`CONVEX_SITE_URL`). It is a small server in Convex HTTP actions and tables, not
better-auth's `mcp` plugin. That plugin (better-auth 1.6.23, installed) was checked and
doesn't fit: it stores access and refresh tokens in plain text, doesn't rotate refresh
tokens or detect reuse, has no RFC 8707 audience binding, accepts `plain` PKCE, has no
Client ID Metadata Documents, needs a Better Auth session cookie on the deployment's
origin (only `AUTH_MODE=convex`, and the app keeps that session cross-domain), and has
no workspace choice. `@better-auth/oauth-provider` isn't installed. The custom server
works in every auth mode because consent runs in the app with the app's normal sign-in.

| Route (on `CONVEX_SITE_URL`) | Purpose |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` (and without `/mcp`) | RFC 9728: `resource` `<site>/mcp`, `authorization_servers` `[<site>]`, `scopes_supported` = the read scopes |
| `GET /.well-known/oauth-authorization-server` (and `/mcp` suffixed) | RFC 8414: endpoints, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"]`, `scopes_supported` = all connector scopes + `offline_access`, `authorization_response_iss_parameter_supported: true` |
| `GET /oauth/authorize` | Validates the client and redirect URI (errors shown on a page, never redirected), then PKCE, `response_type`, `resource`; stores the request, sets the browser binding cookie and redirects to the app's consent page |
| `POST /oauth/authorize/complete` | The consent page's form after a decision (`request`, `completion`): checks `Origin` is the app, the one-time completion token and the binding cookie, then `303`s to the app with `code` (or `error=access_denied`), `state` and `iss`. There is no `GET` |
| `POST /oauth/token` | Form-encoded. `authorization_code` (PKCE S256 required) and `refresh_token` (rotating) |
| `POST /oauth/register` | RFC 7591 dynamic registration, JSON, rate-limited (10 at once, then 20/hour per IPv4 address or IPv6 /64); clients nobody connects are deleted after a week |
| `POST /oauth/revoke` | RFC 7009; revokes the token's family |

A `401` from `/mcp` now carries
`WWW-Authenticate: Bearer realm="societyer-mcp", resource_metadata="<site>/.well-known/oauth-protected-resource/mcp", scope="<read scopes>"`.

**Clients.** A `client_id` that is an https URL with a path is a Client ID Metadata
Document: fetched through the outbound URL policy (https only; private, loopback,
link-local, metadata and internal hosts refused before any request; 16 KiB, 4 s, no
redirects), checked (`client_id` equals the URL, `client_name`, public client, no
secret, redirect URIs within the policy), and cached for its `max-age` between 5 minutes
and a day. When the cache is stale and the URL answers `404` or `410`, the cached client
is deleted and the request refused (the publisher removed it; tokens for it stop
refreshing). Only a network error, a timeout or a `5xx` falls back to the stale copy,
for up to a week; any other answer is refused.
Other clients register (`soc_dcr_…`); public by default, or confidential with a
`soc_dcs_…` secret stored as a hash.

**Redirect URIs.** Every client's URIs must be one of: `https://claude.ai/api/mcp/auth_callback`,
`https://chatgpt.com/connector_platform_oauth_redirect`, `https://chatgpt.com/connector/oauth/<id>`,
loopback `http://localhost`, `http://127.0.0.1` or `http://[::1]` (any port, any path),
or an exact URI in `SOCIETYER_MCP_OAUTH_REDIRECT_URIS`. A request's `redirect_uri` must
match one the client registered exactly, except that a loopback port is ignored
(RFC 8252 §7.3; Claude Code registers `http://localhost/callback`).

**Tokens.** All opaque and stored as SHA-256 hashes: request handles (`soc_mar_…`, 30
minutes), codes (`soc_mac_…`, 5 minutes, single use), access tokens (`soc_mat_…`, 1
hour) and refresh tokens (`soc_mrt_…`, 30 days, never past the grant's 90 days). Each
code exchange starts a token family; every refresh marks the old row rotated and issues
a new pair. Presenting a rotated refresh token, or a code a second time, revokes the
whole family. Tokens are bound to the resource `<site>/mcp` (a `resource` naming another
server is `invalid_target`; the bare origin is accepted as the same server), and `/mcp`
refuses an access token bound to anything else. A code is spent by its first exchange
attempt, whatever the outcome, so a wrong verifier can't be retried.

**Consent.** The app's `/oauth/consent?request=…` page requires the normal sign-in
(signed-out visitors go to `/login` and come back). Its Convex actions
(`mcpOAuth:consentDetails`, `approve`, `deny`) carry the user's bearer token, not
cookies, so another site can't submit a decision (no CSRF surface); the request handle
is unguessable, single-use and expires in 10 minutes; approval checks active
membership, the workspace opt-in, and scopes ⊆ the person's role. A decision is only
*recorded*, with the decider's sign-in subject and the hash of a fresh one-time
completion token (`soc_mad_…`) that only the decider receives: `approve` and `deny`
return `{ action: "<issuer>/oauth/authorize/complete", fields: { request, completion } }`
for the page to post, never the client's redirect. The first person to decide owns the
decision; only they may change it before it completes. See [Security](#security) for the
checks completion makes. Completion re-checks membership, the opt-in and the scopes, then creates or
updates the `agentGrants` row (`kind: "oauth"`, `oauthClientId`), stores the code's hash
and redirects to the client with `code`, `state` and `iss`. Each code exchange starts a
session (`mcpOAuthFamilies`: the token family, the app's name, its redirect host,
created, last used, expiry), listed under the grant and revocable on its own with
`agentConnectors:revokeToken({ grantId, familyId })`.

### Security

These came out of a security review of the connector (2026-10-17).

- **Consent is bound to the browser that started it.** `/oauth/authorize` sets
  `__Host-soc-oauth-<16 hex of the request hash>=soc_mab_…` (`Secure; HttpOnly;
  SameSite=None; Path=/; Max-Age=600`, no `Domain`, not `Partitioned`) on the issuer
  (`<deployment>.convex.site`) and stores the nonce's SHA-256 on the request. One cookie
  per request, so two connections in one browser don't clash. After a decision the
  consent page (on `SITE_URL`, a different site) submits a form, a top-level `POST`
  navigation, to `/oauth/authorize/complete` with the request and the one-time
  completion token. Completion requires all three: `Origin` is the app's origin (another
  site can't post the form: CSRF; refusals are logged as `completion_cross_site`), the
  token matches the recorded decision (only the decider received it), and the binding
  cookie. A missing or wrong cookie discards the decision, nothing is granted, and the
  decider's workspace gets `oauth_consent_binding_failed`; the request stays open for the
  browser that started it. So a consent link someone forwards can't be approved by
  anyone else, someone who learns your request link can't deny it for you or slip in
  their own decision, and there's no completion link to trick a browser into opening.

  Cross-site behaviour: the authorize request is a top-level navigation from the AI app
  (claude.ai, ChatGPT, a CLI's browser tab), and a cookie set on a top-level navigation
  response is first-party for `convex.site`. The consent page is on the app's origin and
  never sees it. `SameSite=Lax` cookies aren't sent on a cross-site `POST`, so the cookie
  is `SameSite=None`; the `Origin` check, not SameSite, stops other sites. Third-party
  cookie blocking (Chrome's tracking protection, Safari ITP, Firefox Total Cookie
  Protection) applies to cookies in embedded or subresource requests; in the completion
  POST the issuer *is* the top-level site, so its own unpartitioned cookie is sent. This
  was checked in Chromium with third-party cookies blocked: a credentialed `fetch` from
  the app to the issuer carried no cookie, the top-level form `POST` carried the
  `SameSite=None` cookie and not a `SameSite=Lax` control cookie. The consent page must be
  served with `Referrer-Policy: strict-origin` (or any policy but `no-referrer`/
  `same-origin`): under `no-referrer` browsers send `Origin: null` on the POST, which is
  refused. Browsers that block every cookie for the deployment, or that clear storage
  for sites only passed through (bounce-tracking protection), would refuse; requests
  last 10 minutes, well inside those purges.
- **Forwarded authorize links.** Someone can start an app's sign-in themselves and send
  you the *authorize* link; your browser then holds the binding, and an approval would
  send a code to the app's callback for the flow *they* started. Societyer narrows this:
  requests expire after 10 minutes, and Approve needs the box **I just started
  connecting <app> myself**. The rest is the client's job: an OAuth client must bind
  `state` to its own signed-in user (or browser session) and drop a callback whose
  `state` it didn't issue to that user, as RFC 6749 §10.12 and RFC 9700 §4.7 require. Claude's
  and ChatGPT's callbacks do; check any operator-listed client.
- **Sessions are visible.** A second consent for the same app shows up as a new session
  under it in Settings → AI connectors instead of merging out of sight.
- **In-camera content stays in** (decision A5), for documents too: see [Privacy and the
  workspace opt-in](#privacy-and-the-workspace-opt-in).
- **Consent spoofing.** Control and format characters (`\p{Cc}`, `\p{Cf}`: bidi
  overrides and isolates, zero-width characters, the BOM) are removed from client names
  and every host the page shows. Only a metadata document's URL host is shown as the
  publisher; a registered client is titled by its redirect host, its own name is only
  quoted ("Calls itself …") and its `client_uri` is "unverified, self-declared". Approve
  waits for 500 ms of the page being visible and focused, restarting on blur or a tab
  switch.
- **Limits and clean-up.** Throttles key on the client address, IPv6 by /64; when Convex
  can't give one, requests share one bucket per route (`mcp-oauth-<route>:unknown-ip`)
  instead of going unlimited, and the deployment logs `mcp_oauth_client_ip_unavailable`
  once per instance. A self-hosted deployment behind a proxy that hides client addresses
  puts every caller in that bucket, so one busy or hostile caller can make everyone wait;
  raise `SOCIETYER_MCP_OAUTH_UNKNOWN_IP_AUTHORIZE_PER_HOUR` (default 600, burst a tenth)
  and `SOCIETYER_MCP_OAUTH_UNKNOWN_IP_REGISTER_PER_HOUR` (default 200), or pass the
  client address through. There is no deployment-wide registration cap for one caller to drain.
  An hourly cron (`internal.mcpOAuth.purgeStale`) deletes authorization requests a day
  after they end, token rows and sessions seven days after they were rotated, revoked or
  expired (reuse of a rotated refresh token is detected for those seven days; after
  that it's simply unknown), deployment events after 30 days, and clients with no grant
  idle for a week. It deletes up to 200 rows per table query a round; while a round
  comes back full it schedules the next at once, up to 25 rounds a run, so the about 24
  token rows a day each connection's rotation leaves can't build a backlog.
- **Events with no workspace.** A dynamic registration, a decline or binding failure by
  someone who named no workspace, and a cross-site completion attempt are written to
  `mcpOAuthEvents` (event type, client id, non-secret detail) and the deployment's logs,
  and kept 30 days. A refused completion POST is unauthenticated, so it is written and
  logged once per caller (address, IPv6 /64, or the shared unknown-address key) per
  hour, and the rest only add to that row's `count`; the row keys on a hash of the
  caller, never the address.
- **Token endpoint.** A used code presented again by the client it was issued to revokes
  that session (RFC 6749 §4.1.2); presented by another client it is only refused and
  audited. Malformed Basic credentials are `401 invalid_client`. Request bodies are read
  as a stream and refused as soon as they pass the limit (16 KiB for `/oauth/*`, 64 KiB
  for `/mcp`).
- **Clickjacking.** The consent page must be served with `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` (see [Hosting requirements](#hosting-requirements)), and it
  refuses to show its buttons inside a frame either way. The server's own error page has
  the same headers and a `default-src 'none'` CSP.

**Errors** follow RFC 6749: `invalid_request`, `invalid_client` (401),
`invalid_grant`, `invalid_scope`, `invalid_target`, `unsupported_grant_type`,
`unsupported_response_type`, `access_denied`; descriptions never include internals. The
token endpoint does only Convex reads and writes (no outbound calls), well inside
Claude's 10-second limit.

### Deployment settings

OAuth is on when the deployment knows its own URL and the app's:

| Variable | Purpose |
| --- | --- |
| `CONVEX_SITE_URL` | Set by Convex. The issuer and the `/mcp` resource. |
| `SITE_URL` | The app's origin (first entry). The consent page is `<SITE_URL>/oauth/consent`. Already required for `AUTH_MODE=convex`. |
| `SOCIETYER_MCP_OAUTH_CONSENT_URL` | Optional. The consent page's full URL when the app isn't at the root of `SITE_URL` or `SITE_URL` isn't set (other auth modes). |
| `SOCIETYER_MCP_OAUTH_REDIRECT_URIS` | Optional, comma-separated exact redirect URIs to allow beyond Claude's, ChatGPT's and loopback. |
| `SOCIETYER_MCP_OAUTH=0` | Turns OAuth off: the well-known routes and `/oauth/*` answer `404` and the `401` loses `resource_metadata`. Personal tokens keep working. |
| `SOCIETYER_MCP_OAUTH_UNKNOWN_IP_AUTHORIZE_PER_HOUR`, `SOCIETYER_MCP_OAUTH_UNKNOWN_IP_REGISTER_PER_HOUR` | Optional positive integers: the hourly allowance (burst a tenth of it) of the shared bucket for requests whose client address Convex can't give. Defaults 600 and 200. See [Security](#security). |

Claude reaches the deployment from `160.79.104.0/21`; a firewall in front of
`*.convex.site` must allow it for discovery, registration and tokens.

### Hosting requirements

The app's CSP is a `<meta>` tag (`index.html`), which can't set `frame-ancestors`, so the
static host has to send these on `/oauth/*` (the consent page), and route
`/oauth/consent` to `index.html`:

```
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
Referrer-Policy: strict-origin
```

| Host | How |
| --- | --- |
| Cloudflare Pages, Netlify | `public/_headers` (in the repo); `_redirects` sends everything to `index.html` |
| Docker (nginx) | `docker/frontend.nginx.conf` has a `location /oauth/` with the headers (`always`), serving `index.html` from that location so they aren't dropped by an internal redirect |
| Vercel | Add a `headers` entry for `/oauth/(.*)` to a `vercel.json` (none in the repo) |
| GitHub Pages, plain S3 or other hosts without custom headers | They ignore `_headers` and can't send these. The page's frame check (it won't show Approve or Deny inside a frame) is the only protection there; put a CDN that can add headers in front, or host elsewhere, before turning OAuth on |

The issuer side needs nothing: `/oauth/*` on `*.convex.site` sends its own headers, and
its binding cookie is a `__Host-` cookie, which needs HTTPS (or `http://localhost` in
development).

## How it runs

| Piece | File |
| --- | --- |
| Route (`/mcp`, all methods) | `convex/mcpHttp.ts`, registered in `convex/http.ts` |
| Protocol | `shared/mcp/server.ts` (`handleMcpHttp` + an `McpBackend`) |
| Token, scope and limit rules | `shared/mcp/connectorPolicy.ts` |
| Tokens, opt-in, auth, audit | `convex/agentConnectors.ts`, tables in `convex/tables/agentConnectors.ts` |
| Admitting a grant (checks, rate limit, last used) | `convex/lib/connectorAdmission.ts` |
| OAuth rules (metadata, redirect policy, PKCE, CIMD/DCR validation) | `shared/mcp/oauth.ts` |
| OAuth routes | `convex/mcpOAuthHttp.ts`, registered in `convex/http.ts` |
| OAuth storage, consent, token exchange | `convex/mcpOAuth.ts`, tables in `convex/tables/mcpOAuth.ts` |
| Consent page | `src/features/aiConnectors/OAuthConsentPage.tsx` (`/oauth/consent`), headers in `public/_headers` and `docker/frontend.nginx.conf` |
| OAuth sessions (token families) | `convex/lib/oauthSessions.ts`; hourly clean-up in `convex/crons.ts` |
| Server adapter for the registry | `convex/lib/agentToolRunner.ts` |
| Settings card | `src/features/aiConnectors/AiConnectorsCard.tsx` |
| Tests | `scripts/check-mcp-endpoint.ts` (`npm run test:mcp-endpoint`), `scripts/check-mcp-oauth.ts` (`npm run test:mcp-oauth`) |

A request is: hash the bearer token → `agentConnectors:authorizeRequest` for a personal
token, or `mcpOAuth:authorizeAccessToken` for an OAuth access token (expiry, revocation,
resource), both ending in `admitGrant` (an internal mutation: grant, expiry, opt-in,
active membership, rate limit, last used) → for
`tools/call`, `agentConnectors:runReadTool` (one internal query) or `runWriteTool` (one
internal mutation, so a failure part-way rolls back) → `recordToolCall`.

The runner re-checks the token in the same transaction as the reads and runs the tool
through a `PortableRuntime` whose principal is a service principal
`{ actorUserId: creator, scopes: token scopes }`. Every wrapped portable function then
applies its own action policy, membership, document access, in-camera and transcript
rules, and `requirePermissionPortable` intersects the role with the scopes (the
`convex/pathways.ts` worker-principal pattern). `AGENT_TOOL_FUNCTIONS` lists the portable
functions the tools call, because hosted Convex doesn't load the whole registry;
`check-mcp-endpoint` fails if a tool calls one that isn't listed or the handler differs
from the registry's.

`agentConnectors:*` and `mcpOAuth:*` public functions are hosted only: classified as handler policies in
`shared/functions/actionPolicy.ts`, server-only in the portable manifest, offline no-ops
in `src/lib/staticConvexParity.ts`, and excluded from workspace exports (token hashes,
OAuth clients, requests and tokens, and the opt-in are authorization state, not records).

## Roadmap

**Directory listings.** OAuth is built (see [Connecting with OAuth](#connecting-with-oauth)).
Listing in Anthropic's connector directory or OpenAI's plugin directory still needs a
privacy policy, test credentials without MFA, domain verification
(`/.well-known/openai-apps-challenge` for OpenAI) and the vendors' review.

**Desktop bridge (not built).** The desktop app keeps data in the renderer's local
store, so an MCP server there would be a local (stdio or loopback) bridge running the
same `shared/mcp/server.ts` protocol with a `PortableRuntime` backend over the local
runtime and a device-only token. It's a separate step.

## Limitations

- Members can't open Settings; they create tokens under AI agents → Connectors.
- Tokens can't read in-camera content, even for roles that may (by design). A
  transcript of a meeting whose in-camera sessions aren't all marked in the recording
  is withheld whole.
- Writes wait for a person: an AI client sees only the pending draft until someone
  approves it in Societyer.
- No `resources`, `prompts`, progress notifications or cancellation; tool lists don't
  change during a session (`listChanged: false`), and a tool removed by a role change
  shows up on the next `tools/list`.
- The rate limit is per token (or OAuth connection) and per minute only; there is no
  per-workspace quota.
- Registered clients nobody connected are deleted after a week idle, ended token rows and
  sessions after seven days, requests a day after they end (hourly, `purgeStale`). A
  dynamic registration has no workspace, so it appears only in the deployment's logs
  until someone connects the client.
- Routine refreshes aren't audited (one an hour per connection); code exchanges,
  replays, connections and disconnections are.
- No grace period on refresh rotation: a client that loses a refresh response and
  retries with the old refresh token is treated as a replay and must connect again.
