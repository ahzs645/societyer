# Meetings, transcripts and AI: working assumptions (2026-10-17)

The product owner asked for the open questions to be decided by reasonable
assumption and documented. Each entry records the decision, the reason and how to
reverse it. Where a choice was close, the more privacy-protective option was
taken: BC PIPA applies to governance and member data.

## Access and privacy

### A1. Working transcripts are for minute-takers only
**Decision.** Reading a meeting's working transcript requires `minutes:write`
(Owner, Admin, Director by default), not just `minutes:read`. Members and Viewers
read the minutes, not the raw transcript.

**Why.** A transcript is unedited evidence. It holds every aside and personal
remark, much of which never belongs in the record. Minutes are the curated record
that members are entitled to see. Draft-minutes access for Members is unchanged.

**Reverse.** Change the transcript read permission in `shared/functions/actionPolicy.ts`
and `shared/minutesPrivacy.ts` back to `minutes:read`. Tests:
`scripts/check-minutes-privacy.ts`.

**Implemented** — `shared/minutesPrivacy.ts` (`TRANSCRIPT_READ_PERMISSION` is
`minutes:write`; `TRANSCRIPT_READ_SCOPE` is the `minutes:read` scope a connector also
needs; `withoutTranscriptCopy`), `shared/functions/minutesPrivacy.ts`
(`requireTranscriptReaderPortable`, `canReadTranscriptPortable`, `readerAccessGate`,
`minutesForReader`, `exportRowsForReader`), `shared/functions/transcripts.ts`,
`shared/functions/actionPolicy.ts` (the `transcripts:*` query gate is the scope; the
handler checks the role), `shared/agentTools/tools/meetings.ts` (`get_transcript`
`requiresRole: ["minutes:write"]`), `shared/agentTools/types.ts` / `index.ts`
(`requiresRole`, `rolePermissions`), `shared/mcp/*`, `convex/lib/agentToolRunner.ts`,
`convex/lib/connectorAdmission.ts` (session `rolePermissions`),
`src/features/meetings/components/TranscriptAccessNotice.tsx`, `src/pages/MeetingDetail.tsx`,
`src/features/meetings/pages/MeetingMinutesPreviewPage.tsx`. The minutes' transcript copy
(`draftTranscript`) follows the same rule; import metadata stored in that field stays.
To reverse: set `TRANSCRIPT_READ_PERMISSION` back to `minutes:read` and drop
`requiresRole` from `get_transcript`. Tests: `check-minutes-privacy`, `check-agent-tools`,
`check-mcp-endpoint`, `check-device-assistant-tools`.

### A2. Partial in-camera redaction of transcripts: recording offsets are optional
**Decision.** In-camera sessions may carry optional recording offsets
(`recordingStartSec` / `recordingEndSec`). Editors can set them from the Transcript
tab by marking a selected range as in camera. When offsets exist, exports and any
reader without in-camera access lose only the overlapping segments. Without
offsets, the whole transcript is withheld from those readers, as before.

**Why.** After A1, non-editors can't read transcripts in the app anyway. Offsets
still matter for exports and appendices, and for connectors (A5), where the whole
transcript would otherwise be withheld.

**Implemented** — offsets on session segments (`convex/tables/meetings.ts`,
`convex/minutes.ts`), `transcripts:markInCameraRange` (`shared/functions/transcripts.ts`,
`convex/transcripts.ts`, registry and manifest; needs `meetings:write` and
`minutes:write`). **Approved or adopted minutes are refused**, not stored separately: the
offsets are part of the session segment, which is part of the record, so marking happens
while the minutes are a draft; an approved meeting's transcript stays withheld whole from
readers without in-camera access. Redaction in `shared/minutesPrivacy.ts`
(`inCameraRecordingRanges`, `redactInCameraTranscript`, `transcriptWithoutInCamera`,
`transcriptTextWithoutInCamera`), applied by `transcriptForReader` and the public-session
export (`minutesRenderer.ts` `audienceTranscript`). Partial redaction needs every
in-camera session marked and every in-camera section named by a marked session;
otherwise the whole transcript is withheld. UI:
`src/features/meetings/transcript/useInCameraMarks.ts`, `InCameraTranscript.tsx`,
`TranscriptTurns.tsx`, `useTranscriptSelection.tsx`, `MediaPlayerBar.tsx`,
`TranscriptWorkspace.tsx`, `src/styles/_meeting-transcript.scss`. Tests:
`check-minutes-privacy`, `check-agent-tools`, `check-mcp-endpoint`.

