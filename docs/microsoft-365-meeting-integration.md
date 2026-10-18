# Microsoft 365 meeting integration references

Researched October 17, 2026. These are design references; Societyer has not been
granted calendar or Teams transcript permissions by this research.

| Project | Status checked | Useful pattern |
| --- | --- | --- |
| [Microsoft Meeting Capture](https://github.com/microsoftgraph/meetings-capture-sample) | Archived April 2023 | Meeting preparation, notes and follow-up tasks across Teams, Outlook and SharePoint. Reuse the workflow, not its old deployment or broad permission bundle. |
| [Teams transcript/recording tab](https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsJS/tab-meeting-transcript-recording/nodejs) | In the active sample collection, repository pushed October 13, 2026 | Calendar event → join URL → Teams meeting → transcripts/recordings, with notifications. Its beta calls, module-global state and URL token handling need replacement. |
| [Teams SDK meeting bot](https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsSDK/bot-meetings) | Current SDK sample | Meeting lifecycle, participants, transcript availability and Adaptive Cards; an optional Teams entry point to a separately hosted app. |
| [Microsoft Graph React SPA](https://github.com/microsoftgraph/msgraph-sample-reactspa) | Unarchived; code last pushed April 2025 | React calendar integration using delegated Graph access. Start with read-only scopes when importing, rather than requesting calendar writes immediately. |
| [Technical Delivery Architect](https://github.com/microsoft/technical-delivery-architect) | Unarchived; pushed August 2026 | Meeting timelines with transcripts and action items. Electron/Work IQ architecture is a UX reference, not a direct fit for Pages and Convex. |

## A fit for Societyer

Keep the React app on Pages, records and authorization in Convex, and file bytes
in the private SharePoint site. Graph calls and webhook handlers can run in
serverless Convex actions or Workers. No container or Azure migration is implied.

An integration record should bind the Societyer workspace/meeting to the tenant,
organizer, calendar event ID, Teams online meeting ID/join URL, transcript IDs,
document versions and approved minutes. Resolve these through current workspace
permissions; matching an email or accepting an arbitrary external ID grants no
access. Keep credentials on the server and isolate per-user/tenant state.

Build in this order: import/link calendar events and existing documents; connect
Teams meeting references; import available transcripts; then add change
notifications and an optional Teams tab. Keep AI generation separate from the
approved minutes record.

## Current constraints

- SharePoint `Sites.Selected` does not authorize calendars or Teams transcripts.
  [Transcript permissions](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts?view=graph-rest-1.0)
  include delegated/application `OnlineMeetingTranscript.Read.All` and meeting-specific
  application `OnlineMeetingTranscript.Read.Chat` through resource-specific consent
  for supported scheduled private chat meetings. Wider app access uses organizer
  [application access policies](https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy).
- Schedule a [calendar-backed Teams event](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0)
  if Societyer later creates meetings. Transcript listing does not support
  standalone online meetings without an associated calendar event.
- [Transcript notifications](https://learn.microsoft.com/en-us/graph/teams-changenotifications-callrecording-and-calltranscript)
  need subscriptions, renewal and lifecycle handling. Set up the relevant
  subscription before transcription starts. A notification is an input to an
  authenticated, idempotent import, not permission to bypass workspace checks.
- Microsoft's [transcript/recording guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/meeting-transcripts/overview-transcripts)
  says those APIs stopped being metered August 25, 2025. Tenant licensing,
  transcription policies and storage still matter. Copilot meeting insights are
  a different capability with separate requirements.
- [Microsoft Graph Toolkit](https://learn.microsoft.com/en-us/graph/toolkit/get-started/overview)
  retired fully August 28, 2026. Use current Graph REST/SDK APIs with ordinary React
  components. Prefer current TeamsJS/Teams SDK examples over archived Bot Framework
  samples.
