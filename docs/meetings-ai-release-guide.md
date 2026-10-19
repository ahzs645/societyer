# Meetings, transcripts and AI: review and release guide

This covers the work from 2026-10-17 and 2026-10-18. Most of it was committed in
`0074bf0e` and deployed to DDC North (`39e145fd`, `eb7489af`). The rest is in the
working tree (see **Not yet committed**). Decisions and assumptions are in
[decisions/2026-10-17-meetings-ai-assumptions.md](decisions/2026-10-17-meetings-ai-assumptions.md).

## What shipped

| Area | Summary | Docs |
| --- | --- | --- |
| Transcript tab | Playback with waveform and speaker lane; synced, searchable transcript; edits keep timings; speaker review, combine/undo; motion and action links; in-camera ranges; VTT/SRT/JSON import and export | [meeting-transcript-workspace.md](meeting-transcript-workspace.md) |
| Record kinds | Just the meeting / Meeting notes / Formal minutes; Notes tab; "Turn notes into minutes"; kind-aware Overview, tiles and list | same, "Record kinds" |
| Meeting source files | 500 MB resumable uploads to private SharePoint; timed transcripts open in the Transcript tab; recordings play there | [meeting-source-pipeline.md](meeting-source-pipeline.md), [meeting-source-storage.md](meeting-source-storage.md) |
| Local AI | On-device model for minutes drafting, the assistant (read-only tools, approval cards for changes) and intake; on-device speech-to-text; Electron proxy keeps keys in the main process | [local-ai.md](local-ai.md) |
| Privacy | Transcripts are for minute-takers only; in-camera content redacted for everyone else in minutes, agenda, notes, documents, tasks, exports and AI tools | decisions A1–A5 |
| Agent tools | One registry (11 tools) used by WebMCP, the on-device assistant and the remote connector | [agent-tools.md](agent-tools.md) |
| Remote connector | `POST /mcp` with personal tokens and OAuth 2.1 (claude.ai, ChatGPT, Claude Code, Codex); per-workspace opt-in, off by default | [mcp-connector.md](mcp-connector.md) |
| Stale tabs after deploys | Lazy page chunks that no longer exist trigger one reload, then a "Societyer was updated — Reload" notice | `src/lib/staleBuild.ts` |

## Live on DDC North now

- **Connector endpoints.** Verified 2026-10-18: OAuth discovery (`/.well-known/oauth-protected-resource`) and
  `/mcp` answer on `industrious-cricket-610.convex.site`, and `/mcp` returns 401 without a token. No workspace
  is reachable until an Owner or Admin turns on **AI connectors** for it.
- **Transcription.** Server speech processing stays off (`MEETING_TRANSCRIPTION_*` unset).
  Use platform VTT exports or the desktop app; see the pipeline doc.

## Not yet committed (working tree, 2026-10-18)

- **Stale-build recovery:** `src/lib/staleBuild.ts`, `PageErrorBoundary.tsx`, `main.tsx`, `scripts/check-stale-build.ts`.
- **Transcript export:** `shared/transcriptExport.ts`, `TranscriptExportMenu.tsx`, `scripts/check-transcript-export.ts`.
- **Pipeline:**
  - fixes for the 384–600 KB "Use for minutes" import, card copy, A1 gating on source text;
  - `src/lib/meetingSourceTransfer.ts` and `scripts/check-meeting-source-e2e.ts`;
  - parity and export-coverage classifications.
- **Tooling:** stage-2 inventory regenerated, scanner alias fix, locale-stable manifest sort, lint-size refactors
  (`SegmentEditors.tsx`, `OnDeviceAiFields.tsx`).
- **Docs:** `meeting-source-pipeline.md`, this guide, decisions doc updates.
- **Final QA fixes (2026-10-18):** see the next section.
- **Not from this work:** `tests/helpers/recordTableToolbar.ts` and `tests/interface-records.spec.ts` were changed
  by another session. Review them separately.

## Final QA fixes (2026-10-18, working tree)

