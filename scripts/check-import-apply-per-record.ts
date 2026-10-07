/**
 * GATE: import "Apply sections" is per record.
 *
 * One blocked record (a duplicate policy, a meeting material whose meeting is
 * still pending) never holds back the rest of a section; blocked records stay
 * approved with structured reasons; one click skips, defers, links a duplicate
 * to the existing register entry, or retries; records waiting for a meeting
 * apply automatically once that meeting is created (from any session);
 * repeated applies are idempotent and every decision leaves a note. Intake
 * promotion keeps its all-or-nothing behaviour. Synthetic data only.
 */
import assert from "node:assert/strict";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { applyApprovedSectionRecordsPortable } from "../shared/functions/importSessions";

assert.equal(actionPermission("importSessions:resolveBlockedRecords", "mutation"), "settings:write");
assert.equal(actionPermission("importSessions:compactAppliedRecords", "mutation"), "settings:write");

const society = "society_apply";
const db = new MemoryDb({ seed: {
  societies: [{ _id: society, name: "Riverbend Synthetic Society" }],
  users: [
    { _id: "user_owner", societyId: society, role: "Owner", status: "Active", displayName: "Owner" },
    { _id: "user_member", societyId: society, role: "Member", status: "Active" },
  ],
  policies: [{ _id: "policy_existing", societyId: society, policyName: "Records Retention Policy", status: "Draft", createdAtISO: "2024-01-01T00:00:00.000Z" }],
} });
let actor = "user_owner";
const runtime = new PortableRuntime({
  db, capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: actor, userId: actor, societyId: society }),
}).registerAll(PORTABLE_FUNCTIONS);
const mutate = (name: string, args: Record<string, unknown>) => runtime.runMutation(name, args) as Promise<any>;
const query = (name: string, args: Record<string, unknown>) => runtime.runQuery(name, args) as Promise<any>;
const records = async (sessionId: string) => ((await query("importSessions:get", { sessionId })) as any).records as any[];
const kind = (rows: any[], recordKind: string) => rows.filter((row) => row.recordKind === recordKind);

const source = (id: string) => ({ externalId: `local:${id}.pdf`, title: `${id}.pdf`, category: "Policy", sourceExternalIds: [`local:${id}.pdf`] });
const sessionId = await mutate("importSessions:createFromBundle", { societyId: society, name: "Class records 1/2", bundle: {
  documentMap: [source("retention"), source("conduct"), source("agenda-2024-03-12"), source("minutes-2024-03-12")],
  policies: [
    { policyName: "Records Retention Policy", status: "Draft", confidence: "High", sourceExternalIds: ["local:retention.pdf"] },
    { policyName: "Code of Conduct", status: "Draft", confidence: "High", sourceExternalIds: ["local:conduct.pdf"] },
  ],
  deadlines: [{ title: "Annual report filing", dueDate: "2025-06-30", sourceDate: "2025-01-15", sourceExternalIds: ["local:conduct.pdf"] }],
  agreements: [
    { title: "Synthetic monitoring services agreement", effectiveDate: "2024-01-01", sourceExternalIds: ["local:conduct.pdf"] },
    { title: "Agreement with a partial date", effectiveDate: "2024-13", sourceExternalIds: ["local:conduct.pdf"] },
  ],
  meetingMaterials: [
    { meetingDate: "2024-03-12", body: "board", label: "Board agenda", agendaLabel: "Agenda", sourceExternalIds: ["local:agenda-2024-03-12.pdf"] },
    { meetingDate: "2024-04-09", body: "board", label: "Agenda for an ambiguous day", agendaLabel: "Agenda", sourceExternalIds: ["local:agenda-2024-03-12.pdf"] },
  ],
  meetingMinutes: [{ meetingTitle: "Board meeting", meetingDate: "2024-03-12", body: "board", attendees: ["Avery Example"], discussion: "Synthetic minutes.", sourceExternalIds: ["local:minutes-2024-03-12.pdf"] }],
} });
// Two meetings on 2024-04-09 make that material ambiguous (a fact to fix, not something to wait for).
await db.insert("meetings", { societyId: society, title: "Board meeting A", type: "Board", scheduledAt: "2024-04-09T19:00:00.000Z", status: "Held", attendeeIds: [] });
await db.insert("meetings", { societyId: society, title: "Board meeting B", type: "Board", scheduledAt: "2024-04-09T20:00:00.000Z", status: "Held", attendeeIds: [] });

