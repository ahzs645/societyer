import assert from "node:assert/strict";

import {
  diffRegister,
  planApply,
  IGNORED_COMPARE_FIELDS,
  type ChangeOp,
  type DiffRow,
} from "../shared/registerDiff";
import { type VersionedRow } from "../shared/versionedRegister";

type DirectorRow = VersionedRow & {
  seat: string;
  fullName: string;
  office: string;
};

function director(
  seat: string,
  fullName: string,
  office: string,
  stamps: Partial<VersionedRow> = {},
): DirectorRow {
  return {
    seat,
    fullName,
    office,
    enteredAtISO: "2020-01-01T00:00:00.000Z",
    enteredByUserId: "user_seed",
    supersededAtISO: null,
    supersededByUserId: null,
    ...stamps,
  };
}

// --- diffRegister classification with a custom keyField ('seat') ---------------

// current: ada (will be updated), ben (unchanged), carol (will be deleted)
const adaCurrent = director("1", "Ada", "President");
const benCurrent = director("2", "Ben", "Secretary");
const carolCurrent = director("3", "Carol", "Treasurer");

// desired: ada (office changed), ben (same payload, different stamps), dave (new)
const adaDesired = director("1", "Ada", "Chair");
const benDesired = director("2", "Ben", "Secretary", {
  // Different versioning stamps must NOT trigger an 'update'.
  enteredAtISO: "2025-12-31T00:00:00.000Z",
  enteredByUserId: "someone-else",
  _id: "convex123",
  _creationTime: 999,
} as Partial<VersionedRow>);
const daveDesired = director("4", "Dave", "Director");

const diff = diffRegister<DirectorRow>(
  [adaCurrent, benCurrent, carolCurrent],
  [adaDesired, benDesired, daveDesired],
  { keyField: "seat" },
);

function opFor(key: string): ChangeOp {
  const row = diff.find((d) => d.key === key);
  assert.ok(row, `diff row for key ${key} exists`);
  return row.op;
}

assert.equal(opFor("1"), "update", "ada office changed -> update");
assert.equal(opFor("2"), "unchanged", "ben only stamps changed -> unchanged");
assert.equal(opFor("3"), "delete", "carol absent from desired -> delete");
assert.equal(opFor("4"), "new", "dave absent from current -> new");
assert.equal(diff.length, 4, "exactly four diff rows");

// new/delete rows carry the right side only.
const daveDiff = diff.find((d) => d.key === "4") as DiffRow<DirectorRow>;
assert.equal(daveDiff.current, undefined, "new row has no current");
assert.equal(daveDiff.desired, daveDesired, "new row carries desired");
const carolDiff = diff.find((d) => d.key === "3") as DiffRow<DirectorRow>;
assert.equal(carolDiff.desired, undefined, "delete row has no desired");
assert.equal(carolDiff.current, carolCurrent, "delete row carries current");

// --- compareFields restricts which fields trigger 'update' ---------------------

// Ada's office differs but fullName is identical. Comparing only fullName ->
// unchanged; comparing only office -> update.
const diffByName = diffRegister<DirectorRow>([adaCurrent], [adaDesired], {
  keyField: "seat",
  compareFields: ["fullName"],
});
assert.equal(diffByName[0].op, "unchanged", "compareFields=[fullName] ignores office change");

const diffByOffice = diffRegister<DirectorRow>([adaCurrent], [adaDesired], {
  keyField: "seat",
  compareFields: ["office"],
});
assert.equal(diffByOffice[0].op, "update", "compareFields=[office] catches office change");

// --- default keyField is 'recordId' --------------------------------------------

type RecordRow = VersionedRow & { recordId: string; label: string };
const defKeyDiff = diffRegister<RecordRow>(
  [{ recordId: "x", label: "old", enteredAtISO: "2020-01-01T00:00:00.000Z", supersededAtISO: null }],
  [{ recordId: "x", label: "new", enteredAtISO: "2020-01-01T00:00:00.000Z", supersededAtISO: null }],
);
assert.equal(defKeyDiff[0].key, "x", "default keyField is recordId");
assert.equal(defKeyDiff[0].op, "update", "label change detected under default key");

