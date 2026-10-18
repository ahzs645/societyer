# Agent tools

Societyer offers one set of tools to AI agents, defined once in `shared/agentTools/`
and run by an adapter for each surface:

| Surface | Adapter | Status |
| --- | --- | --- |
| `browser`: WebMCP in the open tab | `src/features/webmcp/browserAgentAdapter.ts` (Convex client, hosted or local) | Shipped |
| `device`: the on-device assistant's tool loop | `shared/agentTools/portableAdapter.ts` over the local runtime (`src/features/ai/useDeviceAssistantTools.ts`) | Shipped |
| `remote`: a remote MCP endpoint | `convex/lib/agentToolRunner.ts` behind `POST /mcp` (token auth; see [mcp-connector.md](mcp-connector.md)) | Shipped (hosted, OAuth next) |

A tool is a name, title, description, a zod input schema (published as JSON Schema
2020-12), an output schema, MCP annotations, a `kind` (`read`, `draft` or `write`),
the portable functions it calls, the permissions it needs, and a handler written
against the adapter interface. Handlers only call portable functions, so hosted
Convex and the local runtime run the same code and the same policy.

## Tools

| Tool | Kind | Needs | Also reads if allowed | Notes |
| --- | --- | --- | --- | --- |
| `get_governance_snapshot` | read | `society:read` | deadlines, filings, meetings, tasks | Overdue and upcoming items, compliance flags; lists what the role can't see in `restrictedResources` |
| `list_meetings` | read | `meetings:read` | | Newest first; date range, status, words; up to 50 |
| `get_meeting` | read | `meetings:read` | `minutes:read` | Meeting, minutes (draft or approved), sections, decisions, action items, motions, with in-camera redaction |
| `get_transcript` | read | `meetings:read`, `minutes:read`, and a role holding `minutes:write` (`requiresRole`) | | Pages of up to 200 segments by index or time range, speaker names resolved through combined speakers. For minute-takers only (decision A1) |
| `search_documents` | read | `documents:read` | | Title, file name, category and tags; up to 25 |
| `get_document` | read | `documents:read` | | Details plus up to 12,000 characters of text per call, paged by `offset` |
| `list_tasks` | read | `tasks:read` | | Open by default; up to 50 |
| `list_deadlines` | read | `deadlines:read` | | Open by default, with `overdue` |
| `list_commitments` | read | `commitments:read` | | Everything but Closed by default |
| `create_governance_tasks` | write | `tasks:write` | | Up to 8 tasks. `destructiveHint: false` (it only adds records). Remote: a pending draft; device: Approve card; browser: direct, `consequentialHint: true`, opens Tasks |
| `open_governance_view` | read | the view's route permission | | Browser only. Navigates the tab, so `readOnlyHint: false` |

What each role is offered in the browser (`agentToolsFor`):

| Role | Tools |
| --- | --- |
| Owner, Admin | All 11 |
| Director | All but `create_governance_tasks` |
| Viewer | All but `create_governance_tasks` and `get_transcript` |
| Member | `get_governance_snapshot`, `list_meetings`, `get_meeting`, `search_documents`, `get_document`, `list_tasks`, `open_governance_view` |

Remote and device surfaces get the same lists without `open_governance_view`. The on-device assistant also leaves out
`create_governance_tasks` unless the person allows it to propose changes, and even
then only proposes it.

## Permissions

Every tool lists the portable functions it calls (`calls`). Its `requires` plus
`enrichesWith` must equal `actionPermission()` of those functions;
`scripts/check-agent-tools.ts` fails otherwise. `requires` decides whether the tool
is offered at all. `requiresRole` lists permissions the person's *role* must hold
whatever a token's scopes say (`principal.rolePermissions`); `get_transcript` needs
`minutes:write` this way, so no connector scope can grant it. It is not the security boundary: each wrapped function runs as
the caller and applies its own policy (action policy, handler checks, document
access, in-camera redaction). A caller whose context claims more than its principal
holds gets the function's refusal.

## Privacy

- **In-camera content.** Minutes sections whose type is `in_camera`,
  `executive_session` or `closed`, or whose title matches an in-camera session
  segment, are in camera, along with their depth-1 sub-items and their motions.
  Only roles with `minutes:write` (Owner, Admin, Director) read them. Everyone else
  gets the section, motion and decision in place with the text "In-camera session —
  not shown", so they know something was withheld. The rule and redaction live in
  `shared/minutesPrivacy.ts` and apply to every minutes read path (see below), so
  the tools inherit them. `get_meeting` sets `inCamera` on sections and motions and
  `inCameraRedacted` on the minutes.
- **Working transcripts** are for the people who keep the minutes (decision A1):
  reading one needs a role holding `minutes:write` (Owner, Admin, Director) plus
  `meetings:read`; a scoped service principal (a connector token) also needs the
  `minutes:read` scope. Members and Viewers read the minutes instead, and the minutes'
  transcript copy (`draftTranscript`) is withheld from them too. The rule lives in
  `requireTranscriptReaderPortable` and `canReadTranscriptPortable`
  (`shared/functions/minutesPrivacy.ts`); the action policy gate for `transcripts:*`
  queries is the `minutes:read` scope.
