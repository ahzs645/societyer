/** Two authenticated editors, real Convex validators, and transaction rollback. */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { toPortableMutationCtx } from "../convex/lib/portable";
import { updatePortable } from "../shared/functions/minutes";
import { meetingAgendaSnapshot, meetingExpectedFields, meetingFieldValuesMatch } from "../shared/meetingConcurrency";

process.env.AUTH_MODE = "better-auth";
process.env.VITE_AUTH_MODE = "better-auth";
process.env.BETTER_AUTH_BASE_URL = "https://meeting-collaboration.example.test";
const issuer = process.env.BETTER_AUTH_BASE_URL;
const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./meetings.js": () => import("../convex/meetings"),
  "./minutes.js": () => import("../convex/minutes"),
  "./agendas.js": () => import("../convex/agendas"),
});
const ids = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", {
    name: "Fictional collaboration workspace", isCharity: false, isMemberFunded: false, updatedAt: Date.now(),
  });
  for (const [subject, role] of [["editor-a", "Owner"], ["editor-b", "Admin"], ["reader", "Viewer"]]) {
    await ctx.db.insert("users", {
      societyId, email: `${subject}@example.test`, displayName: subject, role, status: "Active",
      authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-10-01T12:00:00Z",
    });
  }
  const meetingId = await ctx.db.insert("meetings", {
    societyId, title: "Fictional board meeting", type: "Board", scheduledAt: "2026-10-01T12:00:00Z",
    electronic: false, status: "Held", attendeeIds: [],
  });
  return { societyId, meetingId };
});
const first = t.withIdentity({ subject: "editor-a", issuer });
const second = t.withIdentity({ subject: "editor-b", issuer });
const reader = t.withIdentity({ subject: "reader", issuer });
const createArgs = {
  ...ids, heldAt: "2026-10-01T12:00:00Z", attendees: [], absent: [], quorumMet: false,
  quorumStatus: "not_recorded", discussion: "", motions: [], decisions: [], actionItems: [],
};
const firstId: any = await first.mutation(api.minutes.create, createArgs);
await first.mutation(api.minutes.update, { id: firstId, patch: { discussion: "The first editor's draft" } });
const secondId = await second.mutation(api.minutes.create, { ...createArgs, discussion: "A stale bootstrap" });
assert.equal(firstId, secondId, "both editors reuse the same minutes record");
assert.equal((await t.run((ctx) => ctx.db.query("minutes").collect())).length, 1);
assert.equal((await t.run((ctx) => ctx.db.get(firstId)))?.discussion, "The first editor's draft");
assert.equal((await t.run((ctx) => ctx.db.get(ids.meetingId)))?.minutesId, firstId);
const concurrentMeetingId = await t.run((ctx) => ctx.db.insert("meetings", {
  societyId: ids.societyId, title: "Fictional concurrent bootstrap", type: "Board", scheduledAt: "2026-10-01T12:00:00Z",
  electronic: false, status: "Held", attendeeIds: [],
}));
const concurrentCreates = await Promise.all([
  first.mutation(api.minutes.create, { ...createArgs, meetingId: concurrentMeetingId }),
  second.mutation(api.minutes.create, { ...createArgs, meetingId: concurrentMeetingId }),
]);
assert.equal(concurrentCreates[0], concurrentCreates[1]);
assert.equal((await t.run((ctx) => ctx.db.query("minutes").withIndex("by_meeting", (q) => q.eq("meetingId", concurrentMeetingId)).collect())).length, 1);
console.log("✓ repeated minutes bootstrap reuses one record and preserves existing work");

