# Teams meeting transcript connector

Updated November 10, 2026 (America/Vancouver). The November 9 assessment led to
an approved, dedicated connector for DDC North. Tenant configuration, certificate
authentication, chat-roster reads, backend deployment and the DDC frontend
deployment are complete. **A real Graph transcript import has not passed yet:**
discovery currently returns no transcripts, including for a recording visible in
Teams. Browser qualification also awaits the operator’s Microsoft passkey.

## Deployed scope

The React interface runs on Cloudflare Pages (`societyer-ddcnorth`,
`portal.ddcnorth.com`). Server-side Graph calls and records run in the shared
Convex production deployment `industrious-cricket-610`. The First Form frontend
and its workspace have no Teams connector binding. No Azure hosting migration
or additional Cloudflare token is required.

An authorized DDC Owner/Admin can open **Meetings → Import from Teams**, choose
up to 31 days, review transcript-bearing sources, and select **Import as meeting
notes**. This creates an ordinary `notes` meeting and timed working transcript;
it does not prepare or approve formal minutes. Empty calendar events are not
listed. There is no background synchronization, webhook subscription, calendar
access, chat-message read, recording download or Teams bot in this version.

An optional approved chat can supply roster context after explicit confirmation.
On the Transcript tab, the reviewer can choose a recorded speaker and a verified
workspace user, then confirm their link. This creates/reuses a directory profile
without assigning a society membership, directorship, role or attendance.

## Microsoft configuration actually applied

Tenant: FirstForm, `220c85f6-1cb1-4bb2-a63b-55d9fd163b55`.

| Setting | Verified state |
| --- | --- |
| Teams admin → Meetings → Meeting settings → Transcript API access → Microsoft Graph access | On, saved |
| Same page → Configure → Include speaker attribution | On, applied and saved |
| Dedicated app | Societyer DDC North Teams transcript connector |
| Application/client ID | `eaddd759-ec3d-4d2e-8f9e-9a3dcab74571` |
| Application object ID | `f6051162-45b5-44d3-9065-1ffca6eebbae` |
| Supported accounts | Single tenant |
| Granted application permissions | `OnlineMeetingTranscript.Read.All`, `CallTranscripts.Read.All`, `ChatMember.Read.All` |
| Delegated permissions / client secrets / redirect URIs | None |
| Certificate | One uploaded public certificate; private key only needed server-side |
| Certificate validity | November 10, 2026 06:51:28 UTC–May 9, 2027 06:51:28 UTC |
| Certificate SHA-1 thumbprint | `89F46CC28370C86E3312D01A9C4D73E7ACEF57CE` |
| Organizer policy | `Societyer-DDC-Teams-Read`, containing only this app ID |
| Direct policy assignments | Ahmad Jalil, Amir, Fryderyk Paczkowski; all three read back successfully |
| Global organizer policy | Empty app list; no global application grant |

The operator approved app registration, Microsoft Platform Policies, the
180-day certificate and these three broad application permissions. Microsoft’s
online-meeting application access policy covers the scheduled transcript scope;
`CallTranscripts.Read.All` is not listed among its supported permissions. For ad
hoc calls and chat rosters, the configured allowlist limits this connector’s
requests; it does not reduce the underlying tenant-wide consent. These are
separate from Societyer’s sign-in, email and private SharePoint storage apps.

