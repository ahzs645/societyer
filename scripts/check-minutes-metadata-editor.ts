import assert from "node:assert/strict";
import { structuredEditFromMinutes, structuredMetadataChanges, structuredMetadataPatchFromEdit } from "../src/features/meetings/lib/structuredMinutes";
import { recordedMinutesQuorum, minutesQuorumLabel } from "../shared/minutesQuorum";
import { normalizeMeetingMinutesPayload } from "../shared/functions/importSessionHelpers/importSessionNormalize";
import { parseMeetingTemplateImport } from "../src/features/meetings/lib/templateImport";

const source = {
  chairName: "Original chair",
  remoteParticipation: { url: "https://example.org/join", passcode: "source-passcode" },
  sections: [{ title: "Finance", depth: 1, motionId: "motion-1", linkedTaskIds: ["task-1"], publicVisible: false,
    actionItems: [{ text: "Reconcile", assignee: "Treasurer", dueDate: "2026-10-20", done: true }] }],
  detailedAttendance: [{ name: "Director", status: "present", quorumCounted: true }],
  appendices: [{ title: "Report", notes: "Multiple\nsource lines | with separator" }],
  agmDetails: { financialStatementsPresented: true },
};
const original = structuredEditFromMinutes(source);
assert.deepEqual(structuredMetadataChanges(original, original), {});
const changes = structuredMetadataChanges({ ...original, chairName: "New chair" }, original);
assert.deepEqual(changes, { chairName: "New chair" });
const fullPatch = structuredMetadataPatchFromEdit(original);
for (const field of ["sections", "detailedAttendance", "motions", "motionIds", "actionItems", "approvedAt"]) {
  assert.equal(Object.hasOwn(fullPatch, field), false, `${field} must remain owned by its dedicated editor`);
}
const cleared = JSON.parse(JSON.stringify(structuredMetadataChanges({ ...original, chairName: "", remoteUrl: "", remotePasscode: "", financialStatementsPresented: false }, original)));
assert.equal(cleared.chairName, "");
assert.equal(cleared.remoteParticipation.url, "");
assert.equal(cleared.remoteParticipation.passcode, "");
assert.equal(cleared.agmDetails.financialStatementsPresented, false);
const merged = { ...source, ...changes };
assert.deepEqual(merged.sections, source.sections);
assert.deepEqual(merged.detailedAttendance, source.detailedAttendance);
assert.deepEqual(merged.appendices, source.appendices);
assert.throws(() => structuredMetadataChanges({ ...original, appendices: "Report | financial | page 1 | note | extra" }, original), /Appendices, row 1/);
assert.throws(() => structuredMetadataChanges({ ...original, appendices: "Report | financial | page 1 | multiline\nnote" }, original), /Appendices, row 2/);
assert.throws(() => structuredMetadataChanges({ ...original, directorAppointments: "Elected | Director | Chair | Org | 1 year | perhaps | 2 | yes |" }, original), /consent and elected/);
assert.equal(recordedMinutesQuorum({ quorumMet: false, quorumStatus: "not_recorded" }), null);
assert.equal(minutesQuorumLabel({ quorumMet: true, quorumStatus: "not_met" }), "Not met");
assert.equal(normalizeMeetingMinutesPayload({}).quorumStatus, "not_recorded");
assert.equal(normalizeMeetingMinutesPayload({ quorumMet: false }).quorumStatus, "not_met");
assert.equal(normalizeMeetingMinutesPayload({ quorumMet: false, quorumStatus: "not_recorded" }).quorumStatus, "not_recorded");
const template = parseMeetingTemplateImport(JSON.stringify({ societyId: "other-workspace", isDefault: true, name: "PGAIR", items: [{ title: "Welcome", depth: 0 }] }));
assert.equal(Object.hasOwn(template, "societyId"), false);
assert.equal(template.isDefault, false);
assert.throws(() => parseMeetingTemplateImport('{"name":"PGAIR","items":[{"title":"Adoption","motionTemplateId":"cross-workspace"}]}'), /workspace record ID/);
assert.throws(() => parseMeetingTemplateImport('{"name":"PGAIR","items":[{"title":"Nested","depth":1}]}'), /first agenda item/);
console.log("Minutes metadata: isolated changes, no-op source preservation and transport-safe clearing passed.");
