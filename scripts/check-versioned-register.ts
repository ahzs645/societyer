import assert from "node:assert/strict";

import {
  asOfRows,
  currentRows,
  latestByKey,
  planRevision,
  type VersionedRow,
} from "../shared/versionedRegister";

type DirectorRow = VersionedRow & {
  recordId: string;
  fullName: string;
  office: string;
};

// A director register: Ada added 2020, removed (superseded) 2023; Ben added 2021, still current.
const adaTerm1: DirectorRow = {
  recordId: "ada",
  fullName: "Ada Director",
  office: "President",
  enteredAtISO: "2020-01-15T00:00:00.000Z",
  enteredByUserId: "user_a",
  supersededAtISO: "2023-06-30T00:00:00.000Z",
  supersededByUserId: "user_b",
};
const ben: DirectorRow = {
  recordId: "ben",
  fullName: "Ben Director",
  office: "Secretary",
  enteredAtISO: "2021-03-01T00:00:00.000Z",
  enteredByUserId: "user_a",
  supersededAtISO: null,
};

const register: DirectorRow[] = [adaTerm1, ben];

// currentRows filters superseded rows.
const current = currentRows(register);
assert.equal(current.length, 1, "only Ben is current");
assert.equal(current[0].recordId, "ben");

// asOfRows reconstructs the register at a past date.
const at2021 = asOfRows(register, "2021-06-01T00:00:00.000Z");
const at2021Ids = at2021.map((r) => r.recordId).sort();
assert.deepEqual(at2021Ids, ["ada", "ben"], "both directors present as of 2021");

const at2024 = asOfRows(register, "2024-06-01T00:00:00.000Z");
assert.deepEqual(
  at2024.map((r) => r.recordId),
  ["ben"],
  "Ada absent as of 2024 (removed 2023)",
);

// Boundary: at exactly Ada's enteredAtISO she is present; before it she is absent.
assert.ok(
  asOfRows(register, "2020-01-15T00:00:00.000Z").some((r) => r.recordId === "ada"),
  "Ada present at the instant she was entered",
);
assert.ok(
  !asOfRows(register, "2020-01-01T00:00:00.000Z").some((r) => r.recordId === "ada"),
  "Ada absent before she was entered",
);
// At exactly the supersede instant she is already gone (supersededAtISO > iso is false).
assert.ok(
  !asOfRows(register, "2023-06-30T00:00:00.000Z").some((r) => r.recordId === "ada"),
  "Ada absent at her supersede instant",
);

// planRevision: revise Ben's office, yielding a supersede stamp + a new current row sharing the key.
const nowISO = "2026-06-25T12:00:00.000Z";
const plan = planRevision(ben, { office: "Treasurer" }, nowISO, "user_c");

assert.equal(plan.supersede.supersededAtISO, nowISO, "supersede stamped at now");
assert.equal(plan.supersede.supersededByUserId, "user_c", "supersede records actor");

assert.equal(plan.insert.recordId, ben.recordId, "new row shares the logical key");
assert.equal(plan.insert.office, "Treasurer", "patch applied");
assert.equal(plan.insert.fullName, ben.fullName, "unpatched payload carried over");
assert.equal(plan.insert.enteredAtISO, nowISO, "fresh enteredAtISO");
assert.equal(plan.insert.enteredByUserId, "user_c", "fresh enteredByUserId");
assert.equal(plan.insert.supersededAtISO, null, "new row is current (cleared supersede)");
assert.equal(plan.insert.supersededByUserId, null, "new row clears supersededByUserId");

// The new row IS current; the closed-out original is not.
const supersededBen: DirectorRow = {
  ...ben,
  supersededAtISO: plan.supersede.supersededAtISO,
  supersededByUserId: plan.supersede.supersededByUserId ?? null,
};
const revisedRegister: DirectorRow[] = [adaTerm1, supersededBen, plan.insert as DirectorRow];
const revisedCurrent = currentRows(revisedRegister);
assert.equal(revisedCurrent.length, 1, "exactly one current Ben after revision");
assert.equal(revisedCurrent[0].office, "Treasurer");

// planRevision without an actor omits supersededByUserId on the stamp.
const planNoActor = planRevision(ben, { office: "Chair" }, nowISO);
assert.equal(planNoActor.supersede.supersededByUserId, undefined, "no actor -> no supersededByUserId on stamp");
assert.equal(planNoActor.insert.enteredByUserId, undefined, "no actor -> no enteredByUserId");

// latestByKey: current row per logical key (default 'recordId').
const latest = latestByKey(revisedRegister);
assert.equal(latest.size, 1, "only Ben has a current row");
assert.equal(latest.get("ben")?.office, "Treasurer");
assert.equal(latest.get("ada"), undefined, "Ada has no current row");

// latestByKey honors a custom key field and picks the latest enteredAtISO among current rows.
type SeatRow = VersionedRow & { seat: string; holder: string };
const seatOld: SeatRow = { seat: "1", holder: "Old", enteredAtISO: "2022-01-01T00:00:00.000Z", supersededAtISO: null };
const seatNew: SeatRow = { seat: "1", holder: "New", enteredAtISO: "2025-01-01T00:00:00.000Z", supersededAtISO: null };
const bySeat = latestByKey<SeatRow>([seatOld, seatNew], "seat");
assert.equal(bySeat.size, 1);
assert.equal(bySeat.get("1")?.holder, "New", "latest enteredAtISO wins for a key");

console.log("OK versioned-register");