let rows = await records(sessionId);
await mutate("importSessions:bulkSetStatus", { sessionId, status: "Approved", recordIds: rows.filter((row) => row.recordKind !== "meetingMinutes").map((row) => row._id) });
await mutate("importSessions:applyApprovedDocuments", { sessionId });

// 1. Everything valid applies; the blocked records do not hold it back.
const first = await mutate("importSessions:applyApprovedSectionRecords", { sessionId });
assert.equal(first.preflightBlocked, undefined, "a partly blocked section still applies");
assert.equal(first.byKind.policy, 1, "the new policy applied");
assert.equal(first.byKind.deadline, 1, "the deadline applied");
assert.equal(first.byKind.agreement, 1, "the valid agreement applied (agreements register)");
assert.equal(first.blocked.length, 4, JSON.stringify(first.blocked));
const badAgreement = first.blocked.find((item: any) => item.recordKind === "agreement");
assert.equal(badAgreement.reason, "invalid");
const duplicate = first.blocked.find((item: any) => item.reason === "duplicate");
assert.equal(duplicate.recordKind, "policy");
assert.deepEqual(duplicate.duplicateOf, { table: "policies", id: "policy_existing", label: "Records Retention Policy" });
const waiting = first.blocked.find((item: any) => item.reason === "waiting");
assert.deepEqual(waiting.waitingFor, { kind: "meeting", meetingDate: "2024-03-12", body: "board" });
const ambiguous = first.blocked.find((item: any) => item.reason === "invalid" && item.recordKind === "meetingMaterial");
assert.equal(ambiguous.recordKind, "meetingMaterial");
assert.equal((db.dump("policies") as any[]).length, 2, "no duplicate policy was written");
rows = await records(sessionId);
for (const item of first.blocked) {
  const row = rows.find((candidate) => candidate._id === item.recordId);
  assert.equal(row.status, "Approved", "a blocked record stays approved");
  assert.ok(row.blocked?.issues?.length && /Promotion blocked/.test(row.reviewNotes), "the reason is recorded on the record");
}

// 2. Idempotent: a second apply writes nothing new and reports the same blocks.
const second = await mutate("importSessions:applyApprovedSectionRecords", { sessionId });
assert.equal(second.total, 0);
assert.equal(second.blocked.length, 4);
assert.equal((db.dump("policies") as any[]).length, 2);
assert.equal((db.dump("deadlines") as any[]).length, 1);

// 3. Approving and creating the pending meeting applies the material that waited for it (any session).
const minutesRecord = kind(await records(sessionId), "meetingMinutes")[0];
await mutate("importSessions:bulkSetStatus", { sessionId, status: "Approved", recordIds: [minutesRecord._id] });
const meetings = await mutate("importSessions:applyApprovedMeetings", { sessionId });
assert.equal(meetings.meetings, 1);
assert.equal(meetings.dependentsApplied, 1, "the waiting meeting material applied with its meeting");
const material = (db.dump("meetingMaterials") as any[]).find((row) => row.label === "Board agenda");
assert.ok(material, "the material is linked to the new meeting");
rows = await records(sessionId);
const appliedMaterial = rows.find((row) => row._id === waiting.recordId);
assert.ok(appliedMaterial.importedTargets.sections, "the dependent is marked applied");
assert.equal(appliedMaterial.blocked, undefined, "its block is cleared");

// 4. One click per blocked record: link the duplicate to the existing policy, skip or defer the rest.
actor = "user_member";
await assert.rejects(mutate("importSessions:resolveBlockedRecords", { sessionId, recordIds: [duplicate.recordId], action: "link_existing" }), /permission|not allowed|forbidden/i);
actor = "user_owner";
await assert.rejects(mutate("importSessions:resolveBlockedRecords", { sessionId, recordIds: [duplicate.recordId], action: "explode" }), /Choose skip/);
const linked = await mutate("importSessions:resolveBlockedRecords", { sessionId, recordIds: [duplicate.recordId], action: "link_existing" });
assert.equal(linked.updated, 1);
rows = await records(sessionId);
const linkedRow = rows.find((row) => row._id === duplicate.recordId);
assert.equal(linkedRow.importedTargets.sections, "policy_existing");
assert.match(linkedRow.reviewNotes, /Linked to the existing Records Retention Policy/);
const deferred = await mutate("importSessions:resolveBlockedRecords", { sessionId, recordIds: [ambiguous.recordId], action: "defer" });
assert.equal(deferred.updated, 1);
rows = await records(sessionId);
assert.equal(rows.find((row) => row._id === ambiguous.recordId).status, "Pending");
assert.match(rows.find((row) => row._id === ambiguous.recordId).reviewNotes, /Deferred:/);
await mutate("importSessions:bulkSetStatus", { sessionId, status: "Approved", recordIds: [ambiguous.recordId] });
assert.equal((await mutate("importSessions:applyApprovedSectionRecords", { sessionId })).blocked.length, 2, "a re-approved record is checked again");
await mutate("importSessions:resolveBlockedRecords", { sessionId, recordIds: [ambiguous.recordId, badAgreement.recordId], action: "skip" });
rows = await records(sessionId);
assert.equal(rows.find((row) => row._id === ambiguous.recordId).status, "Rejected");
assert.match(rows.find((row) => row._id === ambiguous.recordId).reviewNotes, /Skipped on apply/);
const done = await mutate("importSessions:applyApprovedSectionRecords", { sessionId });
assert.deepEqual([done.total, done.blocked], [0, undefined], "nothing is left to apply or blocked");
const summary = ((await query("importSessions:get", { sessionId })) as any).session.summary;
assert.equal(summary.approvedUnapplied, 0, "the session completes");