### A3. In-camera gaps are closed
**Decision.** For readers without in-camera access:
- titles of agenda items inside an in-camera session show as "In-camera item";
- a minutes meeting's working notes (`meetings.workingNotes`) are hidden when its
  minutes record an in-camera session.

Notes-only meetings keep their notes visible to readers of the meeting; they have
no session segments.

**Implemented** — `shared/minutesPrivacy.ts` (`inCameraAgendaItemIds`,
`redactInCameraAgendaItems`, `redactInCameraAgendaTitles`, `workingNotesAreInCamera`),
`shared/functions/minutesPrivacy.ts` (`agendaItemsForReader`, `meetingForReader`, table
exports of `meetings` and `agendaItems`), `shared/functions/agendas.ts`
(`getForMeeting`, `get`), `shared/functions/meetings.ts` (`get`),
`shared/functions/meetingMaterials.ts` (package agenda, meeting and materials' agenda
labels), `convex/lib/offlineMeetingProjection.ts`, `minutesRenderer.ts` (public copy),
`src/pages/MeetingDetail.tsx` (Overview notes "Restricted"). Agent tools read no agenda
items or working notes. Tests: `check-minutes-privacy`.

### A4. AI never writes without a person approving
**Decision.**
- **Remote connectors (MCP).** Write tools never change records directly. They
  create a pending draft (`aiToolDrafts`) that a person approves in Societyer, and
  the tool result links to it.
- **On-device assistant.** Already uses an inline Approve / Dismiss card.
- **WebMCP in the browser.** Runs in the signed-in user's own session, so it keeps
  direct writes, but its write tool is marked consequential so browser agents
  confirm first.

**Why.** Governance records are legal records. An AI host's confirmation dialog
is not under our control.

**Implemented** — `writeMode` on every write tool, checked by `check-agent-tools`
(`create_governance_tasks`: `{ remote: "draft", device: "approve", browser: "direct" }`);
`shared/agentTools/types.ts` (`writeModeFor`, `proposeDraft`, `execute`,
`AGENT_TOOL_DRAFT_OUTPUT`), `shared/agentTools/index.ts` (`agentToolOutputSchemaFor`,
`webMcpAnnotations` adds `consequentialHint: true`), `convex/lib/agentToolRunner.ts`
(`proposeConnectorDraft`: `aiToolDrafts` row + `tool_draft_proposed` audit, approval
link from `SITE_URL`), `shared/mcp/server.ts` (draft output schema, instructions),
`shared/functions/aiAgents.ts` (`approveToolDraft` runs registry tools as the approver
and audits `tool_draft_approved`), `src/pages/AiAgents.tsx` (`?draft=<id>` deep link),
`src/features/webmcp/browserAgentAdapter.ts`, `src/types/webmcp.d.ts`. The on-device
assistant is unchanged (`check-device-assistant-tools`). Tests: `check-agent-tools`,
`check-mcp-endpoint`.

### A5. Connectors never return in-camera content, even for Owners
**Decision.** No connector scope grants in-camera reads. A future explicit scope
(`minutes:in-camera`, off by default, Owner-only, audited) is the reversal path.

**Why.** In-camera content leaving the workspace for a third-party AI vendor needs
a deliberate, separate decision.

**Implemented** — already true; now tested: `check-minutes-privacy` (no connector scope
is `minutes:write` or `minutes:in-camera`; every connector scope together, for the
Owner, reads no in-camera minutes, agenda, notes or transcript content; minting with
`minutes:in-camera` is refused) and `check-mcp-endpoint`. `RESERVED_IN_CAMERA_SCOPE` in
`shared/minutesPrivacy.ts` names the reserved scope; it is not implemented. Documented in
`docs/mcp-connector.md` and `docs/agent-tools.md`.