await t.run((ctx) => ctx.db.insert("directors", {
  societyId: ids.societyId, firstName: "Fictional", lastName: "Director", position: "Director",
  isBCResident: true, termStart: "2026-01-01", consentOnFile: true, status: "Active",
}));
const createMeeting = (status: string, attendeeIds: string[]) => first.mutation(api.meetings.create, {
  societyId: ids.societyId, title: "Fictional planned meeting", type: "Board", scheduledAt: "2027-01-01T12:00:00Z",
  electronic: false, status, attendeeIds, quorumRequired: 1,
});
for (const [status, attendeeIds, expectedAttendance] of [
  ["Scheduled", [], []],
  ["Scheduled", ["Fictional invitee"], []],
  ["Held", [], []],
  ["Held", ["Fictional recorded attendee"], ["Fictional recorded attendee"]],
] as Array<[string, string[], string[]]>) {
  const meetingId = await createMeeting(status, attendeeIds);
  const minutes = await first.query(api.minutes.getByMeeting, { meetingId });
  assert.deepEqual(minutes.attendees, expectedAttendance, "only explicitly recorded held-meeting attendees become presence");
  assert.equal(minutes.quorumStatus, "not_recorded", "a roster alone never confirms or fails quorum");
  assert.equal(minutes.quorumMet, false);
  assert.deepEqual((await t.run((ctx) => ctx.db.get(meetingId)))?.attendeeIds, attendeeIds, "meeting invitation inputs are preserved");
  if (status === "Scheduled") {
    await first.mutation(api.minutes.saveAttendanceGrid, { minutesId: minutes._id, rows: [], quorumStatusIfUnset: "confirmed" });
    assert.equal((await first.query(api.minutes.getByMeeting, { meetingId })).quorumStatus, "not_recorded", "attendance autosave cannot stamp planned quorum");
  }
}
for (const from of ["agenda", "notes"]) {
  const meetingId = await t.run((ctx) => ctx.db.insert("meetings", {
    societyId: ids.societyId, title: `Fictional ${from} meeting`, type: "Board", scheduledAt: "2027-01-02T12:00:00Z",
    electronic: false, status: "Scheduled", attendeeIds: ["Fictional invitee"], quorumRequired: 1, recordKind: "notes", workingNotes: "Preparation",
  }));
  if (from === "agenda") {
    const agendaId = await first.mutation(api.agendas.syncForMeeting, {
      societyId: ids.societyId, meetingId, items: [{ title: "Preparation" }],
    });
    await first.mutation(api.agendas.startMinutesFromAgenda, { agendaId });
  } else {
    await first.mutation(api.meetings.startMinutesFromNotes, { id: meetingId });
  }
  const minutes = await first.query(api.minutes.getByMeeting, { meetingId });
  assert.deepEqual(minutes.attendees, []);
  assert.equal(minutes.quorumStatus, "not_recorded");
}
console.log("✓ meeting, agenda, and notes scaffolds never turn directors or planned invitees into recorded presence/quorum");

await first.mutation(api.meetings.update, { id: ids.meetingId, patch: { workingNotes: "First editor notes" }, expected: { workingNotes: null } });
await assert.rejects(() => second.mutation(api.meetings.update, {
  id: ids.meetingId, patch: { workingNotes: "Stale second editor notes" }, expected: { workingNotes: null },
}), /changed while you were editing/);
await second.mutation(api.meetings.update, {
  id: ids.meetingId, patch: { location: "Room 2" }, expected: { location: null },
});
assert.equal((await t.run((ctx) => ctx.db.get(ids.meetingId)))?.workingNotes, "First editor notes");
await assert.rejects(() => reader.mutation(api.meetings.update, {
  id: ids.meetingId, patch: { workingNotes: "Read-only account" },
}), /Permission/);
console.log("✓ stale notes rejected, unrelated field edits allowed, reader writes denied");

const originalSections = [{ title: "Business", discussion: "Original" }];
await first.mutation(api.minutes.update, { id: firstId, patch: { sections: originalSections } });
const sectionArgs = (discussion: string) => ({
  id: firstId,
  patch: { sections: [{ title: "Business", discussion }] },
  expected: { sections: originalSections },
  expectedAgenda: null,
  syncAgenda: { title: "Board agenda", items: [{ title: "Business", type: "discussion", details: discussion }] },
});
const savedSections = await first.mutation(api.minutes.update, sectionArgs("First editor section"));
assert.equal(savedSections.sections[0].discussion, "First editor section");
await assert.rejects(() => second.mutation(api.minutes.update, sectionArgs("Stale second section")), /changed while you were editing/);
const agenda = await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId });
assert.equal(agenda.items[0].details, "First editor section");
assert.deepEqual(savedSections.agenda, meetingAgendaSnapshot(agenda), "save returns its canonical agenda before the subscription echo");
const beforeSections: any = await t.run((ctx) => ctx.db.get(firstId));
await assert.rejects(() => first.mutation(api.minutes.update, {
  id: firstId, patch: { sections: [{ title: "Invalid replacement" }] },
  expected: { sections: beforeSections.sections },
  syncAgenda: { items: [{ title: "Invalid replacement", requestedAction: "invalid" }] },
}), /Requested action/);
assert.deepEqual((await t.run((ctx) => ctx.db.get(firstId)))?.sections, beforeSections.sections, "agenda failure rolls back the preceding minutes write");
assert.equal((await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId })).items[0].details, "First editor section");
console.log("✓ sections and agenda commit atomically; stale editor and failed agenda cannot overwrite either");

