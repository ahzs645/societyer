import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { assertImportBundlePreflight } from "../shared/importBundlePreflight";

const societyId = "test_meeting_context";
const client = new StaticConvexClient({ seed: { societies: [{ _id: societyId, name: "Test society" }] } });
await client.whenLocalWorkspaceReady();
const bundle = {
  sources: [{ externalSystem: "google-drive", externalId: "google-drive:test-minutes", title: "Committee source" }],
  meetingMinutes: [{
    meetingDate: "2025-06-12", meetingTitle: "Air quality working session",
    meetingType: "Committee", location: "Online via Zoom", electronic: true,
    remoteParticipation: { url: "https://example.invalid/meeting", instructions: "Join remotely" },
    quorumStatus: "not_recorded", sourceExternalIds: ["google-drive:test-minutes"],
    sections: [{ title: "Review", discussion: "Reviewed the report." }],
  }],
};
assertImportBundlePreflight(bundle);
const sessionId = await client.mutation("importSessions:createFromBundle", { societyId, bundle });
const session = await client.query("importSessions:get", { sessionId });
const candidate = session.records.find((record: { recordKind: string }) => record.recordKind === "meetingMinutes");
assert.equal(candidate.status, "Pending");
await client.mutation("importSessions:updateRecord", { recordId: candidate._id, status: "Approved" });
await client.mutation("importSessions:applyApprovedMeetings", { sessionId });
const snapshot = client.exportLocalWorkspaceSnapshot();
const meeting = snapshot.tables.meetings[0];
assert.ok(meeting, "Approved candidate must materialize a meeting");
assert.equal(meeting.type, "Committee");
assert.equal(meeting.location, "Online via Zoom");
assert.equal(meeting.electronic, true);
assert.equal(meeting.remoteUrl, "https://example.invalid/meeting");
assert.equal(meeting.remoteInstructions, "Join remotely");
assert.equal(snapshot.tables.minutes[0].quorumStatus, "not_recorded");
const secondSessionId = await client.mutation("importSessions:createFromBundle", {
  societyId,
  bundle: { meetingMinutes: [{ ...bundle.meetingMinutes[0], meetingTitle: "Board session in same source package", meetingType: "Board" }] },
});
const secondSession = await client.query("importSessions:get", { sessionId: secondSessionId });
await client.mutation("importSessions:updateRecord", { recordId: secondSession.records[0]._id, status: "Approved" });
await client.mutation("importSessions:applyApprovedMeetings", { sessionId: secondSessionId });
assert.equal(client.exportLocalWorkspaceSnapshot().tables.meetings.length, 2, "Same-date meetings in one source package must remain distinct");
console.log("Meeting import context: explicit type, location, online participation and unknown quorum survive promotion.");