| # | Change | Where | Test |
| --- | --- | --- | --- |
| 1 | Draft minutes works on meetings made from a template: content still exactly as the template seeded it isn't recorded content (or a started draft). Edited sections are refused by name: "… has recorded content, which a draft never overwrites. Edit or clear that section, then draft again." Decision C1a | `shared/minutesDraftInput.ts`, `shared/sourceMinutesTransposition.ts`, `MeetingDetail.tsx`, `convex/minutes.ts`, `shared/functions/minutes.ts`, `localMinutesDraft.ts` | `check-transcript-minutes-draft`, `check-minutes-draft-shared`, `check-meeting-record-kind` |
| 2 | A library document attached to an in-camera item stays readable; the material link (listing, label, notes, count, export row) is withheld instead. Attaching no longer files the document under the meeting. The attach drawer warns on in-camera topics. `listForSociety` no longer embeds in-camera working notes | `shared/minutesPrivacy.ts`, `shared/functions/minutesPrivacy.ts`, `meetingMaterials.ts`, `documents.ts`, `MeetingMaterialDrawer.tsx` | `check-minutes-privacy` |
| 3 | Tokens and apps read "Paused — connectors are off for this workspace" while the opt-in is off | `src/features/aiConnectors/connectorDisplay.ts`, `AiConnectorsCard.tsx` | `check-mcp-oauth` |
| 4 | Consent page: an unverified app is titled by its redirect host, with an Unverified badge and its own name only quoted | `OAuthConsentPage.tsx`, `connectorDisplay.ts` | `check-mcp-oauth` |
| 5 | Every read tool wraps typed text (titles, locations, names, tags, file names) as `{ untrusted }` | `shared/agentTools/*`, `shared/mcp/server.ts`, `shared/ai/localAssistantPrompt.ts` | `check-agent-tools`, `check-device-assistant-tools`, `check-mcp-endpoint` |
| 6 | Members and Viewers no longer query `transcripts:jobForMeeting` | `MeetingDetail.tsx` | `check-timed-transcript` |
| 7 | No duplicate "In camera:" prefix on the divider | `InCameraTranscript.tsx` (`inCameraDividerLabel`) | `check-timed-transcript` |
| 8 | Divider Clear button stays on one line, 40px on touch | `_meeting-transcript.scss` | visual |
| 9 | Phone: assistant chats fold behind a "Chats" toggle; titles ellipsize; ⋯ always reachable | `GlobalAiAssistant.tsx`, `_layout-ai-*.scss` | visual |
| 10 | Whisper JSON hint says "Includes word timings" only when there are word timings | `shared/transcriptExport.ts` (`transcriptExportHint`) | `check-transcript-export` |
| 11 | Revoked/Disconnected wording (no "Expires"); "How meeting files become minutes" is a link (`.text-link`); 40px dialog close and token-banner dismiss on touch; badge text ≥ 4.5:1 via `--*-text` tokens | `connectorDisplay.ts`, `Modal.tsx`, `_tokens.scss`, `tokens.css`, `_base.scss` | `check-mcp-oauth`, `check-css-vars` |
| 12 | Draft minutes is disabled while on-device transcription runs ("Wait for the transcription to finish."); in-camera sections read "In-camera item" like their agenda items; On-device AI separates "running but blocks this page (CORS)" from "Nothing answered at …" | `useLocalTranscription.ts`, `shared/minutesPrivacy.ts`, `src/lib/localAi/transport.ts` | `check-local-transcription`, `check-minutes-privacy`, `check-local-ai-client` |

Behaviour to know before deploying:
- **Connector clients** that read a tool result's `title` as a string must now read `title.untrusted`.
- **Documents attached before this change** were filed under the meeting by the old attach and stay withheld as
  in-camera material when that meeting has an in-camera session (privacy-protective; decision A5, final QA).
- Badge colours for success, warn, danger and accent changed slightly in the light theme (contrast).

## Review hotspots (security-sensitive)

1. **`convex/secrets.ts` `_revealForServer`.** It now accepts the `societyId` the calling action authorized. It
   requires active membership of that workspace and that the key belongs to it. Without this change, saved
   workspace AI keys never worked for signed-in users.
2. **OAuth server: `convex/mcpOAuth.ts`, `convex/mcpOAuthHttp.ts`, `shared/mcp/oauth.ts`,
   `convex/lib/connectorAdmission.ts`.** It had three rounds of adversarial review. Residual risks are in the
   decisions doc (R1 and the B1/A5 notes).
3. **In-camera rules: `shared/minutesPrivacy.ts`, `shared/functions/minutesPrivacy.ts`, document and task read
   paths, and `shared/functions/meetingMaterials.ts` (material links to in-camera items; attach no longer sets
   `documents.meetingId`).**