const staleAgendaSave = (expectedAgenda: any) => first.mutation(api.minutes.update, {
  id: firstId,
  patch: { sections: [{ title: "Business", discussion: "Stale agenda replacement" }] },
  expected: { sections: beforeSections.sections },
  expectedAgenda,
  syncAgenda: { title: "Board agenda", items: [{ title: "Business", details: "Stale agenda replacement" }] },
});
await second.mutation(api.agendas.updateAgenda, { agendaId: agenda.agenda._id, title: "Colleague's agenda title" });
await assert.rejects(() => staleAgendaSave(meetingAgendaSnapshot(agenda)), /meeting agenda changed while you were editing/);
const afterHeaderEdit = await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId });
await second.mutation(api.agendas.updateItem, {
  itemId: afterHeaderEdit.items[0]._id, details: "Colleague's preparation", presenter: "Fictional presenter", timeAllottedMinutes: 12,
});
const afterItemEdit = await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId });
assert.equal(afterItemEdit.agenda.updatedAtISO, afterHeaderEdit.agenda.updatedAtISO, "item-only edits do not update the agenda header timestamp");
await assert.rejects(() => staleAgendaSave(meetingAgendaSnapshot(afterHeaderEdit)), /meeting agenda changed while you were editing/);
assert.deepEqual((await t.run((ctx) => ctx.db.get(firstId)))?.sections, beforeSections.sections, "agenda conflicts cannot partially save minutes");
assert.deepEqual(await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId }), afterItemEdit, "both title and item-only colleague changes survive stale section saves");
const reconciledAgenda = await first.mutation(api.minutes.update, {
  id: firstId,
  patch: { sections: [{ title: "Business", discussion: "Reviewed together" }] },
  expected: { sections: beforeSections.sections },
  expectedAgenda: meetingAgendaSnapshot(afterItemEdit),
  syncAgenda: { title: afterItemEdit.agenda.title, items: [{ title: "Business", details: "Reviewed together" }] },
});
assert.deepEqual(reconciledAgenda.agenda, meetingAgendaSnapshot(await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId })));
assert.equal(reconciledAgenda.agenda.items[0].presenter, "Fictional presenter", "omitted agenda metadata remains intact");
console.log("✓ agenda-only title and item edits reject stale minute synchronization; refreshed baselines save successfully");

const initialMotions = await first.mutation(api.minutes.update, {
  id: firstId, patch: { motions: [{ text: "Review the report", outcome: "Pending", movedBy: "Fictional mover" }] },
  expected: { motions: [] },
});
const motionId = initialMotions.motions[0].motionId;
assert.ok(motionId, "saved motions return the canonical server-assigned identity");
await t.run((ctx) => ctx.db.patch(motionId, {
  notes: "Retain external context", sourceDocumentIds: [], backlogPriority: "high", targetMeetingId: ids.meetingId,
}));
const changedMotions = await second.mutation(api.minutes.update, {
  id: firstId,
  patch: { motions: [{ ...initialMotions.motions[0], text: "Review the revised report", movedBy: undefined }] },
  expected: { motions: initialMotions.motions },
});
const changedMotion: any = await t.run((ctx) => ctx.db.get(motionId));
assert.equal(changedMotion.notes, "Retain external context");
assert.equal(changedMotion.backlogPriority, "high");
assert.equal(changedMotion.targetMeetingId, ids.meetingId);
assert.equal(changedMotion.movedBy, undefined, "cleared editor fields do not linger");
assert.equal(changedMotion.history.length, 2, "motion history is append-only across edits");
await first.mutation(api.minutes.update, { id: firstId, patch: { motions: changedMotions.motions }, expected: { motions: changedMotions.motions } });
assert.equal((await t.run((ctx) => ctx.db.get(motionId)))?.history?.length, 2, "unchanged re-sync does not add history or write the motion again");
await assert.rejects(() => first.mutation(api.minutes.update, {
  id: firstId, patch: { motions: initialMotions.motions }, expected: { motions: initialMotions.motions },
}), /changed while you were editing/);
console.log("✓ motion edits preserve history and metadata, clear fields, return canonical IDs, and reject stale arrays");