- **Transcripts without in-camera access** (only connectors, since every other
  transcript reader holds `minutes:write`; decision A2): when every in-camera session
  in the minutes has recording offsets (`recordingStartSec`/`recordingEndSec` on its
  session segment) and every in-camera section is named by a marked session, the
  segments that overlap a marked range are replaced by one line per run,
  "[In-camera session — not shown]", and speakers heard only in camera drop out.
  Otherwise the whole transcript is withheld and `get_transcript` answers
  `{ available: false, reason: "in_camera" }`. A cut transcript has `inCameraNotice`,
  and placeholder segments have `inCamera: true`.
- **Agenda items and working notes** (decision A3): for readers without in-camera
  access, agenda items inside an in-camera session (their type is in camera, an
  in-camera minutes section links to them or has their title, or an in-camera session
  segment has their title; sub-items follow their parent) read "In-camera item" and
  lose their details and presenter. A formal-minutes meeting's `workingNotes` are
  withheld (`workingNotesWithheld: "in_camera"`) when its minutes record an in-camera
  session. Notes meetings keep their notes.
- **Documents and tasks holding in-camera content** (security review H1): for readers
  without in-camera access, a document in-camera minutes cite (imported sources, the
  source record's documents, dissent reports of in-camera motions), any document filed
  under or attached to a meeting whose minutes record an in-camera session, an
  attachment of an in-camera agenda item, or a duplicate or version of any of those is
  an "In-camera material" placeholder. Tasks made from in-camera action items read
  "In-camera action" in `list_tasks` and the snapshot (`isInCameraTask`), judged when
  read against the current minutes from the section the task records.
  `search_documents` lists it with `restricted: "in_camera"`, and `get_document` returns
  its details with `content: null`; its real title, file name, tags and text never
  reach the tool. The rule is in `shared/minutesPrivacy.ts` (`isInCameraDocument`) and
  `shared/functions/minutesPrivacy.ts` (`inCameraDocumentTest`), applied by the
  `documents:*` queries.
- **Connectors never read in-camera content** (decision A5), even for Owners: no
  connector scope includes `minutes:write`. `minutes:in-camera`
  (`RESERVED_IN_CAMERA_SCOPE`) is reserved for a future, audited, Owner-only scope and
  is not implemented; minting a token with it is refused.
- **User-written text** (discussion, decisions, motion wording, transcript lines,
  document text, task descriptions) is returned as `{ untrusted: "…", truncated?, totalChars? }`,
  and results carry a `notice` saying to treat it as data. Titles and labels are
  plain strings. Read tools set `untrustedContentHint: true`.
- **Bounded output.** Lists cap at 25 to 50 rows and report `total` and `truncated`;
  long text is cut and flagged; transcripts and documents page.

### Where in-camera redaction is applied

`minutes:list`, `minutes:listLight`, `minutes:getByMeeting`, `minutes:listSummaries`
(in-camera action observations), `motions:list`, `motions:listForMinutes`,
`motions:listForMeeting`, `motions:backlog`, `meetingMaterials:packageForMeeting`
(minutes, agenda titles, the meeting's working notes, materials' agenda labels),
`agendas:getForMeeting`, `agendas:get`, `meetings:get` (working notes),
`transcripts:getByMeeting`, table exports of `minutes`, `motions`, `transcripts`,
`meetings` and `agendaItems`, the offline meeting snapshot
(`convex/lib/offlineMeetingProjection.ts`: discussion and agenda titles), the hosted AI
agent's `find_minutes` tool (`convex/aiAgents.ts`), and the public copy renderer
(`renderMinutesHtml` with `publicOnly`/`publicCopy`, for every role: in-camera
sections, in-camera agenda titles, and a transcript appendix built by
`transcriptTextWithoutInCamera`). Stored rows, approved snapshots and adoption history
are never changed; redaction happens on read.

## Write modes (decision A4)

Every `draft` or `write` tool declares `writeMode` for each surface it runs on, and
`check-agent-tools` fails otherwise:

| Surface | Mode | What happens |
| --- | --- | --- |
| `remote` (MCP connectors) | `draft` | `tool.run` validates the input and calls `adapter.proposeDraft`, which stores a pending `aiToolDrafts` row (`agentKey: "mcp_connector"`, `payload: { input, surface, grantId }`) and audits `tool_draft_proposed`. The result is `{ status: "pending_approval", draftId, title, approvePath, approveUrl?, message }`, and MCP publishes that as the tool's output schema. Nothing changes until a person approves the draft in AI agents → AI tool drafts (`/app/ai-agents?draft=<id>` scrolls to it). `aiAgents:approveToolDraft` then runs `tool.execute` as the approver, through only the portable functions the tool declares (so the approver needs the tool's permissions), and audits `tool_draft_approved` |
| `device` (on-device assistant) | `approve` | Unchanged: the loop turns the call into an Approve / Dismiss card and runs it only after approval |
| `browser` (WebMCP) | `direct` | Runs in the signed-in person's session; registered with `readOnlyHint: false` and `consequentialHint: true` (`webMcpAnnotations`) so the browser agent confirms first |

