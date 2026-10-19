/**
 * Meeting source files, end to end, with mocked Microsoft Graph, SharePoint
 * transfer hosts and speech service. Everything else is the real code: the
 * browser's upload loop and fingerprint (meetingSourceTransfer), the transfer
 * Worker, the Convex control plane and mutations, the browser's text
 * extraction and timed-transcript offer, the Transcript tab's ranged download,
 * the transcript mutations and the server minutes draft.
 *
 *   A. VTT export   -> upload -> paged text -> "Open in Transcript tab" (importTimed)
 *                   -> Review speakers (suggest, combine, name) -> rule-based minutes
 *                   -> link an action item and a motion to the transcript -> approval
 *   B. TXT          -> upload -> paged text -> "Use for minutes" -> minutes draft; a 490 KB
 *                      transcript (41 chunks) can be used for minutes too
 *   C. Whisper ZIP  -> upload -> paged text from the TXT entry, timed offer from the JSON entry
 *   D. Recording    -> upload -> speech disabled (DDC North today) -> "Attached recordings"
 *                   ranged download, byte-identical -> mocked speech job -> paged text
 *                   -> "Use for minutes"
 *
 * Prints what each stage produced. Not a live Microsoft or browser test.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import worker from "../workers/meeting-transfer/index";
import { MEETING_SOURCE_CHUNK_BYTES as CHUNK } from "../shared/storage/meetingSourceProtocol";
import { minutesDraftTranscript } from "../shared/minutesDraftInput";
import { uploadMeetingSourceWith, type MeetingSource, type MeetingSourceTransport } from "../src/lib/meetingSourceTransfer";
import { downloadMeetingSourceBlob, meetingRecordingMimeType, type MeetingSourceRangeFetch } from "../src/lib/meetingSourceDownload";
import { importMeetingSourceText } from "../src/lib/meetingTranscriptImport";
import { timedTranscriptOffer, REVIEW_SPEAKERS_INTENT } from "../src/features/meetings/transcript/timedImportOffer";
import { needsSpeakerReview, speakerSuggestions } from "../src/features/meetings/transcript/speakerSuggestions";
import { StreamingZipWriter } from "../src/lib/zipStream";

// ---------------------------------------------------------------- environment
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MEETING_TRANSCRIPTION_ENDPOINT;
delete process.env.MEETING_TRANSCRIPTION_KEY;
Object.assign(process.env, {
  AUTH_MODE: "convex", CONVEX_SITE_URL: "https://e2e.convex.site", SITE_URL: "https://app.example.test",
  BETTER_AUTH_SECRET: "fixture-only-societyer-secret-that-is-not-real", SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: "ddcnorth.com",
  SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT: "1", SOCIETYER_STORAGE_PROVIDER: "sharepoint",
  SHAREPOINT_TENANT_ID: "11111111-1111-1111-1111-111111111111", SHAREPOINT_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
  SHAREPOINT_CLIENT_SECRET: "fixture-not-a-real-secret", SHAREPOINT_SITE_ID: "approved-site", SHAREPOINT_DRIVE_ID: "approved-drive",
  SHAREPOINT_TRANSFER_HOSTS: "files.example.test", MEETING_SOURCE_BROKER_KEY: "fixture-only-broker-key-with-32-characters",
});
const SPEECH_KEY = "fixture-speech-service-key-of-32-characters";

const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./http.js": () => import("../convex/http"),
  "./meetingSources.js": () => import("../convex/meetingSources"),
  "./meetingSourceSpeech.js": () => import("../convex/meetingSourceSpeech"),
  "./meetings.js": () => import("../convex/meetings"),
  "./minutes.js": () => import("../convex/minutes"),
  "./transcripts.js": () => import("../convex/transcripts"),
};
const test = convexTest(schema, modules);
const issuer = process.env.CONVEX_SITE_URL!;
const workerEnv = { CONVEX_SITE_URL: issuer, SITE_ORIGIN: process.env.SITE_URL!, MEETING_SOURCE_BROKER_KEY: process.env.MEETING_SOURCE_BROKER_KEY!, SHAREPOINT_TRANSFER_HOSTS: "files.example.test" };

const { societyId, meetings } = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "DDC North (fixture)", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role] of [["owner", "Owner"], ["director", "Director"], ["member", "Member"]] as const) {
    await ctx.db.insert("users", { societyId, displayName: subject, email: `${subject}@ddcnorth.com`, authIssuer: issuer, authSubject: subject, role, status: "Active", createdAtISO: new Date().toISOString() });
  }
  const meeting = (title: string) => ctx.db.insert("meetings", { societyId, type: "Board", title, scheduledAt: "2026-10-14T19:00:00Z", electronic: true, status: "Held", attendeeIds: [] });
  return { societyId, meetings: { vtt: await meeting("October board meeting"), txt: await meeting("Finance committee"), zip: await meeting("Whisper export"), recording: await meeting("Recorded AGM") } };
});
const as = (subject: string) => test.withIdentity({ issuer, subject, email: `${subject}@ddcnorth.com`, emailVerified: true });
const owner = as("owner");
const member = as("member");

// --------------------------------------------- mocked Graph, SharePoint, speech
type Remote = { id: string; name: string; bytes: Uint8Array; received: number; deleted?: boolean };
const remotes = new Map<string, Remote>();
const counters = { graph: 0, transferPuts: 0, rangeReads: 0, largestBody: 0, speechSubmits: 0, speechPolls: 0 };
let tamperReads = false;
let speechReady = false;
type SpeechJob = { id: string; downloadUrl: string; size: number; fileName: string; hashes: string[] };
// A holder, so control-flow narrowing doesn't assume the mock never ran.
const speech: { job: SpeechJob | null } = { job: null };
let speechProcessorCheck = "";
const SPEECH_TEXT = ["Jane Doe: Good evening, I call the annual general meeting to order at 7:00.", "Sam Lee: I move that we accept the audited statements.", "John Roe: Seconded.", "Jane Doe: All in favour? Motion carried.", "Jane Doe: Meeting adjourned at 7:40."].join("\n");

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(init?.headers);
  if (url.hostname === "e2e.convex.site") {
    assert.notEqual(init?.redirect, "error", 'Cloudflare Workers does not implement redirect:"error"');
    const subject = headers.get("authorization")?.replace("Bearer ", "") ?? "";
    return (subject ? as(subject) : test).fetch(url.pathname, init);
  }
  if (url.hostname === "login.microsoftonline.com") return Response.json({ access_token: "fixture-graph-token", token_type: "Bearer", expires_in: 3600 });
  if (url.hostname === "graph.microsoft.com") return graph(url, init);
  if (url.hostname === "files.example.test") return transferHost(url, init, headers);
  if (url.hostname === "speech.example.test") return speechService(url, init, headers);
  return realFetch(input, init);
};

function graph(url: URL, init: RequestInit | undefined) {
  counters.graph++;
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-graph-token");
  const path = url.pathname;
  if (/\/drives\/approved-drive\/$/.test(path)) return Response.json({ id: "approved-drive", sharePointIds: { tenantId: process.env.SHAREPOINT_TENANT_ID } });
  if (path.includes("/sites/")) return Response.json({ id: "approved-drive" });
  if (path.endsWith("/createUploadSession")) {
    const body = JSON.parse(String(init?.body)) as { item: { name: string; "@microsoft.graph.conflictBehavior": string } };
    assert.equal(body.item["@microsoft.graph.conflictBehavior"], "fail", "Allocated names never overwrite");
    const id = String(remotes.size + 1);
    remotes.set(id, { id, name: body.item.name, bytes: new Uint8Array(0), received: 0 });
    return Response.json({ uploadUrl: `https://files.example.test/upload/${id}?private-token`, expirationDateTime: new Date(Date.now() + 3600_000).toISOString() });
  }
  const item = (remote: Remote) => ({ id: remote.id, name: remote.name, size: remote.received, eTag: "etag-1", file: {}, parentReference: { driveId: "approved-drive" } });
  if (path.includes("/root:/")) {
    const name = decodeURIComponent(path.split("/root:/")[1]);
    const remote = [...remotes.values()].find((r) => r.name === name);
    assert.ok(remote);
    return Response.json(item(remote));
  }
  const id = path.split("/items/")[1]?.split("/")[0];
  const remote = id ? remotes.get(id) : undefined;
  assert.ok(remote, `Unexpected Graph path ${path}`);
  if (path.endsWith("/versions")) return Response.json({ value: [{ id: "1.0", size: remote.received }] });
  if (path.endsWith("/content")) return new Response(null, { status: 302, headers: { location: `https://files.example.test/content/${remote.id}?private-token` } });
  return Response.json(item(remote));
}

async function transferHost(url: URL, init: RequestInit | undefined, headers: Headers) {
  assert.equal(headers.has("authorization"), false, "Never send a Microsoft or app token to a transfer URL");
  const [, kind, id] = url.pathname.split("/");
  const remote = remotes.get(id);
  assert.ok(remote);
  if (kind === "upload") {
    if (init?.method === "DELETE") { remote.deleted = true; return new Response(null, { status: 204 }); }
    if (init?.method !== "PUT") return Response.json({ nextExpectedRanges: [`${remote.received}-`] });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get("content-range") ?? "");
    assert.ok(range);
    const [start, end, total] = [Number(range[1]), Number(range[2]) + 1, Number(range[3])];
    const body = new Uint8Array(init.body as ArrayBuffer);
    counters.transferPuts++; counters.largestBody = Math.max(counters.largestBody, body.length);
    assert.equal(start, remote.received); assert.equal(end - start, body.length); assert.ok(body.length <= CHUNK);
    if (remote.bytes.length !== total) remote.bytes = new Uint8Array(total);
    remote.bytes.set(body, start); remote.received = end;
    return end === total ? Response.json({ id }, { status: 201 }) : Response.json({ nextExpectedRanges: [`${end}-${total - 1}`] }, { status: 202 });
  }
  const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
  if (range) {
    counters.rangeReads++;
    const [start, end] = [Number(range[1]), Number(range[2])];
    const bytes = remote.bytes.slice(start, end + 1);
    if (tamperReads) bytes[0] ^= 1;
    return new Response(bytes, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${remote.bytes.length}`, "content-length": String(bytes.length) } });
  }
  return new Response(remote.bytes.slice(), { headers: { "content-length": String(remote.bytes.length) } });
}

/** The managed speech service contract from convex/meetingSourceSpeech.ts: POST /jobs, GET /jobs/{id}. */
async function speechService(url: URL, init: RequestInit | undefined, headers: Headers) {
  assert.equal(headers.get("authorization"), `Bearer ${SPEECH_KEY}`);
  if (init?.method === "POST") {
    assert.equal(url.pathname, "/jobs");
    const job = JSON.parse(String(init.body)) as SpeechJob;
    speech.job = job;
    counters.speechSubmits++;
    // A processor fetches the pinned original itself and can check it against the chunk manifest.
    const original = new Uint8Array(await (await globalThis.fetch(job.downloadUrl)).arrayBuffer());
    const manifest = Array.from({ length: Math.ceil(original.length / CHUNK) }, (_, i) => sha256(original.subarray(i * CHUNK, (i + 1) * CHUNK)));
    assert.deepEqual(manifest, job.hashes, "The processor receives the committed chunk manifest");
    speechProcessorCheck = `fetched ${original.length.toLocaleString()} bytes from the pre-signed URL; ${manifest.length}-chunk manifest matches`;
    return Response.json({ id: job.id }, { status: 202 });
  }
  counters.speechPolls++;
  assert.equal(url.pathname, `/jobs/${speech.job?.id}`);
  return Response.json(speechReady ? { status: "complete", text: SPEECH_TEXT } : { status: "processing" });
}