Microsoft documentation:
[transcript switches](https://learn.microsoft.com/en-us/microsoftteams/meeting-transcript-api-access),
[organizer policies](https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy),
[transcript permissions](https://learn.microsoft.com/en-us/graph/api/calltranscript-get?view=graph-rest-1.0),
[roster permission](https://learn.microsoft.com/en-us/graph/api/chat-list-members?view=graph-rest-1.0).

## Convex configuration and routing

Configure these server environment variables on the intended deployment:

- `MICROSOFT_MEETINGS_TENANT_ID`: approved Entra tenant UUID.
- `MICROSOFT_MEETINGS_CLIENT_ID`: dedicated application UUID.
- `MICROSOFT_MEETINGS_PRIVATE_KEY`: PKCS#8 PEM private key. Never place in Pages,
  `VITE_*`, GitHub, a checked-in file, browser storage or logs.
- `MICROSOFT_MEETINGS_CERT_SHA256`: base64url SHA-256 certificate thumbprint for
  the `x5t#S256` client assertion header; this is not the SHA-1 displayed by Entra.
- `MICROSOFT_MEETINGS_BINDINGS`: JSON array of explicit workspace routing rules.

```json
[{
  "societyId": "<DDC workspace ID>",
  "organizerIds": ["<Ahmad object ID>", "<Amir object ID>", "<Fryderyk object ID>"],
  "chats": [{"id": "<approved Teamchat thread ID>", "name": "Teamchat"}]
}]
```

The live binding is only for DDC workspace
`xd7g6bpdvp4p2bz1dr9h3mh3918ggdzf`, its three verified staff object IDs and
Teamchat. Sharing a Microsoft tenant or Convex deployment never selects a
workspace. The current binding supports at most 20 workspaces, 20 organizers and
20 chats per workspace. Active workspace-user lookup is bounded to 500 users.

Certificate authentication uses a five-minute PS256 client assertion. No Graph
access token or private key is returned to the browser. OAuth and Graph responses
have time/size limits and redirects are rejected. Graph pagination must remain
inside the approved organizer’s v1.0 transcript collection; discovery is bounded
to five pages per source kind and 100 staged sources overall.

## Records, authorization and identity

`convex/microsoftMeetingsActions.ts` performs read-only Graph calls after current
workspace authorization. `convex/microsoftMeetings.ts` checks authorization again
in the final transaction, after external reads. Import and reviewed linking
require a human user, meeting read/write, working-transcript/minutes write and
settings write. A Viewer or an automation principal cannot use this connector.
Existing transcript privacy restrictions remain in force.

- `microsoftMeetingCandidates`: metadata only, one-hour expiry, reviewed before
  import. Expired rows are unusable; this version does not schedule their deletion.
- `microsoftMeetingImports`: source kind, organizer/call or meeting ID, transcript
  ID, original VTT SHA-256, importer/time, chat confirmation and resolved roster.
- `microsoftMeetingPeople`: explicit workspace-user → directory-person binding
  with reviewer/time. Speaker assignment also writes an activity audit record.

Metadata identity is verified before fetching VTT content. The exact tenant,
organizer, call/meeting and transcript IDs must agree. Deduplication is scoped by
workspace, source kind, organizer and call/meeting ID. Reimport opens the existing
meeting and preserves corrected text; later transcript segments/revisions for
that same source are not automatically appended. Deleted imports require manual
review instead of silent recreation. Native offline meeting projections are
invalidated through the existing mutation wrapper.

Graph chat members are resolved using `tenantId` + `userId` → existing Microsoft
auth-account binding → active user in this workspace. Display names and emails
never grant account access. External/guest members remain unresolved. Chat
membership is not attendance; a VTT speaker label is not proof of Entra identity.
The reviewer makes the final speaker assignment. The source label is retained.
[Microsoft identity fields](https://learn.microsoft.com/en-us/graph/api/resources/aaduserconversationmember?view=graph-rest-1.0).

Workspace transfers skip staged candidates and deployment-specific person
bindings. Imported-meeting provenance is retained as history, not Graph authority.
Retained originals continue to use the existing private SharePoint architecture.
Access to that site does not authorize Ahmad’s personal OneDrive recordings.

## Live test evidence and remaining qualification

Passed:

- Saved both Teams switches and verified granted app permissions/public certificate.
- Real application certificate OAuth authentication.
- Real Teamchat roster read: three Entra object IDs/tenant IDs matched the existing
  Microsoft account bindings and active DDC workspace users.
- Organizer policy creation and independent read-back of all three direct
  assignments; inherited Global policy remains empty.
- Backend deploy to `industrious-cricket-610` and DDC Pages deployment
  `https://d8fa9e9a.societyer-ddcnorth.pages.dev`.
- Application and Convex typechecks, DDC production build, targeted lint,
  `test:teams-meetings`, existing meeting-kind/timed-transcript/speaker tests,
  workspace-transfer policy checks and portable-manifest checks.

Still open:

- Live date-bounded scheduled/ad hoc discovery returns HTTP 200 with zero
  transcripts for the three organizers. The visible November 9 Teamchat recap
  (3:00–4:16 PM Vancouver time) has a transcript and points to an Amir-organized
  group call, but has not been returned by Graph. Empty results do not establish
  that the tenant has no transcripts. A no-date query also returned empty pages
  with continuation links; a five-page probe found no transcript.
- Direct enumeration of the known ad hoc call’s `transcripts` relationship
  returned HTTP 501 NotImplemented. Do not turn this unsupported probe into a
  production fallback or synthesize opaque transcript IDs.
- Organizer policies may take up to 30 minutes to propagate. Recheck the narrow
  date range after propagation; if still empty, qualify a newly transcribed call
  and raise a Microsoft support case with sanitized request IDs. No claim is made
  that policy propagation caused the existing empty results.
- Portal login awaits the operator’s passkey; a real browser import and real
  speaker-link review have not yet passed. No real transcript, attendance or
  directory profile has been created by this connector during qualification.
- Scheduled-meeting content, guests/ambiguous names, consent revocation and blocked
  attribution still need live qualification. Automated fixtures cover identity
  mismatch, denied access, workspace isolation, oversized responses, duplicate
  preservation, disabled users and explicit links; they do not replace those tests.

The live v1.0 ad hoc discovery endpoint accepted this form:

```text
/users/{organizerId}/adhocCalls/getAllTranscripts(userId='{organizerId}',startDateTime=...,endDateTime=...)
```

The `userId` function parameter is an Edm.String and needs quotes. The docs’ root
URL example returned resource-not-found, and an unquoted UUID produced a type
conversion error. Use the documented user-bound route with the verified string
parameter. [Ad hoc discovery reference](https://learn.microsoft.com/en-us/graph/api/adhoccall-getalltranscripts?view=graph-rest-1.0).

## Operations, renewal and rollback

Deploy Convex before the frontend. Use the existing production selector; never
run this setup against the retired First Form deployment `elated-bee-460`.
`npm run test:teams-meetings` is part of CI and requires no tenant credentials.
Microsoft tenant administration uses the official MicrosoftTeams module; device
code authentication was denied by Microsoft, so the successful management login
used interactive `Connect-MicrosoftTeams -DisableWAM` after the normal WAM flow
failed on macOS. No Conditional Access or other tenant security policy changed.

Before May 9, 2027 UTC, generate a replacement certificate, add its public part to
this same app, update the two private-key/thumbprint Convex values securely, test
certificate OAuth and a scoped discovery/import, then remove the superseded
certificate after verification. Never print the private key or access token.
Keep no plaintext temporary private-key file after qualification completes.
No automatic certificate-renewal reminder or background renewal is configured.

To disable just this workspace, remove its entry from
`MICROSOFT_MEETINGS_BINDINGS`. Existing imported notes remain governed by normal
workspace access. To retire the connector, revoke its three Graph grants and
certificate, remove the three direct application-policy assignments and dedicated
policy, and remove its Convex credential variables after checking dependencies.
Turning off the tenant-wide switches would affect other consented apps too; do
not use them as a workspace-specific rollback. Restoring old frontend code alone
does not revoke app credentials.

For an urgent meeting while Graph qualification remains open, the existing
manual path is available: download VTT from Teams → create Meeting notes in DDC
→ Transcript → Import transcript → review speakers. That is a manual import,
not a successful Graph connector test.