## WebMCP (browser)

`src/features/webmcp/WebMcpTools.tsx` registers the tools for the signed-in user's
role on `document.modelContext` and on `navigator.modelContext` when either exists
(both are feature-detected; the same object is used once). Each registration passes
the shared `AbortSignal`; a change of workspace or role (including the demo's
"Viewing as") aborts the old set and registers the new one. The tool list is
mirrored to `<html data-webmcp-tools>` for tests. Each tool carries `inputSchema`,
`outputSchema` and the annotations; writes add `consequentialHint: true`
(`webMcpAnnotations`). Calls go through the app's Convex client, which
is the hosted Convex client or the local runtime's client.

## Adding a tool

1. Write it with `defineAgentTool` in `shared/agentTools/tools/`. Use strict zod
   objects with bounds and short `.describe()` texts, and bounded output with the
   helpers in `output.ts`.
2. List every portable function in `calls`, and set `requires` / `enrichesWith` to
   their `actionPermission()`.
3. Add it to `AGENT_TOOLS` in `shared/agentTools/index.ts`.
4. Run `node --import tsx scripts/check-agent-tools.ts`, and add a case for anything
   privacy-relevant.

`write` and `draft` tools must declare `writeMode` for each surface (see Write modes)
and a `draftTitle` for the pending draft. `requiresRole` is for permissions a token's
scopes must never stand in for.

## For the next adapters

**Remote MCP endpoint (Convex).** Built: see [mcp-connector.md](mcp-connector.md). An
HTTP action authenticates a personal access token, then runs the tool in one internal
query (reads) or mutation (writes, which only store a pending draft; see Write modes) through a `PortableRuntime` whose principal is a
service principal acting as the token's creator with the token's scopes, so every
wrapped function's policy applies, narrowed by those scopes. `context.principal.permissions`
is the creator's current role permissions ∩ the scopes. The protocol lives in
`shared/mcp/server.ts`, so OAuth (next) and a future desktop bridge reuse it.

**On-device assistant (shipped).** See [local-ai.md](local-ai.md#assistant-tools) for
what people see. The pieces:

- Tools: `deviceAssistantTools({ permissions, proposeChanges })` in
  `src/lib/localAi/assistantToolLoop.ts` is `agentToolsFor({ surface: "device", permissions })`,
  reads only unless "Allow the assistant to propose changes" is on.
  `chatToolDefinition` turns each into an OpenAI function with `agentToolInputSchema`.
- Adapter: `createPortableAgentAdapter(runtime, { surface: "device", workspace, principal, now })`,
  where `runtime` runs portable functions through the app's client, which in the
  local and desktop runtimes is the local `PortableRuntime`. `principal` is the
  signed-in person's role and `permissions:myPermissions`.
- Loop: `runDeviceAssistantTurn` validates arguments with the tool's zod schema,
  runs `read` tools with `tool.run`, and turns `draft`/`write` calls into proposals
  without running them. `runApprovedChange(adapter, proposal, offered)` runs one
  after the person approves it, only while the tool is still offered to them.
  Results go back to the model as JSON with the `{ untrusted }` wrappers kept, and
  the system prompt carries `UNTRUSTED_DATA_RULE`.
- Writes made by the device surface are tagged `device-agent` and `agent-created`.

## Tests

- `scripts/check-agent-tools.ts`: schemas, permission parity, annotations, per-role
  visibility, and tool runs on both portable adapters (in-camera redaction, the
  transcript permission, paging bounds, document access, writes, server re-checks).
- `scripts/check-minutes-privacy.ts`: the in-camera rule and transcript permission
  across every read path and role, cut transcripts and marking, agenda titles and
  working notes, and that no connector scope reads in-camera content.
- `scripts/check-device-assistant-tools.ts`: the on-device loop against the mock
  model server: per-role tool lists, proposals that run only on approval, refusals,
  invalid arguments, caps, abort, the no-tools fallback, and in-camera redaction and
  the transcript permission as the model sees them.
- `tests/webmcp.spec.ts` (needs a build) and `tests/live-interface-webmcp.spec.ts`.

## Limitations

- In-camera parts of a transcript can only be cut out once an editor marks every
  in-camera session's range in the recording (Transcript tab → select lines → Mark as
  in-camera…). Until then, readers without in-camera access get no transcript.
  Approved minutes can't be marked; their transcript stays withheld from those readers.
- When minutes record an in-camera session that isn't its own section, the free-text
  discussion is withheld for readers without access; structured sections are shown.
- The imported source documents of minutes follow their own permissions, not the
  in-camera rule.
- `search_documents` matches metadata only, not document text.