// IGNORED set covers the documented stamps.
for (const f of [
  "enteredAtISO",
  "supersededAtISO",
  "enteredByUserId",
  "supersededByUserId",
  "_id",
  "_creationTime",
]) {
  assert.ok(IGNORED_COMPARE_FIELDS.has(f), `${f} is ignored in comparison`);
}

// --- planApply counts and stamps ----------------------------------------------

const nowISO = "2026-06-25T12:00:00.000Z";
const plan = planApply<DirectorRow>(diff, nowISO, "user_actor");

// diff = 1 update + 1 unchanged + 1 delete + 1 new.
// inserts: new (1) + update (1) = 2
// supersedes: update (1) + delete (1) = 2
assert.equal(plan.inserts.length, 2, "two inserts (new + update)");
assert.equal(plan.supersedes.length, 2, "two supersedes (update + delete)");

// Every superseded row carries the nowISO stamp and the actor.
for (const s of plan.supersedes) {
  assert.equal(s.supersededAtISO, nowISO, "superseded row stamped at now");
  assert.equal(s.supersededByUserId, "user_actor", "supersede records actor");
}

// The superseded rows are exactly carol (delete) and ada (update).
const supersededSeats = plan.supersedes.map((s) => s.row.seat).sort();
assert.deepEqual(supersededSeats, ["1", "3"], "ada(update) + carol(delete) superseded");

// Inserts: fresh stamps, cleared supersede, the patched/new payload.
for (const ins of plan.inserts) {
  assert.equal(ins.enteredAtISO, nowISO, "insert has fresh enteredAtISO");
  assert.equal(ins.enteredByUserId, "user_actor", "insert records actor");
  assert.equal(ins.supersededAtISO, null, "insert is current");
  assert.equal(ins.supersededByUserId, null, "insert clears supersededByUserId");
}
const adaInsert = plan.inserts.find((i) => i.seat === "1");
assert.ok(adaInsert, "ada update produced an insert");
assert.equal(adaInsert.office, "Chair", "ada update insert carries patched office");
assert.equal(adaInsert.fullName, "Ada", "ada update insert carries unchanged payload");
const daveInsert = plan.inserts.find((i) => i.seat === "4");
assert.ok(daveInsert, "dave new produced an insert");
assert.equal(daveInsert.office, "Director", "dave insert carries desired payload");

// --- an 'update' produces exactly one supersede + one insert -------------------

const singleUpdate = diffRegister<DirectorRow>([adaCurrent], [adaDesired], {
  keyField: "seat",
});
assert.equal(singleUpdate.length, 1);
assert.equal(singleUpdate[0].op, "update");
const updatePlan = planApply<DirectorRow>(singleUpdate, nowISO, "user_actor");
assert.equal(updatePlan.inserts.length, 1, "update -> exactly one insert");
assert.equal(updatePlan.supersedes.length, 1, "update -> exactly one supersede");
assert.equal(updatePlan.supersedes[0].row, adaCurrent, "update supersedes the current row");

// --- planApply without an actor omits supersededByUserId -----------------------

const noActorPlan = planApply<DirectorRow>(singleUpdate, nowISO);
assert.equal(
  noActorPlan.supersedes[0].supersededByUserId,
  undefined,
  "no actor -> no supersededByUserId on stamp",
);
assert.equal(noActorPlan.inserts[0].enteredByUserId, undefined, "no actor -> no enteredByUserId");

// --- unchanged rows yield nothing ----------------------------------------------

const unchangedDiff = diffRegister<DirectorRow>([benCurrent], [benDesired], {
  keyField: "seat",
});
assert.equal(unchangedDiff[0].op, "unchanged");
const unchangedPlan = planApply<DirectorRow>(unchangedDiff, nowISO, "user_actor");
assert.equal(unchangedPlan.inserts.length, 0, "unchanged -> no inserts");
assert.equal(unchangedPlan.supersedes.length, 0, "unchanged -> no supersedes");

console.log("OK register-diff");
