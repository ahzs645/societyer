import assert from "node:assert/strict";
import { structuredEditFromMinutes, structuredPatchFromEdit, structuredMetadataChanges } from "../src/features/meetings/lib/structuredMinutes";
import { normalizeMinuteSectionsPayload, normalizeDetailedAttendancePayload, normalizeAgendaItemsPayload } from "../shared/functions/importSessionHelpers/importSessionNormalize";
const original = {
  detailedAttendance: [{ status: "present", name: "Alex | Rivera", affiliation: "Committee; Board", quorumCounted: false, notes: "Arrived\nlate" }],
  sections: [{ type: "report", title: "Funds | approval", motionText: "Receive report; approve budget", motionId: "existing_motion", discussion: "Line 1\nLine 2", decisions: ["Accept; subject to review", "A | B"], actionItems: [{ text: "Send report; include A | B\nAppendix", assignee: "Alex", dueDate: "2025-04-01", done: true }, { text: "Await reply", done: false }] }],
  sessionSegments: [{ type: "public", notes: "A | B\nC" }],
  appendices: [{ title: "Appendix | A", notes: "One\nTwo" }],
  agmDetails: { financialStatementsPresented: false, directorAppointments: [{ name: "Alex", votesReceived: 0, elected: false, notes: "Pending | decision" }], specialResolutionExhibits: [{ title: "A; B", notes: "X\nY" }] },
};
const roundtrip = structuredPatchFromEdit(structuredEditFromMinutes(original));
for (const key of ["detailedAttendance", "sections", "sessionSegments", "appendices"] as const) assert.deepEqual(roundtrip[key], original[key]);
assert.deepEqual(roundtrip.agmDetails?.directorAppointments, original.agmDetails.directorAppointments);
assert.deepEqual(roundtrip.agmDetails?.specialResolutionExhibits, original.agmDetails.specialResolutionExhibits);
for (const value of [true, false, undefined]) {
  assert.equal(structuredPatchFromEdit(structuredEditFromMinutes({ agmDetails: { financialStatementsPresented: value } })).agmDetails?.financialStatementsPresented, value);
}
const legacy = structuredEditFromMinutes({});
legacy.sections = "report | Finance | Alex | Read report | no | Accept; File | Send copy";
const parsed = structuredPatchFromEdit(legacy).sections;
assert.equal(parsed[0].reportSubmitted, false);
assert.deepEqual(parsed[0].decisions, ["Accept", "File"]);
assert.deepEqual(parsed[0].actionItems, [{ text: "Send copy", done: false }]);
legacy.sections = '[{"title":"broken"}';
assert.throws(() => structuredPatchFromEdit(legacy), /Invalid structured minutes JSON/);
legacy.sections = '{"title":"not array"}';
assert.throws(() => structuredPatchFromEdit(legacy), /JSON array/);
assert.equal(normalizeMinuteSectionsPayload(original.sections)?.[0]?.motionText, original.sections[0].motionText);
// C7/C8/A12: section links and action status survive normalization; unknown stays unknown.
const linked = normalizeMinuteSectionsPayload([{ title: "Item", depth: 1, publicVisible: false, motionIndex: 0, actionItems: [{ text: "No status" }, { text: "Finished", status: "Done" }, { text: "Old flag", done: true }] }])![0];
assert.deepEqual([linked.depth, linked.publicVisible, linked.motionIndex], [1, false, 0]);
assert.deepEqual(linked.actionItems.map((item: any) => [item.status, item.done]), [["unknown", false], ["completed", true], ["completed", true]]);
assert.equal(linked.actionItems[1].sourceStatus, "Done");
assert.equal(normalizeDetailedAttendancePayload([{ name: "Alex Example" }])![0].status, "unknown", "C8: missing attendance status stays unknown");
const agenda = normalizeAgendaItemsPayload(["Plain title", { number: "4", title: "Approve minutes", requestedAction: "Approve", startTime: "5:13", presenter: "Chair", consent: "yes" }]);
assert.equal(agenda[0], "Plain title");
assert.deepEqual(agenda[1], { title: "Approve minutes", itemNumber: "4", scheduledTimeText: "5:13", presenter: "Chair", requestedAction: "approve", consent: true });
console.log("Structured minutes: section links, action status and agenda item objects passed.");
console.log("Structured minutes: metadata, delimiters, AGM tri-state, legacy rows, invalid input, section motion text passed.");

const metadataOriginal = structuredEditFromMinutes(original);
const changedAppendices = [{ title: "Revised | appendix", notes: "Literal separator | and\nnewline" }];
const metadataChanges = structuredMetadataChanges({ ...metadataOriginal, appendices: JSON.stringify(changedAppendices) }, metadataOriginal);
assert.deepEqual(metadataChanges.appendices, changedAppendices, "metadata saves preserve edited JSON compound rows");
assert.throws(() => structuredMetadataChanges({ ...metadataOriginal, appendices: '[{"notes":"Missing title"}]' }, metadataOriginal), /title is required/);
