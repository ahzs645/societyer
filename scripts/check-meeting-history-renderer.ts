import type { QuorumCheckpoint } from "../shared/evidenceReview";
import { buildSourceMeetingRecord } from "../shared/sourceMeetingRecord";
import assert from "node:assert/strict";
import { renderMinutesHtml, MINUTES_EXPORT_STYLES } from "../src/features/meetings/lib/minutesRenderer";
import type { MeetingHistory } from "../shared/meetingHistory";
import { structuredEditFromMinutes, structuredPatchFromEdit } from "../src/features/meetings/lib/structuredMinutes";

const history: MeetingHistory & { quorumCheckpoints: QuorumCheckpoint[] } = {
  actionObservations: [
    { entryId: "observation-one", actionKey: "source-key-17", sourceActionId: "17", text: "Private action <script>alert(1)</script>", assignee: "Sensitive Person", status: "unknown", sourceStatus: "C (unresolved code)", sourceExternalIds: ["private-source-1"], evidence: "private-action-evidence" },
    { entryId: "observation-two", actionKey: "source-key-17", text: "Later observation", status: "on_hold", statusAsOf: "2020-07-14", dateAssigned: "2020-05-12", dueDate: "2020-08-01", carriedFromMinutesId: "prior-minutes", carriedFromEntryId: "prior-entry" },
  ],
  quorumCheckpoints: [
    { id: "q1", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", scope: "session", scopeLabel: "AGM opening", atTime: "5:11 pm", assertion: "confirmed", eligibleCount: 13, eligiblePopulation: 15, evidence: "private-quorum-evidence" },
    { id: "q2", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", scope: "item", scopeLabel: "Private late item", assertion: "not_recorded", eligibleCount: 0 },
  ],
  importedSourceVersions: [
    { versionId: "v1", label: "Unreviewed source", status: "unknown", sourceExternalIds: ["private-version-source"], notes: "private-version-note" },
    { versionId: "v2", label: "Later adopted version", status: "adopted", sourceDate: "2020-07-14", supersedesVersionId: "v1", adoptedAt: "2020-09-03", adoptionEvidence: "private-adoption-evidence", adoptedInMeetingId: "adopting-meeting", adoptionMotionId: "adoption-motion", sourceExternalIds: ["private-version-two"], contentJson: '{"privateSnapshot":"must-not-be-dumped"}' },
  ],
};
const minutes = { heldAt: "2020-07-14T12:00:00Z", attendees: [], absent: [], quorumMet: false, quorumStatus: "not_recorded" as const, discussion: "Ordinary source discussion", sections: [{ title: "Opening", discussion: "Ordinary section" }], motions: [], decisions: [], actionItems: [], ...history };
const before = structuredClone(minutes);
const args = { society: { name: "History fixture" }, meeting: { title: "Board meeting", type: "Board", scheduledAt: minutes.heldAt }, minutes };
for (const { id: styleId } of MINUTES_EXPORT_STYLES) {
  const html = renderMinutesHtml({ ...args, styleId, options: { includeGeneratedFooter: false } });
  for (const heading of ["Action observations", "Quorum observations", "Imported source versions"]) assert.ok(html.includes(heading), `${styleId}: ${heading}`);
  assert.match(html, /Status:<\/strong> Unknown/);
  assert.match(html, /As of:<\/strong> Not recorded/);
  assert.match(html, /Status:<\/strong> On hold · <strong>As of:<\/strong> 2020-07-14/);
  assert.match(html, /Carried from:<\/strong> Minutes prior-minutes, observation prior-entry/);
  assert.match(html, /Session: AGM opening/);
  assert.match(html, /Item: Private late item/);
  assert.match(html, /present count 0/);
  assert.equal((html.match(/<h2>Quorum observations<\/h2>/g) ?? []).length, 1, "one checkpoint quorum section");
  assert.ok(html.indexOf("Session: AGM opening") < html.indexOf("Item: Private late item"), "source quorum order retained");
  assert.match(html, /Supersedes:<\/strong> Unreviewed source/);
  assert.match(html, /Adopted:<\/strong> 2020-09-03/);
  assert.match(html, /private-adoption-evidence/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|must-not-be-dumped/);
  const publicHtml = renderMinutesHtml({ ...args, styleId, options: { publicCopy: true, includeGeneratedFooter: false } });
  for (const secret of ["Action observations", "Quorum observations", "Imported source versions", "Sensitive Person", "Private action", "private-action-evidence", "private-quorum-evidence", "Private late item", "private-version-source", "private-version-note", "private-adoption-evidence", "source-key-17", "prior-entry", "privateSnapshot"]) assert.ok(!publicHtml.includes(secret), `${styleId} public copy leaked ${secret}`);
}
assert.deepEqual(minutes, before, "rendering and public omission do not mutate original evidence");
const hiddenActions = renderMinutesHtml({ ...args, options: { includeActionItems: false } });
assert.doesNotMatch(hiddenActions, /Action observations/);
assert.match(hiddenActions, /Quorum observations/);
assert.match(hiddenActions, /Imported source versions/);
const legacyPatch = structuredPatchFromEdit(structuredEditFromMinutes(minutes));
for (const key of ["actionObservations", "quorumCheckpoints", "importedSourceVersions"]) assert.ok(!Object.hasOwn(legacyPatch, key), "legacy editor must not clear separately edited history");
console.log("Meeting history renderer: all six styles retain observations, scope, version relationships, escaping and as-of uncertainty; public copies omit all history evidence; legacy editor leaves history untouched.");

// Complete source recreation and local history coexist in every private style.
const sourceMeetingRecord = buildSourceMeetingRecord({ sourceDocuments: [{ _id: "history-source", title: "Original minutes", selectedText: "Original source wording SOURCE-HISTORY-RETENTION" }], minutes });
for (const { id: styleId } of MINUTES_EXPORT_STYLES) {
  const sourceArgs = { ...args, minutes: { ...minutes, sourceMeetingRecord }, styleId };
  const html = renderMinutesHtml({ ...sourceArgs, options: { privateCopy: true, includeGeneratedFooter: false } });
  assert.match(html, /SOURCE-HISTORY-RETENTION/);
  for (const heading of ["Action observations", "Quorum observations", "Imported source versions"]) assert.ok(html.includes(heading), `${styleId}: source recreation retains ${heading}`);
  for (const options of [{ publicCopy: true }, { publicOnly: true }]) {
    const publicHtml = renderMinutesHtml({ ...sourceArgs, options });
    assert.doesNotMatch(publicHtml, /SOURCE-HISTORY-RETENTION|private-action-evidence|private-quorum-evidence|private-adoption-evidence/);
  }
}
console.log("Complete source recreation retains meeting history; both public export flags suppress source and history evidence.");