**Security review fixes — in-camera documents (H1).** `get_document` returned a document's
extracted text with only the role check, so the minutes scan of a meeting whose minutes
redact an in-camera section reached an Owner's connector whole. Documents now follow the
in-camera rule on every read path, on both runtimes: for readers without in-camera access
(Members, Viewers, every connector) a document is in-camera material when in-camera
minutes cite it (`sourceDocumentIds`, `sourceTransposition.originalSources`,
`sourceMeetingRecord.documents`, a dissent report of an in-camera motion), when it is a
material or attachment of an agenda item inside an in-camera session, or when it is the
Minutes-category document of a meeting whose minutes record one.
`documents:list`/`listSummaries`/`get`/`getMany`/`browse`/`reviewQueues`, the meeting
package and materials lists return an "In-camera material" placeholder (category, dates
and links; no title, file, tags, text, URL or download) marked `inCameraWithheld:
"in_camera"`, and the material's own label and notes go too. Every other document path
(versions and downloads, comments, evidence, linked rows, public sharing) refuses it,
because `documentAccessPredicate` and `requireDocumentAccess` include the rule; the
minutes' own source check uses the ACL alone (`documentAclPredicate`), since
`minutesForReader` already drops in-camera minutes' source copies. The index is built
once per query from index reads (the workspace's minutes, and for in-camera minutes their
motions, agendas and agenda items), only for readers without in-camera access. The agent
tools mark placeholders `restricted: "in_camera"` with no content. UI: the Documents list
shows a "Restricted" badge and the document page "Restricted: in-camera material".
Implemented in `shared/minutesPrivacy.ts` (`inCameraDocumentIdsOf`, `isInCameraDocument`,
`withheldInCameraDocument`), `shared/functions/minutesPrivacy.ts`
(`inCameraDocumentIndex`, `inCameraDocumentTest`, `publicInCameraDocumentTest`),
`shared/functions/documents.ts`, `documentCatalog.ts`, `meetingMaterials.ts`,
`minutes.ts`, `shared/agentTools/tools/documents.ts`, `src/pages/DocumentWorkbench.tsx`,
`src/pages/Documents.tsx`. Tests: `check-minutes-privacy` (every role, both adapters, and
every connector scope for the Owner), `check-mcp-endpoint` (`get_document` and
`search_documents` through `/mcp`).

**Security review round 2 — in-camera material, wider (H1).** The first pass only caught
Minutes-category documents. Now, for readers without in-camera access: any document filed
under an in-camera meeting (`meetingId`) or attached to it as a material, whatever its
category; duplicates and versions linked to an in-camera document (`duplicateOfDocumentId`,
`supersedesDocumentId`, both directions, four steps, through the new `by_duplicate_of` and
`by_supersedes` indexes); tasks made from in-camera action items ("In-camera action":
status, dates and links stay, wording, people and notes go). A task records whether its
action item was in camera when it is created (`tasks.inCamera`, set by `tasks:create` from
`minutesSectionIndex`); older tasks count when an in-camera section links them
(`actionItems[].taskId`, `linkedTaskIds`), sit under an in-camera agenda item, or are
minutes action tasks of an in-camera meeting with no `inCamera` recorded (privacy-protective:
nothing says which part of the meeting they came from). Task reads go through
`tasksForReader`: `tasks:list`/`byCommittee`/`byGoal`/`byMeeting`, the dashboard preview,
the meeting package, scoped exports and the hosted agent's `find_tasks`. `documents:get` and
`getMany` no longer return import bookkeeping rows (the lists never did), and scoped exports
leave them out. Swept and unchanged: AI chat (its attachments are files from the user's
browser; its tools go through the same queries), document versions (file metadata only,
behind `requireDocumentAccess`), intake and import flows (editors with manage access, who
hold in-camera access). Implemented in `shared/minutesPrivacy.ts` (`isInCameraDocument`,
`inCameraTaskIdsOf`, `isInCameraTask`, `withheldInCameraTask`), `shared/functions/minutesPrivacy.ts`
(`inCameraIndex`, `readerInCameraIndex`, `tasksForReader`), `shared/functions/tasks.ts`,
`documents.ts`, `dashboard.ts`, `meetingMaterials.ts`, `convex/aiAgents.ts`,
`convex/tables/documents.ts`, `convex/tables/policies.ts`, `convex/tasks.ts`,
`src/features/meetings/components/MeetingActionItemsCard.tsx`. Tests:
`check-minutes-privacy`, `check-mcp-endpoint`.

