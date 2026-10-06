import { EVIDENCE_FIELDS, normalizeImportedEvidence, validateMeetingEvidence, checkpointResult } from "../shared/evidenceReview";
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { assertImportBundlePreflight } from "../shared/importBundlePreflight";

const societyId = "test_meeting_context";
const client = new StaticConvexClient({ seed: { societies: [{ _id: societyId, name: "Test society" }] } });
await client.whenLocalWorkspaceReady();
const bundle = {
  sources: [{ externalSystem: "google-drive", externalId: "google-drive:test-minutes", title: "Committee source", url: "https://drive.google.com/file/d/test-minutes/view" }],
  meetingMinutes: [{
    meetingDate: "2025-06-12", meetingTitle: "Air quality working session",
    meetingType: "Committee", location: "Online via Zoom", electronic: true,
    remoteParticipation: { url: "https://example.invalid/meeting", instructions: "Join remotely" },
    quorumStatus: "not_recorded", sourceExternalIds: ["google-drive:test-minutes"],
    sections: [{ title: "Review", discussion: "Reviewed the report." }],
    attendanceEvents: [{ id: 'arrival', personName: 'Source attendee', kind: 'arrived', boundary: 'Opening', sourceReference: 'Attendance row', reviewStatus: 'verified' }],
    quorumCheckpoints: [{ id: 'opening', assertion: 'confirmed', atTime: '5:11 pm', scope: 'session', scopeLabel: 'AGM opening', eligibleCount: 12, eligiblePopulation: 15, required: 10, sourceReference: 'Opening paragraph', reviewStatus: 'verified' }],
    consentItems: [{ id: 'consent', outcome: 'deferred', sourceReference: 'Item 2', reviewStatus: 'verified' }],
    conditionalDecisions: [{ id: 'decision', title: 'Subject to funding', outcome: 'Carried', checkpointId: 'opening', sourceReference: 'Item 3', reviewStatus: 'verified' }],
    decisionRequirements: [{ id: 'requirement', decisionId: 'decision', kind: 'condition', state: 'unknown', observedDate: '2025-06', sourceReference: 'Item 3 condition', reviewStatus: 'verified' }],
    futureMeetingSuggestions: [{ id: 'future', date: '2025-08', status: 'tentative', sourceReference: 'Closing paragraph', reviewStatus: 'verified' }],
  }],
};
assertImportBundlePreflight(bundle);
const sessionId = await client.mutation("importSessions:createFromBundle", { societyId, bundle });
const session = await client.query("importSessions:get", { sessionId });
const candidate = session.records.find((record: { recordKind: string }) => record.recordKind === "meetingMinutes");
assert.equal(candidate.status, "Pending");
for(const field of EVIDENCE_FIELDS) {
  assert.equal(candidate.payload[field][0].reviewStatus,'pending');
  assert.equal(candidate.payload[field][0].sourceUrl,bundle.sources[0].url);
}
assert.equal(candidate.payload.quorumCheckpoints[0].boundary,'AGM opening, 5:11 pm');
assert.equal(candidate.payload.quorumCheckpoints[0].eligibleCount,12);
assert.equal(candidate.payload.quorumCheckpoints[0].eligiblePopulation,15);
assert.equal(checkpointResult(candidate.payload.quorumCheckpoints[0]),'unknown');
await client.mutation("importSessions:updateRecord", { recordId: candidate._id, status: "Approved" });
await client.mutation("importSessions:applyApprovedMeetings", { sessionId });
const snapshot = client.exportLocalWorkspaceSnapshot();
for(const field of EVIDENCE_FIELDS) assert.deepEqual(snapshot.tables.minutes[0][field],candidate.payload[field],`${field} survives promotion`);
const fallback=normalizeImportedEvidence({quorumCheckpoints:[{id:'fallback',scope:'meeting',sourceReference:'Opening',sourceExternalIds:['drive:without-url'],assertion:'confirmed'}]});
assert.equal(fallback.quorumCheckpoints![0].boundary,'Meeting');
assert.equal(fallback.quorumCheckpoints![0].reviewStatus,'pending');
assert.throws(()=>validateMeetingEvidence({quorumCheckpoints:[{...fallback.quorumCheckpoints![0],reviewStatus:'verified'}]}),/source URL/);
assert.throws(()=>validateMeetingEvidence({quorumCheckpoints:[{...fallback.quorumCheckpoints![0],reviewStatus:['verified']}]}),/review status/);
assert.throws(()=>normalizeImportedEvidence({consentItems:[{id:'adoption',outcome:'adopted',sourceReference:'Item 2',sourceExternalIds:['drive:without-url']}]}),/cannot adopt/);
assert.throws(()=>normalizeImportedEvidence({consentItems:[{id:'pin',outcome:'pending',pinnedVersion:{sha256:'forged'},sourceReference:'Item 2',sourceExternalIds:['drive:without-url']}]}),/adoption pins/);
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

// Merge richer intake by stable row ID; verified evidence wins over imports.
await client.mutation('minutes:update',{id:snapshot.tables.minutes[0]._id,patch:{quorumCheckpoints:[{...candidate.payload.quorumCheckpoints[0],reviewStatus:'verified'}]}});
const mergeId=await client.mutation('importSessions:createFromBundle',{societyId,bundle:{meetingMinutes:[{meetingDate:'2025-06-12',meetingTitle:'Air quality working session',sourceExternalIds:['google-drive:test-minutes'],quorumCheckpoints:[{id:'opening',boundary:'Contradictory opening',eligibleCount:1,required:10,assertion:'not_met',sourceReference:'Later extraction'},{id:'later',scope:'meeting',sourceReference:'Later paragraph',assertion:'not_recorded'}]}]}});
await client.mutation('importSessions:bulkSetStatus',{sessionId:mergeId,status:'Approved'});
await client.mutation('importSessions:applyApprovedMeetings',{sessionId:mergeId});
const merged=client.exportLocalWorkspaceSnapshot().tables.minutes.find(row=>row._id===snapshot.tables.minutes[0]._id)!;
assert.equal(merged.quorumCheckpoints.length,2);
assert.equal(merged.quorumCheckpoints[0].reviewStatus,'verified');assert.equal(merged.quorumCheckpoints[0].eligibleCount,12);
assert.equal(merged.quorumCheckpoints[1].reviewStatus,'pending');
console.log('All six evidence arrays, Drive URLs, pending-only imports, external-ID citations, adoption rejection and verified merge protection passed.');