4. **Outbound URL policy for AI endpoints:** `aiSettingsActions`, `aiChatActions`, `convex/lib/outboundUrlPolicy.ts`.
5. **Electron AI proxy:** `electron/localAiProxy.ts`, `electron/ipc/aiHandlers.ts`, `electron/localTranscription.ts`.
   It forwards only allow-listed paths, and keys never reach the window.

## Checks

Run each with `node --import tsx scripts/<name>.ts`. The `tsx` CLI can fail on IPC in sandboxes.

- **Typecheck:** `./node_modules/.bin/tsc -b`, `-p convex/tsconfig.json --noEmit`, `-p tsconfig.electron.json --noEmit`.
- **Transcripts and meetings:** `check-timed-transcript`, `check-transcript-speakers`, `check-transcript-links`,
  `check-transcript-export`, `check-transcript-minutes-draft`, `check-transcript-source-playback`,
  `check-minutes-transcript-export`, `check-meeting-record-kind`, `check-meeting-source-e2e`,
  `check-meeting-sources`.
- **Privacy and access:** `check-minutes-privacy`, `check-workspace-access`, `check-module-access`,
  `check-authorization-policy`, `check-stage2-tenancy`, `check-stage2-enforced`.
- **AI:**
  - Local: `check-local-ai-client`, `check-local-transcription`, `check-device-assistant-tools`,
    `check-minutes-draft-shared`, `check-electron-architecture`.
  - Server: `check-ai-endpoint-policy`, `check-ai-chat-stream`, `check-ai-chat-privacy`,
    `check-ai-provider-scope`, `check-outbound-url-policy`, `check-ai-agent-contract`.
- **Connectors:** `check-agent-tools`, `check-mcp-endpoint`, `check-mcp-oauth`.
- **Repo integrity:** `check-static-convex-parity`, `check-export-coverage`,
  `check-portable-conformance-matrix`, `check-css-vars`, `check-stale-build`,
  `node scripts/portable-manifest.mjs --check`.
- **`check-api-contract`:** passes only with `AUTH_MODE=none VITE_AUTH_MODE=none` and a local Convex URL set
  for that command, because `.env.local` mixes auth modes.

## Not verified live (do these before relying on them)

1. **A real local model and speech server:**
   - Ollama, LM Studio or llama.cpp with a tool-capable model.
   - A local Whisper or WhisperX server.

   Steps are in `local-ai.md`. Everything so far ran against `scripts/fixtures/mock-openai-server.ts`.
2. **The Electron app in a real window:** AI proxy, chunked speech upload, ffmpeg splitting.
3. **Real connectors.** Turn on AI connectors for one test workspace, then:
   - connect claude.ai (custom connector);
   - connect ChatGPT (developer mode);
   - connect Claude Code (`claude mcp add --transport http …`);
   - connect Codex (`codex mcp add societyer --url <site>/mcp`, then `codex mcp login societyer`).

   Confirm the consent screen, the scopes, Disconnect, and that in-camera content never appears.
4. **`docker/frontend.nginx.conf`:** run `nginx -t` (not available on the build machine).
5. **Headers on Cloudflare Pages:** confirm `public/_headers` reaches `/oauth/*`
   (`frame-ancestors 'none'`, `Referrer-Policy: strict-origin`).

## Deploy checklist

- `CONVEX_SITE_URL` and `SITE_URL` set (OAuth turns on automatically; `SOCIETYER_MCP_OAUTH=0` turns it off).
- Claude's egress range (`160.79.104.0/21`) can reach `*.convex.site`.
- Pages serves `public/_headers`. For other hosts, see "Hosting requirements" in `mcp-connector.md`.
- Per workspace: an Owner or Admin opts in to AI connectors only after deciding that member data may go to the
  chosen AI vendors (BC PIPA).
- After deploying, open tabs recover by themselves once the stale-build fix is live. Before that, users need one
  hard reload.

## Deliberately not built

- **Desktop connector bridge** for Codex and Claude Desktop against the desktop app's local data (owner's request).
- **Sign in with ChatGPT** plan usage (OpenAI preview; decision B4).
- **Server-side speech processing on DDC North** (owner's serverless and no-OpenAI-key constraint). Recommended
  path: platform VTT exports or the desktop app; Azure AI Speech batch transcription if one-click is ever needed.