// 5. Everything blocked still reports `preflightBlocked` (older callers), and intake promotion stays all-or-nothing.
const only = await mutate("importSessions:createFromBundle", { societyId: society, name: "Only duplicates", bundle: { policies: [{ policyName: "Code of Conduct", status: "Draft", confidence: "High", sourceExternalIds: [] }] } });
await mutate("importSessions:bulkSetStatus", { sessionId: only, status: "Approved" });
const allBlocked = await mutate("importSessions:applyApprovedSectionRecords", { sessionId: only });
assert.equal(allBlocked.preflightBlocked, true);
assert.equal(allBlocked.total, 0);
const unit = await mutate("importSessions:createFromBundle", { societyId: society, name: "Unit", bundle: { policies: [{ policyName: "Code of Conduct", status: "Draft", confidence: "High", sourceExternalIds: [] }, { policyName: "Whistleblower Policy", status: "Draft", confidence: "High", sourceExternalIds: [] }] } });
await mutate("importSessions:bulkSetStatus", { sessionId: unit, status: "Approved" });
const serviceCtx: any = {
  db, capabilities: makeCapabilities({}),
  principal: { kind: "service", runtime: "test", assurance: "trusted-internal", subject: "apply-test", societyId: society, actorUserId: "user_owner", scopes: ["settings:write", "settings:read", "documents:write", "documents:read", "policies:write"] },
  runQuery: async () => { throw new Error("Unexpected nested query"); },
  runMutation: async () => { throw new Error("Unexpected nested mutation"); },
};
const unitResult: any = await applyApprovedSectionRecordsPortable(serviceCtx, { sessionId: unit, allOrNothing: true });
assert.equal(unitResult.preflightBlocked, true);
assert.ok(!(db.dump("policies") as any[]).some((row) => row.policyName === "Whistleblower Policy"), "all-or-nothing applies nothing when one record is blocked");

// 6. Compacting the finished session keeps its counts and the applied targets, and drops the staged copies.
const before = (await records(sessionId)).length;
const compacted = await mutate("importSessions:compactAppliedRecords", { sessionId });
assert.ok(compacted.removed >= 4, JSON.stringify(compacted));
const after = await query("importSessions:get", { sessionId }) as any;
assert.equal(after.records.length, before - compacted.removed, "pending and rejected records stay");
assert.equal(after.session.summary.total, summary.total, "the session summary still counts compacted records");
assert.equal(after.session.summary.sectionsApplied, summary.sectionsApplied);
assert.equal(after.session.compactedRecords.targets.length, compacted.removed, "each removed record leaves where it landed");
const reapply = await mutate("importSessions:createFromBundle", { societyId: society, name: "Same bundle again", bundle: { deadlines: [{ title: "Annual report filing", dueDate: "2025-06-30", sourceDate: "2025-01-15", sourceExternalIds: ["local:conduct.pdf"] }] } });
await mutate("importSessions:bulkSetStatus", { sessionId: reapply, status: "Approved" });
await mutate("importSessions:applyApprovedSectionRecords", { sessionId: reapply });
assert.equal((db.dump("deadlines") as any[]).length, 1, "idempotency survives compaction (import targets, not staged copies)");

