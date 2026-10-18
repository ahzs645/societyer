/**
 * Shared ranged download used by Meeting source files ("Download original")
 * and the Transcript tab ("Attached recordings"), against a mocked broker
 * fetch: exact ranges in order, short or padded ranges rejected, failed
 * responses surfaced, and cancellation ending as an AbortError with no
 * further requests.
 */
import assert from "node:assert/strict";
import { MEETING_SOURCE_CHUNK_BYTES as CHUNK } from "../shared/storage/meetingSourceProtocol";
import {
  downloadMeetingSourceBlob,
  downloadMeetingSourceRanges,
  meetingRecordingMimeType,
  type MeetingSourceRangeFetch,
} from "../src/lib/meetingSourceDownload";

const SIZE = 2 * CHUNK + 123;
const BROKER = "https://broker.example.test/meeting-sources/download";
const byteAt = (index: number) => (index * 31 + 7) % 251;
const original = Uint8Array.from({ length: SIZE }, (_, index) => byteAt(index));

type BrokerFault = { offset: number; kind: "short" | "padded" | "status" } | null;
let fault: BrokerFault = null;
let requested: number[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), BROKER);
  init?.signal?.throwIfAborted();
  const { sourceId, offset } = JSON.parse(String(init?.body)) as { sourceId: string; offset: number };
  assert.equal(sourceId, "source-1");
  requested.push(offset);
  // Yield so an abort during the request is observed like a real network call.
  await new Promise((resolve) => setTimeout(resolve, 1));
  init?.signal?.throwIfAborted();
  if (fault?.offset === offset && fault.kind === "status") {
    return Response.json({ error: "Transfer unavailable." }, { status: 502 });
  }
  let end = Math.min(offset + CHUNK, SIZE);
  if (fault?.offset === offset) end += fault.kind === "short" ? -1 : 1;
  const bytes =
    fault?.kind === "padded" && end > SIZE ? new Uint8Array(end - offset) : original.slice(offset, end);
  return new Response(bytes, { status: 206 });
};
const fetchRange: MeetingSourceRangeFetch = (offset, signal) =>
  fetch(BROKER, {
    method: "POST",
    body: JSON.stringify({ sourceId: "source-1", offset }),
    headers: { "Content-Type": "application/json" },
    signal,
  });
const reset = (next: BrokerFault = null) => {
  fault = next;
  requested = [];
};

// 1. Complete download: ranges in order, progress to the end, exact bytes and type.
reset();
const progress: number[] = [];
const blob = await downloadMeetingSourceBlob(SIZE, "audio/mpeg", {
  fetchRange,
  onProgress: (received, total) => {
    assert.equal(total, SIZE);
    progress.push(received);
  },
});
assert.deepEqual(requested, [0, CHUNK, 2 * CHUNK]);
assert.deepEqual(progress, [CHUNK, 2 * CHUNK, SIZE]);
assert.equal(blob.size, SIZE);
assert.equal(blob.type, "audio/mpeg");
assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), original, "assembled bytes match the original");

// 2. Streaming writer (Download original) receives each verified part at its offset.
reset();
const parts: Array<[number, number]> = [];
await downloadMeetingSourceRanges(SIZE, {
  fetchRange,
  onPart: (part, offset) => void parts.push([offset, part.size]),
});
assert.deepEqual(parts, [
  [0, CHUNK],
  [CHUNK, CHUNK],
  [2 * CHUNK, 123],
]);

// 3. A short or padded range is refused, and nothing after it is requested or written.
for (const kind of ["short", "padded"] as const) {
  for (const offset of [CHUNK, 2 * CHUNK]) {
    reset({ offset, kind });
    const written: number[] = [];
    await assert.rejects(
      () => downloadMeetingSourceRanges(SIZE, { fetchRange, onPart: (_part, at) => void written.push(at) }),
      /Incomplete download/,
      `${kind} range at ${offset}`,
    );
    assert.deepEqual(requested, offset === CHUNK ? [0, CHUNK] : [0, CHUNK, 2 * CHUNK]);
    assert.deepEqual(written, offset === CHUNK ? [0] : [0, CHUNK], "the bad range is never written");
  }
}

// 4. A failed response is an error, not a short file.
reset({ offset: CHUNK, kind: "status" });
await assert.rejects(() => downloadMeetingSourceBlob(SIZE, "audio/mpeg", { fetchRange }), /Download failed/);

// 5. Cancel between ranges: AbortError, no further request.
reset();
const between = new AbortController();
await assert.rejects(
  () =>
    downloadMeetingSourceBlob(SIZE, "audio/mpeg", {
      fetchRange,
      signal: between.signal,
      onProgress: (received) => {
        if (received === CHUNK) between.abort();
      },
    }),
  (error: unknown) => error instanceof DOMException && error.name === "AbortError",
);
assert.deepEqual(requested, [0], "no range is requested after cancel");

// 6. Cancel while a range is in flight, and a signal cancelled before starting.
reset();
const inFlight = new AbortController();
const pending = downloadMeetingSourceBlob(SIZE, "audio/mpeg", { fetchRange, signal: inFlight.signal });
inFlight.abort();
await assert.rejects(
  pending,
  (error: unknown) => error instanceof DOMException && error.name === "AbortError",
);
assert.ok(requested.length <= 1, "an in-flight cancel stops the loop");
reset();
const before = new AbortController();
before.abort();
await assert.rejects(
  () => downloadMeetingSourceBlob(SIZE, "audio/mpeg", { fetchRange, signal: before.signal }),
  (error: unknown) => error instanceof DOMException && error.name === "AbortError",
);
assert.deepEqual(requested, [], "a cancelled signal makes no request");

// 7. Invalid sizes are refused before any request.
for (const size of [0, -1, 1.5, Number.NaN]) {
  reset();
  await assert.rejects(
    () => downloadMeetingSourceBlob(size, "audio/mpeg", { fetchRange }),
    /Invalid file size/,
  );
  assert.deepEqual(requested, []);
}

// 8. Recording MIME types follow the upload allow-list's extensions.
assert.equal(meetingRecordingMimeType("Board meeting.MP3"), "audio/mpeg");
assert.equal(meetingRecordingMimeType("call.m4a"), "audio/mp4");
assert.equal(meetingRecordingMimeType("call.wav"), "audio/wav");
assert.equal(meetingRecordingMimeType("call.oga"), "audio/ogg");
assert.equal(meetingRecordingMimeType("video.mp4"), "video/mp4");
assert.equal(meetingRecordingMimeType("video.webm"), "video/webm");
assert.equal(meetingRecordingMimeType("video.mov"), "video/quicktime");
assert.equal(meetingRecordingMimeType("notes"), "application/octet-stream");

globalThis.fetch = realFetch;
console.log(
  "Transcript source playback passed: ordered verified ranges, short/padded/failed ranges refused, and cancellation ends in AbortError without further requests.",
);
