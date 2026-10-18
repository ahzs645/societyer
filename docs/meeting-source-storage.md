# Meeting source files and transcription

Implemented October 17, 2026 for the DDC North cloud profile. The existing
document-version broker retains its 8 MiB limit; this is a separate meeting-source
pipeline with a **500,000,000-byte (500 MB)** limit per original file.

## User flow

Open a meeting's Overview or Minutes tab and use **Meeting source files**.
Choose TXT, VTT, SRT, Whisper JSON/ZIP, or an audio/video recording. Uploading
never drafts or overwrites minutes automatically. After import, read the transcript
and choose **Use for minutes** to replace the working transcript. Then use the
existing transcript card to draft minutes.

The uploader can pause, close the browser, and choose the same complete file to
resume. The browser fingerprints every 5 MiB chunk before starting, with bounded
memory. A Microsoft upload session has a finite expiry: cancel and start again if
it expires. After an interrupted in-flight chunk, wait 90 seconds before resuming.
The server reconciles Microsoft's acknowledged offset against the digest staged
before sending that chunk; it never accepts an arbitrary client progress claim.

Downloads are authenticated requests for successive 5 MiB ranges. Each range is
hashed before delivery. Chrome's file picker writes the ranges straight to disk;
browsers without that API assemble Blob parts for their normal download flow.

## Storage and access

- The original file lives in the existing private SharePoint Documents library.
  No `_storage` blobs are created in Convex. Convex stores metadata, upload state,
  chunk digests and imported transcript text.
- Every operation resolves the current authenticated workspace membership and
  requires `meetings:write`. Raw recordings and working source transcripts are
  therefore restricted to meeting editors, rather than all members who can read
  a meeting. Only the uploader can write into a transfer or start speech processing.
- A dedicated Cloudflare Worker handles bounded byte transfers. Its only secret
  is a random broker key shared with Convex. Microsoft app credentials remain in
  Convex; Microsoft transfer URLs and Graph tokens never reach the browser.
- The runtime app still has `Sites.Selected` and write access only to the approved
  storage site. This feature adds no Microsoft permission or human site membership.
- Files use allocated UUID names and conflict-fail creation. Upload progress is
  serialized by atomic leases. Each uploaded chunk is read back and compared with
  its server-computed SHA-256 before the original becomes available.
- Digests are a **chunk manifest**, not a whole-file SHA-256. The browser's resume
  fingerprint is separately a SHA-256 of the ordered chunk manifest and file metadata.
- Current source size, item ID, drive, eTag and version ID are recorded on commit.
  SharePoint administrators still control this library; ordinary site users are
  not granted direct access. This is access isolation, not immutable retention.

### Microsoft behavior discovered during qualification

