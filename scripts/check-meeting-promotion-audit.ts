import assert from "node:assert/strict";
import { auditMeetingPromotion } from "./audit-meeting-promotion";
const report = await auditMeetingPromotion({ name: "Audit fixture", jurisdictionCode: "CA-BC", entityType: "society" }, {
  meetingMinutes: [{ meetingTitle: "Board minutes", meetingDate: "2025-03-18", discussion: "Report | notes\nNext line", quorumStatus: "not_recorded", sourceExternalIds: ["fixture:minutes"], attendees: ["Alex"], sections: [{ title: "Budget", motionText: "Receive budget", actionItems: [{ text: "Send report", assignee: "Alex", dueDate: "2025-03-20", done: true }] }], motions: [{ motionText: "Receive budget", outcome: "Carried", movedByName: "Alex" }] }],
});
assert.equal(report.meetingCount, 1);
assert.equal(report.nativeDifferenceCount, 0, JSON.stringify(report));
assert.equal(report.editorDifferenceCount, 0, JSON.stringify(report));
assert.equal(report.meetings[0].sourceApproved, false);
assert.equal(report.meetings[0].nativeMotionCount, 1);
console.log("Isolated promotion: native structured fields and motions retained; source not approved.");

const shuffled = await auditMeetingPromotion({ name: "Shuffled fixture", jurisdictionCode: "CA-BC", entityType: "society" }, { meetingMinutes: [
  { meetingTitle: "Z Board", meetingDate: "2025-03-18", discussion: "Z content", sourceExternalIds: ["fixture:z"] },
  { meetingTitle: "A Board", meetingDate: "2025-01-10", discussion: "A content", sourceExternalIds: ["fixture:a"] },
] });
assert.equal(shuffled.meetingCount, 2);
assert.equal(shuffled.nativeDifferenceCount, 0, JSON.stringify(shuffled));
await assert.rejects(auditMeetingPromotion({ name: "Empty fixture", jurisdictionCode: "CA-BC", entityType: "society" }, { facts: [{ title: "Not minutes", value: "Other" }] }), /No meeting-minutes/);
console.log("Audit matches shuffled source identities and rejects empty minutes input.");

const historyReport = await auditMeetingPromotion({ name: "History promotion fixture", jurisdictionCode: "CA-BC", entityType: "society" }, { meetingMinutes: [{
  meetingTitle: "History board", meetingDate: "2020-07-14", discussion: "Historical observations", sourceExternalIds: ["fixture:history"],
  historicalActions: [{ entryId: "h1", actionKey: "source-action-17", sourceActionId: "17", text: "Send report", assignee: "Secretary", status: "unknown", statusAsOf: "2020-07-14", sourceStatus: "C (unresolved)", sourceExternalIds: ["fixture:history"], sourceLocator: "Table 2 row 4", evidence: "Source code C" }],
  quorumEvents: [{ eventId: "q1", status: "confirmed", atTime: "5:11 pm", scope: "session", scopeLabel: "AGM", presentCount: 13, sourceExternalIds: ["fixture:history"], evidence: "Quorum achieved" }, { eventId: "q2", status: "not_recorded", scope: "session", scopeLabel: "Business" }],
  sourceVersions: [{ versionId: "v1", label: "Draft", status: "draft", sourceExternalIds: ["fixture:history"], contentJson: '{"source":"draft"}' }, { versionId: "v2", label: "Correction", status: "revised", supersedesVersionId: "v1", sourceExternalIds: ["fixture:history"], notes: "Correction without adoption claim" }],
}] });
assert.equal(historyReport.nativeDifferenceCount, 0, JSON.stringify(historyReport));
assert.equal(historyReport.editorDifferenceCount, 0, JSON.stringify(historyReport));
console.log("Promotion audit compares all three native history arrays, including source evidence and version snapshots.");
