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
  actionObservations: [{ entryId: "h1", actionKey: "source-action-17", sourceActionId: "17", text: "Send report", assignee: "Secretary", status: "unknown", statusAsOf: "2020-07-14", sourceStatus: "C (unresolved)", sourceExternalIds: ["fixture:history"], sourceLocator: "Table 2 row 4", evidence: "Source code C" }],
  quorumCheckpoints: [{ id: "q1", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", assertion: "confirmed", atTime: "5:11 pm", scope: "session", scopeLabel: "AGM", eligibleCount: 13, evidence: "Quorum achieved" }, { id: "q2", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", assertion: "not_recorded", scope: "session", scopeLabel: "Business" }],
  importedSourceVersions: [{ versionId: "v1", label: "Draft", status: "draft", sourceExternalIds: ["fixture:history"], contentJson: '{"source":"draft"}' }, { versionId: "v2", label: "Correction", status: "revised", supersedesVersionId: "v1", sourceExternalIds: ["fixture:history"], notes: "Correction without adoption claim" }],
}] });
assert.equal(historyReport.nativeDifferenceCount, 0, JSON.stringify(historyReport));
assert.equal(historyReport.editorDifferenceCount, 0, JSON.stringify(historyReport));
const citation={sourceExternalIds:['drive:audit'],sourceReference:'Source table',reviewStatus:'verified'};
const evidenceReport=await auditMeetingPromotion({name:'Evidence audit',jurisdictionCode:'CA-BC',entityType:'society'},{meetingMinutes:[{meetingTitle:'Evidence board',meetingDate:'2025-06-12',sourceExternalIds:['drive:audit'],
 attendanceEvents:[{id:'a',kind:'departed',personName:'Source attendee',boundary:'Item 4',...citation}],
 quorumCheckpoints:[{id:'q',boundary:'Item 4',eligibleCount:2,eligiblePopulation:5,required:3,assertion:'not_met',...citation}],
 consentItems:[{id:'c',outcome:'deferred',...citation}],conditionalDecisions:[{id:'d',outcome:'Carried',...citation}],
 decisionRequirements:[{id:'r',decisionId:'d',kind:'condition',state:'unknown',observedDate:'2025-06',...citation}],
 futureMeetingSuggestions:[{id:'s',status:'tentative',date:'2025-08',...citation}],
}]});
assert.equal(evidenceReport.nativeDifferenceCount,0,JSON.stringify(evidenceReport));
console.log("Promotion audit compares all three native history arrays, including source evidence and version snapshots.");