Microsoft's version-content endpoint **rejects the current version with HTTP 400**.
The live probe returned `invalidRequest` / `You cannot get the content of the current
version.` This is documented in the [version download API](https://learn.microsoft.com/en-us/graph/api/driveitemversion-get-contents?view=graph-rest-1.0).

The broker now checks current metadata. If its eTag matches the committed source,
it requests normal item content; otherwise it requests the recorded historical
version. Every returned range still has to match the committed digest. This catches
an edit between checking metadata and retrieving content as well as a bad storage
response. Deleted or unavailable versions fail closed.

The live corrected probe passed a 5,242,880-byte upload, version lookup, HTTP 206
range download and SHA-256 check against `1stform.sharepoint.com`. Retained audit
item: `01FWZIBCCMG52F5JU5LREIWL6KSPK267PQ`, version `1.0`, file
`societyer-connection-probe-4dd53280-2e12-4e03-99b0-5cd1772c6a86.bin`, digest
`b1ff35b5c369875bcee4fa3dbe405bba756e3338b83706d7bc612a7d6ac746e5`.
Earlier failed qualification attempts also retained synthetic 5 MiB files; no
existing tenant files were overwritten or deleted.

## Text extraction boundaries

TXT, VTT and SRT are decoded incrementally into chunks of at most 48 KB of UTF-8.
Large text can be read in pages without fitting into one Convex document. Caption
imports preserve speaker labels and text; originals preserve timing information.
Text extracted in the browser is editable user input, not a server attestation of
semantic equivalence with the original.

Whisper JSON supports `text` and `segments[].text`. JSON extraction has a 16 MiB
parser limit. Larger JSON can still be attached as an original; export TXT/VTT
for paged extraction. ZIP extraction reads only the directory and one transcript
entry, preferring TXT, VTT, SRT, then JSON. It checks paths, encryption, entry count
(1,000), directory size (2 MiB), expanded size (1 GB), declared transcript length
and CRC. Nested archives are not unpacked. It does not inflate an embedded recording
just to import an accompanying transcript. ZIP archives with multiple transcripts
currently select the first preferred entry; upload other transcripts separately.

Only completed text up to 600 KB can replace the existing working transcript used
by the minutes editor. Larger text remains paged; paste a relevant excerpt for AI
drafting. Importing does not silently truncate a long transcript or mutate adopted
minutes. Partial extraction cannot be used as a completed transcript.

## Serverless deployment and deferred speech processing

The deployed application uses Cloudflare Pages, Convex functions, a Cloudflare
transfer Worker, and private SharePoint storage. Uploading recordings up to 500 MB
and importing existing text/Whisper exports require no Docker container or speech
provider. A Worker runs serverless request handlers; it is distinct from a
Cloudflare Container.

**Operator correction, October 17, 2026:** the owner clarified that the deployment
should stay serverless and asked to hold off on the OpenAI key. An optional ffmpeg
processor image had been built locally and published to Cloudflare Containers to
convert large audio/video into smaller valid audio segments for Whisper. That
processor was unnecessary for the upload feature. Its unused Cloudflare container
application, speech Worker, registry image and shared production speech credential
were removed. Container-specific source, deployment configuration and SDK dependency
were also removed. No live OpenAI transcription was performed.

Convex's optional speech integration remains disabled: both
`MEETING_TRANSCRIPTION_ENDPOINT` and `MEETING_TRANSCRIPTION_KEY` are unset.
The UI disables Transcribe until a service is configured. Recordings remain
attached in SharePoint; existing transcript imports continue independently.
There is no canned/demo transcript fallback for uploaded recordings.

If automatic transcription is requested later, choose a managed asynchronous
service compatible with the large recording workflow before configuring the
endpoint. OpenAI's [speech-to-text API](https://developers.openai.com/api/docs/guides/speech-to-text)
has a 25 MB file limit: a 500 MB original cannot simply be forwarded as one request.
The upload size limit and the provider's processing limit are separate requirements.
The existing integration checks membership again, imports results in bounded pages,
and requires review before using results for minutes.

For reference, the selected [Whisper price](https://developers.openai.com/api/docs/models/whisper-1)
was $0.006 USD/minute (about $0.36 per audio hour, before any processing charges or
tax), checked October 17, 2026. File size does not determine audio duration. The
provider remains deferred by the owner.

Workers Paid was activated during the earlier processor setup and remains the
account's current plan, with a $5 USD/month base. Removing a container does not
cancel that account-wide subscription. Review the transfer Worker's measured CPU
requirements and other account workloads before considering a downgrade; there
is no running Societyer container. The signed-in Cloudflare Chrome profile is
**Ahmad**. CLI authorization was renewed for the same selected account.

## Deployment and verification

Transfer Worker: `societyer-ddcnorth-meeting-transfer`, account
`479e77f49d4ac5d7498529ee360f194b`, origin
`https://societyer-ddcnorth-meeting-transfer.ahzs645.workers.dev`.
Its `MEETING_SOURCE_BROKER_KEY` is set both in Cloudflare secrets and production
Convex. The public DDC North Vite profile has `VITE_MEETING_SOURCE_BROKER_URL`;
other profiles leave it unset and retain their existing behavior.

```sh
npm run test:meeting-sources
npm run test:sharepoint-connection
npm run test:sharepoint-adapter
npx convex run --prod meetingSourceQualification:verifyConnection '{}'
npm run deploy:meeting-transfer:ddcnorth
npx convex deploy --typecheck enable
npm run deploy:ddcnorth
```

`check-meeting-sources.ts` runs the real Convex handlers and transfer Worker against
mocked Graph and processor endpoints. It transfers, verifies and downloads a
synthetic 500,000,000-byte file using bodies no larger than 5 MiB. It covers lost
acknowledgement recovery, bounded Microsoft ranges, leases, corruption, direct edits,
replays, cancellation, revoked users, foreign workspaces, denied roles, origin
pinning, hidden Microsoft URLs, transcript parsing, paged storage and background
speech submission/polling. This is not an authenticated live 500 MB browser test.

Observed qualification on October 17: the 500 MB Worker/Convex test, live 5 MiB
Microsoft version/range/hash probe, production build,
Convex production push and transfer Worker deploy all passed. The retired processor
was tested locally with synthetic audio and mocked provider responses; it was not
qualified as a live transcription service. Speech processing remains disabled;
no live OpenAI key is configured. The transfer Worker deployment version is
`02921878-6c9b-47f0-89cc-5e257bb319ab`.
The read-only resource qualification also passed from the actual production
Convex runtime, independently of the Node operator probe. The current Pages
deployment is `f0a9964e.societyer-ddcnorth.pages.dev`.

### Authenticated live qualification, October 17, 2026

Microsoft 365 delivery and real email verification were completed for the
owner-authorized test account. The live browser created **DDC North — live test
workspace** and **Live upload verification — synthetic test**, then attached
`live-transcript.txt` and displayed its extracted text. Ordinary authenticated
production API calls subsequently qualified TXT, VTT, SRT, Whisper JSON, and a
Whisper ZIP containing a transcript plus a synthetic recording entry. Each
original was downloaded and compared with its uploaded bytes; extracted text was
read back and applied to the working minutes. The initial TXT was restored as
the meeting's working transcript afterwards. No adopted minutes were modified.

This first end-user run exposed a Cloudflare runtime incompatibility that Node
mocking had missed: the deployed `fetch()` rejected `redirect: "error"` before
issuing the authenticated control request. The Worker now uses manual redirect
handling, explicitly rejects 3xx responses, and checks the control response type.
It never forwards the user's JWT or broker key to a redirect destination. The
corrected deployed Worker version is `9b10da02-bd82-4af3-8c6e-8aebb88c555e`.
Regression coverage emulates the Workers restriction and rejects a 307 control
redirect. The full meeting-source regression suite passed after that fix.

The browser uploaded the TXT original; format variations used the same verified
Owner's production APIs. A later Mac lock prevented additional browser actions.
Do not describe these checks as a complete 500 MB browser-file-picker test.

The separate authenticated production API test then completed a full
**500,000,000-byte synthetic WAV recording** upload, resume from the first
acknowledged 5 MiB chunk, server readback verification, and complete download.
The downloaded file's SHA-256 matched the generated original:
`d8dc6ff7a5bcd26492db4c566f6ac4daebf075fc5d55dee3024a206965306ac2`.
Retained source: `h58142kerdbvscxyfmafs5t2ss8ggdyj`, meeting:
`kx7vqhppzg6x473sv53mhb35xx8ggxg2`. The test also confirmed HTTP 401 without
authentication and HTTP 400 for a 500,000,001-byte declaration. Total sequential
upload/readback/download duration was 1,037 seconds on the test connection.
This is a test-client whole-file checksum; the production source metadata still
uses the chunk manifest described above. The original remains in private
SharePoint storage for review. Automatic audio/video transcription is disabled.

Free Workers have a [10 ms CPU budget](https://developers.cloudflare.com/workers/platform/limits/);
this account now has Workers Paid. Chunking keeps memory and request bodies
bounded but does not itself prove CPU capacity on a particular deployment. Measure live transfer CPU once
authenticated browser qualification is available; do not equate mocked tests with
Cloudflare load qualification. The DDC North Microsoft 365 sender is now
configured and verified-domain signup is open.
