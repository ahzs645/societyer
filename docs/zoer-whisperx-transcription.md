# Meeting transcription with Zoer and WhisperX

## Architecture

Societyer owns meeting uploads, permissions, queue state and transcript results. Original recordings remain in the existing private SharePoint drive. A dedicated Zoer-server Python process runs WhisperX; neither Cloudflare Containers nor an OpenAI API key is required.

1. Upload and verify a recording under a meeting’s **Sources** tab (up to 500 MiB).
2. In **Transcript → WhisperX transcription**, choose that recording and queue it.
3. The worker claims one recording per workspace, receiving a two-minute lease. It renews the lease while downloading and processing. Its credential cannot enumerate SharePoint or retrieve unqueued files.
4. The existing Cloudflare meeting-transfer Worker returns verified 5 MiB ranges of the pinned Microsoft file version. Microsoft application credentials and signed download URLs never reach Zoer, the browser, or the ML process.
5. WhisperX transcribes and aligns the recording on the Zoer server. Audio is decoded in ten-minute windows with two seconds of context; words belong to exactly one window. Timings use the recording’s global clock.
6. Results are uploaded in pages of at most 50 segments and 192 KB. Partial attempts cannot be read or activated. Word timings remain attached to the segments.
7. A meeting editor reviews the candidate and explicitly selects **Use transcript**. Replacing a transcript checks its revision. This never rewrites draft or approved minutes.

The reused transcript interface provides playback, speaker assignment/combining, segment editing, minutes citations and in-camera ranges. Paging and whole-transcript search avoid loading the entire transcript on entry. Speaker counts and timeline segments describe the displayed page. Opening an attached recording in the existing browser player still downloads that recording; server transcription itself does not require the browser to download it.

## Pair a workspace

Prerequisites: existing Convex-hosted Societyer deployment, private SharePoint meeting storage, and the Cloudflare meeting-transfer Worker. This is an online capability; the local/offline runtime does not expose this connection.

1. An administrator opens any meeting’s **Transcript → Processor settings**.
2. Select the defaults, explicitly allow the processor to read queued recordings (including private sections), and create a pairing key.
3. Save settings. Copy the key while the dialog remains open; Societyer stores only its SHA-256 hash. Closing the dialog hides the only copy shown there.
4. In Zoer, enable **Extensions → Meeting transcription**. Select **Connect**, enter the workspace name, broker endpoint shown by Societyer, and pairing key. Confirm processing permission. Zoer stores the key in its encrypted host-only secret store.
5. Configure the dedicated worker with the same endpoint/key as described in Zoer’s `plugins/meeting-transcription/README.md`. Its private config is separate from Zoer’s encrypted control connection. A green/connected heartbeat confirms polling; it does not prove the ML models can run, so do the synthetic test below.
6. Upload a synthetic spoken WAV, queue it, wait for **ready**, review, and apply. Confirm timestamps, edits, search and reload.

Use a separate connection/key for each Societyer workspace. No new Entra application or SharePoint permission grant is needed for this bridge.

## Defaults and limits

- WhisperX 3.8.6, CPU, `small`, automatic language, batch size 4, automatic speaker identification off.
- The provisioned CPU worker advertises `tiny`, `base`, `small`. Larger models need a suitably sized GPU worker. The code supports CUDA, but GPU operation has not been verified on this CPU server.
- Recording: 500 MiB / 24 hours. Queue: 20 waiting recordings per workspace, one running. Transcript: 200,000 segments, 64 speaker labels, 50 segments/192 KB per page.
- Automatic speaker identification needs a Hugging Face read token and acceptance of the model terms by the operator. It is off without that setup; manual speaker labels work. This worker limits diarization to one hour to bound waveform memory. CPU transcription of longer recordings can be slow.
- Settings changes affect new submissions. Queued jobs retain their submitted settings.
- Complete transcript export (text, timed Whisper JSON, VTT or SRT) is bounded at 64 MiB. Existing minutes drafting loads every page on explicit request and refuses input above 600 KB; it never drafts from only the visible page or silently truncates. The existing AI provider/model still needs separate configuration.
- The original legacy speech endpoint and on-device transcription remain available when independently configured.

## Access, revocation and recovery

Only signed-in workspace minute-takers can read queue/results/pages. Enqueuing, editing, applying or cancelling also requires meeting edit permission. Machine/connector identities cannot call the raw paged transcript read endpoints. The processor’s creating administrator and each submitting editor are rechecked while the worker operates.

**Cancel** revokes the lease immediately. The worker stops its inference child at the next heartbeat check and removes job scratch files. **Disable processor** or **rotate pairing key** in Societyer revokes future worker requests, including completion. Update both Zoer’s saved connection and the worker’s private config after rotating. Disconnecting or disabling the Zoer UI plugin alone does not revoke an independently running daemon; use Societyer’s setting to do that.

A crash or lost lease lets the next claim start a new attempt. Stale attempts cannot complete or become active; replayed pages must match. After three interrupted attempts, a human retries with a new job. Transport errors use bounded retry/backoff. Failed/cancelled attempts remain audit metadata; their inaccessible partial pages currently have no automatic retention sweeper. Include these tables in workspace backup/retention administration.

Segment edits use page revision checks; editing text removes only that segment’s now-invalid word timings. Speaker names apply across all pages. Approved/adopted minutes remain frozen by their existing rules. Paged transcripts are not materialized into offline meeting packages or general connector text exports; use the authorized transcript view/export.

## Update and deploy

From a clean Societyer checkout with the existing production credentials configured:

```sh
npm run test:whisperx
npm run build:ddcnorth
npx convex deploy --yes --env-file /absolute/private/production.env
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT npx wrangler deploy --config wrangler.meeting-transfer.jsonc
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT npx wrangler pages deploy dist --project-name societyer-ddcnorth --branch main
```

Deploy the Convex schema/functions and transfer Worker before exposing the new frontend. The transfer Worker retains its existing private `MEETING_SOURCE_BROKER_KEY`; never place a pairing key or Microsoft secret into public Vite variables. Zoer’s compiled host workspace/routes require a Zoer frontend/backend rollout; install or upgrade its plugin package afterward. Updating the Python processor additionally requires copying the reviewed worker and restarting its systemd service; a web deployment does not update that external process.

## Verification

`npm run test:whisperx` exercises real Convex handlers with synthetic data and the transfer Worker: tenant/role denial, 500 MiB manifest, lease exclusion/expiry/recovery, cancelled and revoked access, replay safety, >700 KB paged transcript, search, editing conflicts and frozen minutes. `npm run test:meeting-sources` separately covers a synthetic 500 MiB upload/readback through the existing mocked Graph transport. These tests do not establish ML accuracy on real meetings.

The dated rollout receipt records actual server speech tests, live upload/queue checks and deployment revisions. WhisperX’s [official documentation](https://github.com/m-bain/whisperX/tree/v3.8.6) describes CPU inference and optional Hugging Face diarization setup. No model terms are accepted automatically.