// An agenda can retain the proposed wording after its linked motion was amended
// and voted on. Saving section notes must reconcile that motion by its identity.
const linkedMeetingId = await t.run((ctx) => ctx.db.insert("meetings", {
  societyId: ids.societyId, title: "Fictional linked-motion meeting", type: "Board", scheduledAt: "2026-10-02T12:00:00Z",
  electronic: false, status: "Held", attendeeIds: [],
}));
const linkedMinutesId = await first.mutation(api.minutes.create, {
  ...createArgs, meetingId: linkedMeetingId, motions: [{ text: "Original proposed wording", outcome: "Pending" }],
});
const proposedMinutes = await first.query(api.minutes.getByMeeting, { meetingId: linkedMeetingId });
const linkedMotionId = proposedMinutes.displayMotions[0].motionId;
await first.mutation(api.agendas.syncForMeeting, {
  societyId: ids.societyId, meetingId: linkedMeetingId,
  items: [{ title: "Decision", motionId: linkedMotionId, motionText: "Original proposed wording" }],
});
const linkedBase = await first.query(api.minutes.getByMeeting, { meetingId: linkedMeetingId });
await second.mutation(api.minutes.update, {
  id: linkedMinutesId,
  patch: { motions: [{ ...linkedBase.displayMotions[0], text: "Amended and approved wording", outcome: "Carried", votesFor: 2, votesAgainst: 0 }] },
  expected: { motions: linkedBase.displayMotions },
});
const linkedAgenda = await first.query(api.agendas.getForMeeting, { meetingId: linkedMeetingId });
await first.mutation(api.minutes.update, {
  id: linkedMinutesId,
  patch: { sections: [{ ...linkedBase.sections[0], discussion: "The decision was discussed." }] },
  expected: { sections: linkedBase.sections },
  expectedAgenda: meetingAgendaSnapshot(linkedAgenda),
  syncAgenda: { items: [{ title: "Decision", details: "The decision was discussed." }] },
});
const afterLinkedSection = await first.query(api.minutes.getByMeeting, { meetingId: linkedMeetingId });
assert.deepEqual(afterLinkedSection.motionIds, [linkedMotionId], "agenda sync cannot duplicate a linked motion identity");
assert.equal(afterLinkedSection.displayMotions.length, 1);
assert.equal(afterLinkedSection.displayMotions[0].text, "Amended and approved wording");
assert.equal(afterLinkedSection.displayMotions[0].outcome, "Carried");
assert.equal(afterLinkedSection.displayMotions[0].votesFor, 2);
console.log("✓ section synchronization preserves a linked motion's amended wording and recorded vote");

