import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { toMeetingDateTime } from "../shared/functions/importSessionHelpers/importSessionRecordKinds";
import { createFromBundlePortable, bulkSetStatusPortable, applyApprovedMeetingsPortable } from "../shared/functions/importSessions";

assert.equal(toMeetingDateTime("2025-03-18"), "2025-03-18T12:00:00.000Z");
assert.equal(toMeetingDateTime("2025-03-18T17:00:00-07:00"), "2025-03-19T00:00:00.000Z");
assert.equal(toMeetingDateTime("2025-03-18T17:00Z"), "2025-03-18T17:00:00.000Z");
for (const date of [undefined, "", "unknown", "2025", "2025-03", "2025-02-30", "2025-13-01", "2025-03-18T17:00:00", "2025-02-30T17:00Z", "2025-03-18T24:00Z"]) {
  assert.throws(() => toMeetingDateTime(date), /date|YYYY|review/i, `Cannot invent a scheduled meeting date from ${String(date)}`);
}
const db = new MemoryDb({ seed: { societies: [{ _id: "society", name: "Meeting date fixture" }], users: [{ _id: "owner", societyId: "society", role: "Owner", status: "Active" }] } });
const ctx = {
  db, capabilities: makeCapabilities({}),
  principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "date-preflight-test", societyId: "society", actorUserId: "owner", scopes: ["settings:write", "settings:read", "documents:write", "documents:read", "meetings:write", "minutes:write", "motions:write"] },
  runQuery: async () => { throw new Error("Unexpected nested query"); },
  runMutation: async () => { throw new Error("Unexpected nested mutation"); },
};
const sessionId = await createFromBundlePortable(ctx, { societyId: "society", bundle: {
  sources: [{ externalSystem: "google-drive", externalId: "google-drive:test", title: "Original source", url: "https://drive.google.com/file/d/test/view" }],
  meetingMinutes: [
    { meetingTitle: "First dated meeting", meetingDate: "2025-03-18", sourceExternalIds: ["google-drive:test"] },
    { meetingTitle: "Later undated source", sourceExternalIds: ["google-drive:test"] },
  ],
} });
await bulkSetStatusPortable(ctx, { sessionId, status: "Approved" });
const tables = ["documents", "meetings", "minutes", "motions", "agendaItems", "sourceEvidence"];
const before = Object.fromEntries(tables.map(table => [table, db.dump(table)]));
await assert.rejects(() => applyApprovedMeetingsPortable(ctx, { sessionId }), /date|YYYY|review/i);
assert.deepEqual(Object.fromEntries(tables.map(table => [table, db.dump(table)])), before, "Validate every selected source date before creating even the first meeting or source placeholder");
console.log("Meeting-date preflight passed: unknown/partial/invalid dates cannot invent dates, and a later undated candidate causes zero batch writes.");