// ------------------------------------------------- browser side, real modules
async function brokerJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Broker ${response.status}`);
  return body;
}
const call = (operation: string, data: Record<string, unknown>, subject = "owner") =>
  worker.fetch(new Request(`https://broker.example.test/meeting-sources/${operation}`, {
    method: "POST", headers: { Authorization: `Bearer ${subject}`, Origin: workerEnv.SITE_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(data),
  }), workerEnv);
const transport = (subject = "owner"): MeetingSourceTransport => ({
  request: async (operation, data) => brokerJson<MeetingSource>(await call(operation, data, subject)),
  putChunk: async (sourceId, offset, body) => brokerJson<MeetingSource>(await worker.fetch(new Request(
    `https://broker.example.test/meeting-sources/chunk?${new URLSearchParams({ sourceId, offset: String(offset), size: String(body.size) })}`,
    { method: "PUT", headers: { Authorization: `Bearer ${subject}`, Origin: workerEnv.SITE_ORIGIN }, body: new Uint8Array(await body.arrayBuffer()) },
  ), workerEnv)),
});
const rangeFetcher = (sourceId: string, subject = "owner"): MeetingSourceRangeFetch => (offset) => call("download", { sourceId, offset }, subject);
const listSources = async (meetingId: Id<"meetings">, subject = "owner") => brokerJson<MeetingSource[]>(await call("list", { meetingId }, subject));