// Inject an I/O failure after one motion was changed. Swallowing it used to
// commit partial motion edits and the surrounding minutes text as a success.
const beforeFailure: any = await t.run((ctx) => ctx.db.get(firstId));
const beforeMotionFailure: any = await t.run((ctx) => ctx.db.get(motionId));
await assert.rejects(() => first.mutation(async (native) => {
  const portable = await toPortableMutationCtx(native);
  const failingDb = new Proxy(portable.db, {
    get(target, key) {
      if (key === "insert") return async (table: string, fields: any) => {
        if (table === "motions" && fields.text === "Fail this insert") throw new Error("Injected motion write failure");
        return target.insert(table, fields);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return updatePortable({ ...portable, db: failingDb }, {
    id: firstId, patch: {
      discussion: "Must roll back",
      motions: [{ ...changedMotions.motions[0], text: "Must also roll back" }, { text: "Fail this insert", outcome: "Pending" }],
    },
  });
}), /Injected motion write failure/);
assert.deepEqual(await t.run((ctx) => ctx.db.get(firstId)), beforeFailure);
assert.deepEqual(await t.run((ctx) => ctx.db.get(motionId)), beforeMotionFailure);
console.log("✓ motion write failure rolls back the complete transaction");

const attendanceBase = meetingExpectedFields(beforeFailure, ["attendees", "absent", "detailedAttendance"]);
await first.mutation(api.minutes.saveAttendanceGrid, {
  minutesId: firstId, expected: attendanceBase,
  rows: [{ name: "Fictional attendee A", status: "present", quorumCounted: true }],
  quorumStatusIfUnset: "confirmed",
});
await assert.rejects(() => second.mutation(api.minutes.saveAttendanceGrid, {
  minutesId: firstId, expected: attendanceBase,
  rows: [{ name: "Fictional attendee B", status: "present", quorumCounted: true }],
}), /changed while you were editing/);
assert.deepEqual((await t.run((ctx) => ctx.db.get(firstId)))?.attendees, ["Fictional attendee A"]);
assert.equal((await t.run((ctx) => ctx.db.get(firstId)))?.quorumStatus, "confirmed", "recorded attendance may confirm previously unknown quorum for a held meeting");
assert.deepEqual((await t.run((ctx) => ctx.db.get(ids.meetingId)))?.attendeeIds, ["Fictional attendee A"]);
assert.equal((await t.run((ctx) => ctx.db.query("meetingAttendanceRecords").collect())).length, 1);
assert.equal(meetingFieldValuesMatch({ b: 1, a: [2], extra: undefined }, { a: [2], b: 1 }), true);
assert.equal(meetingFieldValuesMatch(undefined, null), true);
assert.throws(() => meetingFieldValuesMatch(1n, 1n), /plain JSON values/);
assert.throws(() => meetingFieldValuesMatch(new ArrayBuffer(1), {}), /plain JSON values/);
console.log("✓ stale attendance cannot erase another editor's rows; optional fields and object-key order compare consistently");

const duplicate = await t.run(async (ctx) => {
  const meetingId = await ctx.db.insert("meetings", {
    societyId: ids.societyId, title: "Fictional source duplicate", type: "Board", scheduledAt: "2026-10-01T12:00:00Z",
    electronic: false, status: "Held", attendeeIds: [],
  });
  const minutesId = await ctx.db.insert("minutes", {
    ...createArgs, meetingId, sourceMeetingRecord: { sourceText: "x".repeat(410_000) },
  } as any);
  await ctx.db.patch(meetingId, { minutesId });
  return { meetingId, minutesId };
});
await assert.rejects(() => first.mutation(api.meetings.merge, {
  targetId: ids.meetingId, duplicateId: duplicate.meetingId,
}), /too large to preserve/);
assert.ok(await t.run((ctx) => ctx.db.get(duplicate.meetingId)));
assert.equal(((await t.run((ctx) => ctx.db.get(duplicate.minutesId)))?.sourceMeetingRecord as any)?.sourceText.length, 410_000);
console.log("✓ oversized duplicate source records block destructive merging instead of silently truncating evidence");

await first.mutation(api.minutes.update, { id: firstId, patch: { approvedAt: "2026-10-02T12:00:00Z" } });
await assert.rejects(() => first.mutation(api.meetings.remove, { id: ids.meetingId }), /approved minutes/);
assert.ok(await t.run((ctx) => ctx.db.get(ids.meetingId)));
assert.ok((await t.run((ctx) => ctx.db.get(firstId)))?.approvedAt);
assert.ok(await first.query(api.agendas.getForMeeting, { meetingId: ids.meetingId }));
console.log("✓ deleting a meeting cannot bypass its approved-minutes protection or remove the agenda");

const draftAgendaMeeting = await t.run(ctx => ctx.db.insert("meetings", {
  societyId: ids.societyId, title: "Fictional recoverable agenda", type: "Board", scheduledAt: "2027-01-02T12:00:00Z",
  electronic: false, status: "Scheduled", attendeeIds: ["Fictional invitee"], quorumRequired: 1,
}));
const initialAgendaArgs = {
  societyId: ids.societyId, meetingId: draftAgendaMeeting, expectedAgenda: null,
  expectedNoMinutes: true, initializeMinutes: true, items: [{ title: "First agenda item", depth: 0 as const }],
};
await first.mutation(api.agendas.syncForMeeting, initialAgendaArgs);
const initialAgenda = await first.query(api.agendas.getForMeeting, { meetingId: draftAgendaMeeting });
const initialMinutes = await first.query(api.minutes.getByMeeting, { meetingId: draftAgendaMeeting });
assert.ok(initialMinutes);
assert.equal(initialMinutes.sections[0].agendaItemId, initialAgenda.items[0]._id);
assert.deepEqual(initialMinutes.attendees, [], "initial agenda save does not turn invitees into attendance");
assert.equal(initialMinutes.quorumStatus, "not_recorded");
await assert.rejects(() => second.mutation(api.agendas.syncForMeeting, {
  ...initialAgendaArgs, items: [{ title: "Recovered stale item" }],
}), /minutes changed while you were editing/);
assert.deepEqual(await first.query(api.agendas.getForMeeting, { meetingId: draftAgendaMeeting }), initialAgenda);
assert.equal((await t.run(ctx => ctx.db.query("minutes").withIndex("by_meeting", q => q.eq("meetingId", draftAgendaMeeting)).collect())).length, 1);
await second.mutation(api.agendas.updateItem, { itemId: initialAgenda.items[0]._id, presenter: "Fictional new presenter" });
await assert.rejects(() => first.mutation(api.agendas.syncForMeeting, {
  societyId: ids.societyId, meetingId: draftAgendaMeeting, expectedAgenda: meetingAgendaSnapshot(initialAgenda),
  items: [{ title: "Stale renamed item" }],
}), /meeting agenda changed while you were editing/);
assert.equal((await first.query(api.agendas.getForMeeting, { meetingId: draftAgendaMeeting })).items[0].presenter, "Fictional new presenter");
await assert.rejects(() => reader.mutation(api.agendas.syncForMeeting, initialAgendaArgs), /Permission|permission/);
console.log("✓ initial agenda and minutes creation is atomic; recovered stale agendas cannot replace independently created minutes or changed items");

const meetingAck = await first.mutation(api.meetings.update, {
  id: draftAgendaMeeting, expected: { title: "Fictional recoverable agenda", committeeId: null },
  patch: { title: "Fictional accepted title", clearCommitteeId: true },
});
assert.deepEqual(meetingAck.expected, { title: "Fictional accepted title", committeeId: null });
assert.deepEqual(Object.keys(meetingAck), ["expected"], "acknowledgements do not return unrelated meeting content");
await first.mutation(api.meetings.update, { id: draftAgendaMeeting, expected: meetingAck.expected, patch: { title: "Fictional later typing" } });
await assert.rejects(() => second.mutation(api.meetings.update, {
  id: draftAgendaMeeting, expected: meetingAck.expected, patch: { title: "Fictional stale title" },
}), /changed while you were editing/);
const attendanceAck = await first.mutation(api.minutes.saveAttendanceGrid, {
  minutesId: initialMinutes._id, expected: meetingExpectedFields(initialMinutes, ["attendees", "absent", "detailedAttendance"]),
  rows: [{ name: "  Fictional Person  ", status: "present" }],
});
assert.deepEqual(attendanceAck.expected, meetingExpectedFields(await first.query(api.minutes.getByMeeting, { meetingId: draftAgendaMeeting }), ["attendees", "absent", "detailedAttendance"]));
assert.equal(attendanceAck.attendees, 1, "existing count fields remain compatible");
await first.mutation(api.minutes.saveAttendanceGrid, {
  minutesId: initialMinutes._id, expected: attendanceAck.expected,
  rows: [{ name: "Fictional Person", status: "absent" }],
});
console.log("✓ accepted meeting and normalized attendance baselines let newer drafts save while still rejecting stale collaborators");

await assert.rejects(() => t.mutation(api.minutes.update, { id: firstId, patch: { discussion: "Anonymous edit" } }), /Authentication|Permission|authenticated/i);
console.log("Meeting collaboration checks passed (synthetic data, no live deployment).");