// 7. Minutes merged into a meeting only an agenda evidenced ("Held — minutes missing") make it held.
const evidenced = await mutate("importSessions:createFromBundle", { societyId: society, name: "Agenda only", bundle: { meetingMinutes: [{ meetingTitle: "Board meeting", meetingDate: "2024-05-14", body: "board", meetingStatus: "HeldMinutesMissing", sourceExternalIds: ["local:agenda-2024-05-14.pdf"] }] } });
await mutate("importSessions:bulkSetStatus", { sessionId: evidenced, status: "Approved" });
await mutate("importSessions:applyApprovedMeetings", { sessionId: evidenced });
const evidencedMeeting = (db.dump("meetings") as any[]).find((row) => String(row.scheduledAt).startsWith("2024-05-14"));
assert.equal(evidencedMeeting.status, "HeldMinutesMissing");
const minutesLater = await mutate("importSessions:createFromBundle", { societyId: society, name: "Minutes later", bundle: { meetingMinutes: [{ meetingTitle: "Board meeting", meetingDate: "2024-05-14", body: "board", attendees: ["Avery Example"], discussion: "Synthetic minutes found in a package.", sourceExternalIds: ["local:package-2024-06.pdf#part-12"] }] } });
await mutate("importSessions:bulkSetStatus", { sessionId: minutesLater, status: "Approved" });
const merged = await mutate("importSessions:applyApprovedMeetings", { sessionId: minutesLater });
assert.equal(merged.existing, 1, "the minutes fold into the evidenced meeting");
assert.equal((db.dump("meetings") as any[]).find((row) => row._id === evidencedMeeting._id).status, "Held", "the meeting now has minutes");

// 8. Minutes per record too: a minutes record whose observations contradict what its meeting already holds from
// the same source (e.g. promoted from an intake review) is blocked as a duplicate; the other minutes still apply.
const observation = (text: string) => ({ entryId: "local:package-2024-07.pdf#part-3#action1", actionKey: "a1", text, status: "open" });
const reviewed = await mutate("importSessions:createFromBundle", { societyId: society, name: "Reviewed minutes", bundle: { meetingMinutes: [{ meetingTitle: "Board meeting", meetingDate: "2024-07-09", body: "board", discussion: "Reviewed.", actionObservations: [observation("Send the reviewed letter")], sourceExternalIds: ["local:package-2024-07.pdf"] }] } });
await mutate("importSessions:bulkSetStatus", { sessionId: reviewed, status: "Approved" });
await mutate("importSessions:applyApprovedMeetings", { sessionId: reviewed });
const again2 = await mutate("importSessions:createFromBundle", { societyId: society, name: "Class records again", bundle: { meetingMinutes: [
  { meetingTitle: "Board meeting", meetingDate: "2024-07-09", body: "board", discussion: "Unreviewed copy.", actionObservations: [observation("Send the letter (unreviewed wording)")], sourceExternalIds: ["local:package-2024-07.pdf"] },
  { meetingTitle: "Board meeting", meetingDate: "2024-08-13", body: "board", discussion: "Another meeting.", sourceExternalIds: ["local:minutes-2024-08-13.pdf"] },
] } });
await mutate("importSessions:bulkSetStatus", { sessionId: again2, status: "Approved" });
const minutesApply = await mutate("importSessions:applyApprovedMeetings", { sessionId: again2 });
assert.equal(minutesApply.meetings, 1, "the other minutes apply");
assert.equal(minutesApply.blocked?.length, 1, JSON.stringify(minutesApply));
assert.equal(minutesApply.blocked[0].reason, "duplicate");
assert.equal(minutesApply.blocked[0].duplicateOf.table, "meetings");
assert.match(minutesApply.blocked[0].issues[0], /already holds minutes from this source that differ/);
const conflicted = minutesApply.blocked[0].recordId;
await mutate("importSessions:resolveBlockedRecords", { sessionId: again2, recordIds: [conflicted], action: "link_existing" });
const linkedMinutes = ((await query("importSessions:get", { sessionId: again2 })) as any).records.find((row: any) => row._id === conflicted);
assert.equal(String(linkedMinutes.importedTargets.meetings.meetingId), minutesApply.blocked[0].duplicateOf.id, "linked to the meeting that holds the reviewed minutes");
assert.equal(linkedMinutes.blocked, undefined);
assert.equal(((await query("importSessions:get", { sessionId: again2 })) as any).session.summary.approvedUnapplied, 0);

console.log("PASS import apply per record: valid records apply past blocked ones; duplicates, waiting and invalid records are reported with reasons; link/skip/defer/retry resolve them; waiting materials apply when their meeting is created; conflicting minutes are blocked per record; repeated applies and compaction stay idempotent");