/** What MeetingSourcesCard does after "Choose file": upload, verify, then import text for text formats. */
async function chooseFile(file: File, meetingId: Id<"meetings">) {
  const statuses: string[] = [];
  const source = await uploadMeetingSourceWith(transport(), file, meetingId, (state) => {
    if (statuses.at(-1) !== state.status) statuses.push(state.status);
  }, new AbortController().signal);
  const sourceId = source.id as Id<"meetingSources">;
  const chunks = /\.(txt|vtt|srt|json|zip)$/i.test(file.name)
    ? await importMeetingSourceText(file, (chunk) => owner.mutation(api.meetingSources.appendText, { sourceId, ...chunk }))
    : 0;
  return { source, sourceId, statuses, chunks };
}

const lines: string[] = [];
function stage(name: string, ...facts: string[]) {
  lines.push(`\n${name}`);
  for (const fact of facts) lines.push(`  - ${fact}`);
}
const transcriptRow = (meetingId: Id<"meetings">) => test.run((ctx) => ctx.db.query("transcripts").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).first());
const minutesRow = (meetingId: Id<"meetings">) => test.run((ctx) => ctx.db.query("minutes").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).first());
const firstPage = async (sourceId: Id<"meetingSources">) => (await owner.query(api.meetingSources.textPage, { sourceId, index: 0 }))?.text ?? "";