**Security review round 3 — tasks judged when read; accepted residuals (H1).** Round 2
decided a task's in-camera status once, when it was made, from a section index the page
sent; a task made without one stored `inCamera: false`, and a section marked in camera
later never hid its tasks. Now a task made from an action records the section it came
from (`minutesSectionIndex` and `minutesSectionTitle`, the title read from the minutes on
the server; a caller can't send its own title or hint), and `tasksForReader` decides on
every read against the current minutes: the section, found by title (or by index when the
title still matches), is in camera now; a minutes action task with no section that can be
found, under a meeting with an in-camera session (or one whose session no section holds),
counts as in camera; `inCamera: true` is only a hint, used when the meeting's minutes are
gone. Marking a section later hides its tasks, unmarking shows them again. Accepted
residual: duplicate and version links are followed at most four steps and 500 documents
per workspace; a longer chain of copies of in-camera material isn't found. Implemented in
`shared/minutesPrivacy.ts` (`isInCameraTask`, `minutesSectionsOf`, `sectionTitleAt`),
`shared/functions/minutesPrivacy.ts` (`inCameraIndex` carries every meeting's sections,
`readerInCameraIndex`), `shared/functions/tasks.ts`, `convex/tables/policies.ts`. Tests:
`check-minutes-privacy` (missing index, later marking, unmarking, a caller's own hint and
title ignored, both runtimes, every connector scope), `check-mcp-endpoint` (through `/mcp`).

## Connectors and AI providers

### B1. Next build: OAuth for claude.ai and ChatGPT connectors
**Decision.** OAuth 2.1 comes next, so the remote MCP endpoint works as a
claude.ai custom connector and a ChatGPT connector/plugin.
- PKCE S256.
- Client ID Metadata Documents and dynamic client registration.
- Protected-resource and authorization-server metadata.
- Audience-bound tokens.
- A consent screen that picks the workspace and scopes.

It uses what the installed better-auth already ships where possible, rather than
adding packages. Each OAuth grant maps onto the same `agentGrants` model, so
opt-in, scope intersection, revocation, rate limits and audit are identical to
personal tokens.

**Implemented** (2026-10-17) — `shared/mcp/oauth.ts`, `convex/mcpOAuthHttp.ts`,
`convex/mcpOAuth.ts`, `convex/tables/mcpOAuth.ts`, `convex/lib/connectorAdmission.ts`,
`convex/mcpHttp.ts`, `shared/mcp/server.ts`, `src/features/aiConnectors/OAuthConsentPage.tsx`,
`public/_headers`, tests in `scripts/check-mcp-oauth.ts`. better-auth's `mcp` plugin was
checked and not used: it stores tokens in plain text, doesn't rotate refresh tokens,
has no audience binding or Client ID Metadata Documents, and needs a Better Auth
cookie session. The authorization server is a small one in Convex instead; consent
uses the app's normal sign-in, so it works in every auth mode. Details and setup:
`docs/mcp-connector.md` (Connecting with OAuth).

**Reverse.** Set `SOCIETYER_MCP_OAUTH=0` on the deployment; personal tokens keep working.

**Security review fixes — OAuth (2026-10-17).**
- *Consent bound to the starting browser (M1, L3).* `/oauth/authorize` sets a
  `__Host-soc-oauth-…` cookie (Secure, HttpOnly, SameSite=Lax, Path=/) holding a nonce
  whose hash the request stores. `approve` and `deny` only record a decision and return
  the issuer's `/oauth/authorize/complete`, which applies it only with that cookie, so a
  forwarded consent link can't be approved or denied by someone else; a mismatch discards
  the decision (the request stays open for the starting browser) and is audited. Lax cookies are sent on the top-level GET back to the issuer
  even though the consent page is another site.
- *Sessions (M1).* Each code exchange is a session (`mcpOAuthFamilies`) under its grant,
  with created, last used, app and redirect host, listed in Settings → AI connectors and
  revocable on its own (`agentConnectors:revokeToken` with `familyId`). A second consent
  for the same app shows as a new session instead of merging out of sight.
- *Throttles and growth (L1).* No client IP → a shared bucket, not none; IPv6 keyed by
  /64; no deployment-wide registration cap; a daily `purgeStale` cron removes ended
  requests, token rows and sessions after 7 days, and clients with no grant idle a week.
- *Metadata documents (L2).* A 404 or 410 deletes the cached client and refuses; only
  network errors, timeouts and 5xx use a stale copy.
- *Consent spoofing (L4).* Format characters stripped from names and hosts; a registered
  client's `client_uri` shown only as "unverified, self-declared"; Approve after 500 ms of
  the page being visible and focused.
- *Framing (L5).* `docker/frontend.nginx.conf` sends `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` on `/oauth/`; hosts that can't send headers (GitHub Pages) are
  documented, with the page's frame check as the remaining guard.
- *Audit (L6).* Denials, binding failures, RFC 7009 revocation, failed code exchanges
  (flagged as possible interception) and session revocation are audited; registrations
  are logged. No secrets in audit rows.
- *Token endpoint.* Malformed Basic auth is `401 invalid_client`; a used code presented
  by another client is refused without revoking the real client's session; bodies are
  read with a cap.

Implemented in `shared/mcp/oauth.ts`, `shared/mcp/server.ts`, `convex/mcpOAuth.ts`,
`convex/mcpOAuthHttp.ts`, `convex/lib/oauthSessions.ts`, `convex/tables/mcpOAuth.ts`,
`convex/agentConnectors.ts`, `convex/crons.ts`, `src/features/aiConnectors/*`,
`docker/frontend.nginx.conf`. Tests: `check-mcp-oauth`, `check-mcp-endpoint`. Details:
`docs/mcp-connector.md` (Security, Hosting requirements).

**Security review round 2 — OAuth (2026-10-18).**
- *Completion is a POST with a CSRF check (item 2).* `/oauth/authorize/complete` is
  `POST` only. It needs `Origin` = the consent page's origin, a one-time completion token
  that `approve`/`deny` return only to the decider, and the binding cookie. The cookie is
  now `SameSite=None` (Lax isn't sent on a cross-site POST); it's first-party in that
  top-level navigation, so third-party cookie blocking doesn't affect it (checked in
  Chromium with third-party cookies blocked). The consent page's `Referrer-Policy` is
  `strict-origin`, because `no-referrer` makes browsers send `Origin: null`.
- *First decision wins (item 2).* A request's decision records the decider's sign-in
  subject; nobody else can replace it, only the decider can change it before completion.
- *Forwarded authorize links (item 3).* Requests last 10 minutes; Approve needs "I just
  started connecting <app> myself"; the docs require clients to bind `state` to their user.
- *Unknown client address (item 4).* The shared bucket's allowance is configurable
  (`SOCIETYER_MCP_OAUTH_UNKNOWN_IP_AUTHORIZE_PER_HOUR`, `…_REGISTER_PER_HOUR`); a missing
  address is logged once per instance; the self-hosting implication is documented.
- *Events with no workspace (item 5).* Registrations, declines and binding failures with
  no workspace, and cross-site completion attempts go to `mcpOAuthEvents` (30 days, purged
  by the clean-up cron) and the logs.

Implemented in `shared/mcp/oauth.ts`, `convex/mcpOAuth.ts`, `convex/mcpOAuthHttp.ts`,
`convex/tables/mcpOAuth.ts`, `src/features/aiConnectors/OAuthConsentPage.tsx`,
`public/_headers`, `docker/frontend.nginx.conf`. Tests: `check-mcp-oauth`.

**Security review round 3 — OAuth (2026-10-18).**
- *Clean-up throughput.* `purgeStale` runs hourly, and while a round's batches come back
  full it schedules the next round at once (`scheduler.runAfter(0, …)`), up to 25 rounds
  a run, so token rotation (about 24 rows a day per connection) can't outpace it.
- *Refused completions.* A completion POST from another origin is unauthenticated, so its
  event is written and logged once per caller (address, IPv6 /64, or the shared
  unknown-address key) per hour, keyed by a hash of the caller; the rest only count.
- *Accepted residuals.* Someone who learns a pending request link can answer it first and
  block the starter's own answer (a denial of service only: they can't complete it from
  the starter's browser); the request expires within 10 minutes and the person starts
  again from the app. Duplicate and version links of in-camera documents are followed at
  most four steps and 500 documents (see A5).

Implemented in `convex/mcpOAuth.ts`, `convex/mcpOAuthHttp.ts`, `convex/tables/mcpOAuth.ts`,
`convex/crons.ts`. Tests: `check-mcp-oauth`.

### B2. The desktop bridge is not built yet
**Decision.** The owner said not to build the desktop app's connector yet. It
stays a documented roadmap item (`docs/mcp-connector.md`). Codex CLI 0.163 supports
stdio, bearer-token HTTP and OAuth MCP servers, so the bridge will work with it
once built.

### B3. No software installed on the owner's machine
**Decision.** Ollama, LM Studio, whisper.cpp and model weights are not installed
automatically. Local AI is tested against the mock OpenAI-compatible server
(`scripts/fixtures/mock-openai-server.ts`). A real-model run is a manual step in
`docs/local-ai.md`.

### B4. Sign in with ChatGPT (plan usage) is deferred
**Decision.** It is in preview, text-only, and self-serve only for
open-source/locally hosted apps; the hosted site needs OpenAI's interest form. It
would suit the desktop app later. Until then, AI uses a workspace API key, a local
model, or a connector where the AI vendor does the model work.

### B5. Remote connectors are off by default
Each workspace must be opted in by an Owner or Admin. Tokens are read-only by
default, capped at the creator's current role, and expire within 90 days by
default and 365 at most.

## Meetings (recorded from earlier work)

### C1. Meeting record kinds
- Board, AGM and SGM default to **Formal minutes**; committees and other meetings
  default to **Meeting notes**.
- Existing meetings without the field behave as formal minutes.
- Notes meetings keep the template's agenda topics. Template motions are added only
  when the meeting is turned into minutes.

### C2. Speaker merges are reversible
Merges are recorded on the speaker map, not by rewriting segments. Transcripts
merged before this change read the same but can't be unmerged.

### C3. Recordings opened from a device are never uploaded
Only the file's name and size are remembered, per meeting on that device, to
prompt reopening.

### C4. Known quirk: the meetings list counts the adjournment
The meetings list's motion count includes the adjournment; the Motions tab counts
business motions. The list reads a cached summary that only holds motion IDs, and
reading motion rows for every meeting would be too costly.

## Accepted residual risks

### R1. Client metadata fetches can't check DNS answers
**What remains.** Convex can't see the IP a hostname resolves to. A client metadata
URL on a public wildcard-DNS name that resolves to a private address (for example
`127.0.0.1.nip.io`) passes the hostname check.

**Why it's accepted.** The fetch still needs HTTPS with a valid certificate for
that name, follows no redirects, is capped at 16 KiB and 4 seconds, and returns
only generic errors. That makes it a blind, low-value request.

**Revisit if** metadata fetches move to a runtime that can pin resolved
addresses, such as a Worker or Node fetch with a custom DNS lookup.
