# On-device AI

Societyer can use a model server on your own computer for AI features in the
**browser-local workspace** and the **desktop app**. With a local server such as
Ollama, LM Studio or llama.cpp, meeting transcripts and chat messages never leave
the computer.

On-device AI covers:

- **Minutes drafting** from a transcript (paste, saved transcript, or the
  Transcript tab), with progress ("Drafting part 2 of 4…") and **Cancel**.
- **The assistant chat**. With **record lookups** on, the model can look up the
  meetings, minutes, transcripts, documents, tasks, deadlines and commitments you
  can see, and (if you allow it) propose new tasks for you to approve. Without
  them it works from what you paste or attach. **Stop** ends a reply early. See
  [Assistant tools](#assistant-tools).
- **AI intake** field extraction and **Ask AI** table filters, through the same
  settings.
- **Transcribe on this device**: a recording opened in the Transcript tab is sent
  to a speech-to-text server on this computer (faster-whisper / speaches,
  whisper.cpp, or a WhisperX server for speaker labels). See
  [Speech-to-text](#speech-to-text).

## What runs where

| Runtime | Minutes drafts and chat use | Where the request is made | API key kept in |
| --- | --- | --- | --- |
| Server workspace (hosted or self-hosted) | The workspace AI provider (AI setup), then the deployment's environment key | The Convex server | The workspace secret vault |
| Browser-local workspace | On-device AI settings | This browser page (direct `fetch`) | This tab only (`sessionStorage`) |
| Desktop app | On-device AI settings | The desktop app's main process | The operating system keychain (Electron `safeStorage`) |

Speech-to-text follows the same rows, with its own address and key.
| Public demo (`/demo`) | Nothing: the demo never contacts a network service | | |

On-device settings belong to this computer. They are not part of the workspace,
are never written to `aiProviderSettings`, are not synced, and are not included in
a workspace export.

## Set up

Open **Settings → On-device AI** (Workspace tab), turn on **Use an on-device
model**, pick the server, check the address, then **Test connection**. The test
saves the settings, lists the server's models and shows the round-trip time. If no
model is chosen, the first one listed is used; you can type any model name.

| Server | Address | Notes |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | Models are also listed from `/api/tags`. |
| LM Studio | `http://127.0.0.1:1234/v1` | Start the server on the Developer tab. |
| llama.cpp server | `http://127.0.0.1:8080/v1` | `llama-server -m model.gguf --port 8080 -c 8192` |
| Other OpenAI-compatible | Type it | vLLM, LocalAI, a LAN box, and so on. |
| OpenAI / OpenRouter | Fixed | Hosted services: an API key is required and data leaves the computer. |

An API key is optional for a server on this computer or your local network. If you
set one it is sent as `Authorization: Bearer …`. A key is bound to the server it was
entered for: changing the address to another server forgets it.

Addresses on this computer or the local network may use `http://`. Anything else
must use `https://`.

### Browser-local workspace: allow this page (CORS)

In a browser, the page calls the model server directly, so the server must allow
the page's origin. The desktop app does not need this.

- **Ollama**: set `OLLAMA_ORIGINS` and restart Ollama.
  - macOS app: `launchctl setenv OLLAMA_ORIGINS "http://127.0.0.1:5173"` then quit
    and reopen Ollama. Use your Societyer address, or `*` to allow any page.
  - Command line: `OLLAMA_ORIGINS="http://127.0.0.1:5173" ollama serve`.
  - Linux service: add `Environment="OLLAMA_ORIGINS=http://127.0.0.1:5173"` with
    `systemctl edit ollama`, then restart it.
- **LM Studio**: Developer tab → server settings → turn on **Enable CORS**.
- **llama.cpp**: `llama-server` answers browser requests by default. If it sits
  behind a reverse proxy, allow this origin there.

When the test reports "Could not reach …", the server is either not running or not
allowing this page; the message repeats these steps.

## Privacy

Requests go only to the address in Settings. With a local server, meeting data
stays on this computer. With OpenAI or OpenRouter selected, transcripts and
messages are sent to that service.

- Minutes drafting sends the meeting title, type and the transcript text (with
  assigned speaker names).
- The assistant sends the conversation (last 16 turns) and a short system prompt
  with the organization name, the current page and today's date. With record
  lookups off it sends no workspace records. With them on, it also sends the
  results of the lookups the model asks for in that reply (see
  [Assistant tools](#assistant-tools)); the lookups themselves run on this device.
- Intake masks phone numbers, emails, SIN, account and card numbers and postal
  codes before every call, and never sends restricted files.
- Ask AI sends the table's column schema and the request, never row data.

Drafts and chat turns are saved in the local workspace like any other record.

## Assistant tools

**Settings → On-device AI**, under the assistant toggle:

- **Let the assistant look up workspace records** (off by default). The model is
  offered the shared agent tools ([agent-tools.md](agent-tools.md)) that your
  role may use, read-only: `get_governance_snapshot`, `list_meetings`,
  `get_meeting`, `get_transcript`, `search_documents`, `get_document`,
  `list_tasks`, `list_deadlines`, `list_commitments`.
- **Allow the assistant to propose changes** (off by default, needs lookups).
  Adds `create_governance_tasks` for roles with `tasks:write`. A change is never
  made by the model: the chat shows an approval card with what it will do
  ("Create 1 task: “…” due 2026-10-31") and the exact arguments. **Approve** runs
  it on this device as you; **Dismiss** runs nothing. Either way a short note is
  saved in the chat ("Approved: Created 1 task.") and the card goes away.

Under each reply the chat shows what was looked up, for example
"Looked up: meetings (12) · transcript 0:00–5:00". A chip opens the arguments and
a shortened result. Failed or refused calls show as warnings. The records are
saved with the reply. The suggested prompts change to questions the tools can
answer ("What did we decide about the budget at the last board meeting?",
"List overdue tasks.").

**How a reply works.** The page sends the question with the tools in OpenAI
function-calling format. When the model calls a tool, the page runs it on the
local data, as you, and sends the result back; this repeats until the model
answers. At most 6 model requests per reply (the last one offers no tools, so the
model has to answer), at most 4 calls per request, 12,000 characters per result
and 40,000 for the whole reply; a longer result is cut and says so. **Stop** works
at any point, including between lookups. A reply stopped before any answer text
saves nothing.

**Models.** Tool calling needs a model and server that support it. Good choices:
Qwen 2.5 or Qwen 3 (7B and up), Llama 3.1 / 3.2 (8B, 3B), Mistral Small 3 and
Mistral Nemo. Ollama supports tools for these models; LM Studio does for models
marked with tool use; llama.cpp needs `llama-server --jinja`. Smaller models (1–3B)
call tools less reliably and are better at short lookups. **Test connection** (with
lookups on) also sends one short tool test and says whether the model called the
tool. If the server refuses tools (Ollama: "does not support tools"), the reply
is retried without tools and the model is remembered as not supporting them on
this device; the assistant then shows the paste-and-attach suggestions and says
why. Choosing another model or testing again clears that.

The page reads tool calls defensively: arguments as a JSON string, an object, or
a string JSON-encoded twice; calls written in the reply text (`<tool_call>{…}</tool_call>`,
Mistral's `[TOOL_CALLS]`, or a bare `{"name": …, "arguments": …}`). Arguments are
checked against the tool's schema; a call that fails, or names a tool that wasn't
offered, gets an error result the model can correct, never an exception.

**Privacy.**

- Tools run in this page (browser-local workspace) or the desktop app's window,
  against the local data, as the signed-in person. Each tool calls portable
  functions that apply their own checks: role permissions, document access,
  in-camera redaction of minutes and motions, and the transcript rule (a
  transcript needs `minutes:read`, and is withheld whole from readers without
  in-camera access when the minutes record an in-camera session). The model sees
  only what you could open yourself.
- Nothing leaves the device except the model request, to the address in
  Settings. With a local server, records stay on this computer. With OpenAI or
  OpenRouter selected, what the tools return is sent to that service.
- Text written by workspace users (minutes, transcript lines, document text,
  task descriptions) reaches the model wrapped as `{ "untrusted": "…" }`, and the
  system prompt says that text inside these wrappers is data, never instructions.

## Long transcripts

Small local models have small context windows. When a transcript is longer than
**Transcript part size** (default 8,000 characters, about 2,000 tokens) it is split
on line breaks, each part is drafted separately, and the parts are merged:
motions, decisions and action items keep their spoken order, attendee names are
de-duplicated, the opening time and chair come from the first part, and the
adjournment and next meeting from the last. Raise the size for models with a large
context window; one request is faster and sees the whole meeting.

## Speech-to-text

**Settings → On-device AI → Speech-to-text** has its own server, address, model and
optional key, separate from the chat model (a key is bound to its own server, like
the chat key). **Test speech-to-text** saves, then sends one second of silence
through the same path as a real recording and checks the reply is readable.

| Server kind | Address | Request |
| --- | --- | --- |
| OpenAI-compatible `/v1/audio/transcriptions` (faster-whisper / speaches / LM Studio if supported) | `http://127.0.0.1:8000/v1` | multipart `file`, `model`, `response_format=verbose_json`, `timestamp_granularities[]=word` and `segment` |
| whisper.cpp server (`/inference`) | `http://127.0.0.1:8081` (the server root) | multipart `file`, `response_format=verbose_json`, `temperature`, `temperature_inc` |
| WhisperX-style JSON (speakers) | `http://127.0.0.1:8000/v1` | as OpenAI-compatible, plus `diarize=true` |

- **speaches** (formerly faster-whisper-server): run its CPU or CUDA container on
  port 8000 and download a model such as `Systran/faster-whisper-small` (see the
  speaches docs). Put the model id in **Model**; most OpenAI-compatible servers
  need one. Lines get word timings; there are no speaker labels.
- **whisper.cpp**: `whisper-server -m models/ggml-base.en.bin --host 127.0.0.1 --port 8081 --convert`.
  `--convert` makes the server convert any audio or video with ffmpeg (which must
  be installed for the server); without it only 16-bit WAV is accepted. Port 8081
  keeps it clear of llama.cpp's usual 8080. The model is the one the server was
  started with, so **Model** is not used.
- **WhisperX** (speaker labels): a WhisperX-based server that accepts the OpenAI
  multipart request and answers with WhisperX JSON (`segments[].speaker`,
  `words[].speaker`). Diarization usually needs a Hugging Face token for pyannote
  on that server. A line whose words change speaker is split at the change.

In the Transcript tab, with a recording open (**Open recording** reads it from this
device) and speech-to-text set up, **Transcribe on this device** appears for meeting
editors. The recording line shows its size and duration. While it runs, the tab
shows the step ("Handing the recording to the desktop app… 40%", "Preparing the
audio with ffmpeg…", "Transcribing part 2 of 6…"), the elapsed time and **Cancel**.
When it finishes it asks before replacing an existing transcript, saves through
`transcripts:importTimed` (provider `local-whisper`) and opens **Review speakers**
when there are speaker labels to name, as after an import. Cancel, a failure or
declining the replacement changes nothing. Without speech-to-text set up, the tab
links to Settings instead. The demo never transcribes.

**How the recording travels.**

- *Browser-local workspace*: one multipart `fetch` from this page, straight from
  the opened `File` (the browser reads it from disk as it sends; it is not copied
  into memory first). The server must allow this page's origin (CORS):
  whisper.cpp's server does by default; for speaches, allow the page's address in
  its CORS setting. The file is sent as it is.
- *Desktop app*: the renderer copies the file to the main process in ordered 8 MB
  pieces (`localAiTranscriptionUpload`), so no IPC message is large and the main
  process only ever receives bytes the person chose. The main process writes them
  to a private `societyer-stt-*` folder in the OS temp directory, then
  `localAiTranscribe` sends it with the key from the OS keychain (`stt-api-key`,
  never readable from the window) and deletes the folder when it ends, fails or is
  cancelled (an abandoned upload after 5 idle minutes). No CORS is needed.
  If ffmpeg is installed (`FFMPEG_PATH`, the PATH, or `/opt/homebrew/bin`,
  `/usr/local/bin`), the recording becomes 16 kHz mono WAV, and anything over
  ~10.5 minutes is sent in 10-minute parts that overlap by 5 seconds. Timestamps
  are shifted to each part's place; each side of a boundary keeps the lines that
  start in its half of the overlap, and a line heard in both is kept once.
  WhisperX servers always get the whole recording in one part, because each part
  would be diarized with its own `SPEAKER_n` labels. Without ffmpeg, or if ffmpeg
  cannot read the file, the original is sent whole.

**Privacy.** Recordings go only to the speech-to-text address in Settings; with a
server on this computer, audio never leaves it. Nothing is uploaded to the
workspace: only the resulting transcript (text, timings, speaker labels) is saved,
like an imported one. A hosted address (for example OpenAI's
`https://api.openai.com/v1` with `whisper-1`) needs a key and sends the audio to
that service.

**Limits.** Recordings up to 2 GB. A transcript holds at most 20,000 lines (a longer
result is refused with a message, nothing saved). Rows over ~700 KB keep line
timings and drop word timings, with a notice. One server request may take up to an
hour (desktop) and a whole transcription up to three hours before it is stopped;
Cancel works at any time. Quality and speed depend on the model: `base`/`small`
run on a laptop CPU at a few times real time; `large-v3` wants a GPU.

## Structured replies

Servers differ in which JSON mode they accept: LM Studio refuses `json_object`,
some llama.cpp builds refuse `json_schema`, older servers know neither. The client
tries `json_schema`, then `json_object`, then a plain request, moving on only when
the server rejects the format, and remembers what worked per server and model.
Replies are read defensively: a Markdown code fence or prose around the JSON is
stripped, and fields are validated one by one. A reply with no usable JSON falls
back to the rule-based draft, exactly as on the server.

## Safety rules

- Adopted minutes, and drafts whose sections already hold recorded content, are
  refused before any model call. `minutes:upsertFromDraft` checks again when it
  writes. Replacing a started draft asks first.
- No network request ever happens inside a portable mutation. The page calls the
  model, then saves through `minutes:upsertFromDraft` or
  `aiChat:appendDeviceMessage`.
- A failed or cancelled request writes nothing; the transcript or chat draft stays
  where it was. Cancel on a minutes draft says "Draft cancelled. Nothing was
  changed." (after a pasted transcript: the transcript was saved, the minutes were
  not changed).
- **Stop** in the assistant keeps the reply as far as it got, saved with
  "(stopped)" after it. Stopped before any text arrived, nothing is saved and the
  question stays in the composer.

## Limits

- The on-device assistant's tools cover meetings, minutes, transcripts, documents
  (metadata search, then text), tasks, deadlines and commitments. It can't look
  up directors, members, filings or finances, and the only change it can propose
  is new tasks. Without record lookups (or with a model that doesn't take tools)
  its suggested prompts work on pasted or attached text ("Summarize this
  transcript excerpt", "Turn these notes into action items", "Check this motion
  wording"). `deviceAssistantToolsAvailable()` in `src/lib/localAi/useDeviceAi.ts`
  is the switch, read by `assistantCapabilities()` in
  `src/features/ai/assistantSuggestions.ts`.
- The thread's title follows its latest question, as before.
- Long drafts on a slow model can take minutes. A request stops after 5 minutes
  without an answer, and a stream stops after 90 seconds of silence; Cancel stops
  it sooner.
- Speech-to-text limits are listed under [Speech-to-text](#speech-to-text).
- Quality depends on the model. 7–8B instruction models draft usable minutes from a
  clean transcript; smaller models miss motions more often.

## For developers

- Shared drafting: `shared/ai/minutesDraft.ts` (prompt, rule-based fallback,
  `parseMinutesDraft`), `shared/ai/minutesDraftChunks.ts` (split and merge),
  `shared/ai/draftToMinutesArgs.ts` (the upsert arguments for every runtime).
  `convex/providers/llm.ts` only chooses the endpoint and speaks HTTP.
- Device client: `src/lib/localAi/` (`config.ts`, `client.ts`, `transport.ts`,
  `models.ts`, `useDeviceAi.ts`). Intake's worker and Ask AI reach the AI SDK
  through `deviceAiSdkFetch`, so they use the same transport.
- Desktop proxy: `electron/localAiProxy.ts` (chat paths `/models`,
  `/chat/completions`, `/api/tags`; speech paths `/audio/transcriptions` and
  `/inference` only to the speech-to-text server, only the one its kind uses;
  everything else refused) and `electron/ipc/aiHandlers.ts` (sender-verified
  channels, streaming as ordered IPC events, abort, transcription upload and
  run). `getSecret("ai-api-key")` and `getSecret("stt-api-key")` are refused; only
  the main process reads those keys.
- Speech-to-text: `shared/ai/speechRequest.ts` (server kinds, paths, multipart
  fields, the part plan; dependency-free so the main process can import it),
  `shared/ai/transcription.ts` (reply parsing for OpenAI, whisper.cpp and WhisperX
  JSON, the overlap merge and limits; the Whisper JSON file import in
  `timedTranscript.ts` uses the same core), `src/lib/localAi/transcription.ts`
  (browser and desktop transports, Test connection),
  `electron/localTranscription.ts` (temp-file upload, ffmpeg, requests) and
  `src/features/meetings/transcript/useLocalTranscription.ts` (the Transcript tab).
- Draft progress and Cancel: `src/features/meetings/deviceDraftProgress.ts` and
  `components/DeviceDraftStatus.tsx`, shown by the Minutes empty state, the
  transcript card and the Transcript tab.
- Orchestration: `src/features/meetings/localMinutesDraft.ts` and
  `useLocalMinutesDraft.ts`; the assistant path is `sendOnDevice` in
  `src/features/ai/GlobalAiAssistant.tsx`.
- Assistant tools: `src/lib/localAi/assistantToolLoop.ts` (tool list per role,
  the loop, proposals, `runApprovedChange`), `src/lib/localAi/toolCalls.ts`
  (argument decoding, calls written as text), `src/lib/localAi/toolSupport.ts`
  (which models take tools, per device), `chatStep` and `probeToolCalling` in
  `client.ts`, and the protocol in `shared/ai/openAiCompatible.ts` (tools in the
  body, `tool_calls` in replies and streamed fragments, `isToolsRejection`). The
  prompt is `shared/ai/localAssistantPrompt.ts` (`UNTRUSTED_DATA_RULE`). Records
  saved with a reply: `shared/ai/deviceToolRecords.ts`, through
  `aiChat:appendDeviceMessage` (`toolCalls`). UI: `src/features/ai/useDeviceAssistantTools.ts`
  (the adapter: `createPortableAgentAdapter` over the app's local client),
  `DeviceToolActivity.tsx` (chips), the proposal card in `GlobalAiAssistant.tsx`,
  and `src/components/OnDeviceAiToolSettings.tsx`.

Server workspaces: a saved "OpenAI-compatible" address is fetched by the server, so
it must be public HTTPS. Loopback, private, link-local, metadata and internal hosts
are refused (the shared outbound URL policy), redirects are refused, provider error
bodies are never shown, a saved key is only sent to its own address, and the
deployment's environment key is never sent to a workspace-chosen address.

Checks (no network, mock server in `scripts/fixtures/mock-openai-server.ts`):

```sh
npm run test:local-ai-client        # client: model lists, JSON modes, streaming, stalls, keys
npm run test:device-assistant-tools # tool loop on the portable runtime: roles, proposals, caps, abort, fallback, privacy
npm run test:local-transcription    # speech replies, part merge, browser and desktop paths, importTimed
npm run test:minutes-draft-shared   # server and device produce the same minutes; chunking
npm run test:ai-endpoint-policy     # hosted address policy, device settings stay out of exports
npm run test:electron-architecture  # desktop proxy allow-list, streaming, abort, key isolation
```

The mock can also run on its own for manual testing:
`node --import tsx scripts/fixtures/mock-openai-server.ts 11999`, then use
`http://127.0.0.1:11999/v1` with the "Other OpenAI-compatible" preset. For
speech-to-text use `http://127.0.0.1:11999/v1` (OpenAI-compatible or WhisperX) or
`http://127.0.0.1:11999` (whisper.cpp); it answers three short lines, with speaker
labels for WhisperX. For tool calling, set `toolScript` (presets in
`MOCK_TOOL_SCRIPTS`: look up meetings then answer, arguments as an object or
encoded twice, propose a task, invalid arguments, disallowed tools, never stop),
`rejectTools` (answers 400 like an Ollama model without tool support) or
`toolsInText`.
