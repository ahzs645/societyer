import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { normalizeMeetingQuorum, minutesQuorumLabel } from "../shared/minutesQuorum";
import { normalizeMeetingMinutesPayload } from "../shared/functions/importSessionHelpers/importSessionNormalize";
import { renderMinutesHtml } from "../src/features/meetings/lib/minutesRenderer";

assert.deepEqual(normalizeMeetingQuorum({}), { quorumMet: false, quorumStatus: "not_recorded" });
assert.deepEqual(normalizeMeetingQuorum({ quorumMet: "false" }), { quorumMet: false, quorumStatus: "not_met" });
assert.throws(() => normalizeMeetingQuorum({ quorumMet: "unknown" }), /must be/);
assert.throws(() => normalizeMeetingQuorum({ quorumStatus: "not_met", quorumMet: true }), /contradicts/);
assert.equal(minutesQuorumLabel({ quorumMet: false }), "Not met", "legacy explicit booleans remain readable");
assert.equal(normalizeMeetingMinutesPayload({ meetingTitle: "Historical board" }).quorumStatus, "not_recorded");

const societyId = "quorum_test_society";
const client = new StaticConvexClient({ seed: { societies: [{ _id: societyId, name: "Quorum Test", jurisdictionCode: "CA-BC", entityType: "society" }] } });
await client.whenLocalWorkspaceReady();
const sourceId = "google-drive:quorum-fixture";
const sessionId = await client.mutation("importSessions:createFromBundle", { societyId, bundle: {
  sources: [{ externalSystem: "google-drive", externalId: sourceId, title: "Historical minutes" }],
  meetingMinutes: [{ meetingDate: "2020-01-01", meetingTitle: "Historical board", attendees: ["Example Person"], discussion: "No quorum statement appears in this source.", sourceExternalIds: [sourceId] }],
} });
const staged = await client.query("importSessions:get", { sessionId });
assert.equal(staged.records.find((row: { recordKind: string }) => row.recordKind === "meetingMinutes").payload.quorumStatus, "not_recorded");
await client.mutation("importSessions:bulkSetStatus", { sessionId, status: "Approved" });
await client.mutation("importSessions:applyApprovedMeetings", { sessionId });
const snapshot = client.exportLocalWorkspaceSnapshot();
const row = snapshot.tables.minutes[0];
assert.ok(row, "approved fixture creates native minutes");
assert.equal(row.quorumStatus, "not_recorded");
assert.equal(row.quorumMet, false, "compatibility boolean is not evidence when status is unknown");
const restored = new StaticConvexClient({ seed: { societies: [] } });
await restored.importLocalWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
const recovered = restored.exportLocalWorkspaceSnapshot().tables.minutes[0];
assert.equal(recovered.quorumStatus, "not_recorded", "backup retains native unknown status");
for (const styleId of ["standard", "formal-agm", "executive-agenda", "numbered-agenda", "action-table", "board-public"] as const) {
  const html = renderMinutesHtml({ society: { name: "Quorum Test" }, meeting: { title: "Board meeting", type: "Board", scheduledAt: row.heldAt, agendaItems: ["Opening"] }, minutes: { ...row, motions: [] }, styleId, options: { sourceFidelity: false } });
  assert.doesNotMatch(html, /Quorum: Not met|Quorum was not met|Quorum achieved|Quorum was declared present/);
  if (["standard", "formal-agm", "numbered-agenda", "action-table"].includes(styleId)) assert.match(html, /[Qq]uorum[^<.]*[Nn]ot recorded/);
}
await restored.mutation("minutes:update", { id: row._id, patch: { discussion: "Editorial edit" } });
assert.equal(restored.exportLocalWorkspaceSnapshot().tables.minutes[0].quorumStatus, "not_recorded", "unrelated editing preserves unknown");
const draftMeetingId = await restored.mutation("meetings:create", { societyId, type: "Board", title: "Fresh transcript draft", scheduledAt: row.heldAt, electronic: false, status: "Held", attendeeIds: [] });
await restored.mutation("minutes:upsertFromDraft", { societyId, meetingId: draftMeetingId, heldAt: row.heldAt,
  attendees: ["Example Person"], absent: [], quorumRequired: 1, quorumMet: false, quorumStatus: "not_recorded",
  discussion: "Source did not establish quorum.", motions: [], decisions: [], actionItems: [] });
assert.equal(restored.exportLocalWorkspaceSnapshot().tables.minutes.find(minutes => minutes.meetingId === draftMeetingId)!.quorumStatus, "not_recorded", "draft synchronization must not replace explicit historical unknown with a count-based claim");
await restored.mutation("minutes:update", { id: row._id, patch: { quorumMet: false } });
assert.equal(restored.exportLocalWorkspaceSnapshot().tables.minutes[0].quorumStatus, "not_met", "explicit manual false makes a known negative observation");
await restored.mutation("minutes:update", { id: row._id, patch: { quorumStatus: "not_recorded" } });
assert.equal(restored.exportLocalWorkspaceSnapshot().tables.minutes[0].quorumStatus, "not_recorded");
console.log("Meeting quorum fidelity: normalization, staging, native promotion, restore, all export styles and explicit edits passed.");