try {
  // ======================================================= A. VTT export
  const vtt = [
    "WEBVTT", "",
    "00:00:01.000 --> 00:00:06.000", "<v SPEAKER_00>Good evening. I call the meeting to order at 7:02.", "",
    "00:00:06.500 --> 00:00:11.000", "<v SPEAKER_01>I move that we approve the 2027 operating budget.", "",
    "00:00:11.500 --> 00:00:13.000", "<v SPEAKER_02>Seconded.", "",
    "00:00:13.500 --> 00:00:19.000", "<v SPEAKER_00>All in favour? Motion carried, 5 in favour, none opposed.", "",
    "00:00:19.500 --> 00:00:26.000", "<v speaker_01>Action item: John will circulate the approved budget by November 15th.", "",
    "00:00:26.500 --> 00:00:30.000", "<v SPEAKER_00>Meeting adjourned at 7:46.", "",
  ].join("\n");
  const vttFile = new File([vtt], "board-2026-10.vtt", { type: "text/vtt" });
  const a = await chooseFile(vttFile, meetings.vtt);
  assert.equal(a.source.status, "ready");
  const [aListed] = await listSources(meetings.vtt);
  assert.equal(aListed.textComplete, true);
  stage("A1. VTT upload (browser fingerprint -> Worker -> Convex lease -> SharePoint upload session -> readback verify)",
    `${vttFile.size} bytes, kind "${aListed.kind}", statuses ${a.statuses.join(" -> ")}`,
    `paged text: ${a.chunks} chunk(s), ${aListed.textBytes} bytes, complete=${aListed.textComplete}`,
    `first page: ${JSON.stringify((await firstPage(a.sourceId)).split("\n")[0])}`);

  const offer = await timedTranscriptOffer(vttFile);
  assert.ok(offer);
  assert.equal(offer.provider, "vtt");
  assert.equal(offer.segments.length, 6);
  const reviewIntent = needsSpeakerReview(offer.segments) ? REVIEW_SPEAKERS_INTENT : "";
  assert.equal(reviewIntent, REVIEW_SPEAKERS_INTENT);
  stage("A2. Timed-transcript offer (parsed in the browser from the chosen file)",
    `provider "${offer.provider}", ${offer.segments.length} segments, ${offer.durationSeconds}s, speakers ${[...new Set(offer.segments.map((s) => s.speaker))].join(", ")}`,
    `"Open in Transcript tab" -> ?tab=transcript&intent=${reviewIntent}`);

  await owner.mutation(api.transcripts.importTimed, { societyId, meetingId: meetings.vtt, provider: offer.provider, segments: offer.segments, durationSeconds: offer.durationSeconds });
  await assert.rejects(() => member.query(api.transcripts.getByMeeting, { meetingId: meetings.vtt }), /Permission/, "A1: Members read minutes, not transcripts");
  await assert.rejects(() => member.query(api.meetingSources.textPage, { sourceId: a.sourceId, index: 0 }), /Permission/);
  await assert.rejects(() => listSources(meetings.vtt, "member"), /Transfer unavailable|Access denied/);
  const imported = await owner.query(api.transcripts.getByMeeting, { meetingId: meetings.vtt });
  assert.ok(imported?.segments?.length === 6);
  stage("A3. transcripts:importTimed (Owner)",
    `transcript row: provider "${imported.provider}", ${imported.segments.length} timed segments`,
    "Member: transcripts:getByMeeting, meetingSources:textPage and broker list all refused (A1, meetings:write)");

  const labels = [...new Set<string>(imported.segments.map((s) => String(s.speaker)))];
  const suggestions = speakerSuggestions({ labels, speakers: imported.speakers ?? [], attendees: [{ name: "Jane Doe" }, { name: "John Roe" }, { name: "Sam Lee" }] });
  const combine = suggestions.find((s) => s.kind === "combine");
  assert.ok(combine && combine.kind === "combine");
  await owner.mutation(api.transcripts.mergeSpeakers, { societyId, meetingId: meetings.vtt, from: combine.label, to: combine.into });
  for (const [label, name] of [["SPEAKER_00", "Jane Doe"], ["SPEAKER_01", "John Roe"], ["SPEAKER_02", "Sam Lee"]] as const) {
    await owner.mutation(api.transcripts.assignSpeaker, { societyId, meetingId: meetings.vtt, label, name });
  }
  const named = await owner.query(api.transcripts.getByMeeting, { meetingId: meetings.vtt });
  assert.ok(named);
  assert.match(named.text, /^John Roe: Action item: John will circulate/m, "the combined label takes the target's name");
  assert.doesNotMatch(named.text, /SPEAKER_0\d|speaker_0\d/);
  stage("A4. Review speakers",
    `suggestion: ${combine.reason} (${combine.label} -> ${combine.into}); combined with transcripts:mergeSpeakers`,
    "named SPEAKER_00/01/02 as Jane Doe, John Roe, Sam Lee (transcripts:assignSpeaker)",
    `regenerated text: ${named.text.split("\n").length} "Name: text" lines, no raw labels`);

  // The page sends the transcript row's named text (minutesDraftTranscript), then minutes:generateDraft.
  const draftInput = minutesDraftTranscript({ transcriptRow: named, draftTranscript: "", draftIsImportMetadata: false });
  await owner.action(api.minutes.generateDraft, { meetingId: meetings.vtt, transcript: draftInput });
  const drafted = await minutesRow(meetings.vtt);
  assert.ok(drafted);
  const motionRows = (minutesId: Id<"minutes">) => test.run((ctx) => ctx.db.query("motions").collect()).then((rows) => rows.filter((row) => String(row.minutesId) === String(minutesId)));
  const motions = await motionRows(drafted._id);
  const actionItems = drafted.actionItems ?? [];
  assert.ok(actionItems.length >= 1, "rule-based draft finds the action item");
  stage("A5. Draft minutes from transcript (minutes:generateDraft, no AI provider: rule-based fallback, as on DDC North today)",
    `motion rows: ${motions.map((m) => `${JSON.stringify(m.text)} moved by ${m.movedBy ?? "?"}, ${m.outcome}`).join("; ") || "none"}`,
    `action items: ${actionItems.map((item) => JSON.stringify(item.text)).join(", ")}`,
    `draftTranscript synced: ${drafted.draftTranscript === draftInput}`);

  const actionSegment = named.segments.find((s) => /Action item/.test(s.text));
  assert.ok(actionSegment);
  const linkedAction = await owner.mutation(api.transcripts.linkMinutesItem, { societyId, meetingId: meetings.vtt, kind: "actionItem", actionIndex: 0, expectedText: actionItems[0].text, startSec: actionSegment.startSec, endSec: actionSegment.endSec });
  assert.ok(linkedAction.transcriptRef);
  const linkFacts = [`action item 0 -> ${linkedAction.transcriptRef.startSec}s-${linkedAction.transcriptRef.endSec}s`];
  const moveSegment = named.segments.find((s) => /I move/.test(s.text));
  if (motions[0] && moveSegment) {
    const linkedMotion = await owner.mutation(api.transcripts.linkMinutesItem, { societyId, meetingId: meetings.vtt, kind: "motion", motionId: motions[0]._id, startSec: moveSegment.startSec, endSec: moveSegment.endSec });
    assert.ok(linkedMotion.transcriptRef);
    linkFacts.push(`motion "${motions[0].text}" -> ${linkedMotion.transcriptRef.startSec}s-${linkedMotion.transcriptRef.endSec}s`);
  }
  stage("A6. Link minutes items to the transcript (transcripts:linkMinutesItem)", ...linkFacts);

  // Approval freezes the record (recorded the way check-transcript-minutes-draft does).
  await assert.rejects(() => as("director").mutation(api.minutes.update, { id: drafted._id, patch: { approvedAt: "2026-10-14", approvedInMeetingId: meetings.vtt } }), /minutes:approve/, "Directors draft; approval needs minutes:approve");
  await owner.mutation(api.minutes.update, { id: drafted._id, patch: { approvedAt: "2026-10-14", approvedInMeetingId: meetings.vtt } });
  const approved = await minutesRow(meetings.vtt);
  await assert.rejects(() => owner.action(api.minutes.generateDraft, { meetingId: meetings.vtt, transcript: draftInput }), /Adopted minutes are frozen/);
  await owner.mutation(api.meetingSources.useTranscript, { sourceId: a.sourceId });
  await owner.mutation(api.transcripts.importTimed, { societyId, meetingId: meetings.vtt, provider: offer.provider, segments: offer.segments, durationSeconds: offer.durationSeconds });
  const afterApproval = await minutesRow(meetings.vtt);
  assert.equal(afterApproval?.draftTranscript, approved?.draftTranscript);
  assert.equal(afterApproval?.discussion, approved?.discussion);
  stage("A7. Approval",
    `Director refused (minutes:approve); Owner approved: approvedAt ${approved?.approvedAt}; later draft refused ("Adopted minutes are frozen")`,
    "later Use for minutes and a re-import replace the working transcript only; approved minutes unchanged");

  // ======================================================= B. TXT
  const txtFile = new File(["Chair: The finance committee met at noon.\nTreasurer: I move that we adopt the Q3 report.\nChair: Seconded and carried.\n"], "finance-notes.txt", { type: "text/plain" });
  const b = await chooseFile(txtFile, meetings.txt);
  assert.equal(await timedTranscriptOffer(txtFile), null, "untimed text gets no Transcript-tab offer");
  await owner.mutation(api.meetingSources.useTranscript, { sourceId: b.sourceId });
  const bRow = await transcriptRow(meetings.txt);
  assert.equal(bRow?.text.trimEnd(), (await txtFile.text()).trimEnd(), "the extractor keeps the final newline as a blank line");
  assert.equal(bRow?.segments.length, 0);
  await owner.action(api.minutes.generateDraft, { meetingId: meetings.txt, transcript: bRow.text });
  const bMinutes = await minutesRow(meetings.txt);
  stage("B. TXT upload -> Use for minutes -> draft",
    `${b.chunks} text chunk(s); no timed offer`,
    `meetingSources:useTranscript -> transcript row provider "${bRow.provider}", untimed (0 segments)`,
    `rule-based draft: discussion ${JSON.stringify(String(bMinutes?.discussion).split("\n").at(-1))}`);

  // A long transcript near the 600 KB "Use for minutes" limit spans more than 32 chunks.
  const longFile = new File([("Chair: " + "word ".repeat(18) + "\n").repeat(5000)], "long-meeting.txt", { type: "text/plain" });
  const long = await chooseFile(longFile, meetings.txt);
  assert.ok(long.chunks > 32);
  await owner.mutation(api.meetingSources.useTranscript, { sourceId: long.sourceId });
  assert.equal((await transcriptRow(meetings.txt))?.text.length, (await longFile.text()).length + 1);
  stage("B2. Long TXT (regression)",
    `${longFile.size.toLocaleString()} bytes -> ${long.chunks} text chunks; Use for minutes accepts it (it read only 32 chunks before)`);

  // ======================================================= C. Whisper ZIP
  const whisper = { text: "Hello and welcome.", segments: [{ start: 0, end: 2.5, text: "Hello and welcome.", speaker: "SPEAKER_00", words: [{ word: "Hello", start: 0, end: 0.4 }, { word: "and", start: 0.5, end: 0.7 }, { word: "welcome.", start: 0.8, end: 2.5 }] }] };
  const archive = new StreamingZipWriter();
  await archive.add("recording.wav", new Uint8Array(1_000_000), { compress: false });
  await archive.add("transcript.json", new TextEncoder().encode(JSON.stringify(whisper)));
  await archive.add("transcript.txt", new TextEncoder().encode("SPEAKER_00: Hello and welcome."));
  const zipFile = new File([archive.finish()], "whisper-export.zip", { type: "application/zip" });
  const c = await chooseFile(zipFile, meetings.zip);
  const zipOffer = await timedTranscriptOffer(zipFile);
  assert.equal(zipOffer?.provider, "whisper-json");
  assert.equal(zipOffer?.fileName, "transcript.json");
  stage("C. Whisper ZIP (recording + JSON + TXT entries)",
    `${zipFile.size.toLocaleString()} bytes stored as kind "${(await listSources(meetings.zip))[0].kind}"; embedded recording not inflated`,
    `paged text from the TXT entry: ${JSON.stringify(await firstPage(c.sourceId))}`,
    `timed offer from ${zipOffer?.fileName}: provider "${zipOffer?.provider}", ${zipOffer?.segments.length} segment(s), ${zipOffer?.segments[0].words?.length ?? 0} word timings`);

  // ======================================================= D. Recording
  const wavSize = 2 * CHUNK + 1_234_567;
  const wav = new Uint8Array(wavSize);
  const header = new DataView(wav.buffer);
  wav.set(new TextEncoder().encode("RIFF"), 0); header.setUint32(4, wavSize - 8, true); wav.set(new TextEncoder().encode("WAVEfmt "), 8);
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 16_000, true); header.setUint32(28, 32_000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  wav.set(new TextEncoder().encode("data"), 36); header.setUint32(40, wavSize - 44, true);
  for (let i = 44; i < wavSize; i++) wav[i] = (i * 31 + 7) % 251;
  const recordingFile = new File([wav], "agm-2026.wav", { type: "audio/wav" });
  const d = await chooseFile(recordingFile, meetings.recording);
  const [dListed] = await listSources(meetings.recording);
  assert.equal(dListed.kind, "recording");
  assert.equal(dListed.status, "ready");
  stage("D1. Recording upload",
    `${wavSize.toLocaleString()} bytes in ${Math.ceil(wavSize / CHUNK)} chunks (largest body ${counters.largestBody.toLocaleString()} bytes), statuses ${d.statuses.join(" -> ")}`,
    "no text import for recordings");

  const capabilities = await owner.query(api.meetingSources.speechCapabilities, { meetingId: meetings.recording });
  assert.equal(capabilities.configured, false);
  await assert.rejects(() => owner.action(api.meetingSourceSpeech.start, { sourceId: d.sourceId }), /Configure a speech processing service/);
  stage("D2. Speech processing as deployed on DDC North",
    "meetingSources:speechCapabilities -> { configured: false } (MEETING_TRANSCRIPTION_ENDPOINT/KEY unset)",
    'meetingSourceSpeech:start refused: "Configure a speech processing service before transcribing recordings."');

  const readsBefore = counters.rangeReads;
  const type = meetingRecordingMimeType(recordingFile.name);
  const played = new Uint8Array(await (await downloadMeetingSourceBlob(wavSize, type, { fetchRange: rangeFetcher(d.source.id) })).arrayBuffer());
  assert.equal(sha256(played), sha256(wav), "Attached recording downloads byte-identical");
  const playRanges = counters.rangeReads - readsBefore;
  tamperReads = true;
  await assert.rejects(() => downloadMeetingSourceBlob(wavSize, type, { fetchRange: rangeFetcher(d.source.id) }), /Download failed/);
  tamperReads = false;
  await assert.rejects(() => downloadMeetingSourceBlob(wavSize, type, { fetchRange: rangeFetcher(d.source.id, "member") }), /Download failed/);
  stage('D3. Transcript tab "Attached recordings" (downloadMeetingSourceBlob through the Worker)',
    `${playRanges} verified 5 MiB ranges -> Blob of ${played.length.toLocaleString()} bytes, ${type}; SHA-256 matches the original`,
    "a range altered in storage fails the Worker's digest check; a Member is refused");

  process.env.MEETING_TRANSCRIPTION_ENDPOINT = "https://speech.example.test";
  process.env.MEETING_TRANSCRIPTION_KEY = SPEECH_KEY;
  assert.equal((await owner.query(api.meetingSources.speechCapabilities, { meetingId: meetings.recording })).configured, true);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await assert.rejects(() => as("director").action(api.meetingSourceSpeech.start, { sourceId: d.sourceId }), /uploader/);
    await owner.action(api.meetingSourceSpeech.start, { sourceId: d.sourceId });
    const job = speech.job;
    assert.ok(job);
    await test.action(internal.meetingSourceSpeech.poll, { sourceId: d.sourceId, jobId: job.id });
    const processing = (await listSources(meetings.recording))[0];
    assert.equal(processing.jobStatus, "processing");
    speechReady = true;
    await test.action(internal.meetingSourceSpeech.poll, { sourceId: d.sourceId, jobId: job.id });
  } finally { mock.timers.reset(); }
  const [dDone] = await listSources(meetings.recording);
  assert.equal(dDone.jobStatus, "complete");
  assert.equal(dDone.textComplete, true);
  assert.equal(await firstPage(d.sourceId), SPEECH_TEXT);
  await owner.mutation(api.meetingSources.useTranscript, { sourceId: d.sourceId });
  const dRow = await transcriptRow(meetings.recording);
  assert.equal(dRow?.text, SPEECH_TEXT);
  await owner.action(api.minutes.generateDraft, { meetingId: meetings.recording, transcript: dRow.text });
  const dMinutes = await minutesRow(meetings.recording);
  stage("D4. Mocked managed speech service (POST /jobs, GET /jobs/{id})",
    `job ${speech.job?.id.slice(0, 8)}…: ${speechProcessorCheck}`,
    `${counters.speechPolls} poll(s): processing -> complete; Director (not the uploader) refused`,
    `${dDone.textChunks} text chunk(s), ${dDone.textBytes} bytes; Use for minutes -> untimed transcript row "${dRow.provider}"`,
    `rule-based draft: ${(await motionRows(dMinutes!._id)).map((m) => `${JSON.stringify(m.text)} ${m.outcome}`).join("; ") || "no motions"}`);

  assert.equal((await test.run((ctx) => ctx.db.system.query("_storage").collect())).length, 0, "No Convex blobs");
  stage("Totals",
    `${remotes.size} SharePoint items, ${counters.transferPuts} chunk PUTs, ${counters.rangeReads} verified range reads, ${counters.graph} Graph calls; 0 Convex _storage blobs`);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`Meeting source pipeline, end to end (mocked Microsoft and speech service):${lines.join("\n")}`);
